#!/bin/bash
#
# minecraft.service の ExecStop から呼ぶ停止スクリプト
#
# Youer は SIGTERM で止めると、終了処理がメインスレッドの外からプレイヤー保存を待って固まり、
# ワールドも保存されないまま systemd に強制終了される。
# そこで MC REST API の POST /server/stop（ゲーム内の stop と同じ通常の停止）で止め、Java が終わるまで待つ。
# API が使えないときは何もせずに終わり、systemd の SIGTERM に任せる。
#
# 置き場所: /opt/minecraft/mc-stop.sh
# 使い方:   ExecStop=/bin/bash /opt/minecraft/mc-stop.sh $MAINPID

PID="$1"
TOKENS=/opt/minecraft/config/mc_rest_api/tokens.json
API=http://127.0.0.1:8765/api/v1
# Java が終わるのを待つ秒数（minecraft.service の TimeoutStopSec より短くする）
WAIT=150

# systemd は Java が自分で終わったとき（画面からの再起動・ゲーム内の stop）にも ExecStop を呼ぶ。
# そのときは $MAINPID が空か、もういないので何もしない
if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
    echo "Java はすでに止まっています"
    exit 0
fi

# tokens.json から scope が admin のトークンを取り出す（トークンの名前は変えられるので scope で探す）
TOKEN=$(awk -F'"' '/"token"/ { t = $4 } /"scope"/ { s = $4 }
    /}/ { if (s == "admin" && t != "") { print t; exit } t = ""; s = "" }' "$TOKENS" 2>/dev/null)
if [ -z "$TOKEN" ]; then
    echo "$TOKENS から admin トークンを読めません。SIGTERM で止めます" >&2
    exit 0
fi

if ! curl -fsS -m 5 -X POST -H "Authorization: Bearer $TOKEN" "$API/server/stop" > /dev/null; then
    echo "REST API で止められませんでした。SIGTERM で止めます" >&2
    exit 0
fi
echo "REST API から停止を送りました。保存して終わるのを待ちます（最大 ${WAIT} 秒）"

for _ in $(seq 1 "$WAIT"); do
    if ! kill -0 "$PID" 2>/dev/null; then
        echo "停止しました"
        exit 0
    fi
    sleep 1
done

echo "${WAIT} 秒たっても終わりません。SIGTERM で止めます" >&2
exit 0
