import { useState, type ReactNode } from 'react'
import {
  Activity,
  Archive,
  Database,
  FileCode2,
  FolderOpen,
  Gauge,
  Globe,
  Menu,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  ScrollText,
  SquareTerminal,
  SunMedium,
  Trophy,
  Users,
} from 'lucide-react'
import { type ServerStatus } from './api'
import { NavContext, usePath, useQuery, useRestarting } from './hooks'
import { Button, ConfirmHost, Dot, Ticks, ToastHost } from './ui'
import { Dashboard } from './pages/Dashboard'
import { Players } from './pages/Players'
import { Access } from './pages/Access'
import { Worlds } from './pages/Worlds'
import { SettingsPage } from './pages/Settings'
import { GameData } from './pages/GameData'
import { ConsolePage } from './pages/Console'
import { Files } from './pages/Files'
import { Backups } from './pages/Backups'
import { ApiSpec } from './pages/ApiSpec'
import { History } from './pages/History'
import { Metrics } from './pages/Metrics'
import { Ranking } from './pages/Ranking'

interface NavItem {
  path: string
  label: string
  icon: typeof Gauge
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: '見る',
    items: [
      { path: '/', label: '概要', icon: Gauge },
      { path: '/metrics', label: 'メトリクス', icon: Activity },
      { path: '/ranking', label: 'ランキング', icon: Trophy },
      { path: '/players', label: 'プレイヤー', icon: Users },
      { path: '/worlds', label: 'ワールド', icon: Globe },
    ],
  },
  {
    label: '管理',
    items: [
      { path: '/access', label: 'OP・ホワイトリスト・BAN', icon: ShieldCheck },
      { path: '/settings', label: '設定・ゲームルール', icon: SlidersHorizontal },
      { path: '/data', label: 'スコア・データパック', icon: Database },
    ],
  },
  {
    label: '運用',
    items: [
      { path: '/console', label: 'コンソール・チャット', icon: SquareTerminal },
      { path: '/files', label: 'ファイル', icon: FolderOpen },
      { path: '/backups', label: 'バックアップ', icon: Archive },
      { path: '/history', label: 'ログと履歴', icon: ScrollText },
      { path: '/api', label: 'API 一覧', icon: FileCode2 },
    ],
  },
]

export function BrandMark() {
  // ブロックの面を 1 色の線で描いた印
  return (
    <svg className="brand-mark" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.75" y="1.75" width="14.5" height="14.5" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.75 7.25h5.5V1.75M16.25 10.75h-5.5v5.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function App() {
  return (
    <ToastHost>
      <ConfirmHost>
        <Shell />
      </ConfirmHost>
    </ToastHost>
  )
}

type Theme = 'system' | 'dark' | 'light'

export const THEME_KEY = 'mc-server-manager-theme'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = document.documentElement.dataset.theme
    return t === 'dark' || t === 'light' ? t : 'system'
  })
  const next = () => {
    const n: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system'
    setTheme(n)
    if (n === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = n
    try {
      localStorage.setItem(THEME_KEY, n)
    } catch {
      // 保存できなくても切り替えは効く
    }
  }
  return [theme, next]
}

function Shell() {
  const [path, go] = usePath()
  const [navOpen, setNavOpen] = useState(false)
  const [theme, nextTheme] = useTheme()
  const status = useQuery<ServerStatus>('/server/status', 5000)

  const navigate = (to: string) => {
    setNavOpen(false)
    go(to)
  }

  const page = route(path)
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : SunMedium
  const st = status.data
  const apiDown = !!status.error
  const restarting = useRestarting(st, apiDown)

  return (
    <NavContext.Provider value={navigate}>
      <div className={navOpen ? 'shell nav-open' : 'shell'}>
        <aside className="sidebar">
          <div className="brand">
            <BrandMark />
            mc-server-manager
          </div>
          <nav className="nav" aria-label="メニュー">
            {NAV.map((g) => (
              <div key={g.label}>
                <div className="nav-label">{g.label}</div>
                <div className="split-v" style={{ gap: 2 }}>
                  {g.items.map((it) => {
                    const active = it.path === '/' ? path === '/' : path.startsWith(it.path)
                    const Icon = it.icon
                    return (
                      <a
                        key={it.path}
                        href={it.path}
                        className="nav-item"
                        aria-current={active ? 'page' : undefined}
                        onClick={(e) => {
                          e.preventDefault()
                          navigate(it.path)
                        }}
                      >
                        <Icon size={16} strokeWidth={1.5} />
                        {it.label}
                        {it.path === '/players' && st && <span className="nav-meta">{st.players.online}</span>}
                      </a>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="server-chip">
              <div className="server-chip-row">
                <Dot state={restarting ? 'wait' : apiDown ? 'off' : st?.ready ? 'on' : 'wait'} />
                {restarting ? '再起動中' : apiDown ? 'サーバーに接続できません' : st?.restartAt ? '再起動の予告中' : st?.ready ? '稼働中' : '起動中'}
                {st && !apiDown && <span className="mono muted" style={{ marginLeft: 'auto' }}>{st.tps.toFixed(1)} TPS</span>}
              </div>
              {st && !apiDown && <Ticks tps={st.tps} target={st.targetTps} />}
            </div>
            <div className="user-row">
              <span className="muted" style={{ fontSize: 13 }}>
                v{__APP_VERSION__}
              </span>
              <span className="spacer" />
              <Button variant="ghost" icon size="sm" onClick={nextTheme} title={`テーマ: ${theme === 'system' ? 'OS に合わせる' : theme === 'dark' ? 'ダーク' : 'ライト'}`} aria-label="テーマを切り替え">
                <ThemeIcon size={16} strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        </aside>
        <div>
          <div className="mobile-bar">
            <Button variant="ghost" icon onClick={() => setNavOpen((v) => !v)} aria-label="メニュー">
              <Menu size={18} strokeWidth={1.5} />
            </Button>
            <div className="brand" style={{ padding: 0 }}>
              <BrandMark />
              mc-server-manager
            </div>
          </div>
          <main className="main" onClick={() => navOpen && setNavOpen(false)}>
            <div className="enter" key={page.key}>
              {page.node}
            </div>
          </main>
        </div>
      </div>
    </NavContext.Provider>
  )
}

function route(path: string): { key: string; node: ReactNode } {
  if (path === '/' || path === '') return { key: 'dash', node: <Dashboard /> }
  if (path.startsWith('/metrics')) return { key: 'metrics', node: <Metrics /> }
  if (path.startsWith('/ranking')) return { key: 'ranking', node: <Ranking /> }
  if (path.startsWith('/players')) return { key: 'players', node: <Players /> }
  if (path.startsWith('/worlds')) return { key: 'worlds', node: <Worlds /> }
  if (path.startsWith('/access')) return { key: 'access', node: <Access /> }
  if (path.startsWith('/settings')) return { key: 'settings', node: <SettingsPage /> }
  if (path.startsWith('/data')) return { key: 'data', node: <GameData /> }
  if (path.startsWith('/console')) return { key: 'console', node: <ConsolePage /> }
  if (path.startsWith('/files')) return { key: 'files', node: <Files /> }
  if (path.startsWith('/backups')) return { key: 'backups', node: <Backups /> }
  if (path.startsWith('/history')) return { key: 'history', node: <History /> }
  if (path.startsWith('/api')) return { key: 'api', node: <ApiSpec /> }
  return { key: 'dash', node: <Dashboard /> }
}
