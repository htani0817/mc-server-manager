import { useRef, useState } from 'react'
import { ChevronRight, File, FileText, Folder, Link2 } from 'lucide-react'
import { del, download, getText, post, putRaw, q, type FileEntry } from '../api'
import { useQuery } from '../hooks'
import { Button, Card, Empty, Field, Input, Modal, PageHead, Textarea, fmtBytes, fmtTime, useAction, useConfirm, useToast } from '../ui'

interface Listing {
  path: string
  entries: FileEntry[]
}

export function Files() {
  const [dir, setDir] = useState('.')
  const list = useQuery<Listing>(q('/files', { path: dir === '.' ? undefined : dir }))
  const run = useAction()
  const toast = useToast()
  const confirm = useConfirm()
  const upload = useRef<HTMLInputElement>(null)
  const [edit, setEdit] = useState<{ path: string; text: string; original: string } | null>(null)
  const [moving, setMoving] = useState<{ entry: FileEntry; mode: 'move' | 'copy'; to: string } | null>(null)
  const [mkdir, setMkdir] = useState<string | null>(null)

  const parts = dir === '.' ? [] : dir.split('/')
  const join = (name: string) => (dir === '.' ? name : `${dir}/${name}`)

  const open = async (e: FileEntry) => {
    if (e.type === 'directory') {
      setDir(e.path)
      return
    }
    if (e.text && (e.size ?? 0) <= 2 * 1024 * 1024) {
      try {
        const text = await getText(q('/files/content', { path: e.path }))
        setEdit({ path: e.path, text, original: text })
      } catch (err) {
        toast({ kind: 'error', text: `${e.name} を開けません`, detail: (err as Error).message })
      }
    } else {
      await download('/files/content', { path: e.path })
    }
  }

  const onUpload = async (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) {
      const target = join(f.name)
      const exists = list.data?.entries.some((x) => x.name === f.name)
      if (exists && !(await confirm({ title: `${f.name} を上書きしますか`, ok: '上書き', danger: true }))) continue
      await run(`${f.name} をアップロードしました`, () => putRaw(q('/files/content', { path: target, overwrite: true }), f))
    }
    if (upload.current) upload.current.value = ''
    list.reload()
  }

  return (
    <>
      <PageHead
        title="ファイル"
        sub="サーバーのフォルダの中身です。mods に jar を置く、設定を直すといった作業ができます"
        actions={
          <>
            <Button onClick={() => setMkdir('')}>
              フォルダを作る
            </Button>
            <Button variant="primary" onClick={() => upload.current?.click()}>
              アップロード
            </Button>
            <input ref={upload} type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} />
          </>
        }
      />
      <Card flush>
        <div className="card-head" style={{ marginBottom: 8 }}>
          <div className="crumbs">
            <button onClick={() => setDir('.')}>サーバー</button>
            {parts.map((p, i) => (
              <span key={i} className="row" style={{ gap: 4 }}>
                <ChevronRight size={14} strokeWidth={1.5} className="muted" />
                <button onClick={() => setDir(parts.slice(0, i + 1).join('/'))}>{p}</button>
              </span>
            ))}
          </div>
        </div>
        {list.error ? (
          <Empty>{list.error.message}</Empty>
        ) : !list.data ? (
          <Empty>読み込み中</Empty>
        ) : list.data.entries.length === 0 ? (
          <Empty>空のフォルダです</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>名前</th>
                  <th className="num">サイズ</th>
                  <th>更新</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.entries.map((e) => {
                  const Icon = e.type === 'directory' ? Folder : e.type === 'symlink' ? Link2 : e.text ? FileText : File
                  return (
                    <tr key={e.path} className="clickable" onClick={() => open(e)}>
                      <td>
                        <span className="row" style={{ flexWrap: 'nowrap' }}>
                          <Icon size={16} strokeWidth={1.5} className="muted" />
                          {e.name}
                        </span>
                      </td>
                      <td className="num mono muted">{e.type === 'directory' ? '' : fmtBytes(e.size)}</td>
                      <td className="mono muted">{fmtTime(e.modified)}</td>
                      <td className="actions" onClick={(ev) => ev.stopPropagation()}>
                        {e.type !== 'directory' && (
                          <Button size="sm" variant="ghost" onClick={() => run('ダウンロードを始めました', () => download('/files/content', { path: e.path }))}>
                            ダウンロード
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setMoving({ entry: e, mode: 'move', to: e.path })}>
                          移動
                        </Button>
                        {e.type === 'file' && (
                          <Button size="sm" variant="ghost" onClick={() => setMoving({ entry: e, mode: 'copy', to: e.path + '.copy' })}>
                            コピー
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const isDir = e.type === 'directory'
                            const ok = await confirm({
                              title: `${e.name} を削除しますか`,
                              body: isDir ? 'フォルダの中身もすべて消えます。元に戻せません。' : '元に戻せません。',
                              ok: '削除',
                              danger: true,
                            })
                            if (!ok) return
                            await run('削除しました', () => del(q('/files', { path: e.path, recursive: isDir ? true : undefined })))
                            list.reload()
                          }}
                        >
                          削除
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.path} wide>
        {edit && (
          <div className="stack" style={{ gap: 12, marginTop: 12 }}>
            <Textarea className="code" rows={24} value={edit.text} spellCheck={false} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              {edit.text !== edit.original && <span className="accent-ink" style={{ fontSize: 12 }}>変更あり</span>}
              <Button variant="ghost" onClick={() => setEdit(null)}>
                閉じる
              </Button>
              <Button
                variant="primary"
                disabled={edit.text === edit.original}
                onClick={async () => {
                  if (await run('保存しました', () => putRaw(q('/files/content', { path: edit.path, overwrite: true }), edit.text))) {
                    setEdit({ ...edit, original: edit.text })
                    list.reload()
                  }
                }}
              >
                保存
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={moving !== null} onClose={() => setMoving(null)} title={moving?.mode === 'copy' ? 'コピー' : '移動・名前の変更'}>
        {moving && (
          <div className="stack" style={{ gap: 12, marginTop: 12 }}>
            <Field label="元">
              <Input className="mono" value={moving.entry.path} disabled />
            </Field>
            <Field label="先" hint="サーバーのフォルダからの相対パス">
              <Input className="mono" value={moving.to} onChange={(e) => setMoving({ ...moving, to: e.target.value })} autoFocus />
            </Field>
            <div className="dialog-actions" style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={() => setMoving(null)}>
                やめる
              </Button>
              <Button
                variant="primary"
                disabled={!moving.to || moving.to === moving.entry.path}
                onClick={async () => {
                  const ok = await run(moving.mode === 'copy' ? 'コピーしました' : '移動しました', () =>
                    post(moving.mode === 'copy' ? '/files/copy' : '/files/move', { from: moving.entry.path, to: moving.to }),
                  )
                  if (ok) {
                    setMoving(null)
                    list.reload()
                  }
                }}
              >
                {moving.mode === 'copy' ? 'コピー' : '移動'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={mkdir !== null} onClose={() => setMkdir(null)} title="フォルダを作る">
        {mkdir !== null && (
          <div className="stack" style={{ gap: 12, marginTop: 12 }}>
            <Field label="名前" hint={`作る場所: ${dir === '.' ? 'サーバーのフォルダ' : dir}`}>
              <Input value={mkdir} onChange={(e) => setMkdir(e.target.value)} autoFocus />
            </Field>
            <div className="dialog-actions" style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={() => setMkdir(null)}>
                やめる
              </Button>
              <Button
                variant="primary"
                disabled={!mkdir}
                onClick={async () => {
                  if (await run('作りました', () => post('/files/mkdir', { path: join(mkdir) }))) {
                    setMkdir(null)
                    list.reload()
                  }
                }}
              >
                作る
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
