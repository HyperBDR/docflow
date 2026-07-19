import type { WorkspaceQuotaSummary } from './quota'
import type { Locale } from './types'

const copy = {
  en: {
    title: 'AI Enhancement',
    subtitle: 'Use AI to create natural, flowing descriptions for your demo steps.',
    enable: 'Enable AI Enhancement',
    quotaTitle: 'AI Token quota',
    quotaUsed: '{{used}} / {{limit}} used',
    quotaRemaining: '{{remaining}} remaining',
    unlimited: 'Unlimited',
    resets: 'Resets {{date}}',
    contextLabel: 'What is this demo about?',
    contextHelp: 'Helps the AI generate more relevant text (Optional).',
    contextPlaceholder: 'e.g. This demo shows new team members how to create a project, invite collaborators, and publish their first guide.',
    sensitiveHint: 'Do not include passwords or sensitive information.',
    languageLabel: 'Language',
    languageHelp: 'Choose the language for AI-generated titles, descriptions, and hotspot tips.',
    chinese: 'Simplified Chinese',
    english: 'English',
    cancel: 'Cancel',
    save: 'Save settings',
    enabled: 'On',
    disabled: 'Off',
    quotaReached: 'Quota reached',
    checking: 'Checking quota…',
    close: 'Close AI settings',
  },
  'zh-CN': {
    title: 'AI 增强',
    subtitle: '使用 AI 为演示步骤生成自然、连贯的引导文案。',
    enable: '启用 AI 增强',
    quotaTitle: 'AI Token 配额',
    quotaUsed: '已使用 {{used}} / {{limit}}',
    quotaRemaining: '剩余 {{remaining}}',
    unlimited: '无限额',
    resets: '{{date}} 重置',
    contextLabel: '这个演示主要介绍什么？',
    contextHelp: '帮助 AI 生成更贴合业务场景的文案，可选填写。',
    contextPlaceholder: '例如：向新成员演示如何创建项目、邀请协作者并发布第一个操作指南。',
    sensitiveHint: '请勿填写密码、Token 或其他敏感信息。',
    languageLabel: '生成语言',
    languageHelp: '用于 AI 生成的标题、步骤说明和热点提示。',
    chinese: '简体中文',
    english: 'English',
    cancel: '取消',
    save: '保存设置',
    enabled: '已开启',
    disabled: '未开启',
    quotaReached: '配额不足',
    checking: '正在检查配额…',
    close: '关闭 AI 设置',
  },
} as const satisfies Record<Locale, Record<string, string>>

export type AITextKey = keyof typeof copy.en

export function aiText(locale: Locale, key: AITextKey, values: Record<string, string | number> = {}) {
  let result: string = copy[locale][key]
  for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{{${name}}}`, String(value))
  return result
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function number(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function date(value: string | undefined, locale: Locale) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parsed)
}

function warningIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/></svg>'
}

export type AISettingsViewProps = {
  locale: Locale
  enabled: boolean
  allowed: boolean
  loading: boolean
  context: string
  contentLocale: Locale
  quota: WorkspaceQuotaSummary | null
  unavailableReason: string
}

export function aiSettingsView(value: AISettingsViewProps) {
  const item = value.quota?.items.find(entry => entry.key === 'monthly_ai_tokens')
  const limit = item?.limit
  const remaining = limit === null || limit === undefined ? null : Math.max(0, limit - Number(item?.used || 0))
  const percent = limit ? Math.min(100, Math.max(0, Number(item?.percent || 0))) : 0
  const tone = !value.allowed ? 'blocked' : item?.status || 'normal'
  const usage = item && typeof limit === 'number'
    ? aiText(value.locale, 'quotaUsed', { used: number(item.used, value.locale), limit: number(limit, value.locale) })
    : aiText(value.locale, 'unlimited')
  const quotaBody = value.loading
    ? `<div class="ai-quota-loading"><span></span>${aiText(value.locale, 'checking')}</div>`
    : item
      ? `<div class="ai-quota-numbers"><strong>${usage}</strong><span>${remaining === null ? aiText(value.locale, 'unlimited') : aiText(value.locale, 'quotaRemaining', { remaining: number(remaining, value.locale) })}</span></div>${limit === null ? '' : `<div class="ai-quota-progress"><i style="width:${percent}%"></i></div>`}<small>${aiText(value.locale, 'resets', { date: date(value.quota?.period.resets_at, value.locale) })}</small>`
      : `<div class="ai-quota-loading">${escapeHtml(value.unavailableReason)}</div>`
  const alert = !value.loading && !value.allowed && value.unavailableReason
    ? `<div class="ai-quota-alert">${warningIcon()}<span>${escapeHtml(value.unavailableReason)}</span></div>`
    : ''

  return `<div class="ai-config-head"><div><h2>${aiText(value.locale, 'title')}</h2><p>${aiText(value.locale, 'subtitle')}</p></div><button id="ai-config-close" aria-label="${aiText(value.locale, 'close')}">×</button></div>
    <div class="ai-config-body">
      <label class="ai-enable-row"><span class="ai-dialog-switch"><input id="ai-config-toggle" type="checkbox" ${value.enabled ? 'checked' : ''} ${value.allowed && !value.loading ? '' : 'disabled'}><i></i></span><strong>${aiText(value.locale, 'enable')}</strong></label>
      <section class="ai-quota-panel ${tone}" aria-live="polite"><header><strong>${aiText(value.locale, 'quotaTitle')}</strong>${limit !== null && limit !== undefined ? `<em>${Math.round(percent)}%</em>` : ''}</header>${quotaBody}${alert}</section>
      <label class="ai-context-field"><strong>${aiText(value.locale, 'contextLabel')}</strong><small>${aiText(value.locale, 'contextHelp')}</small><textarea id="ai-context" maxlength="500" placeholder="${escapeHtml(aiText(value.locale, 'contextPlaceholder'))}">${escapeHtml(value.context)}</textarea><span><small>${aiText(value.locale, 'sensitiveHint')}</small><em id="ai-context-count">${value.context.length}/500</em></span></label>
      <fieldset class="ai-language-field"><legend>${aiText(value.locale, 'languageLabel')}</legend><select id="ai-language"><option value="zh-CN" ${value.contentLocale === 'zh-CN' ? 'selected' : ''}>${aiText(value.locale, 'chinese')}</option><option value="en" ${value.contentLocale === 'en' ? 'selected' : ''}>${aiText(value.locale, 'english')}</option></select></fieldset>
      <p class="ai-language-help">${aiText(value.locale, 'languageHelp')}</p>
    </div>
    <div class="actions"><button class="btn" id="ai-config-cancel">${aiText(value.locale, 'cancel')}</button><button class="btn primary" id="ai-config-save">${aiText(value.locale, 'save')}</button></div>`
}

export const aiSettingsStyles = `
  .ai-config-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:26px 32px 18px;border-bottom:1px solid #edf0f4}.ai-config-head h2{margin-bottom:7px}.ai-config-head p{max-width:500px}.ai-config-head>button{width:32px;height:32px;display:grid;place-items:center;flex:0 0 auto;border:0;border-radius:9px;color:#778195;background:#f3f5f8;font:400 24px/1 system-ui;cursor:pointer}.ai-config-head>button:hover{color:#3f4755;background:#e9ecf1}
  .ai-config-body{display:grid;gap:15px;padding:20px 32px 24px}.ai-enable-row{display:flex;align-items:center;gap:10px;color:#303a4d;font-size:13px;cursor:pointer}.ai-enable-row:has(input:disabled){cursor:not-allowed}.ai-dialog-switch{position:relative;width:42px;height:24px;flex:0 0 auto}.ai-dialog-switch input{position:absolute;opacity:0}.ai-dialog-switch i{position:absolute;inset:0;border-radius:20px;background:#cbd2dd;box-shadow:inset 0 0 0 1px #929cad33;transition:.2s}.ai-dialog-switch i:after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 4px #0003;transition:.2s}.ai-dialog-switch input:checked+i{background:#635bff;box-shadow:none}.ai-dialog-switch input:checked+i:after{transform:translateX(18px)}.ai-dialog-switch input:disabled+i{opacity:.58}
  .ai-quota-panel{display:grid;gap:8px;padding:13px 14px;border:1px solid #e1e4eb;border-radius:11px;background:#fafbfc}.ai-quota-panel>header,.ai-quota-numbers{display:flex;align-items:center;justify-content:space-between;gap:10px}.ai-quota-panel>header strong{font-size:11px}.ai-quota-panel>header em{color:#657084;font-size:10px;font-style:normal;font-weight:800}.ai-quota-numbers strong{color:#3d485b;font-size:11px}.ai-quota-numbers span,.ai-quota-panel>small{color:#748095;font-size:9.5px}.ai-quota-progress{height:6px;overflow:hidden;border-radius:999px;background:#e5e8ef}.ai-quota-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#7b70f4,#5c50df);transition:width .25s}.ai-quota-panel.warning{border-color:#eed49d;background:#fffaf1}.ai-quota-panel.warning .ai-quota-progress i{background:linear-gradient(90deg,#f3b449,#db8c16)}.ai-quota-panel.blocked{border-color:#e7ad4f;background:#fff8ec;box-shadow:0 0 0 3px #e7ad4f14}.ai-quota-panel.blocked .ai-quota-progress i{background:linear-gradient(90deg,#ec9a22,#d97706)}.ai-quota-loading{display:flex;align-items:center;gap:7px;color:#748095;font-size:10px}.ai-quota-loading>span{width:12px;height:12px;border:2px solid #d6d9e2;border-top-color:#635bff;border-radius:50%;animation:aiSpin .7s linear infinite}.ai-quota-alert{display:grid;grid-template-columns:17px minmax(0,1fr);align-items:start;gap:7px;padding-top:8px;border-top:1px solid #edce94;color:#8a570e;font-size:10px;font-weight:700;line-height:1.45;white-space:pre-line}.ai-quota-alert svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  .ai-context-field{display:grid;gap:5px}.ai-context-field>strong{font-size:12px}.ai-context-field>small,.ai-context-field>span small,.ai-language-help{color:#748095;font-size:9.5px;line-height:1.45}.ai-context-field textarea{width:100%;min-height:94px;resize:vertical;padding:11px 12px;border:1px solid #d8dde7;border-radius:10px;color:#273246;background:#fff;font:11px/1.5 inherit;outline:none}.ai-context-field textarea:focus,.ai-language-field:focus-within{border-color:#7368ef;box-shadow:0 0 0 3px #635bff16}.ai-context-field textarea::placeholder{color:#a1a9b6}.ai-context-field>span{display:flex;align-items:center;justify-content:space-between;gap:10px}.ai-context-field>span em{color:#8a94a6;font-size:9px;font-style:normal}.ai-language-field{min-width:0;margin:0;padding:0 10px 7px;border:1px solid #d8dde7;border-radius:10px}.ai-language-field legend{margin-left:5px;padding:0 7px;color:#69758a;background:#fff;font-size:10px;font-weight:750}.ai-language-field select{width:100%;height:37px;border:0;color:#344054;background:#fff;font:600 11px inherit;outline:none;cursor:pointer}.ai-language-help{margin-top:-10px}.ai-config-body+.actions{padding-top:15px}@keyframes aiSpin{to{transform:rotate(360deg)}}
  @media(max-width:620px){.ai-config-head,.ai-config-body{padding-left:18px;padding-right:18px}}
`
