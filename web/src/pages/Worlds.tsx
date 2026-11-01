import { useState } from 'react'
import { del, enc, get, put, q, type WorldInfo } from '../api'
import { useQuery, useRegistry } from '../hooks'
import { WorldClock } from '../components/WorldClock'
import {
  Button,
  Card,
  Empty,
  Field,
  fmt1,
  fmtInt,
  Input,
  Kv,
  PageHead,
  Select,
  Seg,
  shortId,
  SuggestInput,
  dimName,
  useAction,
  useConfirm,
} from '../ui'

interface EntityRow {
  id: number
  uuid: string
  type: string
  name: string
  customName: string | null
  position: { x: number; y: number; z: number }
  alive: boolean
}

interface BlockInfo {
  dimension: string
  x: number
  y: number
  z: number
  block: string
  state: string
  hasBlockEntity: boolean
}

const TIME_PRESETS: [string, number][] = [
  ['朝', 1000],
  ['正午', 6000],
  ['夕方', 12000],
  ['夜', 13000],
  ['真夜中', 18000],
]

export function Worlds() {
  const worlds = useQuery<WorldInfo[]>('/worlds', 10000)
  const [dim, setDim] = useState(() => new URLSearchParams(window.location.search).get('d') ?? 'minecraft:overworld')
  const w = useQuery<WorldInfo>(`/worlds/${enc(dim)}`, 3000)
  const list = worlds.data ?? []

  return (
    <>
      <PageHead
        title="ワールド"
        sub={w.data ? `シード ${w.data.seed} · 難易度 ${w.data.difficulty}` : undefined}
        actions={
          list.length > 0 && (
            <Seg options={list.map((x) => [x.dimension, dimName(x.dimension)] as [string, string])} value={dim} onChange={setDim} />
          )
        }
      />
      {!w.data ? (
        <Card>
          <Empty>{w.error ? w.error.message : '読み込み中'}</Empty>
        </Card>
      ) : (
        <div className="stack">
          <div className="grid grid-main">
            <Card title="いまの様子">
              <div className="row" style={{ alignItems: 'center', gap: 32 }}>
                <WorldClock timeOfDay={w.data.timeOfDay} day={w.data.day} raining={w.data.raining} thundering={w.data.thundering} />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <Kv
                    items={[
                      ['プレイヤー', <span className="mono">{w.data.players} 人</span>],
                      ['エンティティ', <span className="mono">{fmtInt(w.data.entities)}</span>],
                      ['ロード済みチャンク', <span className="mono">{fmtInt(w.data.loadedChunks)}</span>],
                      ['ゲーム内の経過', <span className="mono">{fmtInt(w.data.gameTime)} tick</span>],
                      ['時計', <span className="mono">{fmtInt(w.data.clockTime)} tick</span>],
                      ['スポーン', w.data.spawn ? <span className="mono">{w.data.spawn.x}, {w.data.spawn.y}, {w.data.spawn.z} <span className="muted">（{dimName(w.data.spawn.dimension)}）</span></span> : '—'],
                      [
                        'ワールドボーダー',
                        w.data.worldBorder ? (
                          <span className="mono">
                            幅 {fmtInt(w.data.worldBorder.size)} · 中心 {fmt1(w.data.worldBorder.centerX)}, {fmt1(w.data.worldBorder.centerZ)}
                          </span>
                        ) : (
                          '—'
                        ),
                      ],
                    ]}
                  />
                </div>
              </div>
            </Card>
            <div className="stack">
              <TimeCard key={dim} dim={dim} onDone={w.reload} />
              <WeatherCard key={dim} dim={dim} current={w.data} onDone={w.reload} />
            </div>
          </div>
          <div className="grid grid-split">
            <SpawnCard key={dim} dim={dim} w={w.data} onDone={w.reload} />
            <BorderCard key={dim} dim={dim} w={w.data} onDone={w.reload} />
          </div>
          <EntitiesCard key={dim} dim={dim} />
          <BlockCard key={dim} dim={dim} />
        </div>
      )}
    </>
  )
}

function TimeCard({ dim, onDone }: { dim: string; onDone: () => void }) {
  const run = useAction()
  const [f, setF] = useState({ time: '', marker: '', add: '', rate: '' })
  const send = async (label: string, body: Record<string, unknown>) => {
    if (await run(label, () => put(`/worlds/${enc(dim)}/time`, body))) onDone()
  }
  return (
    <Card title="時刻">
      <div className="stack" style={{ gap: 12 }}>
        <div className="row">
          {TIME_PRESETS.map(([label, t]) => (
            <Button key={label} onClick={() => send(`${label}にしました`, { time: t })}>
              {label}
            </Button>
          ))}
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr) auto' }}>
          <Field label="時刻（tick）">
            <Input className="num mono" inputMode="numeric" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </Field>
          <Button disabled={!f.time} onClick={() => send('時刻を変えました', { time: Number(f.time) })}>
            設定
          </Button>
          <Field label="進める（tick）">
            <Input className="num mono" inputMode="numeric" value={f.add} onChange={(e) => setF({ ...f, add: e.target.value })} />
          </Field>
          <Button disabled={!f.add} onClick={() => send('時刻を進めました', { add: Number(f.add) })}>
            進める
          </Button>
          <Field label="時刻マーカー">
            <Input className="mono" value={f.marker} placeholder="minecraft:day" onChange={(e) => setF({ ...f, marker: e.target.value })} />
          </Field>
          <Button disabled={!f.marker} onClick={() => send('時刻を変えました', { marker: f.marker })}>
            設定
          </Button>
          <Field label="速さ（倍）">
            <Input className="num mono" inputMode="decimal" value={f.rate} placeholder="1.0" onChange={(e) => setF({ ...f, rate: e.target.value })} />
          </Field>
          <Button disabled={!f.rate} onClick={() => send('時間の速さを変えました', { rate: Number(f.rate) })}>
            設定
          </Button>
        </div>
        <div className="row">
          <Button onClick={() => send('時間を止めました', { paused: true })}>
            時間を止める
          </Button>
          <Button onClick={() => send('時間を動かしました', { paused: false })}>
            動かす
          </Button>
        </div>
      </div>
    </Card>
  )
}

function WeatherCard({ dim, current, onDone }: { dim: string; current: WorldInfo; onDone: () => void }) {
  const run = useAction()
  const now = current.thundering ? 'thunder' : current.raining ? 'rain' : 'clear'
  const [type, setType] = useState<'clear' | 'rain' | 'thunder'>(now)
  const [sec, setSec] = useState('')
  return (
    <Card title="天候" meta={`いま: ${now === 'thunder' ? '雷雨' : now === 'rain' ? '雨' : '晴れ'}`}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <Seg
          options={[
            ['clear', '晴れ'],
            ['rain', '雨'],
            ['thunder', '雷雨'],
          ]}
          value={type}
          onChange={setType}
        />
        <Input className="num mono" inputMode="numeric" placeholder="秒（省略可）" value={sec} onChange={(e) => setSec(e.target.value)} style={{ width: 120 }} />
        <Button
          onClick={async () => {
            if (await run('天候を変えました', () => put(`/worlds/${enc(dim)}/weather`, { type, seconds: sec ? Number(sec) : undefined }))) onDone()
          }}
        >
          変える
        </Button>
      </div>
    </Card>
  )
}

function SpawnCard({ dim, w, onDone }: { dim: string; w: WorldInfo; onDone: () => void }) {
  const run = useAction()
  const [f, setF] = useState({ x: '', y: '', z: '', angle: '' })
  return (
    <Card title="ワールドのスポーン地点">
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr)) auto' }}>
        {(['x', 'y', 'z'] as const).map((k) => (
          <Field key={k} label={k.toUpperCase()}>
            <Input className="num mono" inputMode="numeric" placeholder={String(w.spawn?.[k] ?? '')} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label="向き">
          <Input className="num mono" inputMode="decimal" value={f.angle} onChange={(e) => setF({ ...f, angle: e.target.value })} />
        </Field>
        <Button
          disabled={!f.x || !f.y || !f.z}
          onClick={async () => {
            const body = { x: Number(f.x), y: Number(f.y), z: Number(f.z), angle: f.angle ? Number(f.angle) : undefined }
            if (await run('スポーン地点を変えました', () => put(`/worlds/${enc(dim)}/spawn`, body))) onDone()
          }}
        >
          設定
        </Button>
      </div>
    </Card>
  )
}

function BorderCard({ dim, w, onDone }: { dim: string; w: WorldInfo; onDone: () => void }) {
  const run = useAction()
  const b = w.worldBorder
  const empty = { size: '', seconds: '', centerX: '', centerZ: '', damagePerBlock: '', damageBuffer: '', warningDistance: '', warningTime: '' }
  const [f, setF] = useState(empty)
  const fields: [keyof typeof empty, string, string | number | undefined][] = [
    ['size', '幅', b?.size],
    ['seconds', 'かける秒数', 0],
    ['centerX', '中心 X', b?.centerX],
    ['centerZ', '中心 Z', b?.centerZ],
    ['damagePerBlock', 'ダメージ / ブロック', b?.damagePerBlock],
    ['damageBuffer', '安全な幅', b?.safeZone],
    ['warningDistance', '警告の距離', b?.warningBlocks],
    ['warningTime', '警告の秒数', b?.warningTimeSeconds],
  ]
  return (
    <Card title="ワールドボーダー">
      <div className="stack" style={{ gap: 12 }}>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              <Input className="num mono" inputMode="decimal" placeholder={ph === undefined ? '' : String(Math.round(Number(ph) * 100) / 100)} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="row">
          <Button
            disabled={Object.values(f).every((v) => v === '')}
            onClick={async () => {
              const body: Record<string, number> = {}
              for (const [k, v] of Object.entries(f)) if (v !== '') body[k] = Number(v)
              if ((body.centerX !== undefined) !== (body.centerZ !== undefined)) {
                body.centerX ??= b?.centerX ?? 0
                body.centerZ ??= b?.centerZ ?? 0
              }
              if (await run('ワールドボーダーを変えました', () => put(`/worlds/${enc(dim)}/worldborder`, body))) {
                setF(empty)
                onDone()
              }
            }}
          >
            入力した項目を適用
          </Button>
        </div>
      </div>
    </Card>
  )
}

function EntitiesCard({ dim }: { dim: string }) {
  const types = useRegistry('entity_type')
  const run = useAction()
  const confirm = useConfirm()
  const [f, setF] = useState({ type: '', x: '', y: '', z: '', radius: '' })
  const [path, setPath] = useState(() => q(`/worlds/${enc(dim)}/entities`, { limit: 200 }))
  const res = useQuery<{ total: number; returned: number; entities: EntityRow[] }>(path)
  const params = () => ({ type: f.type || undefined, x: f.x || undefined, y: f.y || undefined, z: f.z || undefined, radius: f.radius || undefined })

  return (
    <Card
      title="エンティティ"
      meta={res.data ? `${fmtInt(res.data.total)} 体中 ${res.data.returned} 体を表示` : undefined}
      flush
    >
      <div style={{ padding: '0 20px 16px' }}>
        <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0,2fr) repeat(4, minmax(0,1fr)) auto auto' }}>
          <Field label="種類">
            <SuggestInput options={types} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="すべて" />
          </Field>
          {(['x', 'y', 'z', 'radius'] as const).map((k) => (
            <Field key={k} label={k === 'radius' ? '半径' : k.toUpperCase()}>
              <Input className="num mono" inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </Field>
          ))}
          <Button onClick={() => setPath(q(`/worlds/${enc(dim)}/entities`, { ...params(), limit: 200 }))}>絞り込む</Button>
          <Button
            variant="danger"
            disabled={!f.type}
            onClick={async () => {
              const ok = await confirm({
                title: `${shortId(f.type)} を消しますか`,
                body: f.radius ? `(${f.x || 0}, ${f.y || 0}, ${f.z || 0}) から半径 ${f.radius} の範囲だけ消します。` : 'このディメンションにいる同じ種類を全部消します。',
                ok: '消す',
                danger: true,
              })
              if (!ok) return
              await run('消しました', () => del(q(`/worlds/${enc(dim)}/entities`, params())))
              res.reload()
            }}
          >
            この種類を消す
          </Button>
        </div>
      </div>
      {res.data?.entities.length ? (
        <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>種類</th>
                <th>名前</th>
                <th className="num">X</th>
                <th className="num">Y</th>
                <th className="num">Z</th>
                <th>UUID</th>
              </tr>
            </thead>
            <tbody>
              {res.data.entities.map((e) => (
                <tr key={e.uuid}>
                  <td className="mono">{shortId(e.type)}</td>
                  <td className="secondary">{e.customName ?? e.name}</td>
                  <td className="num mono">{fmt1(e.position.x)}</td>
                  <td className="num mono">{fmt1(e.position.y)}</td>
                  <td className="num mono">{fmt1(e.position.z)}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {e.uuid}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{res.loading ? '読み込み中' : '見つかりません'}</Empty>
      )}
    </Card>
  )
}

function BlockCard({ dim }: { dim: string }) {
  const blocks = useRegistry('block')
  const run = useAction()
  const [pos, setPos] = useState({ x: '', y: '', z: '' })
  const [info, setInfo] = useState<BlockInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [set, setSet] = useState({ block: '', mode: 'replace' })
  const path = () => `/worlds/${enc(dim)}/blocks/${Number(pos.x)}/${Number(pos.y)}/${Number(pos.z)}`
  const ready = pos.x !== '' && pos.y !== '' && pos.z !== ''

  const look = async () => {
    setErr(null)
    try {
      setInfo(await get<BlockInfo>(path()))
    } catch (e) {
      setInfo(null)
      setErr((e as Error).message)
    }
  }

  return (
    <Card title="ブロック">
      <div className="grid grid-split" style={{ gap: 24 }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr)) auto' }}>
            {(['x', 'y', 'z'] as const).map((k) => (
              <Field key={k} label={k.toUpperCase()}>
                <Input className="num mono" inputMode="numeric" value={pos[k]} onChange={(e) => setPos({ ...pos, [k]: e.target.value })} />
              </Field>
            ))}
            <Button disabled={!ready} onClick={look}>
              調べる
            </Button>
          </div>
          {err && <div className="bad" style={{ fontSize: 13 }}>{err}</div>}
          {info && (
            <Kv
              items={[
                ['ブロック', <span className="mono">{info.block}</span>],
                ['状態', <span className="mono">{info.state}</span>],
                ['ブロックエンティティ', info.hasBlockEntity ? 'あり' : 'なし'],
              ]}
            />
          )}
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="置くブロック" hint="状態は minecraft:oak_stairs[facing=north] のように書く">
            <SuggestInput options={blocks} value={set.block} onChange={(e) => setSet({ ...set, block: e.target.value })} />
          </Field>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Select value={set.mode} onChange={(e) => setSet({ ...set, mode: e.target.value })} style={{ flex: 1 }}>
              <option value="replace">置き換える</option>
              <option value="destroy">壊してから置く（ドロップあり）</option>
              <option value="keep">空気のときだけ置く</option>
              <option value="strict">周りを更新しない</option>
            </Select>
            <Button
              disabled={!ready || !set.block}
              onClick={async () => {
                if (await run('ブロックを置きました', () => put(path(), set))) look()
              }}
            >
              置く
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
