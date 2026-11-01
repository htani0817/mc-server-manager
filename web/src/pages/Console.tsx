import { useEffect, useRef, useState } from 'react'
import { get, post, q, type ChatMessage, type CommandResult, type LogLine } from '../api'
import { useEvents, useQuery } from '../hooks'
import { Button, Card, Empty, Input, PageHead, Select, Switch, Tabs, fmtTime, useAction } from '../ui'

type Tab = 'console' | 'logs' | 'chat'

export function ConsolePage() {
  const [tab, setTab] = useState<Tab>('console')
  const tabs: [Tab, string][] = [
    ['console', 'コンソール'],
    ['logs', 'ログ'],
    ['chat', 'チャット'],
  ]
  return (
    <>
      <PageHead title="コンソール・チャット" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'console' && <Console />}
      {tab === 'logs' && <Logs />}
      {tab === 'chat' && <Chat />}
    </>
  )
}

interface Entry {
  cmd: string
  res?: CommandResult
  error?: string
  at: string
}

function Console() {
  const [cmd, setCmd] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [hist, setHist] = useState<string[]>([])
  const [hi, setHi] = useState(-1)
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  // 波かっこで囲んで何も返さない（scrollIntoView は Chrome で Promise を返すので、返すと後片付け関数と誤解される）
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [entries])

  const exec = async () => {
    const c = cmd.trim()
    if (!c) return
    setBusy(true)
    setHist((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50))
    setHi(-1)
    setCmd('')
    const at = new Date().toISOString()
    try {
      const res = await post<CommandResult>('/console/command', { command: c })
      setEntries((e) => [...e, { cmd: c, res, at }])
    } catch (err) {
      setEntries((e) => [...e, { cmd: c, error: (err as Error).message, at }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="コマンド" meta="権限レベル 4 で実行します · ↑↓ で履歴">
      <div className="stack" style={{ gap: 12 }}>
        <div className="log" style={{ height: 420 }}>
          {entries.length === 0 && <span className="muted">結果がここに出ます。例: list、time query daytime、save-all</span>}
          {entries.map((e, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div className="cmd">
                <span className="muted">{fmtTime(e.at, false)} </span>/{e.cmd}
                {e.res && !e.res.success && <span className="bad"> 失敗</span>}
              </div>
              {e.res?.output.map((o, j) => (
                <div key={j} className="out">
                  {o}
                </div>
              ))}
              {e.res && e.res.output.length === 0 && <div className="out muted">（出力なし · 結果 {e.res.result}）</div>}
              {e.error && <div className="bad">{e.error}</div>}
            </div>
          ))}
          <div ref={end} />
        </div>
        <form
          className="row"
          style={{ flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault()
            exec()
          }}
        >
          <span className="mono muted">/</span>
          <Input
            className="mono"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' && hist.length) {
                e.preventDefault()
                const n = Math.min(hi + 1, hist.length - 1)
                setHi(n)
                setCmd(hist[n])
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                const n = hi - 1
                setHi(n)
                setCmd(n >= 0 ? hist[n] : '')
              }
            }}
            placeholder="コマンド"
            style={{ flex: 1 }}
            autoFocus
          />
          <button type="submit" className="btn primary" disabled={busy || !cmd.trim()}>
            実行
          </button>
        </form>
      </div>
    </Card>
  )
}

function Logs() {
  const [level, setLevel] = useState('')
  const [filter, setFilter] = useState('')
  const [lines, setLines] = useState<LogLine[]>([])
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    get<LogLine[]>(q('/console/logs', { lines: 500, level: level || undefined, q: filter || undefined }))
      .then(setLines)
      .catch(() => setLines([]))
  }, [level, filter])

  const rank: Record<string, number> = { DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5 }
  useEvents(['log'], (e) => {
    const l = e.data as unknown as LogLine
    if (level && (rank[l.level] ?? 0) < (rank[level] ?? 0)) return
    if (filter && !l.message.includes(filter)) return
    setLines((x) => [...x.slice(-1999), l])
  })

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, follow])

  return (
    <Card
      title="サーバーログ"
      meta={`${lines.length} 行 · リアルタイム`}
      actions={
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">すべて</option>
            <option value="INFO">INFO 以上</option>
            <option value="WARN">WARN 以上</option>
            <option value="ERROR">ERROR のみ</option>
          </Select>
          <Input placeholder="文字列で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }} />
          <label className="check-row" style={{ fontSize: 13 }}>
            <Switch label="最新を追う" checked={follow} onChange={setFollow} />
            最新を追う
          </label>
        </div>
      }
    >
      <div className="log" ref={box} style={{ height: 560 }}>
        {lines.length === 0 && <span className="muted">ログはまだありません</span>}
        {lines.map((l, i) => (
          <div key={i} className={`ln ${l.level === 'WARN' ? 'warn' : l.level === 'ERROR' || l.level === 'FATAL' ? 'error' : ''}`}>
            <span className="t">{fmtTime(l.time, false)}</span>
            <span className="lv">{l.level}</span>
            <span className="m">{l.message}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

const SENDER_KEY = 'mc-server-manager-sender'

function loadSender(): string {
  try {
    return localStorage.getItem(SENDER_KEY) || '管理者'
  } catch {
    return '管理者'
  }
}

function Chat() {
  const [sender, setSender] = useState(loadSender)
  const hist = useQuery<ChatMessage[]>(q('/chat/history', { limit: 200 }))
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'chat' | 'broadcast'>('chat')
  const [overlay, setOverlay] = useState(false)
  const run = useAction()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hist.data) setMsgs(hist.data)
  }, [hist.data])

  useEvents(['chat'], (e) => setMsgs((m) => [...m.slice(-499), e.data as unknown as ChatMessage]))

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [msgs])

  const send = async () => {
    if (!text.trim()) return
    const ok =
      mode === 'chat'
        ? await run('送りました', () => post('/chat', { message: text, sender: sender.trim() || '管理者' }))
        : await run('全体メッセージを送りました', () => post('/server/broadcast', { message: text, overlay }))
    if (ok) setText('')
  }

  return (
    <Card title="チャット" meta="起動してからの発言 · リアルタイム">
      <div className="stack" style={{ gap: 12 }}>
        <div className="log" ref={box} style={{ height: 480, fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: '22px' }}>
          {msgs.length === 0 && <Empty>まだ発言はありません</Empty>}
          {msgs.map((m, i) => (
            <div key={i} className="ln">
              <span className="t mono">{fmtTime(m.time, false)}</span>
              <span className={m.source === 'api' ? 'accent-ink' : 'secondary'} style={{ flex: 'none' }}>
                {m.source === 'api' ? `[${m.sender}]` : `<${m.sender}>`}
              </span>
              <span>{m.message}</span>
            </div>
          ))}
        </div>
        <form
          className="row"
          style={{ flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'chat' | 'broadcast')}>
            <option value="chat">名前を付けて発言</option>
            <option value="broadcast">システムメッセージ</option>
          </Select>
          {mode === 'chat' && (
            <Input
              aria-label="発言者の名前"
              value={sender}
              maxLength={32}
              style={{ width: 120 }}
              onChange={(e) => {
                setSender(e.target.value)
                try {
                  localStorage.setItem(SENDER_KEY, e.target.value)
                } catch {
                  // 覚えられなくても送れる
                }
              }}
            />
          )}
          {mode === 'broadcast' && (
            <label className="check-row" style={{ fontSize: 13 }}>
              <Switch label="アクションバー" checked={overlay} onChange={setOverlay} />
              アクションバー
            </label>
          )}
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="メッセージ" style={{ flex: 1 }} />
          <Button variant="primary" disabled={!text.trim()} onClick={send}>
            送る
          </Button>
        </form>
      </div>
    </Card>
  )
}
