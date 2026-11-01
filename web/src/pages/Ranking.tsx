import { useState } from 'react'
import { Download, Info } from 'lucide-react'
import { getManager, type Ranking as RankingData, type RankingPeriod } from '../api'
import { useNav, useQuery } from '../hooks'
import { Bar, Card, Dot, Empty, PageHead, Seg, fmtTime } from '../ui'

const PERIODS: [RankingPeriod, string][] = [
  ['today', '今日'],
  ['7d', '7 日'],
  ['30d', '30 日'],
  ['month', '今月'],
  ['all', '全期間'],
  ['stats', 'Minecraft の統計'],
]

/** 123時間 45分 のように時間で数える（日にすると見比べにくい） */
export function fmtPlaytime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}時間 ${m}分`
  if (m > 0) return `${m}分`
  return `${sec}秒`
}

/** 接続時間のランキング。参加から退出までを Mod が記録している */
export function Ranking() {
  const [period, setPeriod] = useState<RankingPeriod>('7d')
  const r = useQuery<RankingData>(`/ranking?period=${period}`, 30_000, getManager)
  const nav = useNav()
  const d = r.data
  const top = d?.players[0]?.seconds ?? 0
  const stats = period === 'stats'

  return (
    <>
      <PageHead
        title="ランキング"
        sub={d ? (stats ? 'Minecraft が数えているプレイ時間（導入前のぶんも含む）' : `接続時間 · ${fmtTime(d.recordingSince, true).slice(0, 10)} から記録`) : '読み込み中'}
        actions={
          <a className="btn" href={`/manager/ranking.csv?period=${period}`} download>
            <Download size={16} strokeWidth={1.5} />
            CSV をダウンロード
          </a>
        }
      />
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="seg-scroll">
            <Seg options={PERIODS} value={period} onChange={setPeriod} />
          </div>
          {d && (
            <span className="muted mono" style={{ fontSize: 12 }}>
              {d.from ? `${fmtTime(d.from)} 〜 ${fmtTime(d.to)}` : `〜 ${fmtTime(d.to)}`}
            </span>
          )}
        </div>
        <Card flush>
          {d?.players.length ? (
            <div className="table-wrap">
              <table className="table ranking-table">
                <thead>
                  <tr>
                    <th className="num" style={{ width: 56 }}>
                      順位
                    </th>
                    <th>名前</th>
                    <th className="num">接続時間</th>
                    <th className="rank-bar" style={{ width: '24%' }} aria-label="1 位との比較" />
                    {!stats && <th className="num">回数</th>}
                    {!stats && <th className="num">最長</th>}
                    <th>{stats ? '統計の更新' : '最後に見た'}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.players.map((p) => (
                    <tr key={p.uuid} className="clickable" onClick={() => nav(`/players?p=${p.uuid}`)}>
                      <td className={p.rank === 1 ? 'num mono rank-first' : 'num mono muted'}>{p.rank}</td>
                      <td>
                        <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          {p.name}
                          {p.online && (
                            <span className="row muted" style={{ gap: 6, fontSize: 12 }}>
                              <Dot state="on" />
                              オンライン
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="num mono">{fmtPlaytime(p.seconds)}</td>
                      <td className="rank-bar">
                        <Bar value={p.seconds} max={top} accent={p.rank === 1} />
                      </td>
                      {!stats && <td className="num mono muted">{p.sessions}</td>}
                      {!stats && <td className="num mono muted">{p.longestSeconds === null ? '—' : fmtPlaytime(p.longestSeconds)}</td>}
                      <td className="mono muted">{p.online && !stats ? 'いま' : fmtTime(p.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{r.error ? r.error.message : d ? 'この期間に接続した人はいません' : '読み込み中'}</Empty>
          )}
        </Card>
        <div className="notice">
          <Info size={16} strokeWidth={1.5} />
          <span>
            {stats
              ? 'ワールドの stats にあるプレイ時間です。ゲームが動いていた時間を数えるので、接続時間より少し短くなります。オンラインの人は自動保存（約 5 分ごと）の時点までです。'
              : 'この Mod を入れてからの接続を数えます。期間の境目をまたいだ接続は、期間に入っている分だけを足します。落ちたときも 1 分以内の誤差で残ります。'}
          </span>
        </div>
      </div>
    </>
  )
}
