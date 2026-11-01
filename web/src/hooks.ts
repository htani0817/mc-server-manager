import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { get, post, q, type ServerStatus } from './api'

/** GET を呼んで結果を持つ。interval（ミリ秒）を渡すと定期的に取り直す。fetcher を替えると /manager も呼べる */
export function useQuery<T>(path: string | null, interval?: number, fetcher: (path: string) => Promise<T> = get<T>) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const pathRef = useRef(path)
  pathRef.current = path

  const reload = useCallback(async () => {
    const p = pathRef.current
    if (p === null) return
    try {
      const d = await fetcher(p)
      if (pathRef.current === p) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (pathRef.current === p) setError(e as Error)
    } finally {
      if (pathRef.current === p) setLoading(false)
    }
    // fetcher はモジュールの関数を渡す前提なので、変わらない
  }, [])

  useEffect(() => {
    if (path === null) {
      setData(undefined)
      setLoading(false)
      return
    }
    setLoading(true)
    reload()
    if (!interval) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, interval)
    return () => window.clearInterval(id)
  }, [path, interval, reload])

  return { data, error, loading, reload, setData }
}

export type EventType = 'log' | 'chat' | 'join' | 'leave' | 'death' | 'advancement' | 'command' | 'server'

export interface ServerEvent {
  id: number
  type: EventType
  data: Record<string, unknown>
}

/**
 * SSE（/events）を購読する。EventSource はヘッダーを付けられないので、使い捨てチケットを取ってから接続し、
 * 切れたら新しいチケットでつなぎ直す。
 */
export function useEvents(types: EventType[], onEvent: (e: ServerEvent) => void, enabled = true) {
  const handler = useRef(onEvent)
  handler.current = onEvent
  const [connected, setConnected] = useState(false)
  const key = types.join(',')

  useEffect(() => {
    if (!enabled) return
    let es: EventSource | null = null
    let timer: number | undefined
    let closed = false

    const connect = async () => {
      try {
        const t = await post<{ ticket: string }>('/events/ticket')
        if (closed) return
        es = new EventSource('/api/v1' + q('/events', { ticket: t.ticket, types: key }))
        es.onopen = () => setConnected(true)
        for (const type of key.split(',')) {
          es.addEventListener(type, (ev) => {
            const m = ev as MessageEvent<string>
            try {
              handler.current({ id: Number(m.lastEventId), type: type as EventType, data: JSON.parse(m.data) })
            } catch {
              // 壊れた行は捨てる
            }
          })
        }
        es.onerror = () => {
          setConnected(false)
          es?.close()
          if (!closed) timer = window.setTimeout(connect, 3000)
        }
      } catch {
        setConnected(false)
        if (!closed) timer = window.setTimeout(connect, 5000)
      }
    }
    connect()
    return () => {
      closed = true
      es?.close()
      window.clearTimeout(timer)
      setConnected(false)
    }
  }, [key, enabled])

  return connected
}

// ---- 再起動の見守り ----

const RESTART_KEY = 'mc-server-manager-restart'

function readRestart(): number | null {
  try {
    const v = sessionStorage.getItem(RESTART_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

/** 再起動を頼んだことを覚える（止まる予定の時刻、ミリ秒） */
export function markRestart(stopAt: number) {
  try {
    sessionStorage.setItem(RESTART_KEY, String(stopAt))
  } catch {
    // 覚えられなくても再起動はする。表示が「接続できません」になるだけ
  }
}

export function clearRestart() {
  try {
    sessionStorage.removeItem(RESTART_KEY)
  } catch {
    // 何もしない
  }
}

/**
 * 再起動を頼んだあと、サーバーにつながらないあいだ true。
 * 立ち上がり直したら画面を読み込み直す（jar が新しくなっていれば画面も新しくなる）。
 */
export function useRestarting(status: ServerStatus | undefined, down: boolean): boolean {
  const stopAt = readRestart()
  useEffect(() => {
    if (stopAt === null) return
    const now = Date.now()
    if (now - stopAt > 15 * 60_000) {
      // 15 分たっても戻らないときは見守りをやめる
      clearRestart()
      return
    }
    if (!down && status && now > stopAt && status.uptimeSeconds * 1000 < now - stopAt + 5000) {
      clearRestart()
      window.location.reload()
    }
  }, [status, down, stopAt])
  return stopAt !== null && down
}

// ---- 画面遷移（history API だけの小さなルーター） ----

export function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const on = () => setPath(window.location.pathname)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  const go = useCallback((to: string) => {
    if (to !== window.location.pathname) {
      window.history.pushState(null, '', to)
      setPath(to)
      window.scrollTo(0, 0)
    }
  }, [])
  return [path, go]
}

export const NavContext = createContext<(to: string) => void>(() => {})
export const useNav = () => useContext(NavContext)

/** レジストリの ID 一覧（入力の候補用）。ページ内で使い回す */
const registryCache = new Map<string, Promise<string[]>>()
export function useRegistry(name: string | null): string[] {
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => {
    if (!name) return
    let p = registryCache.get(name)
    if (!p) {
      p = get<{ ids: string[] }>(`/registries/${name}`).then((r) => r.ids).catch(() => [])
      registryCache.set(name, p)
    }
    let alive = true
    p.then((v) => alive && setIds(v))
    return () => {
      alive = false
    }
  }, [name])
  return ids
}
