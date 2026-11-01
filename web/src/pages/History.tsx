import { useEffect, useState } from 'react'
import { Download, Info } from 'lucide-react'
import { download, enc } from '../api'
import { useQuery } from '../hooks'
import { Card, Empty, PageHead, fmtBytes, fmtTime, useAction } from '../ui'

interface HistFile {
  name: string
  date: string | null
  size: number
  modified: string
}

interface ModHistory {
  keepDays: number
  kinds: { kind: string; label: string; files: HistFile[] }[]
}

interface LocalAudit {
  keepDays: number
  files: HistFile[]
}

/** チャット・出来事・操作の記録・サーバーログの保存分を一覧して、ダウンロードする（管理者だけ） */
export function History() {
  const mod = useQuery<ModHistory>('/history', 60000)
  const [local, setLocal] = useState<LocalAudit | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const run = useAction()

  // この画面自身（mc-server-manager）の記録は MC REST API を通さず、直接もらう
  useEffect(() => {
    fetch('/manager/audit')
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`)
        setLocal(body.data)
      })
      .catch((e) => setLocalError((e as Error).message))
  }, [])

  const keep = mod.data?.keepDays ?? local?.keepDays ?? 7
  const byKind = (k: string) => mod.data?.kinds.find((x) => x.kind === k)

  const modCard = (kind: string, title?: string) => {
    const k = byKind(kind)
    return (
      <FileCard
        key={kind}
        title={title ?? k?.label ?? kind}
        files={k?.files}
        error={mod.error?.message}
        onDownload={(f) => run(`${f.name} のダウンロードを始めました`, () => download(`/history/${kind}/${enc(f.name)}`))}
      />
    )
  }

  return (
    <>
      <PageHead title="ログと履歴" sub={`どれも 1 日 1 ファイルで、直近 ${keep} 日分を残します。古いものは自動で消えます`} />
      <div className="stack">
        {modCard('chat')}
        {modCard('events')}
        {modCard('audit')}
        <FileCard
          title="操作の記録（mc-server-manager）"
          files={local?.files}
          error={localError ?? undefined}
          onDownload={(f) => {
            // チケットは要らないので、そのまま落とす
            const a = document.createElement('a')
            a.href = `/manager/audit/${enc(f.name)}`
            document.body.appendChild(a)
            a.click()
            a.remove()
          }}
        />
        {modCard('server')}
        <div className="notice">
          <Info size={16} strokeWidth={1.5} />
          <span>
            チャット履歴と出来事の履歴は 1 行 1 件の JSON です。操作の記録（MC REST API）にはトークンの種類が、操作の記録（mc-server-manager）には画面を開いた端末の IP アドレスが残ります。サーバーログの debug.log
            と debug-N は NeoForge が本数を決めているので、ここでは消しません。
          </span>
        </div>
      </div>
    </>
  )
}

function FileCard({ title, files, error, onDownload }: { title: string; files?: HistFile[]; error?: string; onDownload: (f: HistFile) => void }) {
  return (
    <Card title={title} meta={files ? `${files.length} ファイル` : undefined} flush>
      {error && !files ? (
        <Empty>{error}</Empty>
      ) : !files ? (
        <Empty>読み込み中</Empty>
      ) : files.length === 0 ? (
        <Empty>まだありません</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ファイル</th>
                <th className="num">サイズ</th>
                <th>最終更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                    {f.name}
                  </td>
                  <td className="num mono muted" style={{ whiteSpace: 'nowrap', width: 120 }}>
                    {fmtBytes(f.size)}
                  </td>
                  <td className="mono muted" style={{ whiteSpace: 'nowrap', width: 200 }}>
                    {fmtTime(f.modified)}
                  </td>
                  <td className="actions">
                    <button type="button" className="btn sm ghost" onClick={() => onDownload(f)}>
                      <Download size={16} strokeWidth={1.5} />
                      ダウンロード
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
