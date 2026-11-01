package jp.mc.servermanager;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * 画面から何をしたかの記録。MC REST API 側の記録はトークン名しか分からないので、こちらで接続元の IP を残す。
 * logs/mc-server-manager/audit/audit-YYYY-MM-DD.log に 1 日 1 ファイルで書き、直近 keep 日分だけ残す。
 */
public final class Audit implements AutoCloseable {
    static final Pattern NAME = Pattern.compile("^audit-\\d{4}-\\d{2}-\\d{2}\\.log$");

    private final Path dir;
    private final int keep;
    private LocalDate current;
    private BufferedWriter writer;

    public Audit(Path dir, int keep) throws IOException {
        this.dir = dir;
        this.keep = Math.max(1, keep);
        Files.createDirectories(dir);
        prune();
    }

    public Path dir() {
        return dir;
    }

    public int keep() {
        return keep;
    }

    public synchronized void write(String ip, String method, String path, int status) {
        try {
            LocalDate today = LocalDate.now();
            if (writer == null || !today.equals(current)) {
                if (writer != null) {
                    writer.close();
                }
                writer = Files.newBufferedWriter(dir.resolve("audit-" + today + ".log"), StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                current = today;
                prune();
            }
            writer.write(OffsetDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                    + " ip=" + ip + " " + method + " " + path + " status=" + status);
            writer.newLine();
            writer.flush();
        } catch (IOException ignored) {
            // 記録できなくても操作は止めない
        }
    }

    /** 日付の新しい順 */
    public List<Path> files() {
        List<Path> out = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            s.filter(p -> NAME.matcher(p.getFileName().toString()).matches()).forEach(out::add);
        } catch (IOException ignored) {
            return out;
        }
        out.sort(Comparator.comparing((Path p) -> p.getFileName().toString()).reversed());
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

    @Override
    public synchronized void close() throws IOException {
        if (writer != null) {
            writer.close();
            writer = null;
        }
    }
}
