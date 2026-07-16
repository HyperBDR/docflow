import type { Locale } from './types'
import zh from './locales/zh-CN.json'
import en from './locales/en.json'

const messages = { 'zh-CN': zh, en } as const

export function browserLocale(): Locale {
  const language = chrome.i18n?.getUILanguage?.() || navigator.language || 'en'
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export type MessageKey = keyof typeof en
export function tr(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), messages[locale][key])
}
