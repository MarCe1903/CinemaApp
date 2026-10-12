import { t } from './i18n'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, ApiError, date, dayKey, money, time } from './api'
import type { Movie, Screening, SeatPlan, Ticket, User } from './api'
import './cinema.css'
import './posters.css'
import './theme.css'
import HeaderPreferences from './HeaderPreferences'
import { usePreferences } from './preferences'
import PdfDownload from './PdfDownload'
import { formatExpiry, validateCheckout } from './payment'
import AdminPanel from './AdminPanel'
import type { CheckoutErrors, CheckoutFields } from './payment'

const currentYear = new Date().getFullYear()

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    ticket: <><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4Z" /><path d="M15 5v3m0 3v2m0 3v3" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.ticket}</svg>
}

function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} aria-label={title} className={wide ? 'dialog wide' : 'dialog'} onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="dialog-heading"><span className="eyebrow">CINEMA / {title}</span><button className="icon-button" onClick={onClose} aria-label={t("Kapat")}><Icon name="close" /></button></div>
    {children}
  </dialog>
}

function Poster({ movie, hero = false }: { movie: Movie; hero?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (movie.posterUrl && failedUrl !== movie.posterUrl) return <div className={`art uploaded-art ${hero ? 'hero-art' : ''}`} aria-hidden="true"><img src={movie.posterUrl} alt="" onError={() => setFailedUrl(movie.posterUrl!)} /></div>
  return <div className={`art art-${movie.art} ${hero ? 'hero-art' : ''}`} aria-hidden="true">
    <div className="art-stars" /><div className="art-orbit" /><div className="art-planet" /><div className="art-land" /><div className="art-person" />
    {!hero && <div className="poster-type"><span>{' '}{t("BİR")}{' '}{movie.director.toLocaleUpperCase('tr-TR')}{' '}{t("FİLMİ")}</span><strong>{movie.title}</strong><small>{movie.tagline}</small></div>}
  </div>
}

function AuthDialog({ onClose, onLogin }: { onClose: () => void; onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      const user = await api<User>(register ? '/auth/register' : '/auth/login', { name: data.get('name'), email: data.get('email'), password: data.get('password') })
      onLogin(user); onClose()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Dialog title={t("HESABIN")} onClose={onClose}>
    <div className="auth-symbol"><Icon name="ticket" size={30} /></div>
    <h2>{register ? t("Hikâyeye sen de katıl.") : t("Yeniden hoş geldin.")}</h2>
    <p className="muted">{t("Bir sonraki film gecen burada başlıyor.")}</p>
    <form onSubmit={submit} className="form-stack">
      {register && <label>{t("Ad soyad")}<input name="name" autoComplete="name" required maxLength={80} placeholder={t("Adın ve soyadın")} /></label>}
      <label>{register ? t("E-posta") : t("E-posta veya kullanıcı adı")}<input name="email" type={register ? 'email' : 'text'} autoComplete={register ? 'email' : 'username'} required maxLength={254} placeholder={register ? 'ornek@eposta.com' : t("E-posta veya kullanıcı adın")} /></label>
      <label>{t("Şifre")}<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : undefined} maxLength={128} placeholder={t("Şifren")} /></label>
      {register && <small className="muted">{t("En az 8 karakter; büyük/küçük harf, rakam ve özel karakter.")}</small>}
      {error && <p className="error" role="alert">{t(error)}</p>}
      <button className="button primary" disabled={busy}>{busy ? t("Lütfen bekle…") : register ? t("Hesap oluştur") : t("Giriş yap")}<Icon name="arrow" /></button>
    </form>
    <p className="auth-switch">{register ? t("Zaten hesabın var mı?") : t("Henüz hesabın yok mu?")} <button onClick={() => { setRegister(!register); setError('') }}>{register ? t("Giriş yap") : t("Üye ol")}</button></p>
  </Dialog>
}

function BookingDialog({ movie, user, onAuth, onClose, onComplete }: { movie: Movie; user: User | null; onAuth: () => void; onClose: () => void; onComplete: () => void }) {
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [screening, setScreening] = useState<Screening | null>(null)
  const [day, setDay] = useState('')
  const [plan, setPlan] = useState<SeatPlan | null>(null)
  const [seats, setSeats] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<{ id: string; code: string; total: number; isGuest: boolean } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<CheckoutErrors>({})
  const [expiry, setExpiry] = useState('')
  useEffect(() => {
    let current = true
    api<Screening[]>(`/movies/${movie.id}/screenings`).then(data => { if (current) { setScreenings(data); setDay(data[0] ? dayKey(data[0].startsAt) : '') } }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [movie.id])
  useEffect(() => {
    if (!screening) return
    let current = true
    api<SeatPlan>(`/screenings/${screening.id}/seats`).then(data => { if (current) setPlan(data) }).catch(e => { if (current) setError(e.message) })
    return () => { current = false }
  }, [screening])
  useEffect(() => {
    if (!screening || step === 3 || busy) return
    let current = true
    let refreshing = false
    async function refresh() {
      if (refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try {
        const latest = await api<SeatPlan>(`/screenings/${screening!.id}/seats`)
        if (!current) return
        setPlan(latest)
        if (seats.some(seat => latest.occupied.includes(seat))) {
          setSeats(seats.filter(seat => !latest.occupied.includes(seat)))
          setError('Seçtiğin koltuklardan biri satın alındı. Lütfen boş koltuklardan yeniden seçim yap.')
          setStep(1)
        }
      } catch { /* Booking transaction still checks availability if a refresh fails. */ }
      finally { refreshing = false }
    }
    const timer = window.setInterval(refresh, 4000)
    window.addEventListener('focus', refresh)
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [screening, step, seats, busy])
  function toggleSeat(seat: string) {
    setError('')
    if (seats.includes(seat)) setSeats(seats.filter(s => s !== seat))
    else if (seats.length < 8) setSeats([...seats, seat])
    else setError('Tek işlemde en fazla 8 koltuk seçebilirsin.')
  }
  function chooseScreening(value: Screening | null) {
    if (value?.id === screening?.id) return
    setPlan(null); setSeats([]); setError(''); setScreening(value)
  }
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const fields = Object.fromEntries(['cardholder', 'cardNumber', 'expiry', 'cvv', 'contactName', 'contactEmail'].map(key => [key, String(data.get(key) ?? '').trim()])) as unknown as CheckoutFields
    const errors = validateCheckout(fields, !user)
    setFieldErrors(errors)
    if (Object.keys(errors).length) {
      setError('Lütfen boş veya hatalı alanları düzeltin.')
      ;(form.elements.namedItem(Object.keys(errors)[0]) as HTMLInputElement | null)?.focus()
      return
    }
    setBusy(true); setError('')
    try {
      // Only format validation. The API never persists card fields or contacts a bank.
      const { contactName, contactEmail, ...payment } = fields
      const result = await api<{ id: string; code: string; total: number; isGuest: boolean }>('/bookings', { screeningId: screening!.id, seats, payment, contactName, contactEmail })
      form.reset()
      setExpiry('')
      setConfirmation(result); setStep(3)
    } catch (e) {
      setError((e as Error).message)
      if (e instanceof ApiError && e.status === 409) {
        setStep(1); setSeats([]); setPlan(null)
        try { setPlan(await api<SeatPlan>(`/screenings/${screening!.id}/seats`)) } catch { setError('Koltuk planı yenilenemedi. Pencereyi kapatıp tekrar dene.') }
      }
      if (e instanceof ApiError && e.status === 401) onAuth()
    } finally { setBusy(false) }
  }
  const days = [...new Set(screenings.map(s => dayKey(s.startsAt)))]
  return <Dialog title={t("BİLETİNİ AL")} onClose={() => { if (!busy) onClose() }} wide>
    {step === 3 && confirmation ? <div className="success">
      <div className="success-icon"><Icon name="check" size={36} /></div><span className="eyebrow">{t("İYİ SEYİRLER")}</span><h2>{t("Film gecen hazır!")}</h2>
      <p className="muted">{confirmation.isGuest ? t("Misafir biletin hazır. Bu pencereyi kapatmadan PDF biletini indirip sakla.") : t("Demo ödemen tamamlandı. Biletin hesabına eklendi.")}</p>
      <div className="confirmed-ticket"><h3>{movie.title}</h3><p>{date(screening!.startsAt, { day: 'numeric', month: 'long' })} · {time(screening!.startsAt)} · {t(screening!.hall)}</p><p>{t("Koltuklar:")}{' '}<strong>{seats.join(', ')}</strong></p><div className="ticket-code">{confirmation.code}</div><small>{money(confirmation.total)}{' '}{t("· Demo ödeme")}</small></div>
      <div className="success-actions"><PdfDownload id={confirmation.id} code={confirmation.code} /><button className="button subtle" onClick={confirmation.isGuest ? onClose : onComplete}>{confirmation.isGuest ? t("Filmlere dön") : t("Biletlerime git")}<Icon name="arrow" /></button></div>
    </div> : <>
      <div className="booking-title"><div><h2>{movie.title}</h2><p className="muted">{t(movie.genre)} <span>·</span> {movie.duration}{' '}{t("dk")}{' '}<span>·</span> {t(movie.age)}</p></div><span className="rating">★ {movie.rating.toFixed(1)}</span></div>
      <div className="steps">{[t("Seans seç"), t("Koltuk seç"), t("Ödeme")].map((label, index) => <div key={label} className={step >= index ? 'active' : ''}><span>{step > index ? <Icon name="check" size={14} /> : index + 1}</span>{label}</div>)}</div>
      <div className="booking-layout"><section className="booking-content">
        {step === 0 && <><h3>{t("Sana en uygun zaman.")}</h3><p className="muted">{t("Cinema İstanbul · Tüm saatler Türkiye saatidir.")}</p>
          {loading ? <p className="loading">{t("Seanslar yükleniyor…")}</p> : screenings.length === 0 ? <p className="empty">{t("Bu film için henüz seans bulunmuyor.")}</p> : <>
            <div className="date-list">{days.map(d => { const sample = screenings.find(s => dayKey(s.startsAt) === d)!; return <button key={d} className={day === d ? 'date-choice selected' : 'date-choice'} onClick={() => { setDay(d); chooseScreening(null) }}><small>{date(sample.startsAt, { weekday: 'short' })}</small><strong>{date(sample.startsAt, { day: 'numeric' })}</strong><small>{date(sample.startsAt, { month: 'short' })}</small></button> })}</div>
            <div className="session-label"><strong>{t(screenings[0]?.format ?? '')}</strong><span className="muted">{t("Standart bilet")}</span></div>
            <div className="time-list">{screenings.filter(s => dayKey(s.startsAt) === day).map(s => <button key={s.id} className={screening?.id === s.id ? 'time-choice selected' : 'time-choice'} onClick={() => chooseScreening(s)}><strong>{time(s.startsAt)}</strong><small>{t(s.hall)} · {money(s.price)}</small></button>)}</div>
          </>}
          <div className="movie-description"><span className="eyebrow">{t("FİLM HAKKINDA")}</span><p>{movie.description}</p><small>{t("Yönetmen:")}{' '}{movie.director}</small></div>
        </>}
        {step === 1 && <><h3>{t("En sevdiğin yer seni bekliyor.")}</h3><p className="muted">{t("En fazla 8 koltuk seçebilirsin.")}</p><div className="screen"><span>{t("PERDE")}</span></div>
          {!plan ? <p className="loading">{t("Koltuklar yükleniyor…")}</p> : <div className="seat-scroll"><div className="seat-map">{plan.rows.split('').map(row => <div className="seat-row" key={row}><span className="row-name">{row}</span>{Array.from({ length: plan.columns }, (_, index) => { const seat = `${row}${index + 1}`; const occupied = plan.occupied.includes(seat); return <button key={seat} disabled={occupied} aria-label={`${seat} ${occupied ? t("dolu") : t("koltuğu")}`} aria-pressed={seats.includes(seat)} className={`seat ${seats.includes(seat) ? 'chosen' : ''} ${index === 5 ? 'aisle' : ''}`} onClick={() => toggleSeat(seat)}>{index + 1}</button> })}<span className="row-name">{row}</span></div>)}</div></div>}
          <div className="seat-legend"><span><i />{t("Boş")}</span><span><i className="chosen" />{t("Seçimin")}</span><span><i className="occupied" />{t("Dolu")}</span></div><p className="seat-note">{t("Koltuklar ödeme tamamlandığında kesinleşir.")}</p>
        </>}
        {step === 2 && <><h3>{t("Son bir adım kaldı.")}</h3><p className="demo-note">{t("Demo ödeme: gerçek ücret alınmaz, banka onayı istenmez. Örnek kart bilgileri kullan. Alanlar zorunludur; kart bilgileri kaydedilmez.")}</p>
          <form id="payment" onSubmit={pay} noValidate autoComplete="off" className="form-stack">
            {!user && <div className="guest-contact"><span className="eyebrow">{t("MİSAFİR BİLET BİLGİLERİ")}</span>
              <label>{t("Ad soyad")}<input name="contactName" aria-label={t("Ad soyad")} autoComplete="name" required maxLength={80} placeholder={t("Adın ve soyadın")} disabled={busy} aria-invalid={!!fieldErrors.contactName} aria-describedby="contactName-error" />{fieldErrors.contactName && <small id="contactName-error" className="field-error">{t(fieldErrors.contactName)}</small>}</label>
              <label>{t("E-posta")}<input name="contactEmail" aria-label={t("E-posta")} type="email" autoComplete="email" required maxLength={254} placeholder="ornek@eposta.com" disabled={busy} aria-invalid={!!fieldErrors.contactEmail} aria-describedby="contactEmail-error" />{fieldErrors.contactEmail && <small id="contactEmail-error" className="field-error">{t(fieldErrors.contactEmail)}</small>}</label>
              <small className="muted">{t("Hesap oluşturulmaz. Biletini işlem sonunda PDF olarak indirebilirsin; e-posta gönderilmez.")}</small>
            </div>}
            <label>{t("Kart üzerindeki ad")}<input name="cardholder" aria-label={t("Kart üzerindeki ad")} placeholder={t("AD SOYAD")} required maxLength={80} disabled={busy} aria-invalid={!!fieldErrors.cardholder} aria-describedby="cardholder-error" />{fieldErrors.cardholder && <small id="cardholder-error" className="field-error">{t(fieldErrors.cardholder)}</small>}</label>
            <label>{t("Kart numarası")}<input name="cardNumber" aria-label={t("Kart numarası")} inputMode="numeric" placeholder="0000 0000 0000 0000" required maxLength={19} disabled={busy} aria-invalid={!!fieldErrors.cardNumber} aria-describedby="cardNumber-error" />{fieldErrors.cardNumber && <small id="cardNumber-error" className="field-error">{t(fieldErrors.cardNumber)}</small>}</label>
            <div className="form-row"><label>{t("Son kullanma tarihi")}<input name="expiry" aria-label={t("Son kullanma tarihi")} inputMode="numeric" value={expiry} onChange={event => setExpiry(formatExpiry(event.target.value, expiry))} placeholder={t("AA/YY")} required maxLength={5} disabled={busy} aria-invalid={!!fieldErrors.expiry} aria-describedby="expiry-error" />{fieldErrors.expiry && <small id="expiry-error" className="field-error">{t(fieldErrors.expiry)}</small>}</label><label>CVV<input name="cvv" aria-label="CVV" inputMode="numeric" placeholder="000" type="password" required maxLength={3} disabled={busy} aria-invalid={!!fieldErrors.cvv} aria-describedby="cvv-error" />{fieldErrors.cvv && <small id="cvv-error" className="field-error">{t(fieldErrors.cvv)}</small>}</label></div>
          </form>
        </>}
        {error && <p className="error" role="alert">{t(error)}</p>}
      </section><aside className="order-summary"><span className="eyebrow">{t("SENİN FİLM GECEN")}</span><div className="summary-poster"><Poster movie={movie} /></div><h3>{movie.title}</h3><p className="muted">{t("Cinema İstanbul")}</p><dl><div><dt>{t("Seans")}</dt><dd>{screening ? `${date(screening.startsAt, { day: 'numeric', month: 'short' })} · ${time(screening.startsAt)}` : t("Henüz seçilmedi")}</dd></div><div><dt>{t("Salon")}</dt><dd>{t(screening?.hall ?? '—')}</dd></div><div><dt>{t("Koltuk")}</dt><dd>{seats.length ? seats.join(', ') : t("Henüz seçilmedi")}</dd></div></dl><div className="order-total"><span>{t("Toplam")}</span><strong>{money((screening?.price ?? 0) * seats.length)}</strong></div>
        {step === 0 && <button className="button primary" disabled={!screening} onClick={() => setStep(1)}>{t("Koltuk seç")}<Icon name="arrow" /></button>}
        {step === 1 && <button className="button primary" disabled={!seats.length} onClick={() => { if (user) setStep(2); else onAuth() }}>{user ? t("Ödemeye geç") : t("Giriş yap ve devam et")}<Icon name="arrow" /></button>}
        {step === 1 && !user && <button className="button subtle guest-continue" disabled={!seats.length} onClick={() => { setFieldErrors({}); setError(''); setStep(2) }}>{t("Hesap olmadan devam et")}</button>}
        {step === 2 && <button form="payment" className="button primary" disabled={busy}>{busy ? t("Bilet oluşturuluyor…") : t("Ödemeye devam et")}<Icon name="arrow" /></button>}
        {step > 0 && <button className="back-link" disabled={busy} onClick={() => { setStep(step - 1); setError('') }}>{t("← Önceki adıma dön")}</button>}
      </aside></div>
    </>}
  </Dialog>
}

function Tickets({ onBrowse }: { onBrowse: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let current = true; api<Ticket[]>('/bookings').then(data => { if (current) setTickets(data) }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setLoading(false) }); return () => { current = false } }, [])
  return <section className="tickets-page"><span className="eyebrow">{t("SİNEMA TAKVİMİN")}</span><h1>{t("Biletlerim")}<span>.</span></h1><p className="muted">{t("Güzel hikâyelere ayırdığın yerler.")}</p>
    {loading && <p className="loading">{t("Biletlerin yükleniyor…")}</p>}{error && <p className="error" role="alert">{t(error)}</p>}
    {!loading && !error && !tickets.length && <div className="empty"><Icon name="ticket" size={42} /><h3>{t("İlk film geceni planlayalım.")}</h3><p>{t("Henüz bir biletin bulunmuyor.")}</p><button className="button primary" onClick={onBrowse}>{t("Filmleri keşfet")}<Icon name="arrow" /></button></div>}
    <div className="ticket-list">{tickets.map(ticket => <article className="ticket-card" key={ticket.id}><div className="ticket-main"><span className="eyebrow">{t("CINEMA İSTANBUL")}{' '}<span className="demo-badge">{t("DEMO BİLET")}</span></span><h2>{ticket.movieTitle}</h2><p>{date(ticket.startsAt, { day: 'numeric', month: 'long', weekday: 'long' })} · {time(ticket.startsAt)}</p><p className="muted">{t(ticket.hall)} · {t(ticket.format)}{' '}{t("· Koltuk")}{' '}{ticket.seats.join(', ')}</p></div><div className="ticket-stub"><Icon name="ticket" size={32} /><strong>{ticket.code}</strong><span>{money(ticket.total)}</span><PdfDownload id={ticket.id} code={ticket.code} /></div></article>)}</div>
  </section>
}

export default function CinemaApp() {
  const { language } = usePreferences()
  const locale = language === 'en' ? 'en-GB' : 'tr-TR'
  const [movies, setMovies] = useState<Movie[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [auth, setAuth] = useState(false)
  const [pendingTickets, setPendingTickets] = useState(false)
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
  const [page, setPage] = useState('movies')
  const [genre, setGenre] = useState('Tümü')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recommended')
  const [retry, setRetry] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let current = true
    api<Movie[]>('/movies').then(data => { if (current) setMovies(data) }).catch(() => { if (current) setError('Filmlere şu anda ulaşamıyoruz. API ve veritabanı bağlantısını kontrol edip tekrar dene.') }).finally(() => { if (current) setLoading(false) })
    api<User>('/auth/me').then(data => { if (current) setUser(data) }).catch(() => {})
    return () => { current = false }
  }, [retry])
  useEffect(() => {
    function refreshUser() {
      api<User>('/auth/me').then(data => {
        setUser(data)
        if (!data.roles?.some(role => role === 'Admin' || role === 'Manager')) setPage(previous => previous === 'admin' ? 'movies' : previous)
      }).catch(error => { if (error instanceof ApiError && error.status === 401) { setUser(null); setPage('movies') } })
    }
    window.addEventListener('focus', refreshUser)
    return () => window.removeEventListener('focus', refreshUser)
  }, [])
  const canManage = user?.roles?.some(role => role === 'Admin' || role === 'Manager') ?? false
  function showTickets() { if (user) setPage('tickets'); else { setPendingTickets(true); setAuth(true) } }
  async function logout() { try { await api('/auth/logout', {}); setUser(null); setPage('movies') } catch (e) { setError((e as Error).message) } }
  const filtered = movies.filter(movie => (genre === 'Tümü' || genre === movie.genre) && movie.title.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale))).sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'title' ? a.title.localeCompare(b.title, locale) : a.id - b.id)
  const hero = movies[0]
  return <>
    <header className="site-header"><a className="brand" href="#" onClick={() => setPage('movies')} aria-label={t("Cinema ana sayfa")}><span className="brand-icon"><Icon name="ticket" size={25} /></span>cinema<span className="brand-dot">.</span></a>
      <nav aria-label={t("Ana menü")}><button className={page === 'movies' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('movies')}>{t("Filmler")}</button><button className={page === 'tickets' ? 'nav-link active' : 'nav-link'} onClick={showTickets}>{t("Biletlerim")}</button>{canManage && <button className={`nav-link admin-nav ${page === 'admin' ? 'active' : ''}`} onClick={() => setPage('admin')}>{t("Yönetim paneli")}</button>}</nav>
      <div className="header-actions"><HeaderPreferences /><span className="location"><Icon name="pin" size={16} />{t("İstanbul")}</span>{user ? <><span className="user-name">{t("Merhaba,")}{' '}{user.displayName.split(' ')[0]}</span><button className="button small subtle" onClick={logout}>{t("Çıkış yap")}</button></> : <button className="button small subtle" onClick={() => setAuth(true)}><Icon name="user" size={16} />{t("Giriş yap")}<span className="login-divider">/</span>{t("Üye ol")}</button>}</div>
    </header>
    <main>
      {page === 'admin' && canManage && user ? <AdminPanel user={user} onChanged={() => setRetry(value => value + 1)} /> : page === 'tickets' ? <Tickets onBrowse={() => setPage('movies')} /> : <>
        {hero && <section className="hero"><Poster movie={hero} hero /><div className="hero-shade" /><div className="hero-content"><div className="hero-label"><span className="live-dot" />{t("HAFTANIN FİLMİ")}<span className="imax">IMAX</span></div><p className="hero-kicker">{t("SINIRLARIN ÖTESİNDE BİR HİKÂYE")}</p><h1>{t("Yıldızların")}<br /><em>{t("ötesinde.")}</em></h1><div className="hero-meta"><span className="rating">★ {hero.rating.toFixed(1)}</span><span>{t(hero.genre)}</span><span>{hero.duration}{' '}{t("dk")}</span><span className="age">{t(hero.age)}</span></div><p className="hero-description">{hero.tagline}<br />{t("Büyük perdede, bambaşka bir evrende buluşalım.")}</p><div className="hero-buttons"><button className="button primary" onClick={() => setSelectedMovie(hero)}><Icon name="ticket" />{t("Biletini al")}<Icon name="arrow" /></button><button className="button glass" onClick={() => setSelectedMovie(hero)}>{t("Filmi keşfet")}<span>↗</span></button></div></div><div className="hero-bottom"><span>{t("HİKÂYE BAŞLIYOR. YERİNİ AL.")}</span><div><b>01</b><span className="slide-line" /><span>06</span></div></div><span className="hero-orbit-label">{t("35° 41′ N — BİLİNMEYENE DOĞRU")}</span></section>}
        <section className="catalog" id="filmler"><div className="section-heading"><div><span className="eyebrow">{t("BÜYÜK PERDEDE, ŞİMDİ")}</span><h2>{t("Bugün hangi hikâyedesin")}<span>?</span></h2></div><span className="film-count">{movies.length}{' '}{t("film vizyonda")}</span></div>
          <div className="catalog-toolbar"><div className="genre-list" aria-label={t("Film türü")}>{['Tümü', ...new Set(movies.map(m => m.genre))].map(g => <button key={g} className={genre === g ? 'genre active' : 'genre'} aria-pressed={genre === g} onClick={() => setGenre(g)}>{t(g)}</button>)}</div><label className="search"><Icon name="search" size={17} /><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Bir film ara…")} aria-label={t("Film ara")} /></label></div>
          <div className="results-row"><span>{filtered.length}{' '}{t("film seni bekliyor")}</span><label>{t("Sırala:")}{' '}<select aria-label={t("Filmleri sırala")} value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">{t("Önerilen")}</option><option value="rating">{t("Puana göre")}</option><option value="title">A–Z</option></select></label></div>
          {loading && <div className="loading">{t("Perdeler açılıyor, filmler yükleniyor…")}</div>}
          {error && <div className="error" role="alert">{t(error)}<button className="back-link" onClick={() => { setLoading(true); setError(''); setRetry(retry + 1) }}>{t("Tekrar dene")}</button></div>}
          {!loading && !error && filtered.length === 0 && <div className="empty"><h3>{t("Bu aramada film bulamadık.")}</h3><button className="button subtle" onClick={() => { setGenre('Tümü'); setQuery('') }}>{t("Filtreleri temizle")}</button></div>}
          <div className="movie-grid">{filtered.map((movie, index) => <article className="movie-card" key={movie.id} style={{ animationDelay: `${index * 55}ms` }}><button className="poster-button" onClick={() => setSelectedMovie(movie)} aria-label={t("{title} filmi ve seansları", { title: movie.title })}><Poster movie={movie} /><span className="poster-rating">★ {movie.rating.toFixed(1)}</span><span className="poster-format">{movie.id === 1 ? 'IMAX' : '2D'}</span><span className="poster-cta">{t("Seansları keşfet")}<Icon name="arrow" /></span></button><div className="movie-info"><div className="movie-tags"><span>{t(movie.genre)}</span><span>{t(movie.age)}</span></div><h3><button onClick={() => setSelectedMovie(movie)}>{movie.title}</button></h3><div className="movie-card-bottom"><span><Icon name="clock" size={14} />{movie.duration}{' '}{t("dk")}</span><button onClick={() => setSelectedMovie(movie)}>{t("Bilet al")}<Icon name="arrow" size={16} /></button></div></div></article>)}</div>
        </section>
        <section className="experience"><div className="experience-mark">C<span>+</span></div><div><span className="eyebrow">{t("SADECE BİR FİLM DEĞİL.")}</span><h2>{t("Işıklar sönsün.")}<br />{t("Hikâye seninle başlasın.")}</h2><p>{t("Sevdiğin filmi bul. Yerini seç. Anın tadını çıkar.")}</p></div><div className="experience-details"><div><span>01</span><p><strong>{t("Her zevke bir hikâye")}</strong>{t("Bilim kurgudan romantik filmlere.")}</p></div><div><span>02</span><p><strong>{t("En güzel yer senin")}</strong>{t("Koltuk planından yerini kendin seç.")}</p></div><div><span>03</span><p><strong>{t("Biletin hep yanında")}</strong>{t("Tüm biletlerin tek bir hesapta.")}</p></div></div></section>
      </>}
    </main>
    <footer><a className="brand" href="#" onClick={() => setPage('movies')}>cinema<span className="brand-dot">.</span></a><p>{t("Hayatın küçük bir molası. Hikâyelerin büyük dünyası.")}</p><span>© {currentYear}{' '}{t("Cinema · Demo proje")}</span></footer>
    {selectedMovie && <BookingDialog movie={selectedMovie} user={user} onAuth={() => setAuth(true)} onClose={() => setSelectedMovie(null)} onComplete={() => { setSelectedMovie(null); setPage('tickets') }} />}
    {auth && <AuthDialog onClose={() => { setAuth(false); setPendingTickets(false) }} onLogin={data => { setUser(data); if (pendingTickets) setPage('tickets') }} />}
  </>
}



