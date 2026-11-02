import { useCallback, useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { del, download, enc, get, post, type BackupJob } from '../api'
import { useQuery } from '../hooks'
import { BackupScheduleCard } from '../components/BackupScheduleCard'
import { Button, Card, Dot, Empty, PageHead, fmtBytes, fmtInt, fmtTime, useAction, useConfirm } from '../ui'

interface BackupList {
  directory: string
  backups: { name: string; size: number; created: string }[]
}

const PHASE: Record<string, string> = {
  queued: '待機中',
  saving: 'ワールドを保存中',
  zipping: 'zip にまとめています',
  pruning: '古いものを整理中',
  done: '完了',
}

export function Backups() {
  const list = useQuery<BackupList>('/backups')
  const jobs = useQuery<BackupJob[]>('/backups/jobs')
  const run = useAction()
  const confirm = useConfirm()
  const [job, setJob] = useState<BackupJob | null>(null)

  // 実行中のジョブを 1 秒ごとに見に行く
  const jobId = job?.state === 'running' ? job.id : null
  const reloadList = list.reload
  const reloadJobs = jobs.reload
  useEffect(() => {
    if (!jobId) return
    const id = window.setInterval(async () => {
      try {
        const j = await get<BackupJob>(`/backups/jobs/${jobId}`)
        setJob(j)
        if (j.state !== 'running') {
          reloadList()
          reloadJobs()
        }
      } catch {
        // 次の回でやり直す
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [jobId, reloadList, reloadJobs])

  const reloadAll = useCallback(() => {
    reloadList()
    reloadJobs()
  }, [reloadList, reloadJobs])

  const running = job?.state === 'running' || jobs.data?.some((j) => j.state === 'running')

  return (
    <>
      <PageHead
        title="バックアップ"
        sub={list.data ? <span className="mono">{list.data.directory}</span> : undefined}
        actions={
          <Button
            variant="primary"
            disabled={running}
            onClick={async () => {
              const j = await run('バックアップを始めました', () => post<BackupJob>('/backups'))
              if (j) setJob(j)
            }}
          >
            いま作る
          </Button>
        }
      />
      <div className="stack">
        {job && (
          <Card title="作成中のバックアップ" meta={job.file ?? undefined}>
            <div className="row" style={{ gap: 16 }}>
              <Dot state={job.state === 'running' ? 'wait' : job.state === 'done' ? 'on' : 'off'} />
              <span>{job.state === 'failed' ? `失敗しました: ${job.error}` : PHASE[job.phase] ?? job.phase}</span>
              <span className="mono muted" style={{ marginLeft: 'auto' }}>
                {fmtInt(job.files)} ファイル · {fmtBytes(job.bytes)}
              </span>
            </div>
          </Card>
        )}
        <div className="grid grid-main">
          <Card title="保存されているもの" meta={list.data ? `${list.data.backups.length} 個` : undefined} flush>
            {list.data?.backups.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>名前</th>
                      <th className="num">サイズ</th>
                      <th>作成</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.backups.map((b) => (
                      <tr key={b.name}>
                        <td className="mono">{b.name}</td>
                        <td className="num mono">{fmtBytes(b.size)}</td>
                        <td className="mono muted">{fmtTime(b.created)}</td>
                        <td className="actions">
                          <Button size="sm" variant="ghost" onClick={() => run('ダウンロードを始めました', () => download(`/backups/${enc(b.name)}`))}>
                            ダウンロード
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              if (await confirm({ title: `${b.name} を削除しますか`, body: '元に戻せません。', ok: '削除', danger: true })) {
                                await run('削除しました', () => del(`/backups/${enc(b.name)}`))
                                list.reload()
                              }
                            }}
                          >
                            削除
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>まだありません</Empty>
            )}
          </Card>
          <div className="stack">
            <BackupScheduleCard onRan={reloadAll} />
            <Card title="最近のジョブ" flush>
              {jobs.data?.length ? (
                <table className="table">
                  <tbody>
                    {[...jobs.data].reverse().map((j) => (
                      <tr key={j.id}>
                        <td>
                          <span className="row" style={{ flexWrap: 'nowrap' }}>
                            <Dot state={j.state === 'running' ? 'wait' : j.state === 'done' ? 'on' : 'off'} />
                            <span className="mono muted">{fmtTime(j.startedAt)}</span>
                          </span>
                        </td>
                        <td className="num mono muted">{j.state === 'failed' ? '失敗' : fmtBytes(j.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>この起動中にはまだありません</Empty>
              )}
            </Card>
            <div className="notice">
              <Info size={16} strokeWidth={1.5} />
              <span>
                作るあいだは自動保存を止めて、終わったら元に戻します。戻すときはサーバーを止めてから world を入れ替えます（手順は README）。
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
