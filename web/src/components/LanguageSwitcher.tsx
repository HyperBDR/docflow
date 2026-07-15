import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { applyLocale, normalizeLocale, PUBLIC_LOCALE_KEY, type Locale } from '../i18n'

export default function LanguageSwitcher({ account = false, publicMode = false, compact = false }: { account?: boolean; publicMode?: boolean; compact?: boolean }) {
  const { t, i18n } = useTranslation('common')
  const locale = normalizeLocale(i18n.language)

  async function change(next: Locale) {
    if (next === locale) return
    await applyLocale(next, publicMode ? PUBLIC_LOCALE_KEY : undefined)
    if (publicMode) {
      const url = new URL(window.location.href)
      url.searchParams.set('lang', next)
      window.history.replaceState(null, '', url)
    }
    if (account) api.updateLocale(next).catch(() => undefined)
  }

  return <label className={`language-switcher ${compact ? 'compact' : ''}`} title={t('language.switchTo')}>
    <span aria-hidden>文/A</span>
    <select aria-label={t('language.label')} value={locale} onChange={event => change(event.target.value as Locale)}>
      <option value="zh-CN">{t('language.zh-CN')}</option>
      <option value="en">{t('language.en')}</option>
    </select>
  </label>
}
