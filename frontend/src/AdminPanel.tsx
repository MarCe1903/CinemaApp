import { t } from './i18n'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { api, date, money, time } from './api'
import type { Movie, Screening, User } from './api'
import PdfDownload from './PdfDownload'
import './admin.css'

interface ManagedScreening extends Screening { movieId: number; movieTitle: string; soldSeats: number }
interface ManagedUser extends User { bookingCount: number }
interface ManagedBooking { id: string; code: string; total: number; movieTitle: string; startsAt: string; hall: string; buyerName: string; buyerEmail: string; isGuest: boolean; seats: string[] }
const roleLabels: Record<string, string> = { Member: 'Üye', Manager: 'Yönetici', Admin: 'Admin' }
const arts: Record<string, string> = { cosmos: 'Uzay', city: 'Şehir', summer: 'Yaz', forest: 'Orman', fire: 'Aksiyon', rhythm: 'Müzik' }
const emptyMovie = { title: '', tagline: '', description: '', genre: 'Bilim Kurgu', art: 'cosmos', duration: 120, age: 'Genel', rating: 0, director: '' }
const emptySession = { movieId: 0, startsAt: '', price: 240, hall: 'Salon 1', format: '2D · Türkçe' }
function localDateTime(iso: string) {
  const offset = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000)
  return offset.toISOString().slice(0, 16)
}

export default function AdminPanel({ user, onChanged }: { user: User; onChanged: () => void }) {
  const isAdmin = user.roles.includes('Admin')
  const [tab, setTab] = useState('movies')
  const [movies, setMovies] = useState<Movie[]>([])
  const [sessions, setSessions] = useState<ManagedScreening[]>([])
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [bookings, setBookings] = useState<ManagedBooking[]>([])
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [movieId, setMovieId] = useState<number | null>(null)
  const [movie, setMovie] = useState(emptyMovie)
  const [posterPng, setPosterPng] = useState<string | null>(null)
  const [existingPoster, setExistingPoster] = useState<string | null>(null)
  const [removePoster, setRemovePoster] = useState(false)
  const [readingPoster, setReadingPoster] = useState(false)
  const [supportsPosters, setSupportsPosters] = useState(false)
  const [fileKey, setFileKey] = useState(0)
  const posterRead = useRef(0)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [session, setSession] = useState(emptySession)
  const [filterMovie, setFilterMovie] = useState('all')
  const [futureOnly, setFutureOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const activeTab = !isAdmin && ['users', 'bookings'].includes(tab) ? 'movies' : tab

  useEffect(() => {
    let current = true
    Promise.all([
      api<Movie[]>('/manage/movies'), api<ManagedScreening[]>('/manage/screenings'),
      isAdmin ? api<ManagedUser[]>('/admin/users') : Promise.resolve([]),
      isAdmin ? api<ManagedBooking[]>('/admin/bookings') : Promise.resolve([]),
      api<{ features?: string[] }>('/health'),
    ]).then(([filmData, screeningData, userData, bookingData, health]) => {
      if (!current) return
      setMovies(filmData); setSessions(screeningData); setUsers(userData); setBookings(bookingData)
      setSupportsPosters(health.features?.includes('movie-posters') ?? false)
      setNow(Date.now())
    }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [revision, isAdmin])

  async function change(path: string, body: unknown, message: string, after?: () => void) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await api(path, body); setNotice(message); after?.(); setRevision(value => value + 1); onChanged() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  function resetPoster(url: string | null = null) { posterRead.current++; setPosterPng(null); setExistingPoster(url); setRemovePoster(false); setReadingPoster(false); setFileKey(value => value + 1) }
  function resetMovie() { setMovieId(null); setMovie(emptyMovie); resetPoster() }
  function editMovie(value: Movie) { setMovieId(value.id); setMovie(value); resetPoster(value.posterUrl ?? null); setError(''); setNotice('') }
  function choosePoster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const sequence = ++posterRead.current
    setError(''); setReadingPoster(false)
    if (!file.name.toLowerCase().endsWith('.png') || (file.type && file.type !== 'image/png')) { setError('Lütfen PNG formatında bir görsel seçin.'); event.target.value = ''; return }
    if (file.size > 5 * 1024 * 1024) { setError('PNG dosyası en fazla 5 MB olabilir.'); event.target.value = ''; return }
    setReadingPoster(true)
    const reader = new FileReader()
    reader.onload = () => { if (posterRead.current === sequence) { setPosterPng(String(reader.result).split(',')[1]); setRemovePoster(false); setReadingPoster(false) } }
    reader.onerror = () => { if (posterRead.current === sequence) { setError('Görsel okunamadı. Lütfen yeniden seçin.'); setReadingPoster(false) } }
    reader.readAsDataURL(file)
  }
  function editSession(value: ManagedScreening) { setSessionId(value.id); setSession({ ...value, startsAt: localDateTime(value.startsAt) }); setError(''); setNotice('') }
  function saveMovie(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (readingPoster) return
    if ((posterPng || removePoster) && !supportsPosters) { setError('Afiş yüklemek için API’yi güncel kodla yeniden başlatın.'); return }
    void change(movieId ? `/manage/movies/${movieId}` : '/manage/movies', { ...movie, posterPng, removePoster }, 'Film kaydedildi.', resetMovie)
  }
  function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session.startsAt || !(session.movieId || movies[0]?.id)) { setError('Film ve seans tarihi seçin.'); return }
    const startsAt = new Date(`${session.startsAt}:00+03:00`).toISOString()
    void change(sessionId ? `/manage/screenings/${sessionId}` : '/manage/screenings', { ...session, movieId: session.movieId || movies[0]?.id, startsAt }, 'Seans kaydedildi.', () => { setSessionId(null); setSession(emptySession) })
  }
  const tabs = [{ id: 'movies', title: t("Filmler") }, { id: 'screenings', title: t('Seanslar') }, ...(isAdmin ? [{ id: 'users', title: t("Üyeler ve roller") }, { id: 'bookings', title: t("Tüm biletler") }] : [])]
  const visibleSessions = sessions.filter(s => (filterMovie === 'all' || s.movieId === Number(filterMovie)) && (!futureOnly || new Date(s.startsAt).getTime() > now))
  const visibleUsers = users.filter(u => `${u.displayName} ${u.userName} ${u.email}`.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')))
  return <section className="admin-page">
    <div className="admin-heading"><div><span className="eyebrow">{t("CINEMA / YÖNETİM")}</span><h1>{isAdmin ? t("Admin paneli") : t("Yönetici paneli")}<span>.</span></h1><p className="muted">{isAdmin ? t("Filmler, seanslar, üyeler ve biletler tek yerde.") : t("Film kataloğunu ve gösterim takvimini düzenle.")}</p></div><span className="role-badge">{isAdmin ? 'Admin' : t('Yönetici')}</span></div>
    <div className="admin-stats"><article><small>{t("Film")}</small><strong>{movies.length}</strong></article><article><small>{t("Seans")}</small><strong>{sessions.length}</strong></article>{isAdmin && <><article><small>{t("Üye")}</small><strong>{users.length}</strong></article><article><small>{t("Toplam bilet tutarı · Demo")}</small><strong>{money(bookings.reduce((total, b) => total + b.total, 0))}</strong></article></>}</div>
    <div className="admin-tabs" role="tablist" aria-label={t("Yönetim bölümleri")}>{tabs.map(item => <button key={item.id} role="tab" aria-selected={activeTab === item.id} onClick={() => { setTab(item.id); setError(''); setNotice('') }}>{item.title}</button>)}<button className="refresh-admin" disabled={busy || loading} onClick={() => { setLoading(true); setError(''); setRevision(value => value + 1) }}>{t("Yenile ↻")}</button></div>
    {error && <p className="error" role="alert">{t(error)}</p>}{notice && <p className="admin-notice" role="status">{t(notice)}</p>}
    {loading ? <p className="loading">{t("Yönetim bilgileri yükleniyor…")}</p> : <>
      {activeTab === 'movies' && <div className="admin-layout"><section className="admin-box"><h2>{movieId ? t("Filmi düzenle") : t("Yeni film ekle")}</h2><form className="form-stack" onSubmit={saveMovie}><fieldset disabled={busy}>
        <label>{t("Film adı")}<input required maxLength={160} value={movie.title} onChange={e => setMovie({ ...movie, title: e.target.value })} /></label>
        <label>{t("Kısa açıklama")}<input required maxLength={200} value={movie.tagline} onChange={e => setMovie({ ...movie, tagline: e.target.value })} /></label>
        <label>{t("Film açıklaması")}<textarea required maxLength={4000} rows={4} value={movie.description} onChange={e => setMovie({ ...movie, description: e.target.value })} /></label>
        <div className="form-row"><label>{t("Tür")}<input required maxLength={50} list="genres" value={movie.genre} onChange={e => setMovie({ ...movie, genre: e.target.value })} /><datalist id="genres">{['Bilim Kurgu', 'Gerilim', 'Romantik', 'Animasyon', 'Aksiyon', 'Dram', 'Komedi'].map(g => <option key={g} value={g} />)}</datalist></label><label>{t("Süre (dk)")}<input required type="number" min={1} max={600} value={movie.duration} onChange={e => setMovie({ ...movie, duration: Number(e.target.value) })} /></label></div>
        <label>{t("Yönetmen")}<input required maxLength={100} value={movie.director} onChange={e => setMovie({ ...movie, director: e.target.value })} /></label>
        <div className="form-row"><label>{t("Yaş sınırı")}<select value={movie.age} onChange={e => setMovie({ ...movie, age: e.target.value })}>{['Genel', '7+', '13+', '16+', '18+'].map(a => <option key={a} value={a}>{t(a)}</option>)}</select></label><label>{t("Puan")}<input type="number" min={0} max={10} step="0.1" required value={movie.rating} onChange={e => setMovie({ ...movie, rating: Number(e.target.value) })} /></label></div>
        <div className="poster-upload"><label>{t("Film afişi (PNG)")}<input key={fileKey} type="file" accept="image/png,.png" disabled={!supportsPosters} onChange={choosePoster} aria-describedby="poster-help" /></label><small id="poster-help" className="muted">{t("İsteğe bağlı · En fazla 5 MB. Dikey, 2:3 oranında bir afiş önerilir. Görsel seçmezsen mevcut afiş korunur.")}</small>
          {!supportsPosters && <small className="field-error" role="alert">{t("Afiş yüklemeyi kullanmak için API’yi güncel kodla yeniden başlatın, ardından Yenile’ye basın.")}</small>}
          {readingPoster && <small role="status">{t("Görsel hazırlanıyor…")}</small>}
          {(posterPng || (!removePoster && existingPoster)) && <img className="poster-preview" src={posterPng ? `data:image/png;base64,${posterPng}` : existingPoster!} alt={t("Film afişi önizlemesi")} />}
          {posterPng && <button type="button" className="back-link" onClick={() => resetPoster(existingPoster)}>{t("Görsel seçimini iptal et")}</button>}
          {!posterPng && existingPoster && !removePoster && <button type="button" className="back-link" onClick={() => setRemovePoster(true)}>{t("Yüklenen afişi kaldır")}</button>}
          {removePoster && <small className="muted">{t("Kaydettiğinde tema afişine dönülecek.")}{' '}<button type="button" className="back-link" onClick={() => setRemovePoster(false)}>{t("Vazgeç")}</button></small>}
        </div>
        <label>{t("Alternatif afiş teması")}<select value={movie.art} onChange={e => setMovie({ ...movie, art: e.target.value })}>{Object.entries(arts).map(([key, title]) => <option key={key} value={key}>{t(title)}</option>)}</select></label>
        <button className="button primary" type="submit" disabled={readingPoster}>{busy ? t("Kaydediliyor…") : movieId ? t("Değişiklikleri kaydet") : t("Filmi ekle")}</button>{movieId && <button type="button" className="back-link" onClick={resetMovie}>{t("Düzenlemeyi iptal et")}</button>}
      </fieldset></form></section><section className="admin-box"><h2>{t("Film kataloğu")}</h2><div className="admin-film-list">{movies.map(m => <article key={m.id}><div className={`film-swatch art-${m.art}`}>{m.posterUrl && <img src={m.posterUrl} alt="" />}</div><div><h3>{m.title}</h3><p className="muted">{t(m.genre)} · {m.duration}{' '}{t("dk ·")}{' '}{t(m.age)}</p></div><div className="row-actions"><button disabled={busy} onClick={() => editMovie(m)}>{t("Düzenle")}</button><button className="danger-link" disabled={busy} onClick={() => { if (window.confirm(t("“{title}” filmi ve bilet satılmamış seansları silinsin mi?", { title: m.title }))) void change(`/manage/movies/${m.id}/delete`, {}, 'Film silindi.', () => { if (movieId === m.id) resetMovie() }) }}>{t("Sil")}</button></div></article>)}</div></section></div>}
      {activeTab === 'screenings' && <div className="admin-layout"><section className="admin-box"><h2>{sessionId ? t("Seansı düzenle") : t("Yeni seans ekle")}</h2><p className="muted admin-help">{t("Tüm saatler Türkiye saatidir. Salonda filmler arasında 15 dakika ara bırakılır. Bileti satılmış seanslar korunur.")}</p><form className="form-stack" onSubmit={saveSession}><fieldset disabled={busy}>
        <label>{t("Film")}<select required value={session.movieId || movies[0]?.id || ''} onChange={e => setSession({ ...session, movieId: Number(e.target.value) })}>{movies.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
        <label>{t("Tarih ve saat (Türkiye)")}<input required type="datetime-local" value={session.startsAt} onChange={e => setSession({ ...session, startsAt: e.target.value })} /></label>
        <div className="form-row"><label>{t("Salon")}<select value={session.hall} onChange={e => setSession({ ...session, hall: e.target.value })}>{Array.from({ length: 6 }, (_, i) => <option key={i} value={`Salon ${i + 1}`}>{t("Salon")}{' '}{i + 1}</option>)}</select></label><label>{t("Bilet fiyatı (TL)")}<input required type="number" min={1} max={10000} step="0.01" value={session.price} onChange={e => setSession({ ...session, price: Number(e.target.value) })} /></label></div>
        <label>{t("Gösterim biçimi")}<input required maxLength={80} value={session.format} onChange={e => setSession({ ...session, format: e.target.value })} /></label><button className="button primary" type="submit" disabled={!movies.length}>{busy ? t("Kaydediliyor…") : sessionId ? t("Seansı kaydet") : t("Seansı ekle")}</button>{sessionId && <button type="button" className="back-link" onClick={() => { setSessionId(null); setSession(emptySession) }}>{t("Düzenlemeyi iptal et")}</button>}
      </fieldset></form></section><section className="admin-box"><h2>{t("Gösterim takvimi")}</h2><div className="admin-filters"><select aria-label={t("Seansları filme göre filtrele")} value={filterMovie} onChange={e => setFilterMovie(e.target.value)}><option value="all">{t("Tüm filmler")}</option>{movies.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select><label><input type="checkbox" checked={futureOnly} onChange={e => setFutureOnly(e.target.checked)} />{t("Sadece gelecek seanslar")}</label></div><div className="admin-table-scroll"><table><thead><tr><th>{t("Film / Salon")}</th><th>{t("Tarih / Saat")}</th><th>{t("Fiyat / Dolu")}</th><th>{t("İşlem")}</th></tr></thead><tbody>{visibleSessions.map(s => <tr key={s.id}><td><strong>{s.movieTitle}</strong><small>{t(s.hall)} · {t(s.format)}</small></td><td>{date(s.startsAt, { day: 'numeric', month: 'short', year: 'numeric' })}<small>{time(s.startsAt)}</small></td><td>{money(s.price)}<small>{s.soldSeats}{' '}{t("/ 96 dolu")}</small></td><td>{s.soldSeats ? <span className="locked-session">{t("Bilet satıldı")}</span> : <div className="row-actions"><button disabled={busy} onClick={() => editSession(s)}>{t("Düzenle")}</button><button className="danger-link" disabled={busy} onClick={() => { if (window.confirm(t("Bu seans silinsin mi?"))) void change(`/manage/screenings/${s.id}/delete`, {}, 'Seans silindi.', () => { if (sessionId === s.id) { setSessionId(null); setSession(emptySession) } }) }}>{t("Sil")}</button></div>}</td></tr>)}</tbody></table></div>{!visibleSessions.length && <p className="empty">{t("Bu filtrede seans yok.")}</p>}</section></div>}
      {activeTab === 'users' && isAdmin && <section className="admin-box"><h2>{t("Üyeler ve yetkileri")}</h2><p className="admin-help muted">{t("Yönetici film ve seansları düzenler. Admin tüm yönetim bölümlerine erişir. Rol değişikliği açık oturumlarda da geçerlidir.")}</p><input className="admin-user-search" aria-label={t("Üye ara")} placeholder={t("Ad, kullanıcı adı veya e-posta ara…")} value={search} onChange={e => setSearch(e.target.value)} /><div className="admin-table-scroll"><table><thead><tr><th>{t("Üye")}</th><th>{t("E-posta / Kullanıcı adı")}</th><th>{t("Bilet")}</th><th>{t("Yetki")}</th></tr></thead><tbody>{visibleUsers.map(u => <tr key={u.id}><td><strong>{u.displayName}</strong>{u.id === user.id && <small>{t("Senin hesabın")}</small>}</td><td>{u.email}<small>{u.userName}</small></td><td>{u.bookingCount}</td><td><select aria-label={t("{user} rolü", { user: u.userName })} disabled={busy || u.id === user.id} value={u.roles.includes('Admin') ? 'Admin' : u.roles.includes('Manager') ? 'Manager' : 'Member'} onChange={e => { const role = e.target.value; if (window.confirm(t("{name} için yeni yetki: {role}. Kaydedilsin mi?", { name: u.displayName, role: t(roleLabels[role]) }))) void change(`/admin/users/${u.id}/role`, { role }, 'Kullanıcı rolü güncellendi.') }}>{Object.entries(roleLabels).map(([key, title]) => <option key={key} value={key}>{t(title)}</option>)}</select></td></tr>)}</tbody></table></div>{!visibleUsers.length && <p className="empty">{t("Üye bulunamadı.")}</p>}</section>}
      {activeTab === 'bookings' && isAdmin && <section className="admin-box"><h2>{t("Tüm biletler")}</h2><div className="admin-table-scroll"><table><thead><tr><th>{t("Film / Kod")}</th><th>{t("İzleyici")}</th><th>{t("Seans / Koltuk")}</th><th>{t("Tutar / PDF")}</th></tr></thead><tbody>{bookings.map(b => <tr key={b.id}><td><strong>{b.movieTitle}</strong><small>{b.code}</small></td><td>{b.buyerName ?? t('Misafir')}<small>{b.buyerEmail}</small><span className="role-badge">{t(b.isGuest ? 'Misafir' : 'Üye')}</span></td><td>{date(b.startsAt, { day: 'numeric', month: 'short' })} · {time(b.startsAt)}<small>{t(b.hall)} · {b.seats.join(', ')}</small></td><td>{money(b.total)}<PdfDownload id={b.id} code={b.code} /></td></tr>)}</tbody></table></div>{!bookings.length && <p className="empty">{t("Henüz bilet bulunmuyor.")}</p>}</section>}
    </>}
  </section>
}
