import { useEffect, useMemo, useState } from 'react'
import { get } from '../api'
import { Card, Dot, Empty, Input, PageHead } from '../ui'

interface OpenApi {
  info: { title: string; version: string; description: string }
  tags: { name: string; description: string }[]
  paths: Record<string, Record<string, { summary?: string; tags?: string[]; 'x-scope'?: string } | unknown>>
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const SCOPE: Record<string, string> = { read: '閲覧', write: '操作', admin: '管理者' }

/** Mod の openapi.json を読んで、使える API を一覧にする */
export function ApiSpec() {
  const [doc, setDoc] = useState<OpenApi | null>(null)
  const [health, setHealth] = useState<'ok' | 'ng' | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    // openapi.json は {data: ...} で包まれていないので fetch で直接読む
    fetch('/api/v1/openapi.json')
      .then((r) => r.json())
      .then(setDoc)
      .catch(() => setDoc(null))
    get<{ status: string }>('/health')
      .then((h) => setHealth(h.status === 'ok' ? 'ok' : 'ng'))
      .catch(() => setHealth('ng'))
  }, [])

  const groups = useMemo(() => {
    if (!doc) return []
    const f = filter.toLowerCase()
    return doc.tags.map((t) => ({
      tag: t,
      ops: Object.entries(doc.paths).flatMap(([path, item]) =>
        METHODS.filter((m) => m in item)
          .map((m) => ({ path, method: m, op: item[m] as { summary?: string; tags?: string[]; 'x-scope'?: string } }))
          .filter((o) => o.op.tags?.includes(t.name))
          .filter((o) => !f || o.path.toLowerCase().includes(f) || (o.op.summary ?? '').toLowerCase().includes(f)),
      ),
    }))
  }, [doc, filter])

  const total = groups.reduce((n, g) => n + g.ops.length, 0)

  return (
    <>
      <PageHead
        title="API 一覧"
        sub={
          <span className="row" style={{ gap: 12 }}>
            <span className="row" style={{ gap: 8 }}>
              <Dot state={health === 'ok' ? 'on' : health === 'ng' ? 'off' : 'wait'} />
              {health === 'ok' ? 'Mod の API は応答しています' : health === 'ng' ? 'Mod の API が応答しません' : '確認中'}
            </span>
            {doc && (
              <span className="mono muted">
                {doc.info.title} {doc.info.version} · {total} 個
              </span>
            )}
          </span>
        }
        actions={<Input placeholder="パスや説明で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} />}
      />
      {!doc ? (
        <Card>
          <Empty>読み込み中</Empty>
        </Card>
      ) : (
        <div className="stack">
          {groups
            .filter((g) => g.ops.length)
            .map((g) => (
              <Card key={g.tag.name} title={g.tag.description} meta={`${g.ops.length} 個`} flush>
                <table className="table">
                  <tbody>
                    {g.ops.map((o) => (
                      <tr key={o.method + o.path}>
                        <td style={{ width: 72 }}>
                          <span className={`method ${o.method}`}>{o.method.toUpperCase()}</span>
                        </td>
                        <td className="mono" style={{ fontSize: 13 }}>
                          {o.path}
                        </td>
                        <td className="secondary">{o.op.summary}</td>
                        <td className="muted" style={{ width: 72, fontSize: 12 }}>
                          {SCOPE[o.op['x-scope'] ?? ''] ?? '不要'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
        </div>
      )}
    </>
  )
}
