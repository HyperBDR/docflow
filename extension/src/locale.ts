import type { Locale } from './types'

export function browserLocale(): Locale {
  const language = chrome.i18n?.getUILanguage?.() || navigator.language || 'en'
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const messages = {
  zh: {
    apiAddress: 'DocFlow API 地址', pairingCode: '六位配对码', connect: '连接账号', chooseDemo: '选择演示',
    openRecorder: '开始录制当前标签页', disconnect: '断开账号', connectionExpired: '连接已失效，请重新配对。',
    invalidCode: '配对码无效或已过期', createDemoFirst: '请先在 DocFlow 网页中创建演示。', setupOpened: '请在当前页面完成录制设置。', setupHint: '录制模式、AI 和快速教学将在当前页面中打开。',
    recording: '正在录制', paused: '录制已暂停', capturing: '正在处理，请稍候…', uploading: '正在上传 HTML、CSS 和截图…',
    htmlMode: 'HTML Cloning 模式', screenshotMode: '截图模式', steps: '个步骤', pause: '暂停', resume: '继续', stop: '停止录制', finishing: '正在结束…',
    setupTitle: '设置录制方式', setupDescription: '选择适合当前页面的捕获方式，并决定是否使用 AI 自动生成文案。',
    htmlTitle: 'HTML Cloning', htmlDescription: '克隆完整 HTML 与 CSS，生成像素级、可编辑的交互步骤。', htmlBadge: '推荐',
    screenshotTitle: 'Screenshot', screenshotDescription: '保存静态页面截图，适合 Canvas、视频或复杂页面。',
    aiTitle: 'AI 自动生成引导文案', aiDescription: '在后台生成步骤标题、描述和热点提示，不会阻塞录制。', aiUnavailable: '服务端尚未配置 AI',
    startSetup: '开始录制', cancel: '取消', tutorialTitle: '录制使用指南', back: '上一步', next: '下一步', getStarted: 'Get Started',
    hoverTitle: '悬停，然后点击捕获', hoverDescription: '鼠标悬停时元素会高亮。点击即可捕获步骤并将热点锚定到该元素。',
    pauseTitle: '两次点击之间暂停 1–2 秒', pauseDescription: 'HTML 捕获会克隆每一页完整的 HTML 和 CSS。短暂停顿可确保每个步骤处理完整。',
    stopTitle: '完成后停止录制', stopDescription: '你将获得像素级、可交互的页面副本。所有元素都可以编辑，无需重新录制。',
    selectElement: '悬停并点击元素以捕获', manualCapture: '手动截图', manualTooltip: '手动捕获当前页面，不创建热点', manualTitle: '手动捕获当前页面', manualBody: '查看当前页面后继续下一步。',
    stopTooltip: '停止录制并打开编辑器', pauseTooltip: '暂停或继续录制', dragTooltip: '拖动录制控制条', captureFailed: '捕获失败',
  },
  en: {
    apiAddress: 'DocFlow API URL', pairingCode: '6-digit pairing code', connect: 'Connect account', chooseDemo: 'Choose a demo',
    openRecorder: 'Start recording this tab', disconnect: 'Disconnect account', connectionExpired: 'Connection expired. Pair the extension again.',
    invalidCode: 'The pairing code is invalid or expired.', createDemoFirst: 'Create a demo in DocFlow first.', setupOpened: 'Finish recording setup on the current page.', setupHint: 'Recording mode, AI, and a quick tutorial will open directly on the page.',
    recording: 'Recording', paused: 'Recording paused', capturing: 'Capturing, please wait…', uploading: 'Uploading HTML, CSS and screenshot…',
    htmlMode: 'HTML Cloning mode', screenshotMode: 'Screenshot mode', steps: 'Steps', pause: 'Pause', resume: 'Resume', stop: 'Stop Recording', finishing: 'Finishing…',
    setupTitle: 'Set up recording', setupDescription: 'Choose how to capture this page and whether AI should generate the guide copy.',
    htmlTitle: 'HTML Cloning', htmlDescription: 'Clone full HTML and CSS for pixel-perfect, editable interactive steps.', htmlBadge: 'Recommended',
    screenshotTitle: 'Screenshot', screenshotDescription: 'Save a static screen image for Canvas, video, or highly complex pages.',
    aiTitle: 'Generate guide copy with AI', aiDescription: 'Generate titles, descriptions, and hotspot tips in the background without blocking capture.', aiUnavailable: 'AI is not configured on the server',
    startSetup: 'Start recording', cancel: 'Cancel', tutorialTitle: 'How recording works', back: 'Back', next: 'Next', getStarted: 'Get Started',
    hoverTitle: 'Hover, then click to capture', hoverDescription: 'Elements highlight as you hover. Click to capture the step and anchor your hotspot.',
    pauseTitle: 'Pause 1–2 seconds between clicks', pauseDescription: 'HTML capture clones each page’s full HTML and CSS. A brief pause ensures every step processes cleanly.',
    stopTitle: 'Stop recording when done', stopDescription: 'You’ll get a pixel-perfect, fully interactive clone. Every element is editable, no re-recording needed.',
    selectElement: 'Hover and click an element to capture', manualCapture: 'Manual capture', manualTooltip: 'Manually capture this screen without hotspots', manualTitle: 'Manually captured screen', manualBody: 'Review this screen, then continue to the next step.',
    stopTooltip: 'Stop recording and open the editor', pauseTooltip: 'Pause or resume recording', dragTooltip: 'Drag the recording controls', captureFailed: 'Capture failed',
  },
} as const

export type MessageKey = keyof typeof messages.en
export function tr(locale: Locale, key: MessageKey): string { return messages[locale][key] }
