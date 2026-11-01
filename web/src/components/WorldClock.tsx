import { CloudLightning, CloudRain, Sun } from 'lucide-react'
import { fmtInt } from '../ui'

/** Minecraft の時刻（0 = 日の出 6:00）を 24 時間表記にする */
export function mcClock(timeOfDay: number): string {
  const total = ((timeOfDay / 1000 + 6) % 24 + 24) % 24
  const h = Math.floor(total)
  const m = Math.floor((total - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function phaseOf(timeOfDay: number): string {
  const t = ((timeOfDay % 24000) + 24000) % 24000
  if (t < 1000 || t >= 23000) return '夜明け'
  if (t < 11000) return '昼'
  if (t < 13000) return '夕暮れ'
  return '夜'
}

const S = 220
const C = S / 2
const R = 92

/**
 * ワールド時刻の文字盤。左が日の出、上が正午、右が日の入り、下が真夜中。
 * 太陽と月が実際の時刻の位置に来る。この画面で色を持つ見せ場の 1 つ。
 */
export function WorldClock({
  timeOfDay,
  day,
  raining,
  thundering,
  size = S,
}: {
  timeOfDay: number
  day: number
  raining: boolean
  thundering: boolean
  size?: number
}) {
  const t = ((timeOfDay % 24000) + 24000) % 24000
  const angle = Math.PI - (t / 24000) * 2 * Math.PI
  const sun = [C + Math.cos(angle) * (R - 18), C - Math.sin(angle) * (R - 18)]
  const moon = [C - Math.cos(angle) * (R - 18), C + Math.sin(angle) * (R - 18)]
  const sunUp = sun[1] <= C + 2
  const ticks = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width={size} height={size} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`ワールド時刻 ${mcClock(t)}`}>
        <defs>
          <clipPath id="wc-face">
            <circle cx={C} cy={C} r={R} />
          </clipPath>
        </defs>
        {/* 昼の空（上半分）と夜（下半分）。どちらも面の色の段差だけで分ける */}
        <g clipPath="url(#wc-face)">
          <rect x={0} y={0} width={S} height={C} fill="var(--clock-day)" />
          <rect x={0} y={C} width={S} height={C} fill="var(--clock-night)" />
          <line x1={C - R} x2={C + R} y1={C} y2={C} stroke="var(--line-strong)" />
        </g>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line-strong)" />
        <circle cx={C} cy={C} r={R + 10} fill="none" stroke="var(--line)" />
        {ticks.map((i) => {
          // i 時（現実の 24 時間表記）の位置。6 時が左
          const a = Math.PI - ((i - 6) / 24) * 2 * Math.PI
          const major = i % 6 === 0
          const r1 = R + 4
          const r2 = R + (major ? 14 : 9)
          return (
            <line
              key={i}
              x1={C + Math.cos(a) * r1}
              y1={C - Math.sin(a) * r1}
              x2={C + Math.cos(a) * r2}
              y2={C - Math.sin(a) * r2}
              stroke={major ? 'var(--text-2)' : 'var(--text-3)'}
              strokeWidth={major ? 1.5 : 1}
            />
          )
        })}
        {/* 月: 淡い円盤とクレーター */}
        <g opacity={sunUp ? 0.35 : 1}>
          <circle cx={moon[0]} cy={moon[1]} r={9} fill="var(--text)" opacity={0.85} />
          <circle cx={moon[0] - 3} cy={moon[1] - 2} r={2.2} fill="var(--bg-deep)" opacity={0.25} />
          <circle cx={moon[0] + 3} cy={moon[1] + 3} r={1.5} fill="var(--bg-deep)" opacity={0.25} />
        </g>
        {/* 太陽: 松明と同じ琥珀色 */}
        <g opacity={sunUp ? 1 : 0.35}>
          <circle cx={sun[0]} cy={sun[1]} r={12} fill="var(--accent)" opacity={0.18} />
          <circle cx={sun[0]} cy={sun[1]} r={8} fill="var(--accent)" />
        </g>
        <text x={C} y={C - 10} textAnchor="middle" className="clock-time">
          {mcClock(t)}
        </text>
        <text x={C} y={C + 22} textAnchor="middle" className="clock-sub">
          {fmtInt(day + 1)} 日目
        </text>
      </svg>
      <div className="row secondary" style={{ gap: 16, fontSize: 13 }}>
        <span>{phaseOf(t)}</span>
        <span className="row" style={{ gap: 6 }}>
          {thundering ? <CloudLightning size={16} strokeWidth={1.5} /> : raining ? <CloudRain size={16} strokeWidth={1.5} /> : <Sun size={16} strokeWidth={1.5} />}
          {thundering ? '雷雨' : raining ? '雨' : '晴れ'}
        </span>
        <span className="mono muted">{fmtInt(t)} tick</span>
      </div>
    </div>
  )
}
