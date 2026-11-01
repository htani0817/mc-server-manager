import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt2, fmtTime } from '../ui'

export interface Sample {
  t: number
  mspt: number
  tps: number
}

const H = 240
const PAD = { l: 44, r: 12, t: 12, b: 28 }
/** 1 ティックの持ち時間（20 TPS = 50ms） */
const BUDGET = 50

/** 単調な 3 次スプラインで、行き過ぎのないなめらかな線を作る（Fritsch–Carlson） */
export function smoothPath(pts: [number, number][]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0])
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1))
  }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) {
    t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  }
  t.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      t[i] = k * a * m[i]
      t[i + 1] = k * b * m[i]
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const h = dx[i] / 3
    d += ` C${(x0 + h).toFixed(1)},${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
  }
  return d
}

export function niceMax(v: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 60, 100, 200, 250, 500, 1000]
  return steps.find((s) => s >= v) ?? Math.ceil(v / 1000) * 1000
}

/**
 * ティック処理時間（MSPT）の推移。主役のグラフなので、線は琥珀色 1 本だけ。
 * 点が 0〜1 個のときも、直近 windowMs の枠と目盛りを出しておく。
 */
export function TickChart({ samples, windowMs = 6 * 60_000 }: { samples: Sample[]; windowMs?: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const peak = samples.reduce((a, s) => Math.max(a, s.mspt), 0)
  // 余裕があるときは 50ms の線を出さず、値の動きが見える縦幅にする
  const yMax = niceMax(Math.max(peak * 1.3, 2))
  const showBudget = yMax >= BUDGET * 0.8
  const innerW = w - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  // 点が 2 つそろうまでは、いまを右端にした枠で描く
  const enough = samples.length > 1
  const t1 = enough ? samples[samples.length - 1].t : (samples[0]?.t ?? Date.now())
  const t0 = enough ? samples[0].t : t1 - windowMs
  const span = Math.max(1, t1 - t0)

  const pts = useMemo<[number, number][]>(
    () =>
      samples.map((s) => [
        PAD.l + ((s.t - t0) / span) * innerW,
        PAD.t + innerH - (Math.min(s.mspt, yMax) / yMax) * innerH,
      ]),
    [samples, t0, span, innerW, innerH, yMax],
  )
  const line = smoothPath(pts)
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${PAD.t + innerH} L${pts[0][0].toFixed(1)},${PAD.t + innerH} Z` : ''
  const yTicks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax]
  // 狭い画面では時刻の目盛りが重ならないよう 3 つに減らす
  const xRatios = w < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]
  const xTicks = xRatios.map((r) => t0 + r * span)
  const last = pts[pts.length - 1]
  const hs = hover !== null ? samples[hover] : null

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (samples.length < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const r = (x - PAD.l) / innerW
    const target = t0 + r * span
    let best = 0
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(samples[i].t - target) < Math.abs(samples[best].t - target)) best = i
    }
    setHover(best)
  }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg width={w} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="ティック処理時間の推移">
        {yTicks.map((v) => {
          const y = PAD.t + innerH - (v / yMax) * innerH
          return (
            <g key={v}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} stroke="var(--line)" />
              <text x={PAD.l - 8} y={y + 4} textAnchor="end" className="chart-label">
                {v < 10 ? v.toFixed(1) : Math.round(v)}
              </text>
            </g>
          )
        })}
        {xTicks.map((t, i) => (
          <text key={i} x={PAD.l + xRatios[i] * innerW} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} className="chart-label">
            {/* 5 分より短いあいだは秒まで出さないと目盛りが同じ表記になる */}
            {fmtTime(new Date(t).toISOString(), false).slice(0, span < 300_000 ? 8 : 5)}
          </text>
        ))}
        {showBudget && (
          <g>
            <line
              x1={PAD.l}
              x2={w - PAD.r}
              y1={PAD.t + innerH - (BUDGET / yMax) * innerH}
              y2={PAD.t + innerH - (BUDGET / yMax) * innerH}
              stroke="var(--text-3)"
              strokeDasharray="3 4"
            />
            <text x={w - PAD.r} y={PAD.t + innerH - (BUDGET / yMax) * innerH - 6} textAnchor="end" className="chart-label">
              50 ms（20 TPS の上限）
            </text>
          </g>
        )}
        {area && <path d={area} fill="var(--accent-soft)" />}
        {line && <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {samples.length === 0 && (
          <text x={PAD.l + innerW / 2} y={PAD.t + innerH / 2} textAnchor="middle" className="chart-label">
            最初の値を待っています
          </text>
        )}
        {last && hover === null && <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />}
        {hs && hover !== null && (
          <g>
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--line-strong)" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r={3.5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hs && hover !== null && (
        <div
          className="chart-tip"
          style={{ left: Math.min(pts[hover][0] + 12, w - 150), top: Math.max(4, pts[hover][1] - 52) }}
        >
          <div className="mono muted">{fmtTime(new Date(hs.t).toISOString(), false)}</div>
          <div className="num">
            {fmt2(hs.mspt)} ms <span className="muted">· {hs.tps.toFixed(1)} TPS</span>
          </div>
        </div>
      )}
    </div>
  )
}
