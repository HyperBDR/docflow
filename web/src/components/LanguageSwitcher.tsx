import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { applyLocale, normalizeLocale, PUBLIC_LOCALE_KEY, type Locale } from '../i18n'
import Icon from './Icon'

export default function LanguageSwitcher({ account = false, publicMode = false, compact = false }: { account?: boolean; publicMode?: boolean; compact?: boolean }) {
  const { t, i18n } = useTranslation('common')
  const locale = normalizeLocale(i18n.language)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])

  async function change(next: Locale) {
    setOpen(false)
    if (next === locale) return
    await applyLocale(next, publicMode ? PUBLIC_LOCALE_KEY : undefined)
    if (publicMode) {
      const url = new URL(window.location.href)
      url.searchParams.set('lang', next)
      window.history.replaceState(null, '', url)
    }
    if (account) {
      api.updateLocale(next).then(user => {
        window.dispatchEvent(new CustomEvent('docflow:user-updated', { detail: user }))
      }).catch(() => undefined)
    }
  }

  return <div ref={root} className={`language-menu ${compact ? 'compact' : ''}`}>
    <button type="button" className="header-icon-button" title={t('language.switchTo')} aria-label={t('language.label')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className={`language-current-mark ${locale === 'zh-CN' ? 'zh' : 'en'}`} aria-hidden>{locale === 'zh-CN' ? '中' : 'EN'}</span>
    </button>
    {open && <div className="language-menu-popover" role="menu">
      {(['zh-CN', 'en'] as Locale[]).map(item => <button type="button" role="menuitemradio" aria-checked={item === locale} className={item === locale ? 'active' : ''} key={item} onClick={() => change(item)}>
        <span>{item === 'zh-CN' ? '中' : 'EN'}</span><b>{t(`language.${item}`)}</b>{item === locale && <Icon name="check" size={15} />}
      </button>)}
    </div>}
  </div>
}
