import { useSyncExternalStore } from 'react'

export type Language = 'tr' | 'en'
export type Theme = 'dark' | 'light'
type Preferences = { language: Language; theme: Theme }
const key = 'cinema.preferences'
function read(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
    return { language: saved.language === 'en' ? 'en' : 'tr', theme: saved.theme === 'light' ? 'light' : 'dark' }
  } catch { return { language: 'tr', theme: 'dark' } }
}
let current = read()
const listeners = new Set<() => void>()
export function getPreferences() { return current }
function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = current.theme
  document.documentElement.lang = current.language
  document.title = current.language === 'en' ? 'Cinema — Your story starts here' : 'Cinema — Hikâye seninle başlar'
}
export function setPreferences(next: Partial<Preferences>) {
  current = { ...current, ...next }
  try { localStorage.setItem(key, JSON.stringify(current)) } catch { /* Preferences still work when storage is blocked. */ }
  apply(); listeners.forEach(listener => listener())
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function usePreferences() { return useSyncExternalStore(subscribe, getPreferences) }
apply()
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) { current = read(); apply(); listeners.forEach(listener => listener()) }
})
