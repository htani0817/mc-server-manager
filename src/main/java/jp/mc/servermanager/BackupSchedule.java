package jp.mc.servermanager;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * バックアップの予定。決まった曜日・時刻になったら、MC REST API でバックアップを取り、終わるまで待って結果を残す。
 * 予定は config/mc_server_manager/backup-schedule.json、最後に動いた結果は mc-server-manager/backup-schedule-state.json。
 */
public final class BackupSchedule {
    private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");
    private static final int MAX_TIMES = 8;
    /** バックアップを待つ最長の時間 */
    private static final Duration BACKUP_TIMEOUT = Duration.ofHours(3);

    /** 画面から変えられる予定 */
    public static final class Settings {
        public boolean enabled = false;
        /** 曜日（1=月〜7=日） */
        public List<Integer> days = new ArrayList<>(List.of(1, 2, 3, 4, 5, 6, 7));
        /** 時刻（HH:MM、サーバーの時間帯） */
        public List<String> times = new ArrayList<>(List.of("05:00"));
    }

    private final Path settingsFile;
    private final Path stateFile;
    private final RestApiLink link;
    private final Audit audit;
    private final HttpClient client = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "mc-server-manager-schedule");
        t.setDaemon(true);
        return t;
    });
    private Settings settings;
    private ZonedDateTime next;
    private volatile Instant runningSince;
    private Map<String, Object> lastRun;

    public BackupSchedule(Path settingsFile, Path stateFile, RestApiLink link, Audit audit) {
        this.settingsFile = settingsFile;
        this.stateFile = stateFile;
        this.link = link;
        this.audit = audit;
        this.settings = load(settingsFile);
        this.lastRun = loadState(stateFile);
        this.next = nextAfter(settings, ZonedDateTime.now());
    }

    public void start() {
        // 時刻の判定は 15 秒ごと。予定の時刻から最大 15 秒遅れて始まる
        timer.scheduleAtFixedRate(this::check, 15, 15, TimeUnit.SECONDS);
        if (settings.enabled) {
            McServerManager.LOGGER.info("[mc-server-manager] 次の定期バックアップ: {}", next);
        }
    }

    public void stop() {
        timer.shutdownNow();
    }

    private void check() {
        ZonedDateTime run;
        synchronized (this) {
            if (!settings.enabled || next == null || ZonedDateTime.now().isBefore(next) || runningSince != null) {
                return;
            }
            run = next;
            next = nextAfter(settings, ZonedDateTime.now());
            runningSince = Instant.now();
        }
        McServerManager.LOGGER.info("[mc-server-manager] 定期バックアップの時刻（{}）になりました", run.toLocalTime());
        execute("schedule");
    }

    /** 画面の「いま実行」からも呼ぶ。実行中なら false */
    public boolean runNow() {
        synchronized (this) {
            if (runningSince != null) {
                return false;
            }
            runningSince = Instant.now();
        }
        Thread.ofVirtual().name("mc-server-manager-schedule-run").start(() -> execute("manual"));
        return true;
    }

    // ---- 実行 ----

    /** 呼ぶ前に runningSince を入れておく（同時に 2 つ動かないように） */
    private void execute(String trigger) {
        Instant started = runningSince;
        String result;
        String detail = null;
        String backupFile = null;
        try {
            JsonObject job = startBackup();
            job = waitBackup(job.get("id").getAsString());
            backupFile = job.has("file") && !job.get("file").isJsonNull() ? job.get("file").getAsString() : null;
            if ("done".equals(job.get("state").getAsString())) {
                result = "done";
                McServerManager.LOGGER.info("[mc-server-manager] 定期バックアップ {} を作りました", backupFile);
            } else {
                result = "backup_failed";
                detail = job.has("error") && !job.get("error").isJsonNull() ? job.get("error").getAsString() : "バックアップが終わりませんでした";
                McServerManager.LOGGER.error("[mc-server-manager] 定期バックアップに失敗しました: {}", detail);
            }
        } catch (Exception e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            result = "error";
            detail = e.getMessage() == null ? e.toString() : e.getMessage();
            McServerManager.LOGGER.error("[mc-server-manager] 定期バックアップを進められませんでした: {}", detail);
        } finally {
            synchronized (this) {
                runningSince = null;
            }
        }
        saveState(record(trigger, started, result, detail, backupFile));
    }

    private JsonObject startBackup() throws IOException, InterruptedException {
        try {
            return call("POST", "/api/v1/backups", "{}").getAsJsonObject();
        } catch (ApiCallException e) {
            if (e.status != 409) {
                throw e;
            }
            // 画面から作っている最中なら、それが終わるのを待って使う
            for (JsonElement j : call("GET", "/api/v1/backups/jobs", null).getAsJsonArray()) {
                if ("running".equals(j.getAsJsonObject().get("state").getAsString())) {
                    return j.getAsJsonObject();
                }
            }
            throw e;
        }
    }

    private JsonObject waitBackup(String id) throws IOException, InterruptedException {
        Instant limit = Instant.now().plus(BACKUP_TIMEOUT);
        while (Instant.now().isBefore(limit)) {
            JsonObject j = call("GET", "/api/v1/backups/jobs/" + id, null).getAsJsonObject();
            if (!"running".equals(j.get("state").getAsString())) {
                return j;
            }
            Thread.sleep(2000);
        }
        JsonObject timeout = new JsonObject();
        timeout.addProperty("state", "failed");
        timeout.addProperty("error", BACKUP_TIMEOUT.toHours() + " 時間たってもバックアップが終わりませんでした");
        return timeout;
    }

    static final class ApiCallException extends IOException {
        final int status;

        ApiCallException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    /** MC REST API を admin トークンで呼び、応答の data を返す */
    private JsonElement call(String method, String path, String body) throws IOException, InterruptedException {
        String token = link.adminToken();
        if (token == null) {
            throw new IOException("MC REST API の admin トークンを読めません");
        }
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(link.base() + path))
                .header("Authorization", "Bearer " + token)
                .timeout(Duration.ofSeconds(30));
        if (body != null) {
            rb.header("Content-Type", "application/json");
            rb.method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        } else {
            rb.method(method, HttpRequest.BodyPublishers.noBody());
        }
        HttpResponse<String> res = client.send(rb.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (!method.equals("GET")) {
            audit.write("schedule", method, path, res.statusCode());
        }
        JsonObject o;
        try {
            o = JsonParser.parseString(res.body()).getAsJsonObject();
        } catch (RuntimeException e) {
            throw new ApiCallException(res.statusCode(), path + " の応答を読めません（HTTP " + res.statusCode() + "）");
        }
        if (res.statusCode() >= 400) {
            String msg = o.has("error") ? o.getAsJsonObject("error").get("message").getAsString() : "HTTP " + res.statusCode();
            throw new ApiCallException(res.statusCode(), path + ": " + msg);
        }
        return o.get("data");
    }

    private static Map<String, Object> record(String trigger, Instant started, String result, String detail, String backupFile) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("trigger", trigger);
        m.put("startedAt", started.toString());
        m.put("finishedAt", Instant.now().toString());
        m.put("result", result);
        m.put("detail", detail);
        m.put("backupFile", backupFile);
        return m;
    }

    private synchronized void saveState(Map<String, Object> run) {
        lastRun = run;
        try {
            Files.createDirectories(stateFile.getParent());
            Files.writeString(stateFile, ManagerConfig.GSON.toJson(run) + "\n", StandardCharsets.UTF_8);
        } catch (IOException e) {
            McServerManager.LOGGER.warn("[mc-server-manager] 定期バックアップの結果を書けませんでした: {}", e.toString());
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> loadState(Path file) {
        try {
            return Files.isRegularFile(file) ? ManagerConfig.GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Map.class) : null;
        } catch (IOException | JsonParseException e) {
            return null;
        }
    }

    // ---- 予定 ----

    public synchronized Settings settings() {
        return settings;
    }

    /** 画面に返す今の状態 */
    public synchronized Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("settings", settings);
        m.put("timezone", ZoneId.systemDefault().getId());
        m.put("nextRunAt", settings.enabled && next != null ? next.toInstant().toString() : null);
        m.put("running", runningSince != null);
        m.put("runningSince", runningSince == null ? null : runningSince.toString());
        m.put("lastRun", lastRun);
        return m;
    }

    /** 画面からの保存。正しくなければ IllegalArgumentException（文言は画面にそのまま出す） */
    public synchronized void update(JsonObject body) throws IOException {
        Settings s = ManagerConfig.GSON.fromJson(body, Settings.class);
        validate(s);
        Files.createDirectories(settingsFile.getParent());
        Files.writeString(settingsFile, ManagerConfig.GSON.toJson(s) + "\n", StandardCharsets.UTF_8);
        settings = s;
        next = nextAfter(s, ZonedDateTime.now());
        McServerManager.LOGGER.info("[mc-server-manager] 定期バックアップの予定を変えました（{}、次は {}）", s.enabled ? "有効" : "無効", s.enabled ? next : "なし");
    }

    static void validate(Settings s) {
        if (s == null) {
            throw new IllegalArgumentException("予定が空です");
        }
        if (s.days == null) {
            s.days = new ArrayList<>();
        }
        if (s.times == null) {
            s.times = new ArrayList<>();
        }
        TreeSet<Integer> days = new TreeSet<>();
        for (Integer d : s.days) {
            if (d == null || d < 1 || d > 7) {
                throw new IllegalArgumentException("曜日は 1（月）〜7（日）で指定してください");
            }
            days.add(d);
        }
        TreeSet<String> times = new TreeSet<>();
        for (String t : s.times) {
            if (t == null || !TIME.matcher(t.trim()).matches()) {
                throw new IllegalArgumentException("時刻は 00:00〜23:59 の形で指定してください: " + t);
            }
            times.add(t.trim());
        }
        if (times.size() > MAX_TIMES) {
            throw new IllegalArgumentException("時刻は " + MAX_TIMES + " 個までです");
        }
        if (s.enabled && (days.isEmpty() || times.isEmpty())) {
            throw new IllegalArgumentException("有効にするときは、曜日と時刻を 1 つ以上選んでください");
        }
        s.days = new ArrayList<>(days);
        s.times = new ArrayList<>(times);
    }

    /** now より後で、いちばん近い予定の時刻。無ければ null */
    static ZonedDateTime nextAfter(Settings s, ZonedDateTime now) {
        if (s.days.isEmpty() || s.times.isEmpty()) {
            return null;
        }
        ZonedDateTime best = null;
        LocalDate today = now.toLocalDate();
        for (int i = 0; i <= 7; i++) {
            LocalDate d = today.plusDays(i);
            if (!s.days.contains(d.getDayOfWeek().getValue())) {
                continue;
            }
            for (String t : s.times) {
                ZonedDateTime c = d.atTime(LocalTime.parse(t)).atZone(now.getZone());
                if (c.isAfter(now) && (best == null || c.isBefore(best))) {
                    best = c;
                }
            }
            if (best != null) {
                return best;
            }
        }
        return best;
    }

    private static Settings load(Path file) {
        Settings s = null;
        if (Files.isRegularFile(file)) {
            try {
                s = ManagerConfig.GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Settings.class);
                validate(s);
            } catch (IOException | RuntimeException e) {
                McServerManager.LOGGER.error("[mc-server-manager] {} を読めないので、定期バックアップは止めておきます: {}", file, e.getMessage());
                s = new Settings();
            }
        }
        return s == null ? new Settings() : s;
    }
}
