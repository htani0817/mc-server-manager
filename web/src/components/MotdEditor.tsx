import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Bold, Eraser, Italic, Shuffle, Strikethrough, Underline } from 'lucide-react'
import { Button } from '../ui'

// Minecraft の書式記号（§ のあとに 1 文字）。色は Minecraft が決めている 16 色
const COLORS: [string, string, string][] = [
  ['0', '黒', '#000000'],
  ['1', '紺', '#0000AA'],
  ['2', '深緑', '#00AA00'],
  ['3', '青緑', '#00AAAA'],
  ['4', '暗い赤', '#AA0000'],
  ['5', '紫', '#AA00AA'],
  ['6', '金', '#FFAA00'],
  ['7', '灰', '#AAAAAA'],
  ['8', '濃い灰', '#555555'],
  ['9', '青', '#5555FF'],
  ['a', '黄緑', '#55FF55'],
  ['b', '水色', '#55FFFF'],
  ['c', '赤', '#FF5555'],
  ['d', 'ピンク', '#FF55FF'],
  ['e', '黄', '#FFFF55'],
  ['f', '白', '#FFFFFF'],
]
const COLOR_HEX = Object.fromEntries(COLORS.map(([c, , h]) => [c, h]))

const FORMATS: [string, string, typeof Bold][] = [
  ['l', '太字', Bold],
  ['o', '斜体', Italic],
  ['n', '下線', Underline],
  ['m', '取り消し線', Strikethrough],
  ['k', '難読化（文字がランダムに変わり続ける）', Shuffle],
  ['r', 'リセット（色と書式を元に戻す）', Eraser],
]

/** サーバー一覧での MOTD の既定の文字色 */
const DEFAULT_COLOR = '#A8A8A8'

/** 手で書いた &6 などを §6 に直す */
export const normalizeMotd = (s: string) => s.replace(/&([0-9a-fk-or])/gi, (_, c: string) => '§' + c.toLowerCase())

/** 色と書式の記号を外し、2 行を 1 行にした文字だけの MOTD */
export const plainMotd = (s: string) => s.replace(/§[0-9a-fk-or]/gi, '').replace(/\s*\n\s*/g, ' ').trim()

interface Seg {
  text: string
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  obf: boolean
}

function parse(line: string): Seg[] {
  const segs: Seg[] = []
  let cur: Omit<Seg, 'text'> = { color: DEFAULT_COLOR, bold: false, italic: false, underline: false, strike: false, obf: false }
  let buf = ''
  const flush = () => {
    if (buf) segs.push({ ...cur, text: buf })
    buf = ''
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '§' && i + 1 < line.length) {
      const c = line[i + 1].toLowerCase()
      flush()
      if (COLOR_HEX[c]) {
        // 色を変えると書式はリセットされる（Minecraft と同じ）
        cur = { color: COLOR_HEX[c], bold: false, italic: false, underline: false, strike: false, obf: false }
      } else if (c === 'r') {
        cur = { color: DEFAULT_COLOR, bold: false, italic: false, underline: false, strike: false, obf: false }
      } else if (c === 'l') cur = { ...cur, bold: true }
      else if (c === 'o') cur = { ...cur, italic: true }
      else if (c === 'n') cur = { ...cur, underline: true }
      else if (c === 'm') cur = { ...cur, strike: true }
      else if (c === 'k') cur = { ...cur, obf: true }
      i++
      continue
    }
    buf += ch
  }
  flush()
  return segs
}

/** 書式記号を除いた、見える文字数 */
const visibleLength = (line: string) => line.replace(/§[0-9a-fk-or]/gi, '').length

const OBF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghkmnpqrstuvwxyz0123456789#$%&@'

function MotdLine({ text, tick }: { text: string; tick: number }) {
  return (
    <div className="motd-line">
      {parse(text).map((s, i) => {
        const style: CSSProperties = {
          color: s.color,
          fontWeight: s.bold ? 700 : 400,
          fontStyle: s.italic ? 'italic' : 'normal',
          textDecoration: [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
        }
        const t = s.obf
          ? Array.from(s.text, (c, j) => (c === ' ' ? ' ' : OBF_CHARS[(c.charCodeAt(0) * 7 + j * 13 + tick * 31) % OBF_CHARS.length])).join('')
          : s.text
        return (
          <span key={i} style={style}>
            {t}
          </span>
        )
      })}
    </div>
  )
}

/**
 * サーバー一覧の説明（MOTD）の編集欄。色と書式はボタンで入れられ、Minecraft のサーバー一覧と同じ並びで確かめられる。
 */
export function MotdEditor({
  value,
  online,
  max,
  onSave,
}: {
  value: string
  online: number
  max: number
  onSave: (motd: string) => Promise<boolean>
}) {
  const initial = value.split('\n')
  const [lines, setLines] = useState<[string, string]>([initial[0] ?? '', initial.slice(1).join(' ')])
  const [focus, setFocus] = useState(0)
  const [tick, setTick] = useState(0)
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const motd = normalizeMotd(lines[1] ? `${lines[0]}\n${lines[1]}` : lines[0])
  const changed = motd !== value
  const hasObf = /§k/i.test(motd)

  useEffect(() => {
    const v = value.split('\n')
    setLines([v[0] ?? '', v.slice(1).join(' ')])
  }, [value])

  // 難読化（§k）があるときだけ、文字を入れ替え続けて見た目を再現する
  useEffect(() => {
    if (!hasObf) return
    const id = window.setInterval(() => setTick((t) => t + 1), 80)
    return () => window.clearInterval(id)
  }, [hasObf])

  /** 最後に触った行のカーソル位置に §x を入れる */
  const insert = (code: string) => {
    const el = refs[focus].current
    const text = lines[focus]
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + '§' + code + text.slice(end)
    const nl: [string, string] = [...lines] as [string, string]
    nl[focus] = next
    setLines(nl)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + 2, start + 2)
    })
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="motd-preview" aria-label="サーバー一覧での見え方">
        <div className="motd-icon" aria-hidden="true">
          <svg viewBox="0 0 18 18" fill="none" width="28" height="28">
            <rect x="1.75" y="1.75" width="14.5" height="14.5" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M1.75 7.25h5.5V1.75M16.25 10.75h-5.5v5.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="motd-head">
            <span>Minecraft Server</span>
            <span className="motd-count">
              {online}/{max}
              <span className="motd-signal" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} style={{ height: 2 + i * 2 }} />
                ))}
              </span>
            </span>
          </div>
          <MotdLine text={normalizeMotd(lines[0])} tick={tick} />
          <MotdLine text={normalizeMotd(lines[1])} tick={tick} />
        </div>
      </div>

      <div className="motd-tools" role="toolbar" aria-label="色と書式">
        <div className="motd-swatches">
          {COLORS.map(([c, name, hex]) => (
            <button key={c} type="button" className="swatch" title={`${name}（§${c}）`} aria-label={name} style={{ background: hex }} onClick={() => insert(c)} />
          ))}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {FORMATS.map(([c, name, Icon]) => (
            <Button key={c} size="sm" variant="ghost" icon title={`${name}（§${c}）`} aria-label={name} onClick={() => insert(c)}>
              <Icon size={16} strokeWidth={1.5} />
            </Button>
          ))}
        </div>
      </div>

      {(['1 行目', '2 行目'] as const).map((label, i) => (
        <div key={label} className="field">
          <span className="label row" style={{ justifyContent: 'space-between' }}>
            <span>{label}</span>
            <span className="num muted">{visibleLength(normalizeMotd(lines[i]))} 文字</span>
          </span>
          <input
            ref={refs[i]}
            className="input mono"
            value={lines[i]}
           
            placeholder={i === 1 ? '空なら 1 行だけ' : ''}
            onFocus={() => setFocus(i)}
            onChange={(e) => {
              const nl: [string, string] = [...lines] as [string, string]
              nl[i] = e.target.value
              setLines(nl)
            }}
          />
        </div>
      ))}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          色や書式は上のボタンで入れる。手で書くなら & を使ってよい（例: &6金色 → §6金色）。全角で 1 行 25 文字くらいを超えると端が切れる
        </span>
        <div className="row">
          <Button variant="ghost" disabled={!changed} onClick={() => setLines([initial[0] ?? '', initial.slice(1).join(' ')])}>
            元に戻す
          </Button>
          <Button variant="primary" disabled={!changed} onClick={() => onSave(motd)}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
