import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { getManager, manager, type BackupScheduleSettings, type BackupScheduleView } from '../api'
import { useQuery } from '../hooks'
import { Button, Card, Dot, Field, Input, Switch, fmtTime, useAction, useConfirm } from '../ui'

const DAYS: [number, string][] = [
  [1, '月'],
  [2, '火'],
  [3, '水'],
  [4, '木'],
  [5, '金'],
  [6, '土'],
  [7, '日'],
]

const RESULT: Record<string, string> = {
  done: 'バックアップを作りました',
  backup_failed: 'バックアップに失敗しました',
  error: '途中で止まりました',
}

/** 決まった曜日・時刻にバックアップを作る予定。動かすのはサーバーの中の Mod なので、画面を閉じていても動く */
export function BackupScheduleCard({ onRan }: { onRan?: () => void }) {
  const view = useQuery<BackupScheduleView>('/backup-schedule', 5000, getManager)
  const [form, setForm] = useState<BackupScheduleSettings | null>(null)
  const run = useAction()
  const confirm = useConfirm()
  const v = view.data

  // 保存した内容を読み込んだら、編集欄を最新にする（編集中は上書きしない）
  const saved = v?.settings
  useEffect(() => {
    if (saved && form === null) setForm(saved)
  }, [saved, form])

  // 実行が終わったら、バックアップの一覧を取り直してもらう
  const running = v?.running
  const prevRunning = useRef(running)
  useEffect(() => {
    if (prevRunning.current && running === false) onRan?.()
    prevRunning.current = running
  }, [running, onRan])

  if (!v || !form) {
    return <Card title="バックアップの予定">{view.error ? <span className="muted">{view.error.message}</span> : <span className="muted">読み込み中</span>}</Card>
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(v.settings)
  const set = (patch: Partial<BackupScheduleSettings>) => setForm({ ...form, ...patch })
  const toggleDay = (d: number) => set({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort() })

  const save = async () => {
    const next = await run('予定を保存しました', () => manager<BackupScheduleView>('PUT', '/backup-schedule', form))
    if (next) {
      view.setData(next)
      setForm(next.settings)
    }
  }

  const runNow = async () => {
    const ok = await confirm({
      title: 'いま実行しますか',
      body: '予定と同じ流れで、いますぐバックアップを作ります。保存していない変更は使いません。',
      ok: '実行する',
    })
    if (ok && (await run('バックアップを始めました', () => manager('POST', '/backup-schedule/run')))) view.reload()
  }

  return (
    <Card
      title="バックアップの予定"
      meta={v.timezone}
      actions={<Switch checked={form.enabled} onChange={(enabled) => set({ enabled })} label="予定を有効にする" />}
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <Dot state={v.running ? 'wait' : v.settings.enabled ? 'on' : 'idle'} />
          <span>
            {v.running
              ? `バックアップ中（${fmtTime(v.runningSince, false)} から）`
              : v.nextRunAt
                ? `次は ${fmtTime(v.nextRunAt).slice(0, 16)}`
                : '止めています'}
          </span>
        </div>
        <Field label="曜日">
          <div className="seg" role="group" aria-label="曜日">
            {DAYS.map(([d, label]) => (
              <button key={d} type="button" aria-pressed={form.days.includes(d)} onClick={() => toggleDay(d)}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="時刻" hint="サーバーの時間帯。いくつでも足せます（8 個まで）">
          <div className="row" style={{ gap: 8 }}>
            {form.times.map((t, i) => (
              <span key={i} className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                <Input
                  type="time"
                  value={t}
                  style={{ width: 112 }}
                  onChange={(e) => set({ times: form.times.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                <Button size="sm" variant="ghost" icon aria-label={`${t} を外す`} onClick={() => set({ times: form.times.filter((_, j) => j !== i) })}>
                  <X size={14} strokeWidth={1.5} />
                </Button>
              </span>
            ))}
            {form.times.length < 8 && (
              <Button size="sm" variant="ghost" onClick={() => set({ times: [...form.times, '05:00'] })}>
                <Plus size={14} strokeWidth={1.5} />
                足す
              </Button>
            )}
          </div>
        </Field>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="primary" disabled={!dirty} onClick={save}>
            保存
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setForm(v.settings)}>
              元に戻す
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button disabled={v.running} onClick={runNow}>
            いま実行
          </Button>
        </div>
        {v.lastRun && (
          <div className="split-v" style={{ gap: 4, fontSize: 13 }}>
            <span className="muted">
              前回 {fmtTime(v.lastRun.startedAt).slice(0, 16)}（{v.lastRun.trigger === 'manual' ? '手動' : '予定'}）
            </span>
            <span className={v.lastRun.result === 'done' ? undefined : 'bad'}>{RESULT[v.lastRun.result] ?? v.lastRun.result}</span>
            {v.lastRun.backupFile && <span className="mono muted">{v.lastRun.backupFile}</span>}
            {v.lastRun.detail && <span className="mono muted" style={{ overflowWrap: 'anywhere' }}>{v.lastRun.detail}</span>}
          </div>
        )}
      </div>
    </Card>
  )
}
