import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_URL, api } from '../api'
import { copyText } from '../clipboard'
import Icon, { type IconName } from '../components/Icon'
import SlideStage from '../components/SlideStage'
import type { AIJob, Demo, ExportJob, HotspotData, Rect, SelectorInfo, Step } from '../types'

type InspectorTab = 'content' | 'hotspot' | 'tooltip' | 'theme' | 'animation' | 'ai'
type CanvasMode = 'preview' | 'edit'

const defaultTooltip = { content: '点击此处继续', placement: 'auto', alignment: 'center' as const, offset: 12, max_width: 320, show_arrow: true }
const defaultStyle = { shape: 'rectangle' as const, pulse: true, spotlight: false, padding: 6, color: '#635bff', overlay_opacity: .45 }
const inspectorTabs: { value: InspectorTab; label: string; icon: IconName }[] = [
  { value: 'content', label: '内容', icon: 'text' }, { value: 'hotspot', label: '热点', icon: 'target' },
  { value: 'tooltip', label: '引导', icon: 'edit' }, { value: 'theme', label: '样式', icon: 'palette' },
  { value: 'animation', label: 'Animation', icon: 'animation' }, { value: 'ai', label: 'AI', icon: 'ai' },
]

function InspectorSection({ icon, title, description, children, tone = '' }: { icon: IconName; title: string; description?: string; children: ReactNode; tone?: 'danger' | '' }) {
  return <section className={`inspector-section ${tone}`}>
    <header><span className="section-icon"><Icon name={icon} /></span><div><strong>{title}</strong>{description && <small>{description}</small>}</div></header>
    <div className="inspector-items">{children}</div>
  </section>
}

function normalizedColor(value: string) {
  const color = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map(char => char + char).join('')}`.toLowerCase()
  return null
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const color = normalizedColor(draft)
    if (color) { setDraft(color); onChange(color) } else setDraft(value)
  }
  return <label className="color-field"><span>{label}</span><div className="color-input-row">
    <span className="color-swatch" style={{ background: value }}><input aria-label={`${label}颜色选择器`} type="color" value={value} onChange={event => { setDraft(event.target.value); onChange(event.target.value) }} /></span>
    <input className="color-value" value={draft} maxLength={7} spellCheck={false} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
  </div></label>
}

function RangeField({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="range-field"><span>{label}<output>{value}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>
}

function visibleCaptureWarnings(warnings: string[] = []) {
  const legacyAudit = /^(removed unsafe|removed external|removed recorder or browser-extension|removed injected|Video playback is not included)/i
  return warnings.filter(warning => !legacyAudit.test(warning))
}

export default function Editor() {
  const { id = '' } = useParams()
  const [demo, setDemo] = useState<Demo | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null)
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('preview')
  const [tab, setTab] = useState<InspectorTab>('content')
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [aiJob, setAIJob] = useState<AIJob | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const selected = useMemo(() => demo?.steps.find(step => step.id === selectedId) || demo?.steps[0], [demo, selectedId])
  const selectedHotspot = useMemo(() => selected?.hotspots.find(item => item.id === selectedHotspotId) || selected?.hotspots[0], [selected, selectedHotspotId])

  useEffect(() => {
    Promise.all([api.demo(id), api.latestAI(id)]).then(([value, latest]) => {
      setDemo(value); setSelectedId(value.steps[0]?.id || null); setSelectedHotspotId(value.steps[0]?.hotspots[0]?.id || null); setAIJob(latest)
    }).catch(value => setError(value.message))
  }, [id])
  useEffect(() => {
    const active = jobs.some(job => job.status === 'queued' || job.status === 'running')
    if (!active) return
    const timer = window.setInterval(async () => setJobs(await Promise.all(jobs.map(job => job.status === 'complete' || job.status === 'failed' ? job : api.export(job.id)))), 1500)
    return () => clearInterval(timer)
  }, [jobs])
  useEffect(() => {
    if (!aiJob || !['queued', 'running'].includes(aiJob.status)) return
    const timer = window.setInterval(async () => {
      const next = await api.aiJob(aiJob.id)
      setAIJob(next)
      if (next.status === 'complete') {
        const fresh = await api.demo(id); setDemo(fresh); setNotice('AI 智能编排已完成。')
      }
      if (next.status === 'failed') setError(next.error || 'AI 生成失败')
    }, 1800)
    return () => clearInterval(timer)
  }, [aiJob?.id, aiJob?.status, id])

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
  function updateStepLocal(stepId: string, values: Partial<Step>) {
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === stepId ? { ...step, ...values } : step) } : current)
  }
  function updateHotspotLocal(values: Partial<HotspotData>, target = selectedHotspot) {
    if (!selected || !target) return
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: step.hotspots.map(item => item.id === target.id ? { ...item, ...values } : item) } : step) } : current)
  }
  async function patchHotspot(values: Partial<HotspotData>, target = selectedHotspot) {
    if (!selected || !target) return
    updateHotspotLocal(values, target)
    try {
      const updated = await api.updateHotspot(id, selected.id, target.id, values)
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: step.hotspots.map(item => item.id === updated.id ? updated : item) } : step) } : current)
    } catch (value) { setError((value as Error).message) }
  }
  async function chooseTarget(selection: { selector: SelectorInfo; rect: Rect }) {
    if (!selected) return
    if (selectedHotspot) {
      await patchHotspot({ selector: selection.selector, fallback_rect: selection.rect })
    } else {
      const created = await api.createHotspot(id, selected.id, { selector: selection.selector, fallback_rect: selection.rect, trigger: 'click', action: { type: 'next' }, tooltip: defaultTooltip, style: defaultStyle })
      setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: [...step.hotspots, created] } : step) } : current)
      setSelectedHotspotId(created.id)
    }
    setTab('hotspot')
  }
  async function addHotspot() {
    if (!selected) return
    const created = await api.createHotspot(id, selected.id, { selector: {}, fallback_rect: { x: .5, y: .5, w: .08, h: .06 }, trigger: 'click', action: { type: 'next' }, tooltip: defaultTooltip, style: defaultStyle })
    setDemo(current => current ? { ...current, steps: current.steps.map(step => step.id === selected.id ? { ...step, hotspots: [...step.hotspots, created] } : step) } : current)
    setSelectedHotspotId(created.id); setTab('hotspot'); setCanvasMode('edit')
  }
  async function move(stepId: string, offset: number) {
    if (!demo) return
    const steps = [...demo.steps], from = steps.findIndex(step => step.id === stepId), to = from + offset
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
    setDemo(current => current ? { ...current, steps: [...current.steps, step] } : current); setSelectedId(step.id); setSelectedHotspotId(step.hotspots[0]?.id || null)
  }
  async function publish() {
    try { setDemo(await api.publish(id)); setNotice('发布成功，公开版本已更新。') } catch (value) { setError((value as Error).message) }
  }
  async function copyMarkdown() {
    if (!demo?.share_url) return
    const token = demo.share_url.split('/').pop(), response = await fetch(`${API_URL}/public/${token}/markdown`)
    await copyText(await response.text()); setNotice('Markdown 已复制到剪贴板。')
  }
  async function startExport(kind: ExportJob['kind']) {
    try { const job = await api.createExport(id, kind); setJobs(current => [job, ...current.filter(item => item.kind !== kind)]) } catch (value) { setError((value as Error).message) }
  }
  async function generateAI(stepId?: string) {
    try { setAIJob(await api.generateAI(id, stepId)); setTab('ai') } catch (value) { setError((value as Error).message) }
  }

  function defaultZoomRect(step: Step): Rect {
    const hotspot = step.hotspots[0]?.fallback_rect
    if (!hotspot) return { x: .5, y: .5, w: .5, h: .5 }
    const w = Math.min(.9, Math.max(.32, hotspot.w * 3.5))
    const h = Math.min(.9, Math.max(.28, hotspot.h * 4))
    return {
      x: Math.max(w / 2, Math.min(1 - w / 2, hotspot.x)),
      y: Math.max(h / 2, Math.min(1 - h / 2, hotspot.y)),
      w, h,
    }
  }

  function setZoomRect(step: Step, rect: Rect) {
    patchStep(step.id, {
      animation: {
        ...(step.animation || {}),
        zoom: { ...(step.animation?.zoom || {}), enabled: true, duration_ms: step.animation?.zoom?.duration_ms || 3000, rect },
      },
    })
  }

  if (!demo) return <main className="page"><Link to="/">← 返回</Link><div className="center-page">{error || '正在加载…'}</div></main>
  return <main className="editor-page">
    <div className="editor-topbar">
      <Link to="/" className="back">← 我的演示</Link>
      <div className="editor-meta"><input value={demo.title} onChange={event => setDemo({ ...demo, title: event.target.value })} onBlur={() => patchDemo({ title: demo.title })} /><span className={`status ${demo.status}`}>{demo.status === 'published' ? '已发布' : '草稿'}</span></div>
      <div className="toolbar-actions">{demo.share_url && <a className="secondary button icon-button" href={demo.share_url} target="_blank"><Icon name="play" />预览</a>}{demo.ai_enabled && <button className="secondary icon-button" onClick={() => generateAI()}><Icon name="ai" />AI 优化</button>}<button className="primary icon-button" onClick={publish}><Icon name="publish" />发布与共享</button></div>
    </div>
    {error && <div className="toast error" onClick={() => setError('')}>{error}</div>}{notice && <div className="toast success" onClick={() => setNotice('')}>{notice}</div>}
    <div className="editor-layout">
      <aside className="step-list">
        <div className="panel-heading"><span>步骤资源</span><small>{demo.steps.length}</small></div><label className="upload-button icon-button"><Icon name="image" />添加截图<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => event.target.files?.[0] && upload(event.target.files[0])} /></label>
        {demo.steps.map((step, index) => <button className={`step-item ${selected?.id === step.id ? 'active' : ''}`} key={step.id} onClick={() => { setSelectedId(step.id); setSelectedHotspotId(step.hotspots[0]?.id || null) }}><span>{index + 1}</span><img src={step.image_url} /><div>{step.title || `步骤 ${index + 1}`}<small>{step.render_mode === 'dom' ? 'DOM' : '图片'}</small></div></button>)}
      </aside>
      <section className="editor-main">
        {selected ? <>
          <div className="stage-toolbar"><span>{selected.render_mode === 'dom' ? 'HTML Clone · 可交互预览' : '图片 Slide'}</span><div className="stage-mode-switch"><button className={canvasMode === 'preview' ? 'active' : ''} onClick={() => setCanvasMode('preview')}><Icon name="play" />预览</button><button className={canvasMode === 'edit' ? 'active' : ''} onClick={() => setCanvasMode('edit')}><Icon name="target" />编辑热点</button></div>{selected.snapshot_url && <button className="icon-button" onClick={() => patchStep(selected.id, { render_mode: selected.render_mode === 'dom' ? 'image' : 'dom' })}><Icon name="image" />{selected.render_mode === 'dom' ? '图片模式' : 'DOM 模式'}</button>}<button className="icon-button" onClick={addHotspot}><Icon name="plus" />Hotspot</button></div>
          {visibleCaptureWarnings(selected.capture_warnings).map((warning, index) => <div className="capture-warning" key={index}><Icon name="warning" />{warning}</div>)}
          <SlideStage key={selected.id}
            step={selected} mode={canvasMode === 'preview' ? 'player' : 'editor'} theme={demo.theme} navigation={demo.navigation}
            stepIndex={demo.steps.findIndex(step => step.id === selected.id)} stepCount={demo.steps.length} activeHotspotId={selectedHotspot?.id}
            onHotspot={canvasMode === 'preview' ? item => { setSelectedHotspotId(item.id); setTab('tooltip'); setCanvasMode('edit') } : undefined}
            onGuidePrevious={canvasMode === 'preview' ? () => { const index = demo.steps.findIndex(step => step.id === selected.id); const target = demo.steps[Math.max(0, index - 1)]; if (target) { setSelectedId(target.id); setSelectedHotspotId(target.hotspots[0]?.id || null) } } : undefined}
            onGuideNext={canvasMode === 'preview' ? () => { const index = demo.steps.findIndex(step => step.id === selected.id); const target = demo.steps[Math.min(demo.steps.length - 1, index + 1)]; if (target) { setSelectedId(target.id); setSelectedHotspotId(target.hotspots[0]?.id || null) } } : undefined}
            onSelectHotspot={canvasMode === 'edit' ? item => { setSelectedHotspotId(item.id); setTab('hotspot') } : undefined}
            onTarget={canvasMode === 'edit' ? chooseTarget : undefined}
            onRectChange={canvasMode === 'edit' ? (item, rect) => { setSelectedHotspotId(item.id); patchHotspot({ fallback_rect: rect }, item) } : undefined}
            showZoomEditor={tab === 'animation' && canvasMode === 'edit'}
            onZoomRectChange={rect => setZoomRect(selected, rect)}
            onZoomDelete={() => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: undefined } })}
          />
          <div className="inline-actions step-order action-category"><span>步骤操作</span><button className="icon-button" onClick={() => move(selected.id, -1)}><Icon name="arrowUp" />上移</button><button className="icon-button" onClick={() => move(selected.id, 1)}><Icon name="arrowDown" />下移</button><button className="danger icon-button" onClick={async () => { await api.deleteStep(id, selected.id); const fresh = await api.demo(id); setDemo(fresh); setSelectedId(fresh.steps[0]?.id || null) }}><Icon name="delete" />删除步骤</button></div>
        </> : <div className="empty editor-empty"><h2>添加第一个步骤</h2><p>使用浏览器扩展录制 DOM 演示，或手动添加截图。</p></div>}
      </section>
      <aside className="publish-panel inspector-panel">
        <div className="inspector-tabs">{inspectorTabs.filter(item => item.value !== 'ai' || demo.ai_enabled).map(item => <button className={tab === item.value ? 'active' : ''} key={item.value} onClick={() => { setTab(item.value); if (item.value === 'animation') setCanvasMode('edit') }}><Icon name={item.icon} /><span>{item.label}</span></button>)}</div>
        {tab === 'content' && selected && <div className="inspector-body">
          <InspectorSection icon="text" title="步骤文案" description="用于播放器、文档和导出内容">
            <label>步骤标题<input value={selected.title} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, title: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { title: selected.title })} /></label>
            <label>操作说明<textarea value={selected.body} onChange={event => setDemo({ ...demo, steps: demo.steps.map(step => step.id === selected.id ? { ...step, body: event.target.value } : step) })} onBlur={() => patchStep(selected.id, { body: selected.body })} /></label>
          </InspectorSection>
          <InspectorSection icon="clock" title="播放节奏" description="控制视频导出时本步骤的停留时长">
            <label>停留时间（秒）<input type="number" min="1" max="15" step=".5" value={selected.duration} onChange={event => patchStep(selected.id, { duration: Number(event.target.value) })} /></label>
          </InspectorSection>
          {demo.ai_enabled && <InspectorSection icon="ai" title="智能文案" description="仅重新生成当前步骤，不影响其他步骤"><button className="icon-button" onClick={() => generateAI(selected.id)}><Icon name="ai" />AI 重新生成本步骤</button></InspectorSection>}
        </div>}
        {tab === 'hotspot' && <div className="inspector-body">
          <InspectorSection icon="target" title="热点对象" description="一个步骤可以配置多个交互区域">
            <div className="hotspot-list">{selected?.hotspots.map((item, index) => <button className={item.id === selectedHotspot?.id ? 'active' : ''} onClick={() => setSelectedHotspotId(item.id)} key={item.id}><Icon name="target" size={13} />热点 {index + 1}</button>)}</div>
            <button className="icon-button" onClick={addHotspot}><Icon name="plus" />添加热点</button>
          </InspectorSection>
          {selectedHotspot ? <>
            <InspectorSection icon="cursor" title="交互行为" description="设置用户如何触发以及触发后的动作">
              <p className="field-note">切换到“编辑热点”后，在中间页面点击元素可重新绑定目标。</p>
              <label>触发方式<select value={selectedHotspot.trigger} onChange={event => patchHotspot({ trigger: event.target.value as 'click' | 'hover' })}><option value="click">点击</option><option value="hover">悬停</option></select></label>
              <label>触发动作<select value={selectedHotspot.action.type} onChange={event => patchHotspot({ action: { ...selectedHotspot.action, type: event.target.value as HotspotData['action']['type'] } })}><option value="next">进入下一步</option><option value="goto">跳转到指定步骤</option><option value="link">打开外部链接</option><option value="end">结束演示</option></select></label>
              {selectedHotspot.action.type === 'goto' && <label>目标步骤<select value={selectedHotspot.action.target_step_id || ''} onChange={event => patchHotspot({ action: { ...selectedHotspot.action, target_step_id: event.target.value } })}>{demo.steps.map((step, index) => <option value={step.id} key={step.id}>{index + 1}. {step.title}</option>)}</select></label>}
              {selectedHotspot.action.type === 'link' && <label>链接地址<input value={selectedHotspot.action.url || ''} placeholder="https://" onChange={event => patchHotspot({ action: { ...selectedHotspot.action, url: event.target.value } })} /></label>}
            </InspectorSection>
            <InspectorSection icon="move" title="位置与尺寸" description="相对于录制视口的坐标和大小">
              <div className="rect-grid">{(['x', 'y', 'w', 'h'] as const).map(key => <label key={key}>{key.toUpperCase()}<input type="number" min="0" max="1" step=".01" value={selectedHotspot.fallback_rect[key].toFixed(2)} onChange={event => patchHotspot({ fallback_rect: { ...selectedHotspot.fallback_rect, [key]: Number(event.target.value) } })} /></label>)}</div>
            </InspectorSection>
            <InspectorSection icon="palette" title="热点外观" description="高亮区域、动画和遮罩效果">
              <label>形状<select value={selectedHotspot.style.shape} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, shape: event.target.value as 'rectangle' | 'circle' } })}><option value="rectangle">圆角矩形</option><option value="circle">圆形</option></select></label>
              <ColorField label="热点颜色" value={selectedHotspot.style.color || '#635bff'} onChange={value => patchHotspot({ style: { ...selectedHotspot.style, color: value } })} />
              <div className="toggle-list"><label className="check"><input type="checkbox" checked={selectedHotspot.style.pulse} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, pulse: event.target.checked } })} /><span><strong>呼吸动画</strong><small>循环显示热点轮廓</small></span></label>
              <label className="check"><input type="checkbox" checked={selectedHotspot.style.spotlight} onChange={event => patchHotspot({ style: { ...selectedHotspot.style, spotlight: event.target.checked } })} /><span><strong>聚光灯遮罩</strong><small>弱化热点之外的页面内容</small></span></label></div>
            </InspectorSection>
            <InspectorSection icon="delete" title="危险操作" tone="danger"><button className="danger icon-button" onClick={async () => { await api.deleteHotspot(id, selected!.id, selectedHotspot.id); const fresh = await api.demo(id); setDemo(fresh); setSelectedHotspotId(fresh.steps.find(step => step.id === selected!.id)?.hotspots[0]?.id || null) }}><Icon name="delete" />删除当前热点</button></InspectorSection>
          </> : null}
        </div>}
        {tab === 'tooltip' && selectedHotspot && <div className="inspector-body">
          <InspectorSection icon="message" title="引导文案" description="展示在热点旁的操作提示"><label>提示内容<textarea value={selectedHotspot.tooltip.content} onChange={event => updateHotspotLocal({ tooltip: { ...selectedHotspot.tooltip, content: event.target.value } })} onBlur={() => patchHotspot({ tooltip: selectedHotspot.tooltip })} /></label></InspectorSection>
          <InspectorSection icon="layout" title="位置与布局" description="自动避让视口边缘，也可以指定方向">
            <label>展示位置<select value={selectedHotspot.tooltip.placement} onChange={event => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, placement: event.target.value } })}>{['auto','top','top-start','top-end','bottom','bottom-start','bottom-end','left','left-start','left-end','right','right-start','right-end'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <RangeField label="热点间距" value={selectedHotspot.tooltip.offset} min={0} max={60} suffix=" px" onChange={value => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, offset: value } })} />
            <label>最大宽度（px）<input type="number" min="160" max="800" value={selectedHotspot.tooltip.max_width} onChange={event => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, max_width: Number(event.target.value) } })} /></label>
          </InspectorSection>
          <InspectorSection icon="eye" title="显示选项"><div className="toggle-list"><label className="check"><input type="checkbox" checked={selectedHotspot.tooltip.show_arrow} onChange={event => patchHotspot({ tooltip: { ...selectedHotspot.tooltip, show_arrow: event.target.checked } })} /><span><strong>显示指向箭头</strong><small>标明引导卡片对应的页面元素</small></span></label></div></InspectorSection>
        </div>}
        {tab === 'theme' && <div className="inspector-body">
          <InspectorSection icon="palette" title="品牌颜色" description="统一热点、进度和主要操作的视觉颜色">
            <ColorField label="演示主色" value={demo.theme?.primary_color || '#635bff'} onChange={value => patchDemo({ theme: { ...demo.theme, primary_color: value } })} />
          </InspectorSection>
          <InspectorSection icon="message" title="引导卡片" description="控制 Tooltip 的背景和文字对比度">
            <ColorField label="卡片背景" value={demo.theme?.tooltip?.background || '#ffffff'} onChange={value => patchDemo({ theme: { ...demo.theme, tooltip: { ...(demo.theme?.tooltip || {}), background: value } } })} />
            <ColorField label="卡片文字" value={demo.theme?.tooltip?.text_color || '#172033'} onChange={value => patchDemo({ theme: { ...demo.theme, tooltip: { ...(demo.theme?.tooltip || {}), text_color: value } } })} />
          </InspectorSection>
          <InspectorSection icon="cursor" title="导航按钮" description="分别配置前后按钮的文案、底色和文字色">
            <div className="field-grid"><label>上一步文字<input value={demo.navigation?.previous_label || '上一步'} onChange={event => patchDemo({ navigation: { ...demo.navigation, previous_label: event.target.value } })} /></label><label>下一步文字<input value={demo.navigation?.next_label || '下一步'} onChange={event => patchDemo({ navigation: { ...demo.navigation, next_label: event.target.value } })} /></label></div>
            <ColorField label="上一步按钮底色" value={demo.navigation?.previous_color || '#ffffff'} onChange={value => patchDemo({ navigation: { ...demo.navigation, previous_color: value } })} />
            <ColorField label="上一步文字颜色" value={demo.navigation?.text_color || '#172033'} onChange={value => patchDemo({ navigation: { ...demo.navigation, text_color: value } })} />
            <ColorField label="下一步按钮底色" value={demo.navigation?.next_color || '#635bff'} onChange={value => patchDemo({ navigation: { ...demo.navigation, next_color: value } })} />
            <ColorField label="下一步文字颜色" value={demo.navigation?.next_text_color || '#ffffff'} onChange={value => patchDemo({ navigation: { ...demo.navigation, next_text_color: value } })} />
            <RangeField label="按钮圆角" value={demo.navigation?.radius ?? 9} min={0} max={24} suffix=" px" onChange={value => patchDemo({ navigation: { ...demo.navigation, radius: value } })} />
          </InspectorSection>
          <InspectorSection icon="eye" title="显示控制"><div className="toggle-list">
            <label className="check"><input type="checkbox" checked={demo.navigation?.show_previous !== false} onChange={event => patchDemo({ navigation: { ...demo.navigation, show_previous: event.target.checked } })} /><span><strong>显示上一步</strong></span></label>
            <label className="check"><input type="checkbox" checked={demo.navigation?.show_next !== false} onChange={event => patchDemo({ navigation: { ...demo.navigation, show_next: event.target.checked } })} /><span><strong>显示下一步</strong></span></label>
            <label className="check"><input type="checkbox" checked={demo.navigation?.show_progress !== false} onChange={event => patchDemo({ navigation: { ...demo.navigation, show_progress: event.target.checked } })} /><span><strong>显示步骤进度</strong></span></label>
          </div></InspectorSection>
        </div>}
        {tab === 'animation' && selected && <div className="inspector-body">
          <InspectorSection icon="animation" title="Zoom and Pan" description="框选页面区域，在播放步骤时自动聚焦并放大">
            {selected.animation?.zoom?.rect ? <>
              <div className="animation-status"><span><i />Zoom 区域已启用</span><small>可直接在画布中拖动或缩放选区</small></div>
              <label>Zoom Preview 时长（ms）<input type="number" min="500" max="10000" step="250" value={selected.animation.zoom.duration_ms || 3000} onChange={event => updateStepLocal(selected.id, { animation: { ...(selected.animation || {}), zoom: { ...selected.animation.zoom, duration_ms: Number(event.target.value) } } })} onBlur={() => patchStep(selected.id, { animation: selected.animation })} /></label>
              <button className="danger icon-button" onClick={() => patchStep(selected.id, { animation: { ...(selected.animation || {}), zoom: undefined } })}><Icon name="delete" />删除 Zoom 区域</button>
            </> : <>
              <p className="field-note">添加后可在中间画布自由拖动和缩放框选区域；操作栏可预览 3 秒缩放效果，并检查是否包含主要 Hotspot。</p>
              <button className="primary icon-button" onClick={() => setZoomRect(selected, defaultZoomRect(selected))}><Icon name="plus" />添加 Zoom 区域</button>
            </>}
          </InspectorSection>
          <InspectorSection icon="play" title="Autoplay" description="让发布后的演示无需点击即可连续播放">
            <div className="toggle-list"><label className="check"><input type="checkbox" checked={demo.playback?.autoplay === true} onChange={event => patchDemo({ playback: { ...demo.playback, autoplay: event.target.checked } })} /><span><strong>自动播放</strong><small>按下方时间自动切换步骤</small></span></label></div>
            <div className="field-grid">
              <label>Step Duration (ms)<input type="number" min="250" max="60000" step="250" value={demo.playback?.step_duration_ms ?? 2000} onChange={event => setDemo({ ...demo, playback: { ...demo.playback, step_duration_ms: Number(event.target.value) } })} onBlur={() => patchDemo({ playback: demo.playback })} /></label>
              <label>Transition Delay (ms)<input type="number" min="0" max="30000" step="250" value={demo.playback?.transition_delay_ms ?? 1000} onChange={event => setDemo({ ...demo, playback: { ...demo.playback, transition_delay_ms: Number(event.target.value) } })} onBlur={() => patchDemo({ playback: demo.playback })} /></label>
            </div>
            <div className="toggle-list"><label className="check"><input type="checkbox" checked={demo.playback?.loop === true} onChange={event => patchDemo({ playback: { ...demo.playback, loop: event.target.checked } })} /><span><strong>Loop content</strong><small>Repeat in a loop with continuous playback.</small></span></label></div>
          </InspectorSection>
        </div>}
        {tab === 'ai' && <div className="inspector-body">
          <InspectorSection icon="ai" title="智能生成" description="分析整套流程并补全标题、说明和热点提示">
            <button className="primary icon-button" disabled={Boolean(aiJob && ['queued','running'].includes(aiJob.status))} onClick={() => generateAI()}><Icon name="ai" />生成整套演示文案</button>
            <p className="field-note">任务在后台运行，不会阻塞浏览器扩展继续录制。</p>
          </InspectorSection>
          {aiJob && <InspectorSection icon="settings" title="最近任务"><div className={`ai-job ${aiJob.status}`}><strong>{aiJob.status === 'complete' ? 'AI 已完成' : aiJob.status === 'failed' ? 'AI 失败' : 'AI 后台处理中'}</strong><span>{aiJob.progress}% · {aiJob.model}</span>{aiJob.status === 'complete' && aiJob.can_revert && <button onClick={async () => { setAIJob(await api.revertAI(aiJob.id)); setDemo(await api.demo(id)) }}>撤销 AI 修改</button>}</div></InspectorSection>}
          {(selected?.ai_metadata?.warnings?.length || selected?.ai_metadata?.redundant) && <InspectorSection icon="warning" title="AI 建议">
            {selected?.ai_metadata?.warnings?.map((warning, index) => <div className="ai-warning" key={index}><Icon name="warning" />{warning}</div>)}
            {selected?.ai_metadata?.redundant && <div className="ai-warning"><Icon name="warning" />AI 认为此步骤可能冗余，请人工确认。</div>}
          </InspectorSection>}
          <InspectorSection icon="eye" title="数据与覆盖规则"><p className="field-note">AI 只接收脱敏文字和缩略图，不会覆盖已经手动修改的字段。</p></InspectorSection>
        </div>}
        <div className="output-section"><h3><Icon name="share" />发布、共享与导出</h3><textarea value={demo.description} onChange={event => setDemo({ ...demo, description: event.target.value })} onBlur={() => patchDemo({ description: demo.description })} placeholder="演示简介" />
          <div className="output-grid"><button className="icon-button" disabled={!demo.share_url} onClick={copyMarkdown}><Icon name="copy" />复制 Markdown</button><button className="icon-button" disabled={!demo.share_url} onClick={() => startExport('markdown')}><Icon name="download" />文档图片包</button><button className="icon-button" disabled={!demo.share_url} onClick={() => startExport('pdf')}><Icon name="download" />PDF</button><button className="icon-button" disabled={!demo.share_url} onClick={() => startExport('mp4')}><Icon name="download" />MP4</button></div>
          {jobs.map(job => <div className="job" key={job.id}><span>{job.kind.toUpperCase()}</span><span>{job.status === 'complete' ? <a href={`${API_URL}${job.download_url}`}>下载</a> : job.status === 'failed' ? '失败' : `${job.progress}%`}</span></div>)}
        </div>
      </aside>
    </div>
  </main>
}
