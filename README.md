# mc-server-manager

Minecraft サーバーの管理画面を、サーバーの中から配信する NeoForge 26.2 のサーバー専用 Mod です。`mods/` に jar を置くだけで、ブラウザで `http://<サーバーのIP>:8080/` を開くと、状態とメトリクスを見て、プレイヤー・ワールド・設定・ファイル・バックアップを操作できます。別のプロセスを立てる必要はありません。

```text
ブラウザ ──> mc-server-manager（Mod, :8080） ──(admin トークン)──> MC REST API（Mod, 127.0.0.1:8765）
             └────────── 同じ Minecraft サーバーの中 ──────────┘
```

- 対象: Minecraft 26.2 / NeoForge 26.2.0.88 以降
- 入れる場所: サーバーだけ
- **[MC REST API](https://github.com/htani0817/mc-rest-api) 1.2.0 以上が必要です。** 画面の操作はすべて MC REST API に中継します。入っていないとサーバーが起動しません
- トークンは同じサーバーの `config/mc_rest_api/tokens.json` から admin のものを読みます。取り込みの作業は要りません
- メトリクス・接続時間・再起動の予定は、この Mod が自分で記録・実行します（画面を閉じていても動きます）

## 画面

| 画面 | 中身 |
| --- | --- |
| 概要 | TPS・人数・メモリ・CPU、ティック処理時間のグラフ、ワールド時刻の文字盤、オンライン一覧、リアルタイムの出来事、ディメンション別の負荷、ディスク。保存・再読み込み・再起動・停止 |
| メトリクス | マシンと Minecraft の CPU・メモリ、Java ヒープ、ディスク、参加者、TPS、ティック処理時間のグラフ。1 時間〜30 日を切り替え |
| ランキング | 接続時間のランキング。今日・7 日・30 日・今月・全期間・Minecraft の統計。CSV でダウンロード |
| プレイヤー | 一覧、状態、ゲームモード、メッセージ、TP、体力などの変更、キック、OP・ホワイトリスト・BAN、持ち物とエンダーチェスト、アイテム、エフェクト、統計と進捗 |
| ワールド | 時刻・天候・スポーン・ワールドボーダー、エンティティ、ブロック |
| OP・ホワイトリスト・BAN | OP、ホワイトリスト、BAN、IP BAN |
| 設定・ゲームルール | MOTD の編集（色・書式・2 行・プレビュー）、設定 19 項目、ゲームルール |
| スコア・データパック | スコアボード、チーム、データパック、Mod とプラグイン、レジストリ |
| コンソール・チャット | 任意コマンド、サーバーログ、チャット |
| ファイル | 一覧・編集・アップロード・ダウンロード・移動・コピー・削除 |
| バックアップ | 作成・一覧・ダウンロード・削除。再起動の予定（曜日と時刻を決めて、バックアップを取ってから再起動） |
| ログと履歴 | チャット・出来事・操作の記録・サーバーログを直近 7 日分ダウンロード |
| API 一覧 | MC REST API の openapi.json |

ライト／ダークの切り替えがあり、スマホの幅でも使えます。

## ログインはありません

画面を開けた人は、任意のコマンド・ファイルの編集・停止まで全部できます。そのため、次の 3 つで「家の中から開いたときだけ」に絞っています。

| 守り | 内容 |
| --- | --- |
| 接続元の IP | `allowedNetworks` に入っている IP からだけ受け付けます。既定は LAN（10/8・172.16/12・192.168/16）、Tailscale（100.64/10）、リンクローカル、ループバック、IPv6 の ULA。インターネットから届いたものは 403 |
| アドレス欄の名前 | IP アドレス・`localhost`・ドットのない名前・`allowedHosts` に書いた名前だけ受け付けます（DNS リバインディング対策） |
| 書き込み系のヘッダー | POST・PUT・DELETE などには `X-MC-Manager: 1` ヘッダーを必須にしています（別のサイトから勝手に送られる操作の対策） |

> [!WARNING]
> ルーターで 8080 を外に開けないでください。Minecraft の 25565 をポート開放していても、8080 は開けません。外から使うときは Tailscale などの VPN を通してください。

Tailscale の MagicDNS 名（`<マシン名>.tailXXXX.ts.net`）で開きたいときは、`allowedHosts` に `.tailXXXX.ts.net` のように書きます。

## 導入

前提: [MC REST API](https://github.com/htani0817/mc-rest-api) 1.2.0 以上が入った Minecraft サーバー。

1. [Releases](https://github.com/htani0817/mc-server-manager/releases/latest) から `mc-server-manager-<版>+mc26.2-neoforge.jar` をダウンロードし、サーバーの `mods/` に置きます
2. サーバーを起動（再起動）します。ログに次の行が出れば動いています

   ```text
   [mc-server-manager] 管理画面を http://0.0.0.0:8080/ で開いています（中継先 http://127.0.0.1:8765）
   ```

3. ファイアウォールで 8080/tcp を LAN に開けます（firewalld の例）

   ```bash
   firewall-cmd --permanent --add-port=8080/tcp
   firewall-cmd --reload
   ```

4. ブラウザで `http://<サーバーのIP>:8080/` を開きます

更新するときは、古い jar を消してから新しい jar を置きます（同じ Mod の jar が 2 つあると起動しません）。

## 画面から再起動するには

画面の「再起動」は、MC REST API が終了コード 75 で Java を終わらせ、systemd がそれを見て起動し直す仕組みです。tmux の中で java を動かしていると、java が終わっても tmux が残るので systemd が気づかず、起動し直されません。java を systemd から直接動かしてください。設定の例は [deploy/minecraft.service](deploy/minecraft.service) です（jar 名・メモリ・場所は自分のサーバーに合わせて直します）。

| | tmux の中で動かす | deploy/minecraft.service |
| --- | --- | --- |
| 動かし方 | `Type=forking`、tmux の中で `java` | `Type=simple`、`java` を直接 |
| 画面からの再起動 | できない | 終了コード 75 → `Restart=on-failure` で起動し直す |
| 落ちたとき | 止まったまま | 5 秒後に起動し直す（10 分に 5 回まで） |
| 画面・API からの停止 | 止まったまま | 止まったまま（終了コード 0） |
| `systemctl stop` | tmux に `stop` を送る | SIGTERM で Minecraft の終了処理が保存してから止まる（最大 180 秒） |
| コンソール | `tmux attach` | 見るのは `journalctl -u minecraft -f`、コマンドは画面の「コンソール」 |

切り替えたら、画面の「再起動」→「すぐ」で試し、`systemctl show minecraft -p NRestarts` が 1 増えていれば systemd が起動し直しています。

> [!NOTE]
> ハイブリッドサーバー（Bukkit との混成）では、停止のときに独自に Java を終わらせて終了コードが 0 になり、起動し直されないことがあります。そのときは `journalctl -u minecraft -n 100` を確認してください。

## メトリクス

サーバーが起動したときから、`metricsIntervalSeconds`（既定 10 秒）ごとに 1 行ずつ `mc-server-manager/metrics/metrics-YYYY-MM-DD.csv` に書きます。ファイルに残すので、停止・再起動・落ちたあとも消えません。

| 列 | 中身 |
| --- | --- |
| `cpuProcess` / `cpuSystem` | Minecraft とマシン全体の CPU 使用率（%） |
| `processRss` | Minecraft が使っている物理メモリ（Linux だけ） |
| `memUsed` / `memTotal` | マシンのメモリの使用量と総量 |
| `heapUsed` / `heapMax` | Java ヒープの使用量と上限 |
| `diskUsed` / `diskTotal` | サーバーのフォルダがあるディスクの使用量と容量 |
| `ioRead` / `ioWrite` | Minecraft のディスクの読み書き（毎秒、Linux だけ） |
| `players` | 参加者の数 |
| `tps` / `mspt` | TPS とティック処理時間 |

1 日分は 10 秒間隔でおよそ 1 MB です。

## ランキング

参加から退出までを 1 行として `mc-server-manager/playtime/sessions.csv` に足していきます。接続中の人は 1 分ごとに記録するので、サーバーが落ちても次の起動で回収します（誤差 1 分以内）。数え始めはこの Mod を入れたときです。それより前の分は「Minecraft の統計」（ワールドの `play_time`）で見られます。

## 再起動の予定

バックアップ画面の「再起動の予定」で、曜日と時刻（サーバーの時間帯、8 個まで）を決めます。その時刻になると、MC REST API でバックアップを作り、成功したら予告を付けて再起動します。バックアップに失敗したら再起動しません。「いま実行」で同じ流れをすぐ試せます。

- 時刻は 15 秒ごとに見るので、最大 15 秒遅れて始まります。止まっていたあいだに過ぎた時刻は、あとから実行しません
- バックアップの保持数は MC REST API の `backupKeep` に従います

## 設定（config/mc_server_manager/config.json）

初回起動で作られます。変えたら Minecraft の再起動で効きます。

| 項目 | 既定値 | 内容 |
| --- | --- | --- |
| `bindAddress` | `0.0.0.0` | 待ち受けアドレス |
| `port` | `8080` | 待ち受けポート |
| `allowedNetworks` | LAN・Tailscale など | 画面を開いてよい接続元（CIDR）。空にすると制限しない |
| `allowedHosts` | `[]` | IP・`localhost`・ドットのない名前のほかに許すホスト名。`.` で始めると後ろが一致する名前すべて |
| `restApiBase` | `""` | MC REST API の URL。空なら `config/mc_rest_api/config.json` の `port` から `http://127.0.0.1:<port>` にする |
| `historyKeepDays` | `7` | 操作の記録を残す日数 |
| `metricsIntervalSeconds` | `10` | メトリクスを記録する間隔（秒） |
| `metricsKeepDays` | `30` | メトリクスを残す日数 |

再起動の予定は画面から変えます（`config/mc_server_manager/restart-schedule.json` に保存され、再起動しなくても効きます）。

## 置かれるもの

| 場所 | 中身 |
| --- | --- |
| `config/mc_server_manager/config.json` | 設定 |
| `config/mc_server_manager/restart-schedule.json` | 再起動の予定 |
| `logs/mc-server-manager/audit/audit-YYYY-MM-DD.log` | 画面から行った操作の記録（時刻・IP・メソッド・パス・結果）。直近 7 日分 |
| `mc-server-manager/metrics/` | メトリクスと起動した時刻。直近 30 日分 |
| `mc-server-manager/playtime/` | 接続の記録（参加・退出の時刻、UUID、名前） |
| `mc-server-manager/restart-schedule-state.json` | 再起動の予定が最後に動いた結果 |

## 既知の制約

- 画面は Minecraft サーバーの中で動くので、止めると画面も開けなくなります。停止したあとは SSH などで起動し直してください。続けて使うときは「再起動」を使います
- 誰が操作したかは IP アドレスでしか分かりません
- Minecraft のメモリ（RSS）とディスクの読み書きは Linux でだけ取れます

## ビルド

```bash
cd web && npm ci && cd ..   # 初回だけ
./gradlew build             # Windows は gradlew.bat build
```

- 画面（`web/`、Vite＋React＋TypeScript）も `./gradlew build` の中でビルドし、jar に入れます。Node.js が必要です
- できた jar は `dist/` にコピーされます。ビルド出力は `~/.gradle/project-builds/mc-server-manager/` に置きます（場所を変えるときは `-PmcBuildRoot=<パス>`）
- `./gradlew runServer` は、隣のフォルダ `../mc-rest-api/dist/` の jar を開発用サーバーの `mods/` に入れてから起動します
- 画面だけ直すときは、`runServer` を動かしたまま `web` で `npm run dev` を実行し、`http://localhost:5173/` を開きます

## ライセンス

[MIT](LICENSE)。画面に同梱しているライブラリとフォントのライセンスは [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) にあります。
