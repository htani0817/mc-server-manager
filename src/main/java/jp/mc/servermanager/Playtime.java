package jp.mc.servermanager;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
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
import java.util.stream.Stream;

/**
 * 接続時間の記録。参加から退出までを 1 行として mc-server-manager/playtime/sessions.csv に足していく（消さない）。
 * 落ちたときに接続中の分が消えないよう、接続中の人を open.json に 1 分ごとに書き、次の起動で最後に見た時刻まで足す。
 */
public final class Playtime {
    private static final String HEADER = "start,end,uuid,name";

    /** 期間の選択肢（画面のボタンと合わせる） */
    public static final List<String> PERIODS = List.of("today", "7d", "30d", "month", "all", "stats");

    private record Open(String name, long start) {
    }

    private record Session(long start, long end, String uuid, String name) {
    }

    private final Path dir;
    private final Path sessions;
    private final Path openFile;
    private final Path statsDir;
    private final Path userCache;
    private final Map<String, Open> open = new LinkedHashMap<>();
    private long since;

    public Playtime(Path dir, Path statsDir, Path userCache) throws IOException {
        this.dir = dir;
        this.sessions = dir.resolve("sessions.csv");
        this.openFile = dir.resolve("open.json");
        this.statsDir = statsDir;
        this.userCache = userCache;
        Files.createDirectories(dir);
        if (!Files.exists(sessions)) {
            Files.writeString(sessions, "#since=" + System.currentTimeMillis() + "\n" + HEADER + "\n", StandardCharsets.UTF_8);
        }
        since = readSince();
        recoverOpen();
    }

    // ---- 記録 ----

    public synchronized void join(String uuid, String name) {
        open.put(uuid, new Open(name, System.currentTimeMillis()));
        checkpoint();
    }

    public synchronized void leave(String uuid, String name) {
        Open o = open.remove(uuid);
        if (o != null) {
            append(new Session(o.start, System.currentTimeMillis(), uuid, name == null ? o.name : name));
        }
        checkpoint();
    }

    /** サーバー停止時: 接続中の人を全員いま退出したことにする */
    public synchronized void closeAll() {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, Open> e : open.entrySet()) {
            append(new Session(e.getValue().start, now, e.getKey(), e.getValue().name));
        }
        open.clear();
        try {
            Files.deleteIfExists(openFile);
        } catch (IOException ignored) {
            // 次の起動で 1 分以内の誤差として足されるだけ
        }
    }

    /** 接続中の人と、最後に見た時刻を書く（1 分ごと） */
    public synchronized void checkpoint() {
        try {
            if (open.isEmpty()) {
                Files.deleteIfExists(openFile);
                return;
            }
            JsonArray a = new JsonArray();
            long now = System.currentTimeMillis();
            open.forEach((uuid, o) -> {
                JsonObject j = new JsonObject();
                j.addProperty("uuid", uuid);
                j.addProperty("name", o.name);
                j.addProperty("start", o.start);
                j.addProperty("lastSeen", now);
                a.add(j);
            });
            Path tmp = dir.resolve("open.json.tmp");
            Files.writeString(tmp, a.toString(), StandardCharsets.UTF_8);
            Files.move(tmp, openFile, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ignored) {
            // 書けなくても記録は続ける
        }
    }

    /** 前回落ちたときに残った接続中の分を、最後に見た時刻までとして足す */
    private void recoverOpen() {
        if (!Files.isRegularFile(openFile)) {
            return;
        }
        try {
            for (JsonElement e : JsonParser.parseString(Files.readString(openFile, StandardCharsets.UTF_8)).getAsJsonArray()) {
                JsonObject o = e.getAsJsonObject();
                long start = o.get("start").getAsLong();
                long last = o.get("lastSeen").getAsLong();
                if (last > start) {
                    append(new Session(start, last, o.get("uuid").getAsString(), o.get("name").getAsString()));
                }
            }
        } catch (IOException | RuntimeException e) {
            McServerManager.LOGGER.warn("[mc-server-manager] 前回の接続中の記録を読めませんでした: {}", e.toString());
        }
        try {
            Files.deleteIfExists(openFile);
        } catch (IOException ignored) {
            // 次の起動でもう一度足されないよう消したいが、消せなければそのまま
        }
    }

    private void append(Session s) {
        try (BufferedWriter w = Files.newBufferedWriter(sessions, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
            w.write(s.start + "," + s.end + "," + s.uuid + "," + s.name.replace(",", "_"));
            w.newLine();
        } catch (IOException e) {
            McServerManager.LOGGER.warn("[mc-server-manager] 接続時間を書けませんでした: {}", e.toString());
        }
    }

    private long readSince() {
        try (Stream<String> lines = Files.lines(sessions, StandardCharsets.UTF_8)) {
            String first = lines.findFirst().orElse("");
            if (first.startsWith("#since=")) {
                return Long.parseLong(first.substring(7).trim());
            }
        } catch (IOException | RuntimeException ignored) {
            // 分からなければファイルの最初の記録から
        }
        return 0;
    }

    private List<Session> readSessions() {
        List<Session> out = new ArrayList<>();
        try (Stream<String> lines = Files.lines(sessions, StandardCharsets.UTF_8)) {
            lines.forEach(line -> {
                if (line.isEmpty() || line.startsWith("#") || line.startsWith("start,")) {
                    return;
                }
                String[] p = line.split(",", 4);
                if (p.length < 4) {
                    return;
                }
                try {
                    out.add(new Session(Long.parseLong(p[0]), Long.parseLong(p[1]), p[2], p[3]));
                } catch (NumberFormatException ignored) {
                    // 壊れた行は飛ばす
                }
            });
        } catch (IOException ignored) {
            // 読めた分だけ
        }
        return out;
    }

    // ---- ランキング ----

    /** period の始まり（ミリ秒）。全期間と統計は 0 */
    static long periodStart(String period, long now, ZoneId zone) {
        LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        return switch (period) {
            case "today" -> today.atStartOfDay(zone).toInstant().toEpochMilli();
            case "7d" -> now - 7 * 86_400_000L;
            case "30d" -> now - 30 * 86_400_000L;
            case "month" -> today.withDayOfMonth(1).atStartOfDay(zone).toInstant().toEpochMilli();
            default -> 0;
        };
    }

    private static final class Row {
        String uuid;
        String name;
        long ms;
        int sessions;
        long longest;
        long firstSeen = Long.MAX_VALUE;
        long lastSeen;
        boolean online;
    }

    /** period ごとの接続時間の多い順。stats は Minecraft の統計（導入前のぶんも含む）から */
    public Map<String, Object> ranking(String period) {
        long now = System.currentTimeMillis();
        Map<String, Row> rows = new HashMap<>();
        Map<String, String> names = new HashMap<>();
        Map<String, Open> openNow;
        synchronized (this) {
            openNow = new LinkedHashMap<>(open);
        }
        List<Session> all = readSessions();
        for (Session s : all) {
            names.put(s.uuid, s.name);
        }
        openNow.forEach((uuid, o) -> names.put(uuid, o.name));
        long earliest = all.stream().mapToLong(Session::start).min().orElse(now);

        if (period.equals("stats")) {
            statsInto(rows, names);
        } else {
            long from = periodStart(period, now, ZoneId.systemDefault());
            List<Session> list = new ArrayList<>(all);
            openNow.forEach((uuid, o) -> list.add(new Session(o.start, now, uuid, o.name)));
            for (Session s : list) {
                long a = Math.max(s.start, from);
                long b = Math.min(s.end, now);
                if (b <= a) {
                    continue;
                }
                Row r = rows.computeIfAbsent(s.uuid, k -> new Row());
                r.uuid = s.uuid;
                r.ms += b - a;
                r.sessions++;
                r.longest = Math.max(r.longest, s.end - s.start);
                r.firstSeen = Math.min(r.firstSeen, s.start);
                r.lastSeen = Math.max(r.lastSeen, s.end);
            }
        }
        for (Row r : rows.values()) {
            r.name = names.getOrDefault(r.uuid, r.name == null ? r.uuid : r.name);
            r.online = openNow.containsKey(r.uuid);
        }

        List<Row> sorted = new ArrayList<>(rows.values());
        sorted.sort(Comparator.comparingLong((Row r) -> r.ms).reversed().thenComparing(r -> r.name.toLowerCase(java.util.Locale.ROOT)));
        List<Map<String, Object>> out = new ArrayList<>();
        int rank = 0;
        long prev = -1;
        for (int i = 0; i < sorted.size(); i++) {
            Row r = sorted.get(i);
            // 同じ時間は同じ順位にする
            if (r.ms != prev) {
                rank = i + 1;
                prev = r.ms;
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rank", rank);
            m.put("name", r.name);
            m.put("uuid", r.uuid);
            m.put("seconds", r.ms / 1000);
            m.put("sessions", period.equals("stats") ? null : r.sessions);
            m.put("longestSeconds", period.equals("stats") ? null : r.longest / 1000);
            m.put("firstSeen", r.firstSeen == Long.MAX_VALUE ? null : Instant.ofEpochMilli(r.firstSeen).toString());
            m.put("lastSeen", r.lastSeen == 0 ? null : Instant.ofEpochMilli(r.lastSeen).toString());
            m.put("online", r.online);
            out.add(m);
        }
        long from = periodStart(period, now, ZoneId.systemDefault());
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("period", period);
        res.put("from", from == 0 ? null : Instant.ofEpochMilli(from).toString());
        res.put("to", Instant.ofEpochMilli(now).toString());
        res.put("recordingSince", Instant.ofEpochMilli(since > 0 ? Math.min(since, earliest) : earliest).toString());
        res.put("players", out);
        return res;
    }

    /** world の stats/<uuid>.json の minecraft:play_time（ティック）を秒にする。オンラインの人は自動保存の時点まで */
    private void statsInto(Map<String, Row> rows, Map<String, String> names) {
        Map<String, String> cache = readUserCache();
        cache.forEach(names::putIfAbsent);
        if (!Files.isDirectory(statsDir)) {
            return;
        }
        try (Stream<Path> s = Files.list(statsDir)) {
            for (Path f : s.filter(p -> p.getFileName().toString().endsWith(".json")).toList()) {
                String uuid = f.getFileName().toString().replaceFirst("\\.json$", "");
                try {
                    JsonObject custom = JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8))
                            .getAsJsonObject().getAsJsonObject("stats").getAsJsonObject("minecraft:custom");
                    if (custom == null) {
                        continue;
                    }
                    // 1.17 より前のワールドは play_one_minute という名前だった
                    JsonElement t = custom.has("minecraft:play_time") ? custom.get("minecraft:play_time") : custom.get("minecraft:play_one_minute");
                    if (t == null) {
                        continue;
                    }
                    Row r = new Row();
                    r.uuid = uuid;
                    r.ms = t.getAsLong() * 50;
                    r.lastSeen = Files.getLastModifiedTime(f).toMillis();
                    rows.put(uuid, r);
                } catch (IOException | RuntimeException ignored) {
                    // 壊れたファイルは飛ばす
                }
            }
        } catch (IOException ignored) {
            // 読めた分だけ
        }
    }

    private Map<String, String> readUserCache() {
        Map<String, String> out = new HashMap<>();
        try {
            for (JsonElement e : JsonParser.parseString(Files.readString(userCache, StandardCharsets.UTF_8)).getAsJsonArray()) {
                JsonObject o = e.getAsJsonObject();
                out.put(o.get("uuid").getAsString(), o.get("name").getAsString());
            }
        } catch (IOException | RuntimeException ignored) {
            // 無ければ UUID のまま出す
        }
        return out;
    }

    /** ランキングを CSV にする。Excel で文字化けしないよう先頭に BOM を付ける */
    static String toCsv(Map<String, Object> ranking) {
        StringBuilder sb = new StringBuilder("﻿");
        sb.append("順位,名前,UUID,接続時間（秒）,接続時間,接続回数,最長（秒）,最後に見た時刻,オンライン\r\n");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> players = (List<Map<String, Object>>) ranking.get("players");
        for (Map<String, Object> p : players) {
            long sec = ((Number) p.get("seconds")).longValue();
            sb.append(p.get("rank")).append(',')
                    .append(csv(String.valueOf(p.get("name")))).append(',')
                    .append(p.get("uuid")).append(',')
                    .append(sec).append(',')
                    .append(hms(sec)).append(',')
                    .append(p.get("sessions") == null ? "" : p.get("sessions")).append(',')
                    .append(p.get("longestSeconds") == null ? "" : p.get("longestSeconds")).append(',')
                    .append(p.get("lastSeen") == null ? "" : localTime((String) p.get("lastSeen"))).append(',')
                    .append(Boolean.TRUE.equals(p.get("online")) ? "はい" : "").append("\r\n");
        }
        return sb.toString();
    }

    /** 表計算ソフトでそのまま読めるよう、サーバーの時間帯の「2026-11-01 09:30:00」にする */
    private static String localTime(String iso) {
        return java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                .format(Instant.parse(iso).atZone(ZoneId.systemDefault()));
    }

    static String hms(long sec) {
        return String.format("%d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60);
    }

    private static String csv(String s) {
        // 表計算ソフトで式として動かないよう、記号で始まる名前は ' を前に付ける
        String v = s.matches("^[=+\\-@\\t\\r].*") ? "'" + s : s;
        return v.contains(",") || v.contains("\"") ? "\"" + v.replace("\"", "\"\"") + "\"" : v;
    }
}
