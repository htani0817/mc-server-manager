// mc-server-manager（Mod）経由で MC REST API を呼ぶ。トークンはサーバー側で付く。

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const HEADERS = { 'X-MC-Manager': '1' }

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // JSON でない応答（プロキシのエラーページなど）
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'http_' + res.status, err?.message ?? `HTTP ${res.status}`)
  }
  return (body as { data: T } | null)?.data as T
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { ...HEADERS } }
  if (body !== undefined) {
    init.headers = { ...HEADERS, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return parse<T>(await fetch('/api/v1' + path, init))
}

export const get = <T = unknown>(path: string) => api<T>('GET', path)

/** この Mod 自身の API（/manager/...）。MC REST API を通さない */
export async function manager<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { ...HEADERS } }
  if (body !== undefined) {
    init.headers = { ...HEADERS, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return parse<T>(await fetch('/manager' + path, init))
}

export const getManager = <T = unknown>(path: string) => manager<T>('GET', path)
export const post = <T = unknown>(path: string, body?: unknown) => api<T>('POST', path, body ?? {})
export const put = <T = unknown>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {})
export const patch = <T = unknown>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {})
export const del = <T = unknown>(path: string) => api<T>('DELETE', path)

/** ファイルをそのまま送る（PUT /files/content） */
export async function putRaw<T = unknown>(path: string, data: Blob | string): Promise<T> {
  const res = await fetch('/api/v1' + path, {
    method: 'PUT',
    headers: { ...HEADERS, 'Content-Type': 'application/octet-stream' },
    body: data,
  })
  return parse<T>(res)
}

/** 本文をテキストのまま受け取る（GET /files/content） */
export async function getText(path: string): Promise<string> {
  const res = await fetch('/api/v1' + path)
  if (!res.ok) {
    await parse(res)
  }
  return res.text()
}

/** クエリ文字列つきのパス */
export function q(path: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  }
  const qs = s.toString()
  return qs ? `${path}?${qs}` : path
}

export const enc = encodeURIComponent

/** ダウンロードや SSE 用の使い捨てチケットを付けた URL */
export async function ticketUrl(path: string, params: Record<string, string> = {}): Promise<string> {
  const t = await post<{ ticket: string }>('/events/ticket')
  return '/api/v1' + q(path, { ...params, ticket: t.ticket })
}

export async function download(path: string, params: Record<string, string> = {}) {
  const url = await ticketUrl(path, params)
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ---- 応答の型（使うところだけ） ----

export interface CommandResult {
  success: boolean
  result: number
  output: string[]
}

export interface ServerInfo {
  minecraftVersion: string
  serverModName: string
  neoforgeVersion: string | null
  bukkit: { name: string; version: string; bukkitVersion: string } | null
  modVersion: string | null
  motd: string
  port: number
  localIp: string
  worldName: string
  hardcore: boolean
  defaultGameMode: string
  onlineMode: boolean
  startedAt: string
  uptimeSeconds: number
  java: { version: string; vendor: string }
  os: { name: string; version: string; arch: string }
  serverDirectory: string
}

export interface ServerStatus {
  ready: boolean
  running: boolean
  paused: boolean
  players: { online: number; max: number; names: string[] }
  tickCount: number
  tps: number
  targetTps: number
  msptAverage: number
  frozen: boolean
  autosave: boolean
  /** 予告中の再起動の時刻（なければ null） */
  restartAt: string | null
  uptimeSeconds: number
}

export interface Performance {
  game: {
    tps: number
    targetTps: number
    msptAverage: number
    msptMax: number
    msptMin: number
    dimensions: { dimension: string; msptAverage: number; loadedChunks: number; entities: number; players: number }[]
  }
  memory: { heapUsedBytes: number; heapCommittedBytes: number; heapMaxBytes: number; nonHeapUsedBytes: number }
  gc: { name: string; count: number; timeMs: number }[]
  threads: { live: number; peak: number }
  cpu: {
    availableProcessors: number
    processLoad?: number
    systemLoad?: number
    systemLoadAverage?: number
    totalMemoryBytes?: number
    freeMemoryBytes?: number
  }
  disk: { totalBytes: number; usableBytes: number } | null
  uptimeSeconds: number
}

export interface WorldInfo {
  dimension: string
  players: number
  gameTime: number
  clockTime: number
  day: number
  timeOfDay: number
  raining: boolean
  thundering: boolean
  loadedChunks: number
  entities?: number
  seed?: number
  difficulty?: string
  spawn?: { x: number; y: number; z: number; dimension: string }
  worldBorder?: {
    centerX: number
    centerZ: number
    size: number
    lerpTarget: number
    lerpTimeMs: number
    damagePerBlock: number
    safeZone: number
    warningBlocks: number
    warningTimeSeconds: number
  }
}

export interface PlayerSummary {
  name: string
  uuid: string
  dimension: string
  position: { x: number; y: number; z: number }
  gameMode: string
  health: number
  ping: number
}

export interface PlayerDetail extends Partial<PlayerSummary> {
  name: string
  uuid: string
  online: boolean
  rotation?: { yaw: number; pitch: number }
  maxHealth?: number
  food?: number
  saturation?: number
  air?: number
  xp?: { level: number; progress: number; total: number }
  ip?: string
  language?: string
  alive?: boolean
  sleeping?: boolean
  onFire?: boolean
  flying?: boolean
  op: boolean
  opLevel: number
  allowlisted: boolean
  banned: boolean
}

export interface KnownPlayer {
  name: string
  uuid: string
  online: boolean
  cacheExpiresOn: string | null
  op: boolean
  opLevel: number
  allowlisted: boolean
  banned: boolean
}

export interface InvItem {
  slot: number
  id: string
  count: number
  name: string
  item: unknown
}

export interface Effect {
  effect: string
  amplifier: number
  durationTicks: number
  ambient: boolean
  visible: boolean
  showIcon: boolean
}

export interface Operator {
  name: string
  uuid: string
  level: number
  bypassesPlayerLimit: boolean
  online: boolean
}

export interface Ban {
  name?: string
  uuid?: string
  ip?: string
  reason: string | null
  source: string | null
  created: string | null
  expires: string | null
}

export interface Gamerule {
  key: string
  id: string
  type: 'boolean' | 'integer' | string
  category: string
  value: boolean | number
  default: boolean | number
}

export type Settings = Record<string, string | number | boolean>

export interface LogLine {
  time: string
  level: string
  thread: string
  logger: string
  message: string
}

export interface ChatMessage {
  time: string
  sender: string
  uuid: string | null
  message: string
  source: 'player' | 'api'
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number | null
  modified: string
  text: boolean
}

export interface BackupJob {
  id: string
  state: 'running' | 'done' | 'failed'
  phase: string
  file: string | null
  files: number
  bytes: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface MetricsData {
  from: number
  to: number
  step: number
  intervalSeconds: number
  keepDays: number
  times: number[]
  series: Record<MetricKey, (number | null)[]>
  /** この範囲でサーバーが起動した時刻 */
  starts: number[]
  processRssAvailable: boolean
  ioAvailable: boolean
}

export type MetricKey =
  | 'tps'
  | 'mspt'
  | 'players'
  | 'cpuSystem'
  | 'cpuProcess'
  | 'memTotal'
  | 'memUsed'
  | 'processRss'
  | 'heapUsed'
  | 'heapMax'
  | 'diskTotal'
  | 'diskUsed'
  | 'ioRead'
  | 'ioWrite'

export type RankingPeriod = 'today' | '7d' | '30d' | 'month' | 'all' | 'stats'

export interface RankingRow {
  rank: number
  name: string
  uuid: string
  seconds: number
  sessions: number | null
  longestSeconds: number | null
  firstSeen: string | null
  lastSeen: string | null
  online: boolean
}

export interface Ranking {
  period: RankingPeriod
  from: string | null
  to: string
  recordingSince: string
  players: RankingRow[]
}

export interface RestartScheduleSettings {
  enabled: boolean
  /** 1=月〜7=日 */
  days: number[]
  /** HH:MM */
  times: string[]
  delaySeconds: number
  message: string
}

export interface RestartScheduleView {
  settings: RestartScheduleSettings
  timezone: string
  nextRunAt: string | null
  running: boolean
  phase: 'checking' | 'backup' | 'restart' | null
  runningSince: string | null
  lastRun: {
    trigger: 'schedule' | 'manual'
    startedAt: string
    finishedAt: string
    result: 'restart_scheduled' | 'backup_failed' | 'skipped' | 'error'
    detail: string | null
    backupFile: string | null
  } | null
}
