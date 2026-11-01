package jp.mc.servermanager;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonParseException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * config/mc_server_manager/config.json の中身。無い項目は既定値で補って書き戻す。
 */
public final class ManagerConfig {
    static final Gson GSON = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();
    /** 画面への応答用。メトリクスは点が多いので整形せず、空の項目も null として返す */
    static final Gson RESPONSE = new GsonBuilder().disableHtmlEscaping().serializeNulls().create();

    /** 待ち受けアドレス。家の LAN・Tailscale から開くので既定は全インターフェース */
    public String bindAddress = "0.0.0.0";
    public int port = 8080;
    /**
     * 画面を開いてよい接続元（CIDR）。ログインが無いので、既定は自宅 LAN と Tailscale のアドレスだけ。
     * 空にすると制限しない。
     */
    public List<String> allowedNetworks = new ArrayList<>(AccessGuard.DEFAULT_NETWORKS);
    /**
     * IP アドレス・localhost・ドットの無い名前のほかに、アドレス欄に入れてよいホスト名。
     * 「.」で始めると後ろが一致する名前すべて（例: .tail1234.ts.net）。
     */
    public List<String> allowedHosts = new ArrayList<>();
    /** MC REST API の URL。空なら config/mc_rest_api/config.json の port から決める */
    public String restApiBase = "";
    /** 操作の記録を残す日数（1 日 1 世代） */
    public int historyKeepDays = 7;
    /** メトリクス（CPU・メモリなど）を記録する間隔（秒） */
    public int metricsIntervalSeconds = 10;
    /** メトリクスを残す日数（1 日 1 ファイル） */
    public int metricsKeepDays = 30;

    public static ManagerConfig loadOrCreate(Path file) throws IOException {
        ManagerConfig c;
        if (Files.exists(file)) {
            try {
                c = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), ManagerConfig.class);
            } catch (JsonParseException e) {
                throw new IOException(file + " を JSON として読めません: " + e.getMessage(), e);
            }
            if (c == null) {
                c = new ManagerConfig();
            }
            if (c.allowedNetworks == null) {
                c.allowedNetworks = new ArrayList<>();
            }
            if (c.allowedHosts == null) {
                c.allowedHosts = new ArrayList<>();
            }
            if (c.restApiBase == null) {
                c.restApiBase = "";
            }
        } else {
            c = new ManagerConfig();
        }
        Files.createDirectories(file.getParent());
        // 新しい項目が増えたときも書き戻しで補われる
        Files.writeString(file, GSON.toJson(c) + "\n", StandardCharsets.UTF_8);
        return c;
    }
}
