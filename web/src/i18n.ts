import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonZh from './locales/zh-CN/common.json'
import commonEn from './locales/en/common.json'
import authZh from './locales/zh-CN/auth.json'
import authEn from './locales/en/auth.json'
import dashboardZh from './locales/zh-CN/dashboard.json'
import dashboardEn from './locales/en/dashboard.json'
import analyticsZh from './locales/zh-CN/analytics.json'
import analyticsEn from './locales/en/analytics.json'
import playerZh from './locales/zh-CN/player.json'
import playerEn from './locales/en/player.json'
import editorZh from './locales/zh-CN/editor.json'
import editorEn from './locales/en/editor.json'
import accountZh from './locales/zh-CN/account.json'
import accountEn from './locales/en/account.json'
import adminZh from './locales/zh-CN/admin.json'
import adminEn from './locales/en/admin.json'
import workspaceZh from './locales/zh-CN/workspace.json'
import workspaceEn from './locales/en/workspace.json'

export type Locale = 'zh-CN' | 'en'
export const UI_LOCALE_KEY = 'docflow.uiLocale'
export const PUBLIC_LOCALE_KEY = 'docflow.publicLocale'

export function normalizeLocale(value?: string | null): Locale {
  return value?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function detectedLocale(storageKey = UI_LOCALE_KEY): Locale {
  return normalizeLocale(localStorage.getItem(storageKey) || navigator.language)
}

const initialLocale = detectedLocale()

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { common: commonZh, auth: authZh, dashboard: dashboardZh, analytics: analyticsZh, player: playerZh, editor: editorZh, account: accountZh, admin: adminZh, workspace: workspaceZh },
    en: { common: commonEn, auth: authEn, dashboard: dashboardEn, analytics: analyticsEn, player: playerEn, editor: editorEn, account: accountEn, admin: adminEn, workspace: workspaceEn },
  },
  lng: initialLocale,
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
})

document.documentElement.lang = initialLocale

export async function applyLocale(locale: Locale, storageKey = UI_LOCALE_KEY) {
  localStorage.setItem(storageKey, locale)
  document.documentElement.lang = locale
  await i18n.changeLanguage(locale)
}

export function formatDate(value: string | Date, locale: Locale = normalizeLocale(i18n.language)) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function formatNumber(value: number, locale: Locale = normalizeLocale(i18n.language)) {
  return new Intl.NumberFormat(locale).format(value)
}

export default i18n
