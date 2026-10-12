import { t } from './i18n'
import { setPreferences, usePreferences } from './preferences'

export default function HeaderPreferences() {
  const { theme, language } = usePreferences()
  const themeLabel = t(theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç')
  return <div className="header-preferences">
    <button type="button" className="preference-control theme-control" aria-label={themeLabel} title={themeLabel} aria-pressed={theme === 'light'} onClick={() => setPreferences({ theme: theme === 'dark' ? 'light' : 'dark' })}>
      <svg data-icon={theme === 'dark' ? 'moon' : 'sun'} width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'dark' ? <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>}
      </svg>
    </button>
    <button type="button" className="preference-control language-control" aria-label={t(language === 'tr' ? 'İngilizceye geç' : 'Türkçeye geç')} title={t('Dil değiştir')} onClick={() => setPreferences({ language: language === 'tr' ? 'en' : 'tr' })}>
      <span lang="tr" className={language === 'tr' ? 'selected-language' : ''}>TR</span><span aria-hidden="true" className="language-separator">/</span><span lang="en" className={language === 'en' ? 'selected-language' : ''}>EN</span>
    </button>
  </div>
}
