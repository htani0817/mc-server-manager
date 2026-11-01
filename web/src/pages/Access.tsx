import { useState } from 'react'
import { del, enc, patch, post, put, type Ban, type KnownPlayer, type Operator, type PlayerSummary } from '../api'
import { useQuery } from '../hooks'
import { Button, Card, Dot, Empty, Field, Input, PageHead, Select, Switch, Tabs, Textarea, fmtTime, useAction, useConfirm } from '../ui'

type Tab = 'ops' | 'allow' | 'bans' | 'ipbans'

export function Access() {
  const [tab, setTab] = useState<Tab>('ops')
  const known = useQuery<KnownPlayer[]>('/players/known')
  const names = (known.data ?? []).map((p) => p.name)
  return (
    <>
      <PageHead title="OP・ホワイトリスト・BAN" sub="名前か UUID で指定します。一度も来ていない名前は Mojang に問い合わせて UUID を調べます" />
      <Tabs
        tabs={[
          ['ops', 'OP'],
          ['allow', 'ホワイトリスト'],
          ['bans', 'BAN'],
          ['ipbans', 'IP BAN'],
        ]}
        value={tab}
        onChange={setTab}
      />
      <datalist id="known-players">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {tab === 'ops' && <Ops />}
      {tab === 'allow' && <Allowlist />}
      {tab === 'bans' && <Bans />}
      {tab === 'ipbans' && <IpBans />}
    </>
  )
}

function Ops() {
  const ops = useQuery<Operator[]>('/operators')
  const run = useAction()
  const confirm = useConfirm()
  const [f, setF] = useState({ player: '', level: '4', bypass: false })
  return (
    <div className="grid grid-main">
      <Card title="OP" meta={ops.data ? `${ops.data.length} 人` : undefined} flush>
        {ops.data?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>名前</th>
                <th className="num">レベル</th>
                <th>人数上限を無視</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ops.data.map((o) => (
                <tr key={o.uuid}>
                  <td>
                    <span className="row">
                      <Dot state={o.online ? 'on' : 'idle'} />
                      {o.name}
                    </span>
                  </td>
                  <td className="num mono">{o.level}</td>
                  <td className="secondary">{o.bypassesPlayerLimit ? 'する' : 'しない'}</td>
                  <td className="actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (await confirm({ title: `${o.name} の OP を外しますか`, ok: '外す', danger: true })) {
                          await run('OP を外しました', () => del(`/operators/${enc(o.uuid)}`))
                          ops.reload()
                        }
                      }}
                    >
                      外す
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>OP はいません</Empty>
        )}
      </Card>
      <Card title="OP にする">
        <div className="stack" style={{ gap: 12 }}>
          <Field label="プレイヤー">
            <Input list="known-players" value={f.player} onChange={(e) => setF({ ...f, player: e.target.value })} />
          </Field>
          <Field label="権限レベル" hint="4 で全コマンド。2 でコマンドブロックなど">
            <Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
              {[4, 3, 2, 1].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <label className="check-row">
            <Switch label="人数上限を無視" checked={f.bypass} onChange={(v) => setF({ ...f, bypass: v })} />
            満員でも入れる
          </label>
          <div className="row">
            <Button
              variant="primary"
              disabled={!f.player}
              onClick={async () => {
                if (await run('OP にしました', () => post('/operators', { player: f.player, level: Number(f.level), bypassesPlayerLimit: f.bypass }))) {
                  setF({ player: '', level: '4', bypass: false })
                  ops.reload()
                }
              }}
            >
              OP にする
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

interface AllowlistData {
  enabled: boolean
  enforced: boolean
  players: { name: string; uuid: string; online: boolean }[]
}

function Allowlist() {
  const al = useQuery<AllowlistData>('/allowlist')
  const run = useAction()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [bulk, setBulk] = useState<string | null>(null)
  const d = al.data

  const setFlag = async (key: 'use_allowlist' | 'enforce_allowlist', v: boolean) => {
    await run(v ? '有効にしました' : '無効にしました', () => patch('/settings', { [key]: v }))
    al.reload()
  }

  return (
    <div className="grid grid-main">
      <Card
        title="ホワイトリスト"
        meta={d ? `${d.players.length} 人` : undefined}
        flush
        actions={
          <>
            <Button size="sm" onClick={() => setBulk((d?.players ?? []).map((p) => p.name).join('\n'))}>
              まとめて編集
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!d?.players.length}
              onClick={async () => {
                if (await confirm({ title: 'ホワイトリストを空にしますか', body: '有効にしている場合、OP 以外は全員キックされます。', ok: '空にする', danger: true })) {
                  await run('空にしました', () => del('/allowlist'))
                  al.reload()
                }
              }}
            >
              全員外す
            </Button>
          </>
        }
      >
        {d?.players.length ? (
          <table className="table">
            <tbody>
              {d.players.map((p) => (
                <tr key={p.uuid}>
                  <td>
                    <span className="row">
                      <Dot state={p.online ? 'on' : 'idle'} />
                      {p.name}
                    </span>
                  </td>
                  <td className="mono muted">{p.uuid}</td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" onClick={async () => (await run('外しました', () => del(`/allowlist/${enc(p.uuid)}`)), al.reload())}>
                      外す
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>だれも入っていません</Empty>
        )}
      </Card>
      <div className="stack">
        <Card title="設定">
          <div className="stack" style={{ gap: 8 }}>
            <label className="check-row">
              <Switch label="ホワイトリストを使う" checked={!!d?.enabled} disabled={!d} onChange={(v) => setFlag('use_allowlist', v)} />
              ホワイトリストを使う
            </label>
            <label className="check-row">
              <Switch label="外れた人をすぐキック" checked={!!d?.enforced} disabled={!d} onChange={(v) => setFlag('enforce_allowlist', v)} />
              リストから外れた人をすぐキック
            </label>
          </div>
        </Card>
        <Card title="追加">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input list="known-players" value={name} onChange={(e) => setName(e.target.value)} placeholder="名前か UUID" style={{ flex: 1 }} />
            <Button variant="primary" disabled={!name} onClick={async () => (await run('追加しました', () => post('/allowlist', { player: name }))) && (setName(''), al.reload())}>
              追加
            </Button>
          </div>
        </Card>
        {bulk !== null && (
          <Card title="まとめて編集" meta="1 行に 1 人">
            <div className="stack" style={{ gap: 12 }}>
              <Textarea className="code" rows={10} value={bulk} onChange={(e) => setBulk(e.target.value)} />
              <div className="row">
                <Button
                  variant="primary"
                  onClick={async () => {
                    const players = bulk.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
                    if (await run('置き換えました', () => put('/allowlist', { players }))) {
                      setBulk(null)
                      al.reload()
                    }
                  }}
                >
                  この内容で置き換え
                </Button>
                <Button variant="ghost" onClick={() => setBulk(null)}>
                  やめる
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function BanForm({ kind, onDone }: { kind: 'player' | 'ip'; onDone: () => void }) {
  const run = useAction()
  const online = useQuery<PlayerSummary[]>(kind === 'ip' ? '/players' : null)
  const [f, setF] = useState({ target: '', reason: '', expires: '', byPlayer: false })
  const submit = async () => {
    const body: Record<string, string | undefined> = {
      reason: f.reason || undefined,
      expires: f.expires ? new Date(f.expires).toISOString() : undefined,
    }
    if (kind === 'player') body.player = f.target
    else if (f.byPlayer) body.player = f.target
    else body.ip = f.target
    if (await run('BAN しました', () => post(kind === 'player' ? '/bans' : '/ip-bans', body))) {
      setF({ target: '', reason: '', expires: '', byPlayer: f.byPlayer })
      onDone()
    }
  }
  return (
    <Card title={kind === 'player' ? 'BAN する' : 'IP を BAN する'}>
      <div className="stack" style={{ gap: 12 }}>
        {kind === 'ip' && (
          <label className="check-row">
            <Switch label="オンラインのプレイヤーの IP" checked={f.byPlayer} onChange={(v) => setF({ ...f, byPlayer: v, target: '' })} />
            オンラインのプレイヤーの IP を使う
          </label>
        )}
        <Field label={kind === 'player' ? 'プレイヤー' : f.byPlayer ? 'プレイヤー' : 'IP アドレス'}>
          {kind === 'ip' && f.byPlayer ? (
            <Select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
              <option value="">選ぶ</option>
              {(online.data ?? []).map((p) => (
                <option key={p.uuid} value={p.name}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : (
            <Input className={kind === 'ip' ? 'mono' : undefined} list={kind === 'player' ? 'known-players' : undefined} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
          )}
        </Field>
        <Field label="理由（省略可）">
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        <Field label="期限（空なら無期限）">
          <Input type="datetime-local" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />
        </Field>
        <div className="row">
          <Button variant="danger" disabled={!f.target} onClick={submit}>
            BAN する
          </Button>
        </div>
      </div>
    </Card>
  )
}

function BanTable({ rows, kind, onUnban }: { rows: Ban[]; kind: 'player' | 'ip'; onUnban: (b: Ban) => void }) {
  if (!rows.length) return <Empty>だれも BAN されていません</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{kind === 'player' ? '名前' : 'IP'}</th>
            <th>理由</th>
            <th>BAN した人</th>
            <th>日時</th>
            <th>期限</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.uuid ?? b.ip}>
              <td className={kind === 'ip' ? 'mono' : undefined}>{b.name ?? b.ip}</td>
              <td className="secondary">{b.reason ?? '—'}</td>
              <td className="secondary">{b.source ?? '—'}</td>
              <td className="mono muted">{fmtTime(b.created)}</td>
              <td className="mono muted">{b.expires ? fmtTime(b.expires) : '無期限'}</td>
              <td className="actions">
                <Button size="sm" variant="ghost" onClick={() => onUnban(b)}>
                  解除
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Bans() {
  const bans = useQuery<Ban[]>('/bans')
  const run = useAction()
  const confirm = useConfirm()
  return (
    <div className="grid grid-main">
      <Card
        title="BAN"
        meta={bans.data ? `${bans.data.length} 人` : undefined}
        flush
        actions={
          <Button
            size="sm"
            variant="danger"
            disabled={!bans.data?.length}
            onClick={async () => {
              if (await confirm({ title: 'BAN を全部解除しますか', ok: '全部解除', danger: true })) {
                await run('全部解除しました', () => del('/bans'))
                bans.reload()
              }
            }}
          >
            全部解除
          </Button>
        }
      >
        <BanTable rows={bans.data ?? []} kind="player" onUnban={async (b) => (await run('解除しました', () => del(`/bans/${enc(b.uuid!)}`)), bans.reload())} />
      </Card>
      <BanForm kind="player" onDone={bans.reload} />
    </div>
  )
}

function IpBans() {
  const bans = useQuery<Ban[]>('/ip-bans')
  const run = useAction()
  const confirm = useConfirm()
  return (
    <div className="grid grid-main">
      <Card
        title="IP BAN"
        meta={bans.data ? `${bans.data.length} 件` : undefined}
        flush
        actions={
          <Button
            size="sm"
            variant="danger"
            disabled={!bans.data?.length}
            onClick={async () => {
              if (await confirm({ title: 'IP BAN を全部解除しますか', ok: '全部解除', danger: true })) {
                await run('全部解除しました', () => del('/ip-bans'))
                bans.reload()
              }
            }}
          >
            全部解除
          </Button>
        }
      >
        <BanTable rows={bans.data ?? []} kind="ip" onUnban={async (b) => (await run('解除しました', () => del(`/ip-bans/${enc(b.ip!)}`)), bans.reload())} />
      </Card>
      <BanForm kind="ip" onDone={bans.reload} />
    </div>
  )
}
