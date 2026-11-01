import { useState, type ReactNode } from 'react'
import { getManager, type MetricKey, type MetricsData } from '../api'
import { useQuery } from '../hooks'
import { Legend, LineChart, type Series } from '../components/LineChart'
import { Card, Empty, PageHead, Seg, fmt2, fmtBytes } from '../ui'

type Range = '1h' | '6h' | '24h' | '7d' | '30d'

const RANGES: [Range, string][] = [
  ['1h', '1 時間'],
  ['6h', '6 時間'],
  ['24h', '24 時間'],
  ['7d', '7 日'],
  ['30d', '30 日'],
]

const RANGE_KEY = 'mc-server-manager-metrics-range'

function savedRange(): Range {
  try {
    const v = localStorage.getItem(RANGE_KEY)
    return RANGES.some(([k]) => k === v) ? (v as Range) : '1h'
  } catch {
    return '1h'
  }
}

const pct = (v: number) => `${Math.round(v)}%`
const perSec = (v: number) => `${fmtBytes(v)}/s`

/** マシンと Minecraft の CPU・メモリ・ディスク・人数・TPS の推移。記録は Mod が取り続けているので、再起動しても残る */
export function Metrics() {
  const [range, setRangeState] = useState<Range>(savedRange)
  const [hover, setHover] = useState<number | null>(null)
  const setRange = (r: Range) => {
    setRangeState(r)
    setHover(null)
    try {
      localStorage.setItem(RANGE_KEY, r)
    } catch {
      // 覚えられなくても切り替えは効く
    }
  }
  // 長い範囲ほど 1 点の幅が広いので、取り直す間隔も延ばす
  const refresh = range === '1h' ? 10_000 : range === '6h' ? 30_000 : 60_000
  const m = useQuery<MetricsData>(`/metrics?range=${range}`, refresh, getManager)
  const d = m.data

  const s = (key: MetricKey) => d?.series[key] ?? []
  const latest = (key: MetricKey) => {
    const v = s(key)
    for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return v[i] as number
    return null
  }
  const peakOf = (key: MetricKey) => s(key).reduce<number>((a, v) => (v !== null && v > a ? v : a), 0)

  const chart = (props: {
    title: string
    series: Series[]
    format: (v: number) => string
    headline: ReactNode
    yMax?: number
    refLine?: { value: number; label: string }
    binary?: boolean
    axisFormat?: (v: number) => string
    note?: ReactNode
  }) => (
    <Card
      title={props.title}
      actions={<div className="headline-figure">{props.headline}</div>}
    >
      {props.series.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <Legend series={props.series} />
        </div>
      )}
      {d ? (
        <LineChart
          label={`${props.title}の推移`}
          times={d.times}
          from={d.from}
          to={d.to}
          series={props.series}
          yMax={props.yMax}
          format={props.format}
          axisFormat={props.axisFormat}
          refLine={props.refLine}
          binary={props.binary}
          markers={d.starts}
          hover={hover}
          onHover={setHover}
        />
      ) : (
        <Empty>{m.error ? m.error.message : '読み込み中'}</Empty>
      )}
      {props.note && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {props.note}
        </div>
      )}
    </Card>
  )

  const big = (v: string | null, unit?: string) => (
    <>
      <span className="big">{v ?? '—'}</span>
      {unit && <span className="muted">{unit}</span>}
    </>
  )
  const bytesBig = (v: number | null) => {
    if (v === null) return big(null)
    const [n, u] = fmtBytes(v).split(' ')
    return big(n, u)
  }

  const memTotal = latest('memTotal')
  const heapMax = latest('heapMax')
  const diskTotal = latest('diskTotal')
  const rssOk = d?.processRssAvailable ?? false
  const stepLabel = d ? stepText(d.step) : ''

  return (
    <>
      <PageHead
        title="メトリクス"
        sub={d ? `${d.intervalSeconds} 秒ごとに記録して ${d.keepDays} 日分を残します。サーバーを止めても消えません · 1 点 = ${stepLabel}` : '読み込み中'}
        actions={<Seg options={RANGES} value={range} onChange={setRange} />}
      />
      <div className="grid grid-split">
        {chart({
          title: 'CPU',
          series: [
            { key: 'cpuProcess', label: 'Minecraft', values: s('cpuProcess'), tone: 'accent', area: true },
            { key: 'cpuSystem', label: 'マシン全体', values: s('cpuSystem'), tone: 'muted' },
          ],
          format: pct,
          yMax: 100,
          headline: big(latest('cpuProcess') === null ? null : String(Math.round(latest('cpuProcess')!)), '%'),
        })}
        {chart({
          title: 'メモリ',
          series: [
            { key: 'processRss', label: rssOk ? 'Minecraft' : 'Minecraft（ヒープ）', values: rssOk ? s('processRss') : s('heapUsed'), tone: 'accent', area: true },
            { key: 'memUsed', label: 'マシン全体', values: s('memUsed'), tone: 'muted' },
          ],
          format: fmtBytes,
          binary: true,
          yMax: memTotal ?? undefined,
          headline: bytesBig(rssOk ? latest('processRss') : latest('heapUsed')),
          note: memTotal ? `上端はマシンのメモリ ${fmtBytes(memTotal)}${rssOk ? '。Minecraft は実際に使っている物理メモリ（RSS）' : ''}` : undefined,
        })}
        {chart({
          title: 'Java ヒープ',
          series: [{ key: 'heapUsed', label: 'ヒープ', values: s('heapUsed'), tone: 'accent', area: true }],
          format: fmtBytes,
          binary: true,
          refLine: heapMax ? { value: heapMax, label: `上限 ${fmtBytes(heapMax)}（-Xmx）` } : undefined,
          headline: bytesBig(latest('heapUsed')),
        })}
        {chart({
          title: 'ディスク',
          series: [{ key: 'diskUsed', label: '使用量', values: s('diskUsed'), tone: 'accent', area: true }],
          format: fmtBytes,
          binary: true,
          yMax: diskTotal ?? undefined,
          headline: bytesBig(latest('diskUsed')),
          note: diskTotal ? `サーバーのフォルダがあるディスク。上端は容量 ${fmtBytes(diskTotal)}` : undefined,
        })}
        {d && !d.ioAvailable ? (
          <Card title="ディスクの読み書き（Minecraft）">
            <Empty>この OS では取れません（Linux の /proc/self/io を使います）</Empty>
          </Card>
        ) : (
          chart({
            title: 'ディスクの読み書き（Minecraft）',
            series: [
              { key: 'ioWrite', label: '書き込み', values: s('ioWrite'), tone: 'accent' },
              { key: 'ioRead', label: '読み込み', values: s('ioRead'), tone: 'muted' },
            ],
            format: perSec,
            binary: true,
            axisFormat: fmtBytes,
            headline: bytesBig(latest('ioWrite')),
            note: '毎秒の量。ヘッドラインは書き込み',
          })
        )}
        {chart({
          title: '参加者',
          series: [{ key: 'players', label: '人数', values: s('players'), tone: 'accent', area: true }],
          format: (v) => `${Math.round(v)} 人`,
          axisFormat: (v) => (Number.isInteger(v) ? String(v) : ''),
          yMax: Math.max(4, Math.ceil(peakOf('players') * 1.25 / 4) * 4),
          headline: big(latest('players') === null ? null : String(latest('players')), '人'),
          note: '1 点の中でいちばん多かった人数',
        })}
        {chart({
          title: 'TPS',
          series: [{ key: 'tps', label: 'TPS', values: s('tps'), tone: 'accent', area: true }],
          format: (v) => v.toFixed(1),
          axisFormat: (v) => String(Math.round(v)),
          yMax: 20,
          headline: big(latest('tps') === null ? null : latest('tps')!.toFixed(1), 'TPS'),
        })}
        {chart({
          title: 'ティック処理時間',
          series: [{ key: 'mspt', label: 'MSPT', values: s('mspt'), tone: 'accent', area: true }],
          format: (v) => `${fmt2(v)} ms`,
          axisFormat: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))),
          refLine: peakOf('mspt') > 40 ? { value: 50, label: '50 ms（20 TPS の上限）' } : undefined,
          headline: big(latest('mspt') === null ? null : fmt2(latest('mspt')), 'ms'),
        })}
      </div>
    </>
  )
}

function stepText(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分`
  return `${Math.round(ms / 3_600_000)} 時間`
}
