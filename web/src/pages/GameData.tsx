import { useState } from 'react'
import { del, enc, post, put, q } from '../api'
import { useQuery } from '../hooks'
import { Button, Card, Empty, Field, Input, PageHead, Select, Switch, Tabs, fmtInt, useAction, useConfirm } from '../ui'

interface Objective {
  name: string
  displayName: string
  criteria: string
  renderType: string
  entries: number
}
interface Score {
  objective: string
  holder: string
  score: number
}
interface Team {
  name: string
  displayName: string
  color: string | null
  prefix: string
  suffix: string
  friendlyFire: boolean
  seeFriendlyInvisibles: boolean
  nameTagVisibility: string
  collisionRule: string
  members: string[]
}
interface Datapack {
  id: string
  title: string
  description: string
  enabled: boolean
  required: boolean
}
interface ModInfo {
  id: string
  name: string
  version: string
  description: string | null
}
interface Plugins {
  hybrid: boolean
  bukkit?: { name: string; version: string; bukkitVersion: string }
  plugins: { name: string; version: string | null; description: string | null; authors: string[] | null; enabled: boolean | null }[]
  error?: string
}

type Tab = 'scores' | 'teams' | 'packs' | 'mods' | 'registries'

export function GameData() {
  const [tab, setTab] = useState<Tab>('scores')
  return (
    <>
      <PageHead title="スコア・データパック" />
      <Tabs
        tabs={[
          ['scores', 'スコアボード'],
          ['teams', 'チーム'],
          ['packs', 'データパック'],
          ['mods', 'Mod とプラグイン'],
          ['registries', 'レジストリ'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'scores' && <Scores />}
      {tab === 'teams' && <Teams />}
      {tab === 'packs' && <Packs />}
      {tab === 'mods' && <Mods />}
      {tab === 'registries' && <Registries />}
    </>
  )
}

function Scores() {
  const objs = useQuery<Objective[]>('/scoreboard/objectives')
  const run = useAction()
  const confirm = useConfirm()
  const [sel, setSel] = useState<string | null>(null)
  const [holderQ, setHolderQ] = useState('')
  const [holderPath, setHolderPath] = useState<string | null>(null)
  const scores = useQuery<Score[]>(sel ? q('/scoreboard/scores', { objective: sel }) : null)
  const byHolder = useQuery<Score[]>(holderPath)
  const [nf, setNf] = useState({ name: '', criteria: 'dummy', displayName: '' })
  const [ns, setNs] = useState({ holder: '', score: '' })

  return (
    <div className="stack">
      <div className="grid grid-main">
        <Card title="目的" meta={objs.data ? `${objs.data.length} 個` : undefined} flush>
          {objs.data?.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>表示名</th>
                  <th>条件</th>
                  <th className="num">登録数</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {objs.data.map((o) => (
                  <tr key={o.name} className="clickable" aria-selected={sel === o.name} onClick={() => setSel(o.name)}>
                    <td className="mono">{o.name}</td>
                    <td>{o.displayName}</td>
                    <td className="mono muted">{o.criteria}</td>
                    <td className="num mono">{o.entries}</td>
                    <td className="actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (await confirm({ title: `目的 ${o.name} を消しますか`, body: '登録されたスコアも消えます。', ok: '消す', danger: true })) {
                            await run('消しました', () => del(`/scoreboard/objectives/${enc(o.name)}`))
                            if (sel === o.name) setSel(null)
                            objs.reload()
                          }
                        }}
                      >
                        消す
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>目的はありません</Empty>
          )}
        </Card>
        <Card title="目的を作る">
          <div className="stack" style={{ gap: 12 }}>
            <Field label="名前" hint="英数字と _ . + - # $">
              <Input className="mono" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
            </Field>
            <Field label="条件" hint="dummy・deathCount・playerKillCount など">
              <Input className="mono" value={nf.criteria} onChange={(e) => setNf({ ...nf, criteria: e.target.value })} />
            </Field>
            <Field label="表示名（省略可）">
              <Input value={nf.displayName} onChange={(e) => setNf({ ...nf, displayName: e.target.value })} />
            </Field>
            <div className="row">
              <Button
                variant="primary"
                disabled={!nf.name}
                onClick={async () => {
                  if (await run('作りました', () => post('/scoreboard/objectives', { name: nf.name, criteria: nf.criteria || 'dummy', displayName: nf.displayName || undefined }))) {
                    setNf({ name: '', criteria: 'dummy', displayName: '' })
                    objs.reload()
                  }
                }}
              >
                作る
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-split">
        <Card title={sel ? `${sel} のスコア` : 'スコア'} flush>
          {!sel ? (
            <Empty>上の表から目的を選んでください</Empty>
          ) : (
            <>
              {scores.data?.length ? (
                <table className="table">
                  <tbody>
                    {scores.data.map((s) => (
                      <tr key={s.holder}>
                        <td>{s.holder}</td>
                        <td className="num mono">{fmtInt(s.score)}</td>
                        <td className="actions">
                          <Button size="sm" variant="ghost" onClick={async () => (await run('リセットしました', () => del(`/scoreboard/scores/${enc(sel)}/${enc(s.holder)}`)), scores.reload())}>
                            リセット
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>まだだれも登録されていません</Empty>
              )}
              <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', padding: '16px 20px' }}>
                <Field label="持ち主">
                  <Input value={ns.holder} onChange={(e) => setNs({ ...ns, holder: e.target.value })} />
                </Field>
                <Field label="スコア">
                  <Input className="num mono" inputMode="numeric" value={ns.score} onChange={(e) => setNs({ ...ns, score: e.target.value })} />
                </Field>
                <Button
                  disabled={!ns.holder || ns.score === ''}
                  onClick={async () => {
                    if (await run('設定しました', () => put(`/scoreboard/scores/${enc(sel)}/${enc(ns.holder)}`, { score: Number(ns.score) }))) {
                      setNs({ holder: '', score: '' })
                      scores.reload()
                      objs.reload()
                    }
                  }}
                >
                  設定
                </Button>
              </div>
            </>
          )}
        </Card>
        <Card title="持ち主ごとのスコア">
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Input value={holderQ} placeholder="プレイヤー名など" onChange={(e) => setHolderQ(e.target.value)} style={{ flex: 1 }} />
              <Button disabled={!holderQ} onClick={() => setHolderPath(q('/scoreboard/scores', { holder: holderQ }))}>
                調べる
              </Button>
            </div>
            {holderPath &&
              (byHolder.data?.length ? (
                <table className="table">
                  <tbody>
                    {byHolder.data.map((s) => (
                      <tr key={s.objective}>
                        <td className="mono">{s.objective}</td>
                        <td className="num mono">{fmtInt(s.score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>{byHolder.loading ? '読み込み中' : 'スコアはありません'}</Empty>
              ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function Teams() {
  const teams = useQuery<Team[]>('/scoreboard/teams')
  return (
    <Card title="チーム" meta={teams.data ? `${teams.data.length} 個` : undefined} flush>
      {teams.data?.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>名前</th>
                <th>表示名</th>
                <th>色</th>
                <th>同士討ち</th>
                <th>名札</th>
                <th>当たり判定</th>
                <th>メンバー</th>
              </tr>
            </thead>
            <tbody>
              {teams.data.map((t) => (
                <tr key={t.name}>
                  <td className="mono">{t.name}</td>
                  <td>
                    {t.prefix}
                    {t.displayName}
                    {t.suffix}
                  </td>
                  <td className="mono muted">{t.color ?? '—'}</td>
                  <td className="secondary">{t.friendlyFire ? 'あり' : 'なし'}</td>
                  <td className="mono muted">{t.nameTagVisibility}</td>
                  <td className="mono muted">{t.collisionRule}</td>
                  <td className="secondary">{t.members.length ? t.members.join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>チームはありません。作るときはコンソールで /team add を使います</Empty>
      )}
    </Card>
  )
}

function Packs() {
  const packs = useQuery<Datapack[]>('/datapacks')
  const run = useAction()
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <Card title="データパック" meta="切り替えるとデータの再読み込みが走ります" flush>
      {packs.data ? (
        <table className="table">
          <tbody>
            {packs.data.map((p) => (
              <tr key={p.id}>
                <td>
                  <div>{p.title}</div>
                  <div className="mono muted" style={{ fontSize: 12 }}>
                    {p.id}
                  </div>
                </td>
                <td className="secondary">{p.description}</td>
                <td className="actions">
                  <Switch
                    label={p.title}
                    checked={p.enabled}
                    disabled={p.required || busy !== null}
                    onChange={async (v) => {
                      setBusy(p.id)
                      await run(v ? '有効にしました' : '無効にしました', () => post(`/datapacks/${enc(p.id)}/${v ? 'enable' : 'disable'}`))
                      setBusy(null)
                      packs.reload()
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>読み込み中</Empty>
      )}
    </Card>
  )
}

function Mods() {
  const mods = useQuery<ModInfo[]>('/mods')
  const plugins = useQuery<Plugins>('/plugins')
  const pl = plugins.data
  return (
    <div className="grid grid-split">
      <Card title="Mod" meta={mods.data ? `${mods.data.length} 個` : undefined} flush>
        <table className="table">
          <tbody>
            {(mods.data ?? []).map((m) => (
              <tr key={m.id}>
                <td>
                  <div>{m.name}</div>
                  <div className="mono muted" style={{ fontSize: 12 }}>
                    {m.id}
                  </div>
                </td>
                <td className="num mono secondary">{m.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Bukkit プラグイン" meta={pl?.bukkit ? `${pl.bukkit.name} ${pl.bukkit.version}` : undefined} flush>
        {!pl ? (
          <Empty>読み込み中</Empty>
        ) : !pl.hybrid ? (
          <Empty>このサーバーは Bukkit のプラグインに対応していません</Empty>
        ) : pl.plugins.length === 0 ? (
          <Empty>プラグインは入っていません</Empty>
        ) : (
          <table className="table">
            <tbody>
              {pl.plugins.map((p) => (
                <tr key={p.name}>
                  <td>
                    <div>{p.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {p.description}
                    </div>
                  </td>
                  <td className="num mono secondary">{p.version}</td>
                  <td className="secondary">{p.enabled ? '有効' : '無効'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function Registries() {
  const regs = useQuery<string[]>('/registries')
  const [reg, setReg] = useState('minecraft:item')
  const [query, setQuery] = useState('')
  const [path, setPath] = useState(q(`/registries/${enc(reg)}`, {}))
  const res = useQuery<{ registry: string; count: number; ids: string[] }>(path)
  return (
    <Card title="レジストリ" meta={res.data ? `${res.data.count} 件` : undefined}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Select value={reg} onChange={(e) => (setReg(e.target.value), setPath(q(`/registries/${enc(e.target.value)}`, { q: query })))} style={{ width: 320 }}>
            {(regs.data ?? [reg]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Input placeholder="ID で絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setPath(q(`/registries/${enc(reg)}`, { q: query }))} style={{ flex: 1 }} />
          <Button onClick={() => setPath(q(`/registries/${enc(reg)}`, { q: query }))}>絞り込む</Button>
        </div>
        <div className="log" style={{ maxHeight: 480 }}>
          {res.data?.ids.join('\n') || (res.loading ? '読み込み中' : '該当なし')}
        </div>
      </div>
    </Card>
  )
}
