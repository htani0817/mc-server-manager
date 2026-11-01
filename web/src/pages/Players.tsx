import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import {
  del,
  enc,
  patch,
  post,
  put,
  q,
  type CommandResult,
  type Effect,
  type InvItem,
  type KnownPlayer,
  type PlayerDetail,
  type PlayerSummary,
} from '../api'
import { useEvents, useQuery, useRegistry } from '../hooks'
import { EFFECTS, effectInfo, effectName, KIND_LABEL, type EffectKind } from '../effects'
import {
  Bar,
  Button,
  Card,
  Dot,
  Empty,
  Field,
  fmtInt,
  GAME_MODES,
  Input,
  Kv,
  PageHead,
  Select,
  Seg,
  shortId,
  SuggestInput,
  Switch,
  Tabs,
  dimName,
  useAction,
  useConfirm,
} from '../ui'

export function Players() {
  const online = useQuery<PlayerSummary[]>('/players', 5000)
  const known = useQuery<KnownPlayer[]>('/players/known', 30000)
  const [list, setList] = useState<'online' | 'all'>('online')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get('p'))

  useEvents(['join', 'leave'], () => {
    online.reload()
    known.reload()
  })

  useEffect(() => {
    if (!selected && online.data?.length) setSelected(online.data[0].uuid)
  }, [online.data, selected])

  const rows = useMemo(() => {
    const f = filter.toLowerCase()
    const src =
      list === 'online'
        ? (online.data ?? []).map((p) => ({ uuid: p.uuid, name: p.name, meta: GAME_MODES[p.gameMode] ?? p.gameMode, online: true }))
        : (known.data ?? []).map((p) => ({
            uuid: p.uuid,
            name: p.name,
            meta: [p.op && 'OP', p.banned && 'BAN', p.allowlisted && '許可'].filter(Boolean).join(' · '),
            online: p.online,
          }))
    return src.filter((r) => !f || r.name.toLowerCase().includes(f) || r.uuid.includes(f))
  }, [list, filter, online.data, known.data])

  return (
    <>
      <PageHead title="プレイヤー" sub={`オンライン ${online.data?.length ?? 0} 人 · 来たことのある人 ${known.data?.length ?? 0} 人`} />
      <div className="grid grid-side">
        <Card>
          <div className="stack" style={{ gap: 12 }}>
            <Seg
              options={[
                ['online', 'オンライン'],
                ['all', '来たことのある人'],
              ]}
              value={list}
              onChange={setList}
            />
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Search size={16} strokeWidth={1.5} className="muted" />
              <Input placeholder="名前で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} />
            </div>
            <div className="list">
              {rows.length === 0 && <Empty>{list === 'online' ? 'だれもいません' : '見つかりません'}</Empty>}
              {rows.map((r) => (
                <button key={r.uuid} className="list-row" aria-selected={selected === r.uuid} onClick={() => setSelected(r.uuid)}>
                  <Dot state={r.online ? 'on' : 'idle'} />
                  {r.name}
                  <span className="meta">{r.meta}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>
        {selected ? (
          <PlayerPanel
            key={selected}
            id={selected}
            onlineNames={(online.data ?? []).map((p) => p.name)}
            onChanged={() => {
              online.reload()
              known.reload()
            }}
          />
        ) : (
          <Card>
            <Empty>左の一覧からプレイヤーを選んでください</Empty>
          </Card>
        )}
      </div>
    </>
  )
}

function PlayerPanel({ id, onlineNames, onChanged }: { id: string; onlineNames: string[]; onChanged: () => void }) {
  const d = useQuery<PlayerDetail>(`/players/${enc(id)}`, 5000)
  const [tab, setTab] = useState<'state' | 'items' | 'effects' | 'records'>('state')
  const p = d.data
  const run = useAction()
  const confirm = useConfirm()

  if (d.error && !p) return <Card><Empty>{d.error.message}</Empty></Card>
  if (!p) return <Card><Empty>読み込み中</Empty></Card>

  const after = () => {
    d.reload()
    onChanged()
  }

  const toggleOp = async () => {
    if (p.op) {
      if (await confirm({ title: `${p.name} の OP を外しますか`, ok: '外す', danger: true })) {
        await run('OP を外しました', () => del(`/operators/${enc(p.uuid)}`))
      }
    } else {
      await run('OP にしました', () => post('/operators', { player: p.uuid, level: 4 }))
    }
    after()
  }

  const toggleAllow = async () => {
    if (p.allowlisted) {
      await run('ホワイトリストから外しました', () => del(`/allowlist/${enc(p.uuid)}`))
    } else {
      await run('ホワイトリストに入れました', () => post('/allowlist', { player: p.uuid }))
    }
    after()
  }

  const toggleBan = async () => {
    if (p.banned) {
      await run('BAN を解除しました', () => del(`/bans/${enc(p.uuid)}`))
    } else {
      const ok = await confirm({ title: `${p.name} を BAN しますか`, body: 'オンラインなら切断されます。理由や期限をつけるときは「OP・ホワイトリスト・BAN」の画面から。', ok: 'BAN する', danger: true })
      if (!ok) return
      await run('BAN しました', () => post('/bans', { player: p.uuid, reason: 'mc-server-manager から' }))
    }
    after()
  }

  return (
    <div className="stack">
      <Card>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="split-v">
            <div className="row" style={{ gap: 10 }}>
              <span style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500 }}>{p.name}</span>
              <Dot state={p.online ? 'on' : 'idle'} />
              <span className="secondary">{p.online ? 'オンライン' : 'オフライン'}</span>
            </div>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {p.uuid}
            </span>
          </div>
          <div className="row" style={{ marginLeft: 'auto', gap: 16 }}>
            <label className="check-row">
              <Switch label="OP" checked={p.op} onChange={toggleOp} />
              OP{p.op ? <span className="mono muted">Lv{p.opLevel}</span> : null}
            </label>
            <label className="check-row">
              <Switch label="ホワイトリスト" checked={p.allowlisted} onChange={toggleAllow} />
              ホワイトリスト
            </label>
            <label className="check-row">
              <Switch label="BAN" checked={p.banned} onChange={toggleBan} />
              BAN
            </label>
          </div>
        </div>
      </Card>

      <Tabs
        tabs={[
          ['state', '状態と操作'],
          ['items', '持ち物'],
          ['effects', 'エフェクト'],
          ['records', '統計と進捗'],
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'state' && (p.online ? <StateTab p={p} onlineNames={onlineNames} after={after} /> : <Card><Empty>オフラインなので、状態と操作は使えません。統計と進捗は見られます。</Empty></Card>)}
      {tab === 'items' && (p.online ? <ItemsTab p={p} /> : <Card><Empty>持ち物はオンラインのときだけ見られます</Empty></Card>)}
      {tab === 'effects' && (p.online ? <EffectsTab p={p} /> : <Card><Empty>エフェクトはオンラインのときだけ見られます</Empty></Card>)}
      {tab === 'records' && <RecordsTab p={p} />}
    </div>
  )
}

function StateTab({ p, onlineNames, after }: { p: PlayerDetail; onlineNames: string[]; after: () => void }) {
  const run = useAction()
  const confirm = useConfirm()
  const id = enc(p.uuid)
  const [msg, setMsg] = useState('')
  const [overlay, setOverlay] = useState(false)
  const [tp, setTp] = useState({ x: '', y: '', z: '', dimension: p.dimension ?? 'minecraft:overworld', target: '' })
  const [tpMode, setTpMode] = useState<'coords' | 'player'>('coords')
  const [vit, setVit] = useState({ health: '', food: '', saturation: '', xpLevel: '', xpPoints: '' })
  const [kickReason, setKickReason] = useState('')

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s))

  return (
    <div className="grid grid-split">
      <Card title="いまの状態">
        <div className="stack" style={{ gap: 16 }}>
          <div className="split-v" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="secondary">体力</span>
              <span className="mono">
                {p.health?.toFixed(1)} / {p.maxHealth?.toFixed(0)}
              </span>
            </div>
            <Bar value={p.health ?? 0} max={p.maxHealth ?? 20} />
          </div>
          <div className="split-v" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="secondary">満腹度</span>
              <span className="mono">
                {p.food} / 20 <span className="muted">· 隠し満腹度 {p.saturation?.toFixed(1)}</span>
              </span>
            </div>
            <Bar value={p.food ?? 0} max={20} />
          </div>
          <div className="split-v" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="secondary">経験値</span>
              <span className="mono">
                Lv {p.xp?.level} <span className="muted">· 合計 {fmtInt(p.xp?.total)}</span>
              </span>
            </div>
            <Bar value={p.xp?.progress ?? 0} max={1} accent />
          </div>
          <Kv
            items={[
              ['場所', <span className="mono">{dimName(p.dimension ?? '')} · {p.position?.x}, {p.position?.y}, {p.position?.z}</span>],
              ['ゲームモード', GAME_MODES[p.gameMode ?? ''] ?? p.gameMode],
              ['ping', <span className="mono">{p.ping} ms</span>],
              ['IP', <span className="mono">{p.ip}</span>],
              ['言語', <span className="mono">{p.language}</span>],
              ['状態', [p.flying && '飛行中', p.sleeping && '睡眠中', p.onFire && '燃えている', p.alive === false && '死亡中'].filter(Boolean).join(' · ') || '—'],
            ]}
          />
        </div>
      </Card>

      <div className="stack">
        <Card title="ゲームモード">
          <div className="row">
            {Object.entries(GAME_MODES).map(([k, v]) => (
              <Button key={k} variant={p.gameMode === k ? 'primary' : 'default'} onClick={async () => (await run(`${v}にしました`, () => put(`/players/${id}/gamemode`, { mode: k })), after())}>
                {v}
              </Button>
            ))}
          </div>
        </Card>

        <Card title="メッセージ">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="本人にだけ届く" style={{ flex: 1 }} />
            <label className="check-row" style={{ fontSize: 13 }}>
              <Switch label="アクションバー" checked={overlay} onChange={setOverlay} />
              アクションバー
            </label>
            <Button disabled={!msg} onClick={async () => (await run('送りました', () => post(`/players/${id}/message`, { message: msg, overlay }))) && setMsg('')}>
              送る
            </Button>
          </div>
        </Card>

        <Card
          title="テレポート"
          actions={
            <Seg
              options={[
                ['coords', '座標へ'],
                ['player', 'プレイヤーへ'],
              ]}
              value={tpMode}
              onChange={setTpMode}
            />
          }
        >
          {tpMode === 'coords' ? (
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr)) minmax(0,1.6fr) auto' }}>
              {(['x', 'y', 'z'] as const).map((k) => (
                <Field key={k} label={k.toUpperCase()}>
                  <Input className="num mono" inputMode="decimal" value={tp[k]} placeholder={String(p.position?.[k] ?? '')} onChange={(e) => setTp({ ...tp, [k]: e.target.value })} />
                </Field>
              ))}
              <Field label="ディメンション">
                <Select value={tp.dimension} onChange={(e) => setTp({ ...tp, dimension: e.target.value })}>
                  {['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].map((dd) => (
                    <option key={dd} value={dd}>
                      {dimName(dd)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                disabled={tp.x === '' || tp.y === '' || tp.z === ''}
                onClick={async () => {
                  await run('テレポートしました', () => post(`/players/${id}/teleport`, { x: Number(tp.x), y: Number(tp.y), z: Number(tp.z), dimension: tp.dimension }))
                  after()
                }}
              >
                移動
              </Button>
            </div>
          ) : (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Select value={tp.target} onChange={(e) => setTp({ ...tp, target: e.target.value })} style={{ flex: 1 }}>
                <option value="">行き先のプレイヤー</option>
                {onlineNames.filter((n) => n !== p.name).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
              <Button disabled={!tp.target} onClick={async () => (await run('テレポートしました', () => post(`/players/${id}/teleport`, { target: tp.target })), after())}>
                移動
              </Button>
            </div>
          )}
        </Card>

        <Card title="体力・満腹度・経験値">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr)) auto' }}>
            {(
              [
                ['health', '体力'],
                ['food', '満腹度'],
                ['saturation', '隠し満腹度'],
                ['xpLevel', 'レベル'],
                ['xpPoints', 'ポイント'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <Input className="num mono" inputMode="decimal" value={vit[k]} onChange={(e) => setVit({ ...vit, [k]: e.target.value })} />
              </Field>
            ))}
            <Button
              disabled={Object.values(vit).every((v) => v === '')}
              onClick={async () => {
                const body = Object.fromEntries(Object.entries(vit).map(([k, v]) => [k, num(v)]).filter(([, v]) => v !== undefined))
                if (await run('変更しました', () => patch(`/players/${id}/vitals`, body))) {
                  setVit({ health: '', food: '', saturation: '', xpLevel: '', xpPoints: '' })
                  after()
                }
              }}
            >
              適用
            </Button>
          </div>
        </Card>

        <Card title="キック">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input value={kickReason} onChange={(e) => setKickReason(e.target.value)} placeholder="理由（省略可）" style={{ flex: 1 }} />
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await confirm({ title: `${p.name} をキックしますか`, ok: 'キックする', danger: true }))) return
                await run('キックしました', () => post(`/players/${id}/kick`, { reason: kickReason }))
                after()
              }}
            >
              キック
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** 持ち物のスロットの並び（0-8 ホットバー、9-35 持ち物、36-39 防具、40 オフハンド） */
function ItemsTab({ p }: { p: PlayerDetail }) {
  const id = enc(p.uuid)
  const inv = useQuery<{ selectedSlot: number; items: InvItem[] }>(`/players/${id}/inventory`, 5000)
  const ender = useQuery<{ items: InvItem[] }>(`/players/${id}/enderchest`, 10000)
  const items = useRegistry('item')
  const run = useAction()
  const confirm = useConfirm()
  const [give, setGive] = useState({ item: '', count: '1', components: '' })
  const [clear, setClear] = useState({ item: '', maxCount: '' })

  const bySlot = new Map((inv.data?.items ?? []).map((i) => [i.slot, i]))
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)
  const extra = (inv.data?.items ?? []).filter((i) => i.slot > 40)

  return (
    <div className="grid grid-split">
      <div className="stack">
        <Card title="持ち物" meta={inv.data ? `${inv.data.items.length} 枠使用` : undefined}>
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
              <div className="split-v" style={{ gap: 4 }}>
                <span className="muted" style={{ fontSize: 12 }}>防具</span>
                <div className="inv" style={{ gridTemplateColumns: '44px' }}>
                  {[39, 38, 37, 36].map((s) => (
                    <Slot key={s} item={bySlot.get(s)} />
                  ))}
                </div>
              </div>
              <div className="split-v" style={{ gap: 4 }}>
                <span className="muted" style={{ fontSize: 12 }}>オフハンド</span>
                <div className="inv" style={{ gridTemplateColumns: '44px' }}>
                  <Slot item={bySlot.get(40)} />
                </div>
              </div>
            </div>
            <div className="inv">
              {range(9, 36).map((s) => (
                <Slot key={s} item={bySlot.get(s)} />
              ))}
            </div>
            <div className="inv">
              {range(0, 9).map((s) => (
                <Slot key={s} item={bySlot.get(s)} selected={inv.data?.selectedSlot === s} />
              ))}
            </div>
            {extra.length > 0 && (
              <div className="mono muted" style={{ fontSize: 12 }}>
                その他: {extra.map((i) => `${i.slot}=${shortId(i.id)}×${i.count}`).join(', ')}
              </div>
            )}
          </div>
        </Card>
        <Card title="エンダーチェスト">
          <div className="inv">
            {range(0, 27).map((s) => (
              <Slot key={s} item={(ender.data?.items ?? []).find((i) => i.slot === s)} />
            ))}
          </div>
        </Card>
      </div>
      <div className="stack">
        <Card title="アイテムを渡す">
          <div className="stack" style={{ gap: 12 }}>
            <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0,2fr) 96px' }}>
              <Field label="アイテム">
                <SuggestInput options={items} value={give.item} onChange={(e) => setGive({ ...give, item: e.target.value })} placeholder="minecraft:diamond" />
              </Field>
              <Field label="個数">
                <Input className="num mono" inputMode="numeric" value={give.count} onChange={(e) => setGive({ ...give, count: e.target.value })} />
              </Field>
            </div>
            <Field label="コンポーネント（省略可）" hint="例: [minecraft:custom_name='&quot;名前&quot;']">
              <Input className="mono" value={give.components} onChange={(e) => setGive({ ...give, components: e.target.value })} />
            </Field>
            <div className="row">
              <Button
                variant="primary"
                disabled={!give.item}
                onClick={async () => {
                  await run('渡しました', () => post<CommandResult>(`/players/${id}/give`, { item: give.item, count: Number(give.count) || 1, components: give.components || undefined }))
                  inv.reload()
                }}
              >
                渡す
              </Button>
            </div>
          </div>
        </Card>
        <Card title="持ち物を消す">
          <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0,2fr) 96px auto' }}>
            <Field label="アイテム（空なら全部）">
              <SuggestInput options={items} value={clear.item} onChange={(e) => setClear({ ...clear, item: e.target.value })} />
            </Field>
            <Field label="最大数">
              <Input className="num mono" inputMode="numeric" value={clear.maxCount} disabled={!clear.item} onChange={(e) => setClear({ ...clear, maxCount: e.target.value })} />
            </Field>
            <Button
              variant="danger"
              onClick={async () => {
                if (!clear.item && !(await confirm({ title: `${p.name} の持ち物を全部消しますか`, body: '元に戻せません。', ok: '全部消す', danger: true }))) return
                await run('消しました', () =>
                  post<CommandResult>(`/players/${id}/inventory/clear`, { item: clear.item || undefined, maxCount: clear.item && clear.maxCount ? Number(clear.maxCount) : undefined }),
                )
                inv.reload()
              }}
            >
              消す
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Slot({ item, selected }: { item?: InvItem; selected?: boolean }) {
  if (!item) return <div className="slot" style={selected ? { borderColor: 'var(--accent)' } : undefined} />
  const label = shortId(item.id)
    .split('_')
    .map((w) => w.slice(0, 3))
    .slice(0, 2)
    .join(' ')
  return (
    <div className="slot filled" title={`${item.name}（${item.id}）× ${item.count}`} style={selected ? { borderColor: 'var(--accent)' } : undefined}>
      <span style={{ padding: '0 2px' }}>{label}</span>
      {item.count > 1 && <span className="count">{item.count}</span>}
    </div>
  )
}

function EffectsTab({ p }: { p: PlayerDetail }) {
  const id = enc(p.uuid)
  const eff = useQuery<Effect[]>(`/players/${id}/effects`, 5000)
  // サーバーにあるエフェクト（Mod のものも含む）。日本語の説明があるものから並べる
  const registry = useRegistry('mob_effect')
  const run = useAction()
  const [f, setF] = useState({ effect: 'minecraft:speed', custom: '', seconds: '30', infinite: false, level: '1', hide: false })

  const groups = useMemo(() => {
    const ids = registry.length ? registry : Object.keys(EFFECTS)
    const by: Record<EffectKind | 'other', string[]> = { good: [], bad: [], neutral: [], other: [] }
    for (const e of ids) by[effectInfo(e)?.kind ?? 'other'].push(e)
    for (const k of Object.keys(by) as (keyof typeof by)[]) by[k].sort((a, b) => effectName(a).localeCompare(effectName(b), 'ja'))
    return by
  }, [registry])

  const chosen = f.effect === 'custom' ? f.custom.trim() : f.effect
  const info = chosen ? effectInfo(chosen) : undefined

  return (
    <div className="grid grid-split">
      <Card
        title="かかっているエフェクト"
        flush
        actions={
          <Button size="sm" variant="danger" disabled={!eff.data?.length} onClick={async () => (await run('全部解除しました', () => del(`/players/${id}/effects`)), eff.reload())}>
            全部解除
          </Button>
        }
      >
        {eff.data?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>エフェクト</th>
                <th className="num">レベル</th>
                <th className="num">残り</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {eff.data.map((e) => {
                const i = effectInfo(e.effect)
                return (
                  <tr key={e.effect}>
                    <td style={{ paddingTop: 8, paddingBottom: 8 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className={`dot ${i?.kind === 'good' ? 'on' : i?.kind === 'bad' ? 'off' : ''}`} />
                        {effectName(e.effect)}
                        <span className="mono muted" style={{ fontSize: 12 }}>
                          {shortId(e.effect)}
                        </span>
                      </div>
                      {i && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 2, paddingLeft: 16 }}>
                          {i.desc}
                        </div>
                      )}
                    </td>
                    <td className="num mono">{e.amplifier + 1}</td>
                    <td className="num mono">{e.durationTicks < 0 ? '無限' : `${Math.ceil(e.durationTicks / 20)} 秒`}</td>
                    <td className="actions">
                      <Button size="sm" variant="ghost" onClick={async () => (await run('解除しました', () => del(q(`/players/${id}/effects`, { effect: e.effect }))), eff.reload())}>
                        解除
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <Empty>なし</Empty>
        )}
      </Card>
      <Card title="エフェクトを付ける">
        <div className="stack" style={{ gap: 12 }}>
          <Field label="エフェクト">
            <Select value={f.effect} onChange={(e) => setF({ ...f, effect: e.target.value })}>
              {(['good', 'bad', 'neutral', 'other'] as const).map((k) =>
                groups[k].length ? (
                  <optgroup key={k} label={k === 'other' ? 'Mod などのエフェクト' : KIND_LABEL[k]}>
                    {groups[k].map((e) => (
                      <option key={e} value={e}>
                        {effectInfo(e) ? `${effectName(e)}（${shortId(e)}）` : e}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
              <option value="custom">ID を直接入力する</option>
            </Select>
          </Field>
          {f.effect === 'custom' && (
            <Field label="エフェクトの ID">
              <Input className="mono" value={f.custom} placeholder="modid:effect_name" onChange={(e) => setF({ ...f, custom: e.target.value })} />
            </Field>
          )}
          {info && (
            <div className="notice">
              <span className={`dot ${info.kind === 'good' ? 'on' : info.kind === 'bad' ? 'off' : ''}`} style={{ marginTop: 6 }} />
              <span>
                <span style={{ color: 'var(--text)' }}>{info.name}</span>
                <span className="muted">（{KIND_LABEL[info.kind]}）</span>
                <br />
                {info.desc}
              </span>
            </div>
          )}
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <Field label="秒数">
              <Input className="num mono" inputMode="numeric" disabled={f.infinite} value={f.infinite ? '' : f.seconds} onChange={(e) => setF({ ...f, seconds: e.target.value })} />
            </Field>
            <Field label="レベル" hint="1 が普通の強さ">
              <Input className="num mono" inputMode="numeric" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} />
            </Field>
          </div>
          <label className="check-row">
            <Switch label="無限に続ける" checked={f.infinite} onChange={(v) => setF({ ...f, infinite: v })} />
            時間切れにしない
          </label>
          <label className="check-row">
            <Switch label="パーティクルを隠す" checked={f.hide} onChange={(v) => setF({ ...f, hide: v })} />
            パーティクルを隠す
          </label>
          <div className="row">
            <Button
              variant="primary"
              disabled={!chosen}
              onClick={async () => {
                await run(`${effectName(chosen)}を付けました`, () =>
                  post(`/players/${id}/effects`, {
                    effect: chosen,
                    seconds: f.infinite ? 'infinite' : Number(f.seconds) || 30,
                    amplifier: Math.max(0, (Number(f.level) || 1) - 1),
                    hideParticles: f.hide,
                  }),
                )
                eff.reload()
              }}
            >
              付ける
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

interface StatsFile {
  stats: { stats?: Record<string, Record<string, number>> }
}
interface AdvFile {
  advancements: Record<string, { done?: boolean; criteria?: Record<string, string> } | number>
}

const CUSTOM: [string, string, (v: number) => string][] = [
  ['minecraft:play_time', 'プレイ時間', (v) => `${(v / 20 / 3600).toFixed(1)} 時間`],
  ['minecraft:deaths', '死亡', (v) => `${fmtInt(v)} 回`],
  ['minecraft:mob_kills', 'モブを倒した', (v) => `${fmtInt(v)} 体`],
  ['minecraft:player_kills', 'プレイヤーを倒した', (v) => `${fmtInt(v)} 人`],
  ['minecraft:jump', 'ジャンプ', (v) => `${fmtInt(v)} 回`],
  ['minecraft:walk_one_cm', '歩いた距離', (v) => `${(v / 100000).toFixed(2)} km`],
  ['minecraft:sprint_one_cm', '走った距離', (v) => `${(v / 100000).toFixed(2)} km`],
  ['minecraft:damage_dealt', '与えたダメージ', (v) => fmtInt(v / 10)],
  ['minecraft:damage_taken', '受けたダメージ', (v) => fmtInt(v / 10)],
  ['minecraft:time_since_death', '最後に死んでから', (v) => `${(v / 20 / 60).toFixed(0)} 分`],
]

function RecordsTab({ p }: { p: PlayerDetail }) {
  const id = enc(p.uuid)
  const stats = useQuery<StatsFile>(`/players/${id}/stats`)
  const adv = useQuery<AdvFile>(`/players/${id}/advancements`)
  const s = stats.data?.stats.stats ?? {}
  const custom = s['minecraft:custom'] ?? {}
  const top = (k: string) =>
    Object.entries(s[k] ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)

  const done = Object.entries(adv.data?.advancements ?? {}).filter(
    ([k, v]) => typeof v === 'object' && v.done && !k.includes(':recipes/'),
  )

  return (
    <div className="grid grid-split">
      <Card title="統計">
        {stats.error ? (
          <Empty>{stats.error.message}</Empty>
        ) : (
          <div className="stack" style={{ gap: 20 }}>
            <Kv items={CUSTOM.filter(([k]) => custom[k] !== undefined).map(([k, label, f]) => [label, <span className="mono">{f(custom[k])}</span>])} />
            <div className="grid grid-split" style={{ gap: 24 }}>
              <TopList title="よく掘ったブロック" rows={top('minecraft:mined')} />
              <TopList title="よく倒したモブ" rows={top('minecraft:killed')} />
            </div>
          </div>
        )}
      </Card>
      <Card title="進捗" meta={adv.data ? `${done.length} 個達成` : undefined}>
        {adv.error ? (
          <Empty>{adv.error.message}</Empty>
        ) : done.length === 0 ? (
          <Empty>まだありません</Empty>
        ) : (
          <div className="list" style={{ maxHeight: 420, overflow: 'auto' }}>
            {done.map(([k, v]) => {
              const times = typeof v === 'object' ? Object.values(v.criteria ?? {}) : []
              const last = times.sort().pop()
              return (
                <div key={k} className="row" style={{ minHeight: 32, flexWrap: 'nowrap' }}>
                  <span className="mono" style={{ fontSize: 13, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {shortId(k)}
                  </span>
                  <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 12, flex: 'none' }}>
                    {last ? last.slice(0, 10) : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function TopList({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = rows[0]?.[1] ?? 1
  return (
    <div className="split-v" style={{ gap: 8 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {title}
      </span>
      {rows.length === 0 && <span className="muted">—</span>}
      {rows.map(([k, v]) => (
        <div key={k} className="split-v" style={{ gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mono" style={{ fontSize: 12 }}>
              {shortId(k)}
            </span>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {fmtInt(v)}
            </span>
          </div>
          <Bar value={v} max={max} />
        </div>
      ))}
    </div>
  )
}
