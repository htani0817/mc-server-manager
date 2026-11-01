import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ApiError, type CommandResult } from './api'

// ---- 整形 ----

const nf = new Intl.NumberFormat('ja-JP')
export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : nf.format(Math.round(n)))
export const fmt1 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(1))
export const fmt2 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2))

export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = b
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}日 ${h}時間`
  if (h > 0) return `${h}時間 ${m}分`
  return `${m}分`
}

export function fmtTime(iso: string | null | undefined, withDate = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const t = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return withDate ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${t}` : t
}

/** minecraft:diamond_sword → diamond_sword */
export const shortId = (id: string) => id.replace(/^minecraft:/, '')

export const GAME_MODES: Record<string, string> = {
  survival: 'サバイバル',
  creative: 'クリエイティブ',
  adventure: 'アドベンチャー',
  spectator: 'スペクテイター',
}

export const DIM_NAMES: Record<string, string> = {
  'minecraft:overworld': 'オーバーワールド',
  'minecraft:the_nether': 'ネザー',
  'minecraft:the_end': 'ジ・エンド',
}

export const dimName = (id: string) => DIM_NAMES[id] ?? id

// ---- 部品 ----

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'accent' | 'ghost' | 'danger' | 'default'
  size?: 'sm' | 'md'
  icon?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, className, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' && variant, size === 'sm' && 'sm', icon && 'icon', className].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={cls}
      {...rest}
    />
  )
}

export function Card({
  title,
  meta,
  actions,
  flush,
  children,
  className,
}: {
  title?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  flush?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={['card', flush && 'flush', className].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {meta && <span className="meta">{meta}</span>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  )
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={['input', props.className].filter(Boolean).join(' ')} />
}

/** 候補（datalist）つきの入力。レジストリの ID 入力に使う */
export function SuggestInput({ options, ...props }: InputHTMLAttributes<HTMLInputElement> & { options: string[] }) {
  const id = useId()
  return (
    <>
      <input {...props} list={id} className={['input', props.className].filter(Boolean).join(' ')} />
      <datalist id={id}>
        {options.slice(0, 2000).map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={['select', props.className].filter(Boolean).join(' ')} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={['textarea', props.className].filter(Boolean).join(' ')} />
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" className="tab" aria-selected={k === value} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function Seg<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={k === value} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Stat({ label, value, unit, sub, extra }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; extra?: ReactNode }) {
  return (
    <Card>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {extra}
      {sub && <div className="stat-sub">{sub}</div>}
    </Card>
  )
}

/** この製品の目印。TPS を 20 本の目盛りで表し、実際の TPS の本数だけ琥珀色で埋める */
export function Ticks({ tps, target = 20, large }: { tps: number | undefined; target?: number; large?: boolean }) {
  const n = Math.max(1, Math.round(target))
  const filled = tps === undefined ? 0 : Math.min(n, Math.round(tps))
  return (
    <span className={large ? 'ticks lg' : 'ticks'} role="img" aria-label={`TPS ${tps?.toFixed(1) ?? '—'} / ${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={[i < filled && 'on', (i + 1) % 5 === 0 && 'major'].filter(Boolean).join(' ')} />
      ))}
    </span>
  )
}

export function Dot({ state }: { state: 'on' | 'off' | 'wait' | 'idle' }) {
  return <span className={`dot ${state === 'idle' ? '' : state}`} />
}

export function Bar({ value, max, accent }: { value: number; max: number; accent?: boolean }) {
  const r = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className={accent ? 'bar accent' : 'bar'}>
      <i style={{ transform: `scaleX(${r})` }} />
    </div>
  )
}

export function Kv({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---- 通知 ----

interface Toast {
  id: number
  kind: 'ok' | 'error'
  text: string
  detail?: string
}

const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const seq = useRef(0)
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current
    setList((l) => [...l.slice(-3), { ...t, id }])
    window.setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className="toast">
            <Dot state={t.kind === 'ok' ? 'on' : 'off'} />
            <div>
              {t.text}
              {t.detail && <pre>{t.detail}</pre>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/**
 * 操作を実行して結果を通知する。コマンドの結果（output）が返ってきたら本文に出す。
 * 戻り値は成功したかどうか。
 */
export function useAction() {
  const toast = useToast()
  return useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        const r = await fn()
        const out = (r as Partial<CommandResult> | undefined)?.output
        toast({ kind: 'ok', text: label, detail: Array.isArray(out) && out.length ? out.join('\n') : undefined })
        return r
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : String(e)
        toast({ kind: 'error', text: `${label}に失敗しました`, detail: msg })
        return undefined
      }
    },
    [toast],
  )
}

// ---- 確認ダイアログ ----

interface ConfirmReq {
  title: string
  body?: ReactNode
  ok: string
  danger?: boolean
  resolve: (v: boolean) => void
}

const ConfirmCtx = createContext<(r: Omit<ConfirmReq, 'resolve'>) => Promise<boolean>>(async () => false)

export function ConfirmHost({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmReq | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  const ask = useCallback(
    (r: Omit<ConfirmReq, 'resolve'>) => new Promise<boolean>((resolve) => setReq({ ...r, resolve })),
    [],
  )
  useEffect(() => {
    if (req) ref.current?.showModal()
  }, [req])
  const close = (v: boolean) => {
    ref.current?.close()
    req?.resolve(v)
    setReq(null)
  }
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <dialog ref={ref} className="dialog" onCancel={(e) => (e.preventDefault(), close(false))}>
        {req && (
          <>
            <h3>{req.title}</h3>
            {req.body && <p>{req.body}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => close(false)}>
                やめる
              </button>
              <button type="button" className={req.danger ? 'btn danger' : 'btn primary'} onClick={() => close(true)} autoFocus>
                {req.ok}
              </button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmCtx.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmCtx)

/** 汎用のモーダル（ファイル編集など） */
export function Modal({ open, onClose, title, wide, children }: { open: boolean; onClose: () => void; title: ReactNode; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={wide ? 'dialog wide' : 'dialog'} onCancel={(e) => (e.preventDefault(), onClose())}>
      {open && (
        <>
          <h3>{title}</h3>
          {children}
        </>
      )}
    </dialog>
  )
}
