package jp.mc.servermanager;

import com.sun.management.OperatingSystemMXBean;
import net.minecraft.server.MinecraftServer;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * マシンと Minecraft の状態を一定間隔で記録する。サーバーを止めても残るよう、
 * mc-server-manager/metrics/metrics-YYYY-MM-DD.csv に 1 日 1 ファイルで書き、直近 keep 日分だけ残す。
 * 起動した時刻は starts.log に書く（グラフに「起動」の印を出すため）。
 */
public final class Metrics implements AutoCloseable {
    static final Pattern NAME = Pattern.compile("^metrics-(\\d{4}-\\d{2}-\\d{2})\\.csv$");
    /** CSV の列。増やすときは後ろに足す（読むときは見出しの名前で探すので、古いファイルも読める） */
    static final String[] COLUMNS = {
            "t", "tps", "mspt", "players", "cpuSystem", "cpuProcess",
            "memTotal", "memUsed", "processRss", "heapUsed", "heapMax",
            "diskTotal", "diskUsed", "ioRead", "ioWrite"};
    /** まとめるときに平均でなく最大を取る列（人数は「その間に何人いたか」を見たいので） */
    private static final java.util.Set<String> MAX_COLUMNS = java.util.Set.of("players");
    /** 1 回の取得で返す点の数の目安 */
    private static final int TARGET_POINTS = 360;

    private final Path dir;
    private final int keep;
    private final int intervalSeconds;
    private final MinecraftServer server;
    private final Path gameDir;
    private LocalDate current;
    private BufferedWriter writer;
    /** 前回の読み書きバイト数（/proc/self/io の差分から毎秒の量を出す） */
    private long lastIoAt;
    private long lastIoRead = -1;
    private long lastIoWrite = -1;

    public Metrics(Path dir, int keep, int intervalSeconds, MinecraftServer server, Path gameDir) throws IOException {
        this.dir = dir;
        this.keep = Math.max(1, keep);
        this.intervalSeconds = Math.max(1, intervalSeconds);
        this.server = server;
        this.gameDir = gameDir;
        Files.createDirectories(dir);
        prune();
        markStart();
        // CPU 使用率は前回の呼び出しからの値なので、1 回空読みしておく（最初の値が 100% などになるのを防ぐ）
        if (ManagementFactory.getOperatingSystemMXBean() instanceof OperatingSystemMXBean os) {
            os.getCpuLoad();
            os.getProcessCpuLoad();
        }
    }

    public int intervalSeconds() {
        return intervalSeconds;
    }

    public int keep() {
        return keep;
    }

    // ---- 記録 ----

    /** 定期的に呼ばれる。1 行書く */
    public synchronized void sample() {
        try {
            Map<String, Double> v = collect();
            LocalDate today = LocalDate.now();
            if (writer == null || !today.equals(current)) {
                if (writer != null) {
                    writer.close();
                }
                Path f = dir.resolve("metrics-" + today + ".csv");
                boolean fresh = !Files.exists(f);
                writer = Files.newBufferedWriter(f, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                if (fresh) {
                    writer.write(String.join(",", COLUMNS));
                    writer.newLine();
                }
                current = today;
                prune();
            }
            StringBuilder sb = new StringBuilder();
            sb.append(System.currentTimeMillis());
            for (int i = 1; i < COLUMNS.length; i++) {
                sb.append(',');
                Double d = v.get(COLUMNS[i]);
                if (d != null && !d.isNaN() && !d.isInfinite()) {
                    sb.append(d == Math.rint(d) && Math.abs(d) < 1e15 ? Long.toString(d.longValue()) : String.format(java.util.Locale.ROOT, "%.4f", d));
                }
            }
            writer.write(sb.toString());
            writer.newLine();
            writer.flush();
        } catch (IOException | RuntimeException e) {
            // 記録できなくてもサーバーは止めない
            McServerManager.LOGGER.debug("[mc-server-manager] メトリクスを書けませんでした: {}", e.toString());
        }
    }

    private Map<String, Double> collect() {
        Map<String, Double> v = new HashMap<>();
        // サーバースレッドの外から読むが、どれも数値を 1 つ読むだけなので待たずに済ませる
        double mspt = server.getAverageTickTimeNanos() / 1_000_000.0;
        double target = server.tickRateManager().tickrate();
        v.put("mspt", mspt);
        v.put("tps", Math.min(target, mspt <= 0 ? target : 1000.0 / mspt));
        v.put("players", (double) server.getPlayerCount());

        if (ManagementFactory.getOperatingSystemMXBean() instanceof OperatingSystemMXBean os) {
            double sys = os.getCpuLoad();
            double proc = os.getProcessCpuLoad();
            // 取れないときは負の値が返る
            if (sys >= 0) {
                v.put("cpuSystem", sys * 100);
            }
            if (proc >= 0) {
                v.put("cpuProcess", proc * 100);
            }
            v.put("memTotal", (double) os.getTotalMemorySize());
            v.put("memUsed", (double) (os.getTotalMemorySize() - os.getFreeMemorySize()));
        }
        // Linux の「空き」はキャッシュを含まないので、使える量（MemAvailable）から使用量を出し直す
        Map<String, Long> meminfo = procKb(Path.of("/proc/meminfo"));
        if (meminfo.containsKey("MemTotal") && meminfo.containsKey("MemAvailable")) {
            v.put("memTotal", (double) meminfo.get("MemTotal"));
            v.put("memUsed", (double) (meminfo.get("MemTotal") - meminfo.get("MemAvailable")));
        }
        Long rss = procKb(Path.of("/proc/self/status")).get("VmRSS");
        if (rss != null) {
            v.put("processRss", (double) rss);
        }

        MemoryMXBean mem = ManagementFactory.getMemoryMXBean();
        v.put("heapUsed", (double) mem.getHeapMemoryUsage().getUsed());
        v.put("heapMax", (double) Runtime.getRuntime().maxMemory());

        try {
            FileStore store = Files.getFileStore(gameDir);
            v.put("diskTotal", (double) store.getTotalSpace());
            v.put("diskUsed", (double) (store.getTotalSpace() - store.getUsableSpace()));
        } catch (IOException ignored) {
            // 取れない環境では空のまま
        }
        readIo(v);
        return v;
    }

    /** /proc/self/io の read_bytes・write_bytes（実際にディスクへ行った量）から毎秒の量を出す。Linux だけ */
    private void readIo(Map<String, Double> v) {
        Map<String, Long> io = procRaw(Path.of("/proc/self/io"));
        Long r = io.get("read_bytes");
        Long w = io.get("write_bytes");
        long now = System.nanoTime();
        if (r == null || w == null) {
            return;
        }
        if (lastIoRead >= 0) {
            double sec = (now - lastIoAt) / 1e9;
            if (sec > 0) {
                v.put("ioRead", Math.max(0, (r - lastIoRead) / sec));
                v.put("ioWrite", Math.max(0, (w - lastIoWrite) / sec));
            }
        }
        lastIoAt = now;
        lastIoRead = r;
        lastIoWrite = w;
    }

    /** 「名前: 数値 kB」の形のファイルを読み、バイトにして返す。読めなければ空 */
    private static Map<String, Long> procKb(Path file) {
        Map<String, Long> raw = procRaw(file);
        Map<String, Long> out = new HashMap<>();
        raw.forEach((k, n) -> out.put(k, n * 1024));
        return out;
    }

    private static Map<String, Long> procRaw(Path file) {
        Map<String, Long> out = new HashMap<>();
        if (!Files.isReadable(file)) {
            return out;
        }
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                int c = line.indexOf(':');
                if (c <= 0) {
                    continue;
                }
                String[] parts = line.substring(c + 1).trim().split("\\s+");
                try {
                    out.put(line.substring(0, c).trim(), Long.parseLong(parts[0]));
                } catch (NumberFormatException ignored) {
                    // 数値でない行は飛ばす
                }
            }
        } catch (IOException ignored) {
            // 読めなければ空
        }
        return out;
    }

    private void markStart() {
        Path f = dir.resolve("starts.log");
        long now = System.currentTimeMillis();
        long limit = now - keep * 86_400_000L;
        try {
            List<String> lines = new ArrayList<>();
            for (long s : starts()) {
                if (s >= limit) {
                    lines.add(Long.toString(s));
                }
            }
            lines.add(Long.toString(now));
            Files.write(f, lines, StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // 印が出ないだけ
        }
    }

    private List<Long> starts() {
        List<Long> out = new ArrayList<>();
        Path f = dir.resolve("starts.log");
        if (!Files.isRegularFile(f)) {
            return out;
        }
        try {
            for (String line : Files.readAllLines(f, StandardCharsets.UTF_8)) {
                try {
                    out.add(Long.parseLong(line.trim()));
                } catch (NumberFormatException ignored) {
                    // 壊れた行は飛ばす
                }
            }
        } catch (IOException ignored) {
            // 読めなければ空
        }
        return out;
    }

    public synchronized void prune() {
        List<Path> files = files();
        for (int i = keep; i < files.size(); i++) {
            try {
                Files.deleteIfExists(files.get(i));
            } catch (IOException ignored) {
                // 次の機会に消す
            }
        }
    }

    /** 日付の新しい順 */
    private List<Path> files() {
        List<Path> out = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            s.filter(p -> NAME.matcher(p.getFileName().toString()).matches()).forEach(out::add);
        } catch (IOException ignored) {
            return out;
        }
        out.sort(Comparator.comparing((Path p) -> p.getFileName().toString()).reversed());
        return out;
    }

    @Override
    public synchronized void close() throws IOException {
        if (writer != null) {
            writer.close();
            writer = null;
        }
    }

    // ---- 読み出し ----

    /**
     * from〜to（ミリ秒）を step ごとにまとめて返す。点の無い区間は null（グラフの線が切れる）。
     * step を 0 にすると、点がおよそ TARGET_POINTS 個になる幅を選ぶ。
     */
    public Map<String, Object> query(long from, long to, long step) {
        long span = Math.max(1, to - from);
        long base = intervalSeconds * 1000L;
        if (step <= 0) {
            step = niceStep(Math.max(base, span / TARGET_POINTS));
        }
        step = Math.max(base, step);
        // 区切りを step の倍数にそろえると、取り直しても点が横にずれない
        long start = Math.floorDiv(from, step) * step;
        int n = (int) Math.min(5000, Math.max(1, (to - start + step - 1) / step));
        int cols = COLUMNS.length - 1;
        double[][] sum = new double[cols][n];
        int[][] cnt = new int[cols][n];
        double[][] max = new double[cols][n];

        ZoneId zone = ZoneId.systemDefault();
        LocalDate d0 = Instant.ofEpochMilli(from).atZone(zone).toLocalDate();
        LocalDate d1 = Instant.ofEpochMilli(to).atZone(zone).toLocalDate();
        synchronized (this) {
            if (writer != null) {
                try {
                    writer.flush();
                } catch (IOException ignored) {
                    // 読めた分だけ返す
                }
            }
        }
        for (LocalDate d = d0; !d.isAfter(d1); d = d.plusDays(1)) {
            Path f = dir.resolve("metrics-" + d + ".csv");
            if (!Files.isRegularFile(f)) {
                continue;
            }
            readInto(f, start, to, step, n, sum, cnt, max);
        }

        List<Long> times = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            times.add(start + i * step);
        }
        Map<String, Object> series = new LinkedHashMap<>();
        for (int c = 0; c < cols; c++) {
            String name = COLUMNS[c + 1];
            boolean useMax = MAX_COLUMNS.contains(name);
            List<Double> vals = new ArrayList<>(n);
            for (int i = 0; i < n; i++) {
                if (cnt[c][i] == 0) {
                    vals.add(null);
                } else {
                    double v = useMax ? max[c][i] : sum[c][i] / cnt[c][i];
                    vals.add(Math.round(v * 100.0) / 100.0);
                }
            }
            series.put(name, vals);
        }
        List<Long> st = new ArrayList<>();
        for (long s : starts()) {
            if (s >= from && s <= to) {
                st.add(s);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", start);
        out.put("to", to);
        out.put("step", step);
        out.put("intervalSeconds", intervalSeconds);
        out.put("keepDays", keep);
        out.put("times", times);
        out.put("series", series);
        out.put("starts", st);
        out.put("processRssAvailable", Files.isReadable(Path.of("/proc/self/status")));
        out.put("ioAvailable", Files.isReadable(Path.of("/proc/self/io")));
        return out;
    }

    private static void readInto(Path f, long start, long to, long step, int n,
                                 double[][] sum, int[][] cnt, double[][] max) {
        try (BufferedReader r = Files.newBufferedReader(f, StandardCharsets.UTF_8)) {
            String header = r.readLine();
            if (header == null) {
                return;
            }
            // 見出しの並びから、COLUMNS の何番目がファイルの何列目かを決める
            String[] names = header.split(",", -1);
            int[] map = new int[COLUMNS.length];
            java.util.Arrays.fill(map, -1);
            for (int i = 0; i < names.length; i++) {
                for (int c = 0; c < COLUMNS.length; c++) {
                    if (COLUMNS[c].equals(names[i].trim())) {
                        map[c] = i;
                    }
                }
            }
            if (map[0] < 0) {
                return;
            }
            String line;
            while ((line = r.readLine()) != null) {
                String[] p = line.split(",", -1);
                long t;
                try {
                    t = Long.parseLong(p[map[0]]);
                } catch (NumberFormatException | ArrayIndexOutOfBoundsException e) {
                    continue;
                }
                if (t < start || t > to) {
                    continue;
                }
                int b = (int) ((t - start) / step);
                if (b < 0 || b >= n) {
                    continue;
                }
                for (int c = 1; c < COLUMNS.length; c++) {
                    int idx = map[c];
                    if (idx < 0 || idx >= p.length || p[idx].isEmpty()) {
                        continue;
                    }
                    try {
                        double v = Double.parseDouble(p[idx]);
                        sum[c - 1][b] += v;
                        if (cnt[c - 1][b] == 0 || v > max[c - 1][b]) {
                            max[c - 1][b] = v;
                        }
                        cnt[c - 1][b]++;
                    } catch (NumberFormatException ignored) {
                        // 壊れた値は飛ばす
                    }
                }
            }
        } catch (IOException ignored) {
            // 読めた分だけ使う
        }
    }

    /** 区切りの幅を、きりのいい長さ（10 秒・1 分・5 分…）に切り上げる */
    static long niceStep(long ms) {
        long[] steps = {1_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
                1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000};
        for (long s : steps) {
            if (s >= ms) {
                return s;
            }
        }
        return 86_400_000;
    }
}
