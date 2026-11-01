import { useMemo, useState } from 'react'
import { Info, Search } from 'lucide-react'
import { get, patch, put, type Gamerule, type ServerStatus, type Settings } from '../api'
import { MotdEditor } from '../components/MotdEditor'
import { useQuery } from '../hooks'
import { Button, Card, Empty, Input, PageHead, Select, Switch, Tabs, GAME_MODES, useAction } from '../ui'

type Kind = 'bool' | 'int' | 'text' | { options: [string, string][] }

const GROUPS: { title: string; items: [string, string, Kind, string?][] }[] = [
  {
    title: '一般',
    items: [
      ['max_players', '最大人数', 'int'],
      ['difficulty', '難易度', { options: [['peaceful', 'ピースフル'], ['easy', 'イージー'], ['normal', 'ノーマル'], ['hard', 'ハード']] }],
      ['game_mode', '初期ゲームモード', { options: Object.entries(GAME_MODES) as [string, string][] }],
      ['force_game_mode', '入るたびに初期ゲームモードにする', 'bool'],
      ['allow_flight', '飛行を許可（キックしない）', 'bool'],
    ],
  },
  {
    title: '距離と負荷',
    items: [
      ['view_distance', '描画距離（チャンク）', 'int', '2〜32'],
      ['simulation_distance', 'シミュレーション距離（チャンク）', 'int', '2〜32'],
      ['entity_broadcast_range', 'エンティティを送る範囲（%）', 'int', '10〜1000'],
      ['pause_when_empty_seconds', 'だれもいないとき止めるまでの秒数', 'int', '-1 で止めない'],
    ],
  },
  {
    title: '参加',
    items: [
      ['use_allowlist', 'ホワイトリストを使う', 'bool'],
      ['enforce_allowlist', 'リストから外れた人をすぐキック', 'bool'],
      ['player_idle_timeout', '放置でキックするまでの分数', 'int', '0 でキックしない'],
      ['accept_transfers', '他のサーバーからの転送を受け入れる', 'bool'],
      ['hide_online_players', 'サーバー一覧で人数と名前を隠す', 'bool'],
      ['status_replies', 'サーバー一覧に応答する', 'bool'],
    ],
  },
  {
    title: '保存と権限',
    items: [
      ['autosave', '自動保存', 'bool'],
      ['spawn_protection_radius', 'スポーン保護の半径', 'int'],
      ['operator_user_permission_level', 'OP の既定の権限レベル', 'int', '0〜4'],
      ['status_heartbeat_interval', '管理プロトコルの状態通知の間隔（秒）', 'int', '0 で送らない'],
    ],
  },
]

export function SettingsPage() {
  const [tab, setTab] = useState<'server' | 'rules'>('server')
  return (
    <>
      <PageHead title="設定・ゲームルール" sub="サーバーを止めずに変えられるものだけです。設定は server.properties にも書き戻されます" />
      <Tabs
        tabs={[
          ['server', 'サーバー設定'],
          ['rules', 'ゲームルール'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'server' ? <ServerSettings /> : <Gamerules />}
    </>
  )
}

function ServerSettings() {
  const s = useQuery<Settings>('/settings')
  const status = useQuery<ServerStatus>('/server/status')
  const run = useAction()
  const [draft, setDraft] = useState<Settings>({})
  const changed = Object.keys(draft).length

  if (!s.data) return <Card><Empty>{s.error?.message ?? '読み込み中'}</Empty></Card>
  const cur = { ...s.data, ...draft }
  const set = (k: string, v: string | number | boolean) => {
    const next = { ...draft }
    if (s.data![k] === v) delete next[k]
    else next[k] = v
    setDraft(next)
  }

  return (
    <div className="stack">
      <Card title="サーバー一覧の説明（MOTD）" meta="motd">
        <MotdEditor
          value={String(s.data.motd ?? '')}
          online={status.data?.players.online ?? 0}
          max={Number(s.data.max_players ?? 20)}
          onSave={async (motd) => {
            const r = await run('MOTD を保存しました', () => patch<Settings>('/settings', { motd }))
            if (r) s.setData(r)
            return !!r
          }}
        />
      </Card>
      {GROUPS.map((g) => (
        <Card key={g.title} title={g.title} flush>
          <table className="table">
            <tbody>
              {g.items.map(([k, label, kind, hint]) => (
                <tr key={k}>
                  <td style={{ width: '45%' }}>
                    <div>{label}</div>
                  </td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {k}
                    {hint && <span style={{ marginLeft: 12 }}>{hint}</span>}
                  </td>
                  <td style={{ width: 280 }}>
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {k in draft && <span className="accent-ink" style={{ fontSize: 12 }}>変更あり</span>}
                      {kind === 'bool' ? (
                        <Switch label={label} checked={!!cur[k]} onChange={(v) => set(k, v)} />
                      ) : kind === 'int' ? (
                        <Input className="num mono" inputMode="numeric" style={{ width: 120 }} value={String(cur[k] ?? '')} onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
                      ) : kind === 'text' ? (
                        <Input style={{ width: 260 }} value={String(cur[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
                      ) : (
                        <Select style={{ width: 160 }} value={String(cur[k])} onChange={(e) => set(k, e.target.value)}>
                          {kind.options.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {changed > 0 && (
        <div className="savebar">
          <span className="what">{changed} 項目を変更しています</span>
          <Button variant="ghost" onClick={() => setDraft({})}>
            元に戻す
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const r = await run('設定を保存しました', () => patch<Settings>('/settings', draft))
              if (r) {
                s.setData(r)
                setDraft({})
              }
            }}
          >
            保存
          </Button>
        </div>
      )}
    </div>
  )
}

function Gamerules() {
  const rules = useQuery<Gamerule[]>('/gamerules')
  const run = useAction()
  const [filter, setFilter] = useState('')
  const [cat, setCat] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})

  const cats = useMemo(() => Array.from(new Set((rules.data ?? []).map((r) => r.category))).sort(), [rules.data])
  const rows = (rules.data ?? []).filter((r) => (!cat || r.category === cat) && (!filter || r.key.includes(filter.toLowerCase())))

  /** 変えたあと、その 1 件だけ取り直して一覧に反映する */
  const update = async (r: Gamerule, value: boolean | number) => {
    const ok = await run(`${r.key} を変えました`, () => put(`/gamerules/${r.key}`, { value }))
    if (!ok) return
    const fresh = await get<Gamerule>(`/gamerules/${r.key}`)
    rules.setData((list) => list?.map((x) => (x.key === r.key ? fresh : x)))
    setEdits(({ [r.key]: _, ...rest }) => rest)
  }

  return (
    <Card
      flush
      title="ゲームルール"
      meta={rules.data ? `${rows.length} / ${rules.data.length}` : undefined}
      actions={
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Search size={16} strokeWidth={1.5} className="muted" />
          <Input placeholder="名前で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }} />
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">すべての分類</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c.replace('minecraft:', '')}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      {!rules.data ? (
        <Empty>読み込み中</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>名前</th>
                <th>分類</th>
                <th className="num">既定</th>
                <th className="num">いまの値</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="mono">
                    {r.key}
                    {r.value !== r.default && <span className="accent-ink" style={{ marginLeft: 8, fontSize: 12 }}>変更あり</span>}
                  </td>
                  <td className="muted">{r.category.replace('minecraft:', '')}</td>
                  <td className="num mono muted">{String(r.default)}</td>
                  <td className="num" style={{ width: 220 }}>
                    {r.type === 'boolean' ? (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Switch label={r.key} checked={r.value === true} onChange={(v) => update(r, v)} />
                      </div>
                    ) : (
                      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <Input
                          className="num mono"
                          style={{ width: 110 }}
                         
                          value={edits[r.key] ?? String(r.value)}
                          onChange={(e) => setEdits({ ...edits, [r.key]: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && edits[r.key] !== undefined && update(r, Number(edits[r.key]))}
                        />
                        <Button size="sm" disabled={edits[r.key] === undefined} onClick={() => update(r, Number(edits[r.key]))}>
                          適用
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="notice" style={{ margin: 16 }}>
        <Info size={16} strokeWidth={1.5} />
        ゲームルールはワールド単位です。変えるとすぐに効きます。
      </div>
    </Card>
  )
}
