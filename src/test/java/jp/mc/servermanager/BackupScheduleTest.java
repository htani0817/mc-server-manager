package jp.mc.servermanager;

import org.junit.jupiter.api.Test;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class BackupScheduleTest {
    private static final ZoneId TOKYO = ZoneId.of("Asia/Tokyo");

    private static BackupSchedule.Settings settings(List<Integer> days, List<String> times) {
        BackupSchedule.Settings s = new BackupSchedule.Settings();
        s.enabled = true;
        s.days = new ArrayList<>(days);
        s.times = new ArrayList<>(times);
        return s;
    }

    @Test
    void 今日のまだ来ていない時刻を選ぶ() {
        // 2026-11-02 は月曜
        ZonedDateTime now = ZonedDateTime.of(2026, 11, 2, 3, 0, 0, 0, TOKYO);
        ZonedDateTime next = BackupSchedule.nextAfter(settings(List.of(1, 2, 3, 4, 5, 6, 7), List.of("05:00", "17:00")), now);
        assertEquals(ZonedDateTime.of(2026, 11, 2, 5, 0, 0, 0, TOKYO), next);
    }

    @Test
    void ちょうどの時刻とそれより前は次の回にする() {
        ZonedDateTime now = ZonedDateTime.of(2026, 11, 2, 5, 0, 0, 0, TOKYO);
        ZonedDateTime next = BackupSchedule.nextAfter(settings(List.of(1, 2, 3, 4, 5, 6, 7), List.of("05:00")), now);
        assertEquals(ZonedDateTime.of(2026, 11, 3, 5, 0, 0, 0, TOKYO), next);
    }

    @Test
    void 曜日が合う日まで進める() {
        // 月曜の 6 時に、土日の 4 時だけ → 土曜（11/7）
        ZonedDateTime now = ZonedDateTime.of(2026, 11, 2, 6, 0, 0, 0, TOKYO);
        ZonedDateTime next = BackupSchedule.nextAfter(settings(List.of(6, 7), List.of("04:00")), now);
        assertEquals(ZonedDateTime.of(2026, 11, 7, 4, 0, 0, 0, TOKYO), next);
    }

    @Test
    void 同じ曜日の来週も選べる() {
        // 月曜の 6 時に、月曜の 4 時だけ → 来週の月曜
        ZonedDateTime now = ZonedDateTime.of(2026, 11, 2, 6, 0, 0, 0, TOKYO);
        ZonedDateTime next = BackupSchedule.nextAfter(settings(List.of(1), List.of("04:00")), now);
        assertEquals(ZonedDateTime.of(2026, 11, 9, 4, 0, 0, 0, TOKYO), next);
    }

    @Test
    void 時刻か曜日が無ければ予定なし() {
        ZonedDateTime now = ZonedDateTime.of(2026, 11, 2, 6, 0, 0, 0, TOKYO);
        assertNull(BackupSchedule.nextAfter(settings(List.of(), List.of("04:00")), now));
        assertNull(BackupSchedule.nextAfter(settings(List.of(1), List.of()), now));
    }

    @Test
    void 保存の前に並べ替えて重複を消す() {
        BackupSchedule.Settings s = settings(List.of(7, 1, 1), List.of("17:00", "05:00", "05:00"));
        BackupSchedule.validate(s);
        assertEquals(List.of(1, 7), s.days);
        assertEquals(List.of("05:00", "17:00"), s.times);
    }

    @Test
    void おかしな値は断る() {
        assertThrows(IllegalArgumentException.class, () -> BackupSchedule.validate(settings(List.of(8), List.of("05:00"))));
        assertThrows(IllegalArgumentException.class, () -> BackupSchedule.validate(settings(List.of(1), List.of("24:00"))));
        assertThrows(IllegalArgumentException.class, () -> BackupSchedule.validate(settings(List.of(1), List.of("5:00"))));
        assertThrows(IllegalArgumentException.class, () -> BackupSchedule.validate(settings(List.of(), List.of("05:00"))));
    }

    @Test
    void 無効なら曜日と時刻が空でも保存できる() {
        BackupSchedule.Settings s = settings(List.of(), List.of());
        s.enabled = false;
        BackupSchedule.validate(s);
        assertEquals(List.of(), s.days);
    }
}
