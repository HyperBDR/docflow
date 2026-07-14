import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_URL, api } from '../api'
import StepCanvas from '../components/StepCanvas'
import type { Demo, ExportJob, Step } from '../types'

export default function Editor() {
  const { id = '' } = useParams()
  const [demo, setDemo] = useState<Demo | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const selected = useMemo(() => demo?.steps.find(step => step.id === selectedId) || demo?.steps[0], [demo, selectedId])

  useEffect(() => { api.demo(id).then(value => { setDemo(value); setSelectedId(value.steps[0]?.id || null) }).catch(value => setError(value.message)) }, [id])
  useEffect(() => {
    const active = jobs.some(job => job.status === 'queued' || job.status === 'running')
    if (!active) return
    const timer = window.setInterval(async () => setJobs(await Promise.all(jobs.map(job => job.status === 'complete' || job.status === 'failed' ? job : api.export(job.id)))), 1500)
    return () => clearInterval(timer)
  }, [jobs])

  async function patchDemo(values: Partial<Demo>) {
    setDemo(current => current ? { ...current, ...values } : current)
    try { setDemo(await api.updateDemo(id, values)) } catch (value) { setError((value as Error).message) }
  }

  async function patchStep(stepId: string, values: Partial<Step>) {
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, ...values } : step) } : current)
    try {
      const updated = await api.updateStep(id, stepId, values)
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? updated : step) } : current)
    } catch (value) { setError((value as Error).message) }
  }

  async function move(stepId: string, offset: number) {
    if (!demo) return
    const steps = [...demo.steps]
    const from = steps.findIndex(step => step.id === stepId)
    const to = from + offset
    if (to < 0 || to >= steps.length) return
    ;[steps[from], steps[to]] = [steps[to], steps[from]]
    setDemo(await api.reorder(id, steps.map(step => step.id)))
  }

  async function upload(file: File) {
    const bitmap = await createImageBitmap(file)
    const meta = { event_id: crypto.randomUUID(), title: `步骤 ${(demo?.steps.length || 0) + 1}`, body: '', viewport_width: bitmap.width, viewport_height: bitmap.height, hotspot: { x: .5, y: .5, w: .04, h: .04 }, duration: 3 }
    bitmap.close()
    const form = new FormData(); form.append('meta', JSON.stringify(meta)); form.append('screenshot', file)
    const step = await api.uploadStep(id, form)
    setDemo(current => current ? { ...current, steps: [...current.steps, step] } : current)
    setSelectedId(step.id)
  }

  async function publish() {
    try { setDemo(await api.publish(id)); setNotice('发布成功，公开版本已更新。') } catch (value) { setError((value as Error).message) }
  }

  async function copyMarkdown() {
    if (!demo?.share_url) return
    const token = demo.share_url.split('/').pop()
    const response = await fetch(`${API_URL}/public/${token}/markdown`)
    await navigator.clipboard.writeText(await response.text())
    setNotice('Markdown 已复制到剪贴板。')
  }

  async function startExport(kind: ExportJob['kind']) {
    try {
      const job = await api.createExport(id, kind)
      setJobs(current => [job, ...current.filter(item => item.kind !== kind)])
    } catch (value) { setError((value as Error).message) }
  }

  if (!demo) return <main className="page"><Link to="/">← 返回</Link><div className="center-page">{error || '正在加载…'}</div></main>
  return <main className="editor-page">
    <div className="editor-topbar">
      <Link to="/" className="back">← 我的演示</Link>
      <div className="editor-meta"><input value={demo.title} onChange={event => setDemo({ ...demo, title: event.target.value })} onBlur={() => patchDemo({ title: demo.title })} /><span className={`status ${demo.status}`}>{demo.status === 'published' ? '已发布' : '草稿'}</span></div>
      <div className="toolbar-actions">{demo.share_url && <a className="secondary button" href={demo.share_url} target="_blank">预览</a>}<button className="primary" onClick={publish}>发布</button></div>
    </div>
    {error && <div className="toast error" onClick={() => setError('')}>{error}</div>}{notice && <div className="toast success" onClick={() => setNotice('')}>{notice}</div>}
    <div className="editor-layout">
      <aside className="step-list">
        <label className="upload-button">＋ 添加截图<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => event.target.files?.[0] && upload(event.target.files[0])} /></label>
        {demo.steps.map((step, index) => <button className={`step-item ${selected?.id === step.id ? 'active' : ''}`} key={step.id} onClick={() => setSelectedId(step.id)}><span>{index + 1}</span><img src={step.image_url} /><div>{step.title || `步骤 ${index + 1}`}</div></button>)}
      </aside>
      <section className="editor-main">
        {selected ? <>
          <StepCanvas step={selected} onChange={values => patchStep(selected.id, values)} />
          <div className="step-form">
            <label>步骤标题<input value={selected.title} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, title: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { title: selected.title })} /></label>
            <label>操作说明<textarea value={selected.body} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, body: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { body: selected.body })} /></label>
            <label>视频停留时间<input type="number" min="1" max="15" step=".5" value={selected.duration} onChange={event => patchStep(selected.id, { duration: Number(event.target.value) })} /></label>
            <div className="inline-actions"><button onClick={() => move(selected.id, -1)}>上移</button><button onClick={() => move(selected.id, 1)}>下移</button><button className="danger" onClick={async () => { await api.deleteStep(id, selected.id); const fresh = await api.demo(id); setDemo(fresh); setSelectedId(fresh.steps[0]?.id || null) }}>删除步骤</button></div>
          </div>
        </> : <div className="empty editor-empty"><h2>添加第一个步骤</h2><p>用浏览器扩展录制，或点击左侧“添加截图”。</p></div>}
      </section>
      <aside className="publish-panel">
        <h3>说明</h3><textarea value={demo.description} onChange={event => setDemo({ ...demo, description: event.target.value })} onBlur={() => patchDemo({ description: demo.description })} placeholder="演示简介" />
        <h3>输出</h3>
        <button disabled={!demo.share_url} onClick={copyMarkdown}>复制 Markdown</button>
        <button disabled={!demo.share_url} onClick={() => startExport('markdown')}>下载 Markdown + 图片</button>
        <button disabled={!demo.share_url} onClick={() => startExport('pdf')}>导出 PDF</button>
        <button disabled={!demo.share_url} onClick={() => startExport('mp4')}>导出 MP4</button>
        {jobs.map(job => <div className="job" key={job.id}><span>{job.kind.toUpperCase()}</span><span>{job.status === 'complete' ? <a href={`${API_URL}${job.download_url}`}>下载</a> : job.status === 'failed' ? '失败' : `${job.progress}%`}</span></div>)}
        {demo.share_url && <><h3>公开链接</h3><input readOnly value={demo.share_url} onFocus={event => event.currentTarget.select()} /><button className="danger subtle" onClick={async () => setDemo(await api.revoke(id))}>撤销分享</button></>}
      </aside>
    </div>
  </main>
}
