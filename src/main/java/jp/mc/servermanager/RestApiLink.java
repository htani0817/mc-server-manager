package jp.mc.servermanager;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;

/**
 * MC REST API への道筋。同じサーバーの config/mc_rest_api/ から URL と admin トークンを読む。
 * tokens.json は MC REST API が起動時に作るので、使うときに読み、変わっていれば読み直す。
 */
public final class RestApiLink {
    private final Path tokenFile;
    private final String base;
    private FileTime loadedAt;
    private String token;

    public RestApiLink(Path restApiConfigDir, String override) {
        this.tokenFile = restApiConfigDir.resolve("tokens.json");
        this.base = override == null || override.isBlank() ? baseFrom(restApiConfigDir.resolve("config.json")) : stripSlash(override.trim());
    }

    public String base() {
        return base;
    }

    /** admin のトークン。まだ無ければ null */
    public synchronized String adminToken() {
        try {
            FileTime m = Files.getLastModifiedTime(tokenFile);
            if (token == null || !m.equals(loadedAt)) {
                token = readAdminToken(Files.readString(tokenFile, StandardCharsets.UTF_8));
                loadedAt = m;
            }
        } catch (IOException | RuntimeException e) {
            token = null;
            loadedAt = null;
        }
        return token;
    }

    static String readAdminToken(String json) {
        for (JsonElement e : JsonParser.parseString(json).getAsJsonObject().getAsJsonArray("tokens")) {
            JsonObject o = e.getAsJsonObject();
            if (o.has("scope") && o.get("scope").getAsString().equals("admin")) {
                return o.get("token").getAsString();
            }
        }
        return null;
    }

    /** 待ち受けアドレスが 0.0.0.0 などでも、同じマシンなのでループバックでつなぐ */
    private static String baseFrom(Path configJson) {
        int port = 8765;
        try {
            JsonObject o = JsonParser.parseString(Files.readString(configJson, StandardCharsets.UTF_8)).getAsJsonObject();
            if (o.has("port")) {
                port = o.get("port").getAsInt();
            }
        } catch (IOException | RuntimeException e) {
            McServerManager.LOGGER.warn("[mc-server-manager] {} を読めないので、ポート 8765 につなぎます", configJson);
        }
        return "http://127.0.0.1:" + port;
    }

    private static String stripSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
