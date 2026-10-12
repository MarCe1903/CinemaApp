import { getPreferences } from './preferences'

export interface Movie { id: number; title: string; tagline: string; description: string; genre: string; art: string; duration: number; age: string; rating: number; director: string; posterUrl?: string | null }
export interface User { id: string; displayName: string; email: string; userName: string; roles: string[] }
export interface Screening { id: number; startsAt: string; price: number; hall: string; format: string }
export interface SeatPlan { rows: string; columns: number; occupied: string[] }
export interface Ticket { id: string; code: string; total: number; movieTitle: string; startsAt: string; hall: string; format: string; seats: string[] }
export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cinema-Request': '1' }, body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new ApiError(error.message ?? (response.status === 401 ? 'Devam etmek için hesabınıza giriş yapın.' : response.status === 403 ? 'Bu işlem için yetkiniz bulunmuyor.' : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'), response.status)
  }
  return response.status === 204 ? undefined as T : response.json()
}
export const money = (value: number) => new Intl.NumberFormat(getPreferences().language === 'en' ? 'en-GB' : 'tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(value)
export const date = (value: string, options: Intl.DateTimeFormatOptions) => new Date(value).toLocaleDateString(getPreferences().language === 'en' ? 'en-GB' : 'tr-TR', { ...options, timeZone: 'Europe/Istanbul' })
export const time = (value: string) => new Date(value).toLocaleTimeString(getPreferences().language === 'en' ? 'en-GB' : 'tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
export const dayKey = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
