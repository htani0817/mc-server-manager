import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { getManager, post, type MetricsData, type Performance, type PlayerSummary, type ServerInfo, type ServerStatus, type WorldInfo } from '../api'
import { useEvents, useNav, useQuery, type ServerEvent } from '../hooks'
import { TickChart, type Sample } from '../components/TickChart'
import { WorldClock } from '../components/WorldClock'
import { plainMotd } from '../components/MotdEditor'
import {
  Bar,
  Button,
  Card,
  Dot,
  Empty,
  PageHead,
  Ticks,
  dimName,
  fmt2,
  fmtBytes,
  fmtDuration,
  fmtInt,
  fmtTime,
  GAME_MODES,
  useAction,
} from '../ui'

/** 性能の取り直し間隔と、グラフに残す点の数（5 秒 × 72 = 6 分） */
const PERF_INTERVAL = 5000
const KEEP = 72

export function Dashboard() {
  const info = useQuery<ServerInfo>('/server')
  const motd = useQuery<{ key: string; value: string }>('/settings/motd')
  const status = useQuery<ServerStatus>('/server/status', PERF_INTERVAL)
  const perf = useQuery<Performance>('/performance', PERF_INTERVAL)
  const world = useQuery<WorldInfo>('/worlds/overworld', 2000)
  const players = useQuery<PlayerSummary[]>('/players', 10000)
  const [samples, setSamples] = useState<Sample[]>([])
  const [feed, setFeed] = useState<ServerEvent[]>([])
  const run = useAction()
  const nav = useNav()

  // 開いた直後から線が出るよう、Mod が記録している直近 6 分を先に入れておく（最後の起動より前は使わない）
  useEffect(() => {
    let alive = true
    getManager<MetricsData>(`/metrics?from=${Date.now() - KEEP * PERF_INTERVAL}&step=${PERF_INTERVAL}`)
      .then((m) => {
        if (!alive) return
        const since = m.starts.length ? m.starts[m.starts.length - 1] : 0
        const seed: Sample[] = []
        m.times.forEach((t, i) => {
          const mspt = m.series.mspt[i]
          const tps = m.series.tps[i]
          if (mspt !== null && tps !== null && t >= since) seed.push({ t: t + m.step / 2, mspt, tps })
        })
        // 取り出しが終わる前に画面側の点が入っていたら、それより前の分だけ足す
        setSamples((s) => [...seed.filter((x) => !s.length || x.t < s[0].t), ...s].slice(-KEEP))
      })
      .catch(() => {
        // 記録が無くても、5 秒ごとの取得で線は伸びる
      })
    return () => {
      alive = false
    }
  }, [])

  // 取得のたびにグラフの点を足していく
  const lastPerf = useRef<Performance | undefined>(undefined)
  useEffect(() => {
    const p = perf.data
    if (!p || p === lastPerf.current) return
    lastPerf.current = p
    setSamples((s) => [...s.slice(-(KEEP - 1)), { t: Date.now(), mspt: p.game.msptAverage, tps: p.game.tps }])
  }, [perf.data])

  useEvents(['chat', 'join', 'leave', 'death', 'advancement', 'server'], (e) => {
    setFeed((f) => [e, ...f].slice(0, 30))
    if (e.type === 'join' || e.type === 'leave') players.reload()
  })

  const st = status.data
  const p = perf.data
  const w = world.data
  const heapRatio = p ? p.memory.heapUsedBytes / p.memory.heapMaxBytes : 0

  return (
    <>
      <PageHead
        title="概要"
        sub={
          info.data ? (
            <span className="row" style={{ gap: 12 }}>
              <span>{plainMotd(motd.data?.value ?? info.data.motd)}</span>
              <span className="muted">
                Minecraft {info.data.minecraftVersion} · NeoForge {info.data.neoforgeVersion}
                {info.data.bukkit ? ` · ${info.data.bukkit.name}` : ''} · 起動から {fmtDuration(st?.uptimeSeconds ?? info.data.uptimeSeconds)}
              </span>
            </span>
          ) : (
            '読み込み中'
          )
        }
        actions={
          <>
            <Button onClick={() => run('ワールドを保存しました', () => post('/server/save', { flush: true }))}>
              <Save size={16} strokeWidth={1.5} />
              保存
            </Button>
            <Button onClick={() => run('データパックを再読み込みしました', () => post('/server/reload'))}>
              <RefreshCw size={16} strokeWidth={1.5} />
              再読み込み
            </Button>
          </>
        }
      />

      <div className="stack" style={{ gap: 16 }}>
        <div className="grid grid-stats">
          <Card>
            <div className="stat-label">TPS</div>
            <div className="stat-value">
              {st ? st.tps.toFixed(1) : '—'}
              <small>/ {st?.targetTps ?? 20}</small>
            </div>
            <div style={{ marginTop: 12 }}>
              <Ticks tps={st?.tps} target={st?.targetTps} large />
            </div>
          </Card>
          <Card>
            <div className="stat-label">プレイヤー</div>
            <div className="stat-value">
              {st ? st.players.online : '—'}
              <small>/ {st?.players.max ?? '—'}</small>
            </div>
            <div className="stat-sub">{st?.players.names.length ? st.players.names.slice(0, 4).join(', ') + (st.players.names.length > 4 ? ' ほか' : '') : 'だれもいません'}</div>
          </Card>
          <Card>
            <div className="stat-label">メモリ（ヒープ）</div>
            <div className="stat-value">
              {p ? fmtBytes(p.memory.heapUsedBytes).split(' ')[0] : '—'}
              <small>{p ? fmtBytes(p.memory.heapUsedBytes).split(' ')[1] : ''} / {p ? fmtBytes(p.memory.heapMaxBytes) : '—'}</small>
            </div>
            <div style={{ marginTop: 12 }}>
              <Bar value={heapRatio} max={1} />
            </div>
          </Card>
          <Card>
            <div className="stat-label">CPU（プロセス）</div>
            <div className="stat-value">
              {p?.cpu.processLoad !== undefined && p.cpu.processLoad >= 0 ? Math.round(p.cpu.processLoad * 100) : '—'}
              <small>%</small>
            </div>
            <div className="stat-sub">
              {p ? `${p.cpu.availableProcessors} コア · ロードアベレージ ${p.cpu.systemLoadAverage !== undefined && p.cpu.systemLoadAverage >= 0 ? p.cpu.systemLoadAverage.toFixed(2) : '—'}` : ''}
            </div>
          </Card>
        </div>

        <div className="grid grid-main">
          <Card
            title="ティック処理時間"
            meta="5 秒ごと · 直近 6 分"
            actions={
              <div className="headline-figure">
                <span className="big">{p ? fmt2(p.game.msptAverage) : '—'}</span>
                <span className="muted">ms</span>
              </div>
            }
          >
            <TickChart samples={samples} windowMs={KEEP * PERF_INTERVAL} />
            {p && (
              <div className="row mono muted" style={{ gap: 24, fontSize: 12, marginTop: 8 }}>
                <span>最小 {fmt2(p.game.msptMin)} ms</span>
                <span>最大 {fmt2(p.game.msptMax)} ms</span>
                <span>直近 100 ティックの平均</span>
              </div>
            )}
          </Card>
          <Card title="オーバーワールドの時刻" actions={<Button size="sm" variant="ghost" onClick={() => nav('/worlds')}>ワールドへ</Button>}>
            {w ? <WorldClock timeOfDay={w.timeOfDay} day={w.day} raining={w.raining} thundering={w.thundering} /> : <Empty>読み込み中</Empty>}
          </Card>
        </div>

        <div className="grid grid-split">
          <Card title="オンライン" meta={st ? `${st.players.online} 人` : undefined} flush>
            {players.data && players.data.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {players.data.map((pl) => (
                      <tr key={pl.uuid} className="clickable" onClick={() => nav(`/players?p=${pl.uuid}`)}>
                        <td>{pl.name}</td>
                        <td className="secondary">{dimName(pl.dimension)}</td>
                        <td className="secondary">{GAME_MODES[pl.gameMode] ?? pl.gameMode}</td>
                        <td className="num mono muted">{pl.ping} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>だれもいません</Empty>
            )}
          </Card>
          <Card title="最近の出来事" meta="リアルタイム">
            {feed.length === 0 ? (
              <Empty>参加・退出・チャット・死亡・進捗がここに流れます</Empty>
            ) : (
              <div className="list" style={{ gap: 2 }}>
                {feed.slice(0, 10).map((e) => (
                  <FeedRow key={`${e.id}-${e.type}`} e={e} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid-split">
          <Card title="ディメンション" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th className="num">MSPT</th>
                    <th className="num">チャンク</th>
                    <th className="num">エンティティ</th>
                    <th className="num">人数</th>
                  </tr>
                </thead>
                <tbody>
                  {p?.game.dimensions.map((d) => (
                    <tr key={d.dimension} className="clickable" onClick={() => nav(`/worlds?d=${d.dimension}`)}>
                      <td>{dimName(d.dimension)}</td>
                      <td className="num mono">{fmt2(d.msptAverage)}</td>
                      <td className="num mono">{fmtInt(d.loadedChunks)}</td>
                      <td className="num mono">{fmtInt(d.entities)}</td>
                      <td className="num mono">{d.players}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="マシン">
            {p ? (
              <div className="stack" style={{ gap: 12 }}>
                <MeterRow label="ディスク" used={p.disk ? p.disk.totalBytes - p.disk.usableBytes : 0} total={p.disk?.totalBytes ?? 0} />
                <MeterRow
                  label="OS のメモリ"
                  used={(p.cpu.totalMemoryBytes ?? 0) - (p.cpu.freeMemoryBytes ?? 0)}
                  total={p.cpu.totalMemoryBytes ?? 0}
                />
                <div className="row mono muted" style={{ gap: 24, fontSize: 12 }}>
                  <span>スレッド {p.threads.live}</span>
                  {p.gc.map((g) => (
                    <span key={g.name}>
                      {g.name} {fmtInt(g.count)} 回 / {fmtInt(g.timeMs)} ms
                    </span>
                  ))}
                </div>
                {info.data && (
                  <div className="mono muted" style={{ fontSize: 12 }}>
                    Java {info.data.java.version} · {info.data.os.name} {info.data.os.version} · MC REST API {info.data.modVersion}
                  </div>
                )}
              </div>
            ) : (
              <Empty>読み込み中</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function MeterRow({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <div className="split-v" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="secondary">{label}</span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {fmtBytes(used)} / {fmtBytes(total)}
        </span>
      </div>
      <Bar value={used} max={total} />
    </div>
  )
}

const FEED_LABEL: Record<string, string> = {
  chat: 'チャット',
  join: '参加',
  leave: '退出',
  death: '死亡',
  advancement: '進捗',
  server: 'サーバー',
}

export function FeedRow({ e }: { e: ServerEvent }) {
  const d = e.data as Record<string, string | undefined>
  let text: string
  switch (e.type) {
    case 'chat':
      text = `<${d.sender}> ${d.message}`
      break
    case 'death':
      text = d.message ?? `${d.name} が倒れました`
      break
    case 'advancement':
      text = `${d.name} が「${d.title}」を達成`
      break
    case 'join':
      text = `${d.name} が参加`
      break
    case 'leave':
      text = `${d.name} が退出`
      break
    case 'server':
      text = d.state === 'started' ? '起動しました' : d.state === 'stopping' ? '停止しています' : String(d.state)
      break
    default:
      text = JSON.stringify(d)
  }
  const time = typeof d.time === 'string' ? fmtTime(d.time, false) : fmtTime(new Date().toISOString(), false)
  return (
    <div className="row" style={{ minHeight: 32, gap: 12, flexWrap: 'nowrap' }}>
      <span className="mono muted" style={{ fontSize: 12, width: 64, flex: 'none' }}>
        {time}
      </span>
      <span className="muted" style={{ width: 56, flex: 'none', fontSize: 12 }}>
        {FEED_LABEL[e.type] ?? e.type}
      </span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{text}</span>
      {e.type === 'join' && <Dot state="on" />}
    </div>
  )
}
