import { useEffect, useRef, useState } from 'react'
import { fmtTime } from '../ui'
import { niceMax, smoothPath } from './TickChart'

export interface Series {
  key: string
  label: string
  values: (number | null)[]
  /** 主役は琥珀色の実線、比べる相手はグレーの破線（色だけで見分けさせない） */
  tone: 'accent' | 'muted'
  /** 面を塗る（主役 1 本だけに使う） */
  area?: boolean
}

const PAD = { l: 68, r: 12, t: 12, b: 26 }

/**
 * メトリクスの折れ線。値の無い区間（サーバーが止まっていたあいだ）は線を切る。
 * 横軸は from〜to で固定し、同じページのグラフはホバーの位置（hover）を共有する。
 */
export function LineChart({
  times,
  from,
  to,
  series,
  yMax,
  format,
  axisFormat,
  refLine,
  markers = [],
  hover,
  onHover,
  height = 180,
  label,
  binary,
}: {
  times: number[]
  from: number
  to: number
  series: Series[]
  /** 縦軸の上限を決めたいとき（% なら 100） */
  yMax?: number
  format: (v: number) => string
  axisFormat?: (v: number) => string
  refLine?: { value: number; label: string }
  /** 起動した時刻（縦の点線を引く） */
  markers?: number[]
  hover: number | null
  onHover: (i: number | null) => void
  height?: number
  label: string
  /** バイトの値。縦軸を 1024 の刻みで切りのいい値にする */
  binary?: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(560)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = height
  const innerW = w - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const span = Math.max(1, to - from)
  let peak = refLine?.value ?? 0
  for (const s of series) for (const v of s.values) if (v !== null && v > peak) peak = v
  const top = yMax ?? niceAxis(peak * 1.15, binary)
  const x = (t: number) => PAD.l + ((t - from) / span) * innerW
  const y = (v: number) => PAD.t + innerH - (Math.min(Math.max(v, 0), top) / top) * innerH

  // null で区切った線のかたまり
  const runs = series.map((s) => {
    const out: [number, number][][] = []
    let cur: [number, number][] = []
    s.values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) out.push(cur)
        cur = []
      } else {
        cur.push([x(times[i]), y(v)])
      }
    })
    if (cur.length) out.push(cur)
    return out
  })

  const yTicks = [0, top / 4, top / 2, (top * 3) / 4, top]
  const xRatios = w < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]
  const longSpan = span > 2 * 86_400_000
  const af = axisFormat ?? format

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (times.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = from + ((e.clientX - rect.left - PAD.l) / innerW) * span
    const i = Math.round((t - times[0]) / Math.max(1, times[1] - times[0] || 1))
    onHover(Math.max(0, Math.min(times.length - 1, i)))
  }

  const hx = hover !== null && times[hover] !== undefined ? x(times[hover]) : null
  const hasData = series.some((s) => s.values.some((v) => v !== null))

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg width={w} height={H} onMouseMove={onMove} onMouseLeave={() => onHover(null)} role="img" aria-label={label}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="chart-label">
              {af(v)}
            </text>
          </g>
        ))}
        {xRatios.map((r, i) => (
          <text key={r} x={PAD.l + r * innerW} y={H - 6} textAnchor={i === 0 ? 'start' : i === xRatios.length - 1 ? 'end' : 'middle'} className="chart-label">
            {axisTime(from + r * span, longSpan)}
          </text>
        ))}
        {markers.map((m, i) => {
          // 近くに続けて起動していると文字が重なるので、前の印から離れているものだけ文字を付ける
          const labeled = i === 0 || x(m) - x(markers[i - 1]) > 40
          return (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--line-strong)" strokeDasharray="2 3" />
              {labeled && (
                <text x={x(m) > w - PAD.r - 36 ? x(m) - 4 : x(m) + 4} y={PAD.t + 10} textAnchor={x(m) > w - PAD.r - 36 ? 'end' : 'start'} className="chart-label">
                  起動
                </text>
              )}
            </g>
          )
        })}
        {refLine && refLine.value <= top && (
          <g>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--text-3)" strokeDasharray="3 4" />
            <text x={w - PAD.r} y={y(refLine.value) - 6} textAnchor="end" className="chart-label">
              {refLine.label}
            </text>
          </g>
        )}
        {series.map((s, si) =>
          runs[si].map((pts, ri) => {
            if (pts.length === 1) {
              return <circle key={`${s.key}-${ri}`} cx={pts[0][0]} cy={pts[0][1]} r={2} fill={s.tone === 'accent' ? 'var(--accent)' : 'var(--text-3)'} />
            }
            const line = smoothPath(pts)
            const base = PAD.t + innerH
            return (
              <g key={`${s.key}-${ri}`}>
                {s.area && <path d={`${line} L${pts[pts.length - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z`} fill="var(--accent-soft)" />}
                <path
                  d={line}
                  fill="none"
                  stroke={s.tone === 'accent' ? 'var(--accent)' : 'var(--text-3)'}
                  strokeWidth={s.tone === 'accent' ? 2 : 1.5}
                  strokeDasharray={s.tone === 'muted' ? '4 3' : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            )
          }),
        )}
        {!hasData && (
          <text x={PAD.l + innerW / 2} y={PAD.t + innerH / 2} textAnchor="middle" className="chart-label">
            この範囲の記録はまだありません
          </text>
        )}
        {hx !== null && (
          <g>
            <line x1={hx} x2={hx} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--line-strong)" />
            {series.map((s) => {
              const v = s.values[hover!]
              return v === null || v === undefined ? null : (
                <circle key={s.key} cx={hx} cy={y(v)} r={3.5} fill={s.tone === 'accent' ? 'var(--accent)' : 'var(--text-3)'} stroke="var(--card)" strokeWidth={2} />
              )
            })}
          </g>
        )}
      </svg>
      {hx !== null && hover !== null && (
        <div className="chart-tip" style={{ left: hx > w / 2 ? hx - 12 : hx + 12, top: 8, transform: hx > w / 2 ? 'translateX(-100%)' : undefined }}>
          <div className="mono muted">{fmtTime(new Date(times[hover]).toISOString(), longSpan)}</div>
          {series.map((s) => (
            <div key={s.key} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <LegendSwatch tone={s.tone} />
              <span className="muted">{s.label}</span>
              <span className="num" style={{ marginLeft: 'auto' }}>
                {s.values[hover] === null || s.values[hover] === undefined ? '記録なし' : format(s.values[hover] as number)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 凡例の線の見本。グラフの線と同じ形（実線・破線）にする */
export function LegendSwatch({ tone }: { tone: 'accent' | 'muted' }) {
  return (
    <svg width="18" height="8" aria-hidden="true" style={{ flex: 'none' }}>
      <line
        x1="1"
        x2="17"
        y1="4"
        y2="4"
        stroke={tone === 'accent' ? 'var(--accent)' : 'var(--text-3)'}
        strokeWidth={tone === 'accent' ? 2 : 1.5}
        strokeDasharray={tone === 'muted' ? '4 3' : undefined}
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Legend({ series }: { series: Pick<Series, 'key' | 'label' | 'tone'>[] }) {
  return (
    <span className="row" style={{ gap: 12, fontSize: 12 }}>
      {series.map((s) => (
        <span key={s.key} className="row muted" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <LegendSwatch tone={s.tone} />
          {s.label}
        </span>
      ))}
    </span>
  )
}

/** 縦軸の上限。バイトのような大きい値も、1・2・5 の刻みで切り上げる */
function niceAxis(v: number, binary?: boolean): number {
  if (v <= 0) return 1
  if (binary) {
    const unit = 1024 ** Math.max(0, Math.floor(Math.log(v) / Math.log(1024)))
    return niceMax(v / unit) * unit
  }
  if (v <= 1000) return niceMax(v)
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

function axisTime(t: number, withDate: boolean): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return withDate ? `${d.getMonth() + 1}/${d.getDate()} ${hm}` : hm
}
