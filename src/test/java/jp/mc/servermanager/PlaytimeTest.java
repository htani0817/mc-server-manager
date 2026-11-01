package jp.mc.servermanager;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlaytimeTest {
    private static final String A = "00000000-0000-0000-0000-00000000000a";
    private static final String B = "00000000-0000-0000-0000-00000000000b";
    private static final String C = "00000000-0000-0000-0000-00000000000c";

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> players(Map<String, Object> r) {
        return (List<Map<String, Object>>) r.get("players");
    }

    private static void sessions(Path dir, String... lines) throws Exception {
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("sessions.csv"), "#since=1\nstart,end,uuid,name\n" + String.join("\n", lines) + "\n", StandardCharsets.UTF_8);
    }

    @Test
    void 全期間は合計の多い順で同じ時間は同じ順位(@TempDir Path tmp) throws Exception {
        long h = 3_600_000L;
        long t = System.currentTimeMillis() - 100 * h;
        sessions(tmp,
                t + "," + (t + 2 * h) + "," + A + ",Alice",
                (t + 10 * h) + "," + (t + 11 * h) + "," + A + ",Alice2",
                t + "," + (t + 3 * h) + "," + B + ",Bob",
                t + "," + (t + h) + "," + C + ",Carol");
        Playtime p = new Playtime(tmp, tmp.resolve("stats"), tmp.resolve("usercache.json"));
        List<Map<String, Object>> rows = players(p.ranking("all"));
        assertEquals(3, rows.size());
        assertEquals(1, rows.get(0).get("rank"));
        assertEquals(1, rows.get(1).get("rank"));
        assertEquals(3, rows.get(2).get("rank"));
        // 名前は最後の記録のもの
        assertTrue(rows.stream().anyMatch(r -> r.get("name").equals("Alice2") && r.get("seconds").equals(3 * 3600L) && r.get("sessions").equals(2)));
        assertEquals("Carol", rows.get(2).get("name"));
    }

    @Test
    void 期間の境目をまたいだ接続は中の分だけ数える(@TempDir Path tmp) throws Exception {
        long now = System.currentTimeMillis();
        long day = 86_400_000L;
        // 8 日前から 6 日前まで（2 日間）のうち、直近 7 日に入るのは 1 日分
        sessions(tmp, (now - 8 * day) + "," + (now - 6 * day) + "," + A + ",Alice");
        Playtime p = new Playtime(tmp, tmp.resolve("stats"), tmp.resolve("usercache.json"));
        long sec = (Long) players(p.ranking("7d")).getFirst().get("seconds");
        assertTrue(Math.abs(sec - 86_400) < 5, "数えた秒数: " + sec);
        assertTrue(players(p.ranking("today")).isEmpty());
    }

    @Test
    void 落ちたときの接続中の分を次の起動で足す(@TempDir Path tmp) throws Exception {
        long now = System.currentTimeMillis();
        sessions(tmp);
        Files.writeString(tmp.resolve("open.json"),
                "[{\"uuid\":\"" + A + "\",\"name\":\"Alice\",\"start\":" + (now - 600_000) + ",\"lastSeen\":" + (now - 60_000) + "}]",
                StandardCharsets.UTF_8);
        Playtime p = new Playtime(tmp, tmp.resolve("stats"), tmp.resolve("usercache.json"));
        assertFalse(Files.exists(tmp.resolve("open.json")));
        Map<String, Object> row = players(p.ranking("all")).getFirst();
        assertEquals(540L, row.get("seconds"));
        assertEquals(false, row.get("online"));
    }

    @Test
    void 接続中の人は今までの分を数えてオンラインにする(@TempDir Path tmp) throws Exception {
        sessions(tmp);
        Playtime p = new Playtime(tmp, tmp.resolve("stats"), tmp.resolve("usercache.json"));
        p.join(A, "Alice");
        Map<String, Object> row = players(p.ranking("today")).getFirst();
        assertEquals(true, row.get("online"));
        p.leave(A, "Alice");
        assertTrue(Files.readString(tmp.resolve("sessions.csv")).contains("," + A + ",Alice"));
        assertEquals(false, players(p.ranking("all")).getFirst().get("online"));
    }

    @Test
    void 統計はplay_timeのティックを秒にして名前はusercacheから(@TempDir Path tmp) throws Exception {
        sessions(tmp);
        Path stats = tmp.resolve("stats");
        Files.createDirectories(stats);
        Files.writeString(stats.resolve(A + ".json"), "{\"stats\":{\"minecraft:custom\":{\"minecraft:play_time\":72000}},\"DataVersion\":1}");
        Files.writeString(stats.resolve(B + ".json"), "{\"stats\":{\"minecraft:custom\":{\"minecraft:play_one_minute\":144000}}}");
        Files.writeString(tmp.resolve("usercache.json"), "[{\"name\":\"Alice\",\"uuid\":\"" + A + "\",\"expiresOn\":\"x\"}]");
        Playtime p = new Playtime(tmp, stats, tmp.resolve("usercache.json"));
        List<Map<String, Object>> rows = players(p.ranking("stats"));
        assertEquals(B, rows.get(0).get("name"));
        assertEquals(7200L, rows.get(0).get("seconds"));
        assertEquals("Alice", rows.get(1).get("name"));
        assertEquals(3600L, rows.get(1).get("seconds"));
    }

    @Test
    void CSVは式にならないようにする(@TempDir Path tmp) throws Exception {
        sessions(tmp, "0,3600000," + A + ",=cmd");
        Playtime p = new Playtime(tmp, tmp.resolve("stats"), tmp.resolve("usercache.json"));
        String csv = Playtime.toCsv(p.ranking("all"));
        assertTrue(csv.startsWith("﻿順位,"));
        assertTrue(csv.contains(",'=cmd,"));
        assertTrue(csv.contains(",3600,1:00:00,"));
    }
}
