package jp.mc.servermanager;

import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 管理画面のサーバー。jar に入れた画面を返し、/api/v1 を MC REST API へ中継する（admin トークンはここで付ける）。
 */
public final class WebServer {
    /** 書き込み系リクエストに必須のヘッダー（別サイトからのフォーム送信を防ぐ） */
    static final String CSRF_HEADER = "X-MC-Manager";
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");
    private static final Set<String> FORWARD_RESPONSE_HEADERS = Set.of("content-type", "content-disposition", "cache-control");
    private static final Map<String, String> MIME = Map.ofEntries(
            Map.entry("html", "text/html; charset=utf-8"),
            Map.entry("js", "text/javascript; charset=utf-8"),
            Map.entry("css", "text/css; charset=utf-8"),
            Map.entry("json", "application/json; charset=utf-8"),
            Map.entry("svg", "image/svg+xml"),
            Map.entry("png", "image/png"),
            Map.entry("ico", "image/x-icon"),
            Map.entry("woff2", "font/woff2"),
            Map.entry("woff", "font/woff"),
            Map.entry("txt", "text/plain; charset=utf-8"));
    private static final String CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            + "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    /** jar の中の画面の置き場 */
    private static final String WEB_ROOT = "/web/";

    private final ManagerConfig config;
    private final AccessGuard guard;
    private final RestApiLink link;
    private final Audit audit;
    private final Metrics metrics;
    private final Playtime playtime;
    private final RestartSchedule schedule;
    private final HttpClient client;
    /** 画面のファイルは jar から一度読んだら覚えておく（無いものは空で覚える） */
    private final Map<String, Optional<byte[]>> assets = new ConcurrentHashMap<>();
    private HttpServer server;
    private ExecutorService executor;

    public WebServer(ManagerConfig config, AccessGuard guard, RestApiLink link, Audit audit,
                     Metrics metrics, Playtime playtime, RestartSchedule schedule) {
        this.config = config;
        this.guard = guard;
        this.link = link;
        this.audit = audit;
        this.metrics = metrics;
        this.playtime = playtime;
        this.schedule = schedule;
        this.client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(config.bindAddress, config.port), 128);
        executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/", this::handle);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(1);
            server = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    private void handle(HttpExchange ex) {
        // try-with-resources だと catch より先に閉じてエラーを返せないので、finally で閉じる
        try {
            Headers h = ex.getResponseHeaders();
            h.set("X-Content-Type-Options", "nosniff");
            h.set("Referrer-Policy", "same-origin");
            h.set("X-Frame-Options", "DENY");
            if (!guard.clientAllowed(ex.getRemoteAddress().getAddress())) {
                text(ex, 403, "この接続元（" + ip(ex) + "）からは開けません。"
                        + "config/mc_server_manager/config.json の allowedNetworks に足してください");
                return;
            }
            String host = ex.getRequestHeaders().getFirst("Host");
            if (!guard.hostAllowed(host)) {
                text(ex, 403, "このアドレス（" + host + "）では開けません。IP アドレスで開くか、"
                        + "config/mc_server_manager/config.json の allowedHosts にホスト名を足してください");
                return;
            }
            String path = ex.getRequestURI().getRawPath();
            if (path.startsWith("/api/")) {
                proxy(ex);
            } else if (path.startsWith("/manager/")) {
                local(ex, path);
            } else {
                serveStatic(ex, path);
            }
        } catch (Throwable t) {
            McServerManager.LOGGER.warn("[mc-server-manager] リクエスト処理中にエラー: {}", t.toString());
            try {
                if (ex.getResponseCode() == -1) {
                    json(ex, 500, error("internal_error", t.getClass().getSimpleName()));
                }
            } catch (IOException ignored) {
                // 切断済み
            }
        } finally {
            ex.close();
        }
    }

    private static boolean hasCsrfHeader(HttpExchange ex) {
        return "1".equals(ex.getRequestHeaders().getFirst(CSRF_HEADER));
    }

    // ---- API の中継 ----

    private void proxy(HttpExchange ex) throws IOException {
        String method = ex.getRequestMethod().toUpperCase(Locale.ROOT);
        String rawPath = ex.getRequestURI().getRawPath();
        String rawQuery = ex.getRequestURI().getRawQuery();
        if (!rawPath.startsWith("/api/v1/") || rawPath.contains("..")) {
            json(ex, 404, error("not_found", "ありません"));
            return;
        }
        if (!SAFE_METHODS.contains(method) && !hasCsrfHeader(ex)) {
            json(ex, 403, error("csrf", CSRF_HEADER + " ヘッダーが必要です"));
            return;
        }
        String token = link.adminToken();
        if (token == null) {
            json(ex, 503, error("no_token", "MC REST API の tokens.json をまだ読めません（起動中か、admin のトークンがありません）"));
            return;
        }

        URI target = URI.create(link.base() + rawPath + (rawQuery == null ? "" : "?" + rawQuery));
        boolean stream = rawPath.equals("/api/v1/events");
        HttpRequest.Builder rb = HttpRequest.newBuilder(target).header("Authorization", "Bearer " + token);
        String ct = ex.getRequestHeaders().getFirst("Content-Type");
        if (ct != null) {
            rb.header("Content-Type", ct);
        }
        if (!stream) {
            // アップロードやバックアップのダウンロードを考えて長めにする
            rb.timeout(Duration.ofMinutes(10));
        }
        boolean hasBody = method.equals("POST") || method.equals("PUT") || method.equals("PATCH");
        InputStream reqBody = ex.getRequestBody();
        rb.method(method, hasBody ? HttpRequest.BodyPublishers.ofInputStream(() -> reqBody) : HttpRequest.BodyPublishers.noBody());

        HttpResponse<InputStream> res;
        try {
            res = client.send(rb.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (ConnectException e) {
            json(ex, 502, error("upstream_unavailable", "MC REST API につながりません（" + link.base() + "）"));
            return;
        } catch (HttpTimeoutException e) {
            json(ex, 504, error("upstream_timeout", "MC REST API が時間内に応答しませんでした"));
            return;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }

        int status = res.statusCode();
        // チケットは画面を開くたびに出るので、操作の記録には残さない
        if (!SAFE_METHODS.contains(method) && !rawPath.equals("/api/v1/events/ticket")) {
            audit.write(ip(ex), method, rawPath, status);
        }
        res.headers().map().forEach((k, v) -> {
            if (FORWARD_RESPONSE_HEADERS.contains(k.toLowerCase(Locale.ROOT)) && !v.isEmpty()) {
                ex.getResponseHeaders().set(k, v.getFirst());
            }
        });
        long length = res.headers().firstValueAsLong("Content-Length").orElse(-1);
        try (InputStream in = res.body()) {
            if (length == 0 || method.equals("HEAD")) {
                ex.sendResponseHeaders(status, -1);
                return;
            }
            ex.sendResponseHeaders(status, length > 0 ? length : 0);
            OutputStream out = ex.getResponseBody();
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (stream) {
                    // SSE は 1 イベントずつ届けたいので毎回流す
                    out.flush();
                }
            }
            out.flush();
        } catch (IOException e) {
            // ブラウザ側の切断（SSE を閉じたなど）
        }
    }

    // ---- この Mod 自身の記録 ----

    /** 表示する範囲の選択肢（ミリ秒） */
    private static final Map<String, Long> RANGES = Map.of(
            "1h", 3_600_000L, "6h", 21_600_000L, "24h", 86_400_000L, "7d", 7 * 86_400_000L, "30d", 30 * 86_400_000L);

    private void local(HttpExchange ex, String path) throws IOException {
        String method = ex.getRequestMethod().toUpperCase(Locale.ROOT);
        if (!method.equals("GET")) {
            if (!hasCsrfHeader(ex)) {
                json(ex, 403, error("csrf", CSRF_HEADER + " ヘッダーが必要です"));
                return;
            }
            int status = localWrite(ex, method, path);
            audit.write(ip(ex), method, path, status);
            return;
        }
        Map<String, String> query = query(ex);
        if (path.equals("/manager/metrics")) {
            if (metrics == null) {
                json(ex, 503, error("no_metrics", "メトリクスを記録できていません（起動ログを見てください）"));
                return;
            }
            long now = System.currentTimeMillis();
            long span = RANGES.getOrDefault(query.getOrDefault("range", "1h"), 3_600_000L);
            long to = parseLong(query.get("to"), now);
            long from = parseLong(query.get("from"), to - span);
            if (from >= to || to - from > 31 * 86_400_000L) {
                json(ex, 400, error("bad_request", "from〜to は 31 日以内で指定してください"));
                return;
            }
            json(ex, 200, Map.of("data", metrics.query(from, to, parseLong(query.get("step"), 0))));
            return;
        }
        if (path.equals("/manager/ranking") || path.equals("/manager/ranking.csv")) {
            if (playtime == null) {
                json(ex, 503, error("no_playtime", "接続時間を記録できていません（起動ログを見てください）"));
                return;
            }
            String period = query.getOrDefault("period", "all");
            if (!Playtime.PERIODS.contains(period)) {
                json(ex, 400, error("bad_request", "period は " + String.join("・", Playtime.PERIODS) + " のどれかです"));
                return;
            }
            Map<String, Object> r = playtime.ranking(period);
            if (path.endsWith(".csv")) {
                byte[] body = Playtime.toCsv(r).getBytes(StandardCharsets.UTF_8);
                String date = java.time.LocalDate.now().toString();
                ex.getResponseHeaders().set("Content-Type", "text/csv; charset=utf-8");
                ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"playtime-" + period + "-" + date + ".csv\"");
                ex.getResponseHeaders().set("Cache-Control", "no-store");
                ex.sendResponseHeaders(200, body.length);
                try (OutputStream out = ex.getResponseBody()) {
                    out.write(body);
                }
                return;
            }
            json(ex, 200, Map.of("data", r));
            return;
        }
        if (path.equals("/manager/schedule")) {
            json(ex, 200, Map.of("data", schedule.view()));
            return;
        }
        if (path.equals("/manager/audit")) {
            List<Map<String, Object>> files = new ArrayList<>();
            for (Path f : audit.files()) {
                String n = f.getFileName().toString();
                files.add(Map.of(
                        "name", n,
                        "date", n.substring(6, 16),
                        "size", Files.size(f),
                        "modified", Files.getLastModifiedTime(f).toInstant().toString()));
            }
            json(ex, 200, Map.of("data", Map.of("keepDays", audit.keep(), "files", files)));
            return;
        }
        if (path.startsWith("/manager/audit/")) {
            String name = path.substring("/manager/audit/".length());
            if (!Audit.NAME.matcher(name).matches()) {
                json(ex, 400, error("bad_request", "記録のファイル名ではありません"));
                return;
            }
            Path f = audit.dir().resolve(name);
            if (!Files.isRegularFile(f)) {
                json(ex, 404, error("not_found", "ありません（古いものは消えています）"));
                return;
            }
            long size = Files.size(f);
            ex.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
            ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"mc-server-manager-" + name + "\"");
            ex.getResponseHeaders().set("Cache-Control", "no-store");
            ex.sendResponseHeaders(200, size == 0 ? -1 : size);
            if (size > 0) {
                // 書き込み中でも最初に測った大きさまでで止める
                try (InputStream in = Files.newInputStream(f); OutputStream out = ex.getResponseBody()) {
                    out.write(in.readNBytes((int) Math.min(size, Integer.MAX_VALUE)));
                }
            }
            return;
        }
        json(ex, 404, error("not_found", "ありません"));
    }

    /** 予定の保存といま実行。返した状態コードを操作の記録に残す */
    private int localWrite(HttpExchange ex, String method, String path) throws IOException {
        if (path.equals("/manager/schedule") && method.equals("PUT")) {
            byte[] raw = ex.getRequestBody().readNBytes(64 * 1024);
            try {
                schedule.update(JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject());
            } catch (IllegalArgumentException | IllegalStateException | JsonParseException e) {
                json(ex, 400, error("bad_request", e.getMessage() == null ? "予定を読めません" : e.getMessage()));
                return 400;
            }
            json(ex, 200, Map.of("data", schedule.view()));
            return 200;
        }
        if (path.equals("/manager/schedule/run") && method.equals("POST")) {
            if (!schedule.runNow()) {
                json(ex, 409, error("running", "もう実行中です"));
                return 409;
            }
            json(ex, 202, Map.of("data", schedule.view()));
            return 202;
        }
        json(ex, 405, error("method_not_allowed", "この操作はできません"));
        return 405;
    }

    private static Map<String, String> query(HttpExchange ex) {
        Map<String, String> out = new java.util.HashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw == null) {
            return out;
        }
        for (String kv : raw.split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0) {
                out.put(URLDecoder.decode(kv.substring(0, eq), StandardCharsets.UTF_8), URLDecoder.decode(kv.substring(eq + 1), StandardCharsets.UTF_8));
            }
        }
        return out;
    }

    private static long parseLong(String s, long def) {
        try {
            return s == null || s.isEmpty() ? def : Long.parseLong(s);
        } catch (NumberFormatException e) {
            return def;
        }
    }

    // ---- 画面（jar の web/） ----

    private void serveStatic(HttpExchange ex, String rawPath) throws IOException {
        String method = ex.getRequestMethod();
        if (!method.equals("GET") && !method.equals("HEAD")) {
            json(ex, 405, error("method_not_allowed", "GET だけです"));
            return;
        }
        String rel = URLDecoder.decode(rawPath.replace("+", "%2B"), StandardCharsets.UTF_8).replaceFirst("^/+", "");
        String last = rel.substring(rel.lastIndexOf('/') + 1);
        byte[] body = null;
        if (!rel.contains("..") && !rel.contains("\\") && last.contains(".")) {
            body = asset(rel);
        }
        if (body == null) {
            // 画面内の URL（/players など）は index.html を返して React に任せる
            rel = "index.html";
            body = asset(rel);
        }
        if (body == null) {
            json(ex, 500, error("no_web", "画面のファイルが jar に入っていません"));
            return;
        }
        String ext = rel.contains(".") ? rel.substring(rel.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        Headers h = ex.getResponseHeaders();
        h.set("Content-Type", MIME.getOrDefault(ext, "application/octet-stream"));
        // Vite のビルド成果物はファイル名にハッシュが付くので長くキャッシュしてよい
        h.set("Cache-Control", rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
        if (ext.equals("html")) {
            h.set("Content-Security-Policy", CSP);
        }
        if (method.equals("HEAD")) {
            ex.sendResponseHeaders(200, -1);
            return;
        }
        ex.sendResponseHeaders(200, body.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(body);
        }
    }

    private byte[] asset(String rel) {
        return assets.computeIfAbsent(rel, r -> {
            try (InputStream in = WebServer.class.getResourceAsStream(WEB_ROOT + r)) {
                return in == null ? Optional.empty() : Optional.of(in.readAllBytes());
            } catch (IOException e) {
                return Optional.empty();
            }
        }).orElse(null);
    }

    // ---- 共通 ----

    private static String ip(HttpExchange ex) {
        return ex.getRemoteAddress().getAddress().getHostAddress();
    }

    private static Map<String, Object> error(String code, String message) {
        return Map.of("error", Map.of("code", code, "message", message));
    }

    private static void json(HttpExchange ex, int status, Object body) throws IOException {
        send(ex, status, "application/json; charset=utf-8", ManagerConfig.RESPONSE.toJson(body));
    }

    private static void text(HttpExchange ex, int status, String body) throws IOException {
        send(ex, status, "text/plain; charset=utf-8", body + "\n");
    }

    private static void send(HttpExchange ex, int status, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", type);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(bytes);
        }
    }
}
