package jp.mc.servermanager;

import com.mojang.logging.LogUtils;
import net.minecraft.server.dedicated.DedicatedServer;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.Logger;

import java.io.IOException;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 管理 WebUI を Minecraft サーバーの中から配信する。画面の操作は MC REST API に中継する。
 * メトリクスと接続時間はこの Mod が自分で記録し、定期バックアップもこの Mod が時刻を見て行う。
 */
@Mod(value = McServerManager.MODID, dist = Dist.DEDICATED_SERVER)
public class McServerManager {
    public static final String MODID = "mc_server_manager";
    public static final Logger LOGGER = LogUtils.getLogger();

    private ManagerConfig config;
    private WebServer web;
    private Audit audit;
    private Metrics metrics;
    private Playtime playtime;
    private BackupSchedule schedule;
    private ScheduledExecutorService recorder;

    public McServerManager() {
        try {
            config = ManagerConfig.loadOrCreate(FMLPaths.CONFIGDIR.get().resolve(MODID).resolve("config.json"));
        } catch (IOException e) {
            LOGGER.error("[mc-server-manager] 設定を読めないため既定値で動きます: {}", e.getMessage());
            config = new ManagerConfig();
        }
        NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, this::onStarted);
        NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, this::onStopping);
        NeoForge.EVENT_BUS.addListener(PlayerEvent.PlayerLoggedInEvent.class, this::onJoin);
        NeoForge.EVENT_BUS.addListener(PlayerEvent.PlayerLoggedOutEvent.class, this::onLeave);
    }

    private void onStarted(ServerStartedEvent event) {
        if (!(event.getServer() instanceof DedicatedServer server)) {
            return;
        }
        Path gameDir = FMLPaths.GAMEDIR.get();
        // 止めても消えないデータ（メトリクス・接続時間・定期バックアップの結果）の置き場
        Path dataDir = gameDir.resolve("mc-server-manager");
        try {
            audit = new Audit(gameDir.resolve("logs").resolve("mc-server-manager").resolve("audit"), config.historyKeepDays);
        } catch (IOException e) {
            LOGGER.error("[mc-server-manager] 操作の記録の置き場を作れません。管理画面は開きません", e);
            return;
        }
        recorder = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "mc-server-manager-recorder");
            t.setDaemon(true);
            return t;
        });
        try {
            metrics = new Metrics(dataDir.resolve("metrics"), config.metricsKeepDays, config.metricsIntervalSeconds, server, gameDir);
            // CPU 使用率の空読みから少し空けて、最初の 1 点を取る
            recorder.scheduleAtFixedRate(metrics::sample, 2, metrics.intervalSeconds(), TimeUnit.SECONDS);
        } catch (IOException e) {
            LOGGER.error("[mc-server-manager] メトリクスを記録できません: {}", e.toString());
        }
        try {
            playtime = new Playtime(dataDir.resolve("playtime"), server.getWorldPath(LevelResource.PLAYER_STATS_DIR), gameDir.resolve("usercache.json"));
            recorder.scheduleAtFixedRate(playtime::checkpoint, 60, 60, TimeUnit.SECONDS);
        } catch (IOException e) {
            LOGGER.error("[mc-server-manager] 接続時間を記録できません: {}", e.toString());
        }
        try {
            RestApiLink link = new RestApiLink(FMLPaths.CONFIGDIR.get().resolve("mc_rest_api"), config.restApiBase);
            schedule = new BackupSchedule(FMLPaths.CONFIGDIR.get().resolve(MODID).resolve("backup-schedule.json"),
                    dataDir.resolve("backup-schedule-state.json"), link, audit);
            schedule.start();
            AccessGuard guard = AccessGuard.of(config.allowedNetworks, config.allowedHosts);
            web = new WebServer(config, guard, link, audit, metrics, playtime, schedule);
            web.start();
            LOGGER.info("[mc-server-manager] 管理画面を http://{}:{}/ で開いています（中継先 {}）", config.bindAddress, config.port, link.base());
            if (config.allowedNetworks.isEmpty()) {
                LOGGER.warn("[mc-server-manager] allowedNetworks が空なので、どこからでも開けます。ログインは無いので、インターネットに出さないでください");
            }
        } catch (Exception e) {
            LOGGER.error("[mc-server-manager] 管理画面を開けませんでした。サーバーはそのまま動きます", e);
        }
    }

    private void onJoin(PlayerEvent.PlayerLoggedInEvent event) {
        Playtime p = playtime;
        if (p != null) {
            p.join(event.getEntity().getStringUUID(), event.getEntity().getPlainTextName());
        }
    }

    private void onLeave(PlayerEvent.PlayerLoggedOutEvent event) {
        Playtime p = playtime;
        if (p != null) {
            p.leave(event.getEntity().getStringUUID(), event.getEntity().getPlainTextName());
        }
    }

    private void onStopping(ServerStoppingEvent event) {
        if (schedule != null) {
            schedule.stop();
            schedule = null;
        }
        if (web != null) {
            web.stop();
            web = null;
        }
        if (recorder != null) {
            recorder.shutdownNow();
            recorder = null;
        }
        if (playtime != null) {
            // このあと全員が切断されるが、その分はここで締める
            playtime.closeAll();
            playtime = null;
        }
        closeQuietly(metrics);
        metrics = null;
        closeQuietly(audit);
        audit = null;
    }

    private static void closeQuietly(AutoCloseable c) {
        if (c == null) {
            return;
        }
        try {
            c.close();
        } catch (Exception ignored) {
            // 停止中なので無視
        }
    }
}
