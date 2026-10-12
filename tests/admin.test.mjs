import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.CINEMA_API_URL ?? 'http://localhost:5080'
async function request(path, body, cookie) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Cinema-Request': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
}

test('Admin/Manager/Member yetkileri, mevcut oturumda rol değişikliği ve seans güvenliği', async () => {
  assert.ok(process.env.CINEMA_TEST_ADMIN_PASSWORD, 'Set CINEMA_TEST_ADMIN_PASSWORD for the dedicated test database admin account.')
  const admin = await request('/auth/login', { email: process.env.CINEMA_TEST_ADMIN_USER ?? 'admin', password: process.env.CINEMA_TEST_ADMIN_PASSWORD })
  assert.equal(admin.status, 200)
  assert.deepEqual(admin.body.roles, ['Admin'])
  assert.equal((await request('/manage/movies')).status, 401)
  const account = await request('/auth/register', { name: 'Rol Testi', email: `roles-${randomUUID()}@example.test`, password: `Test!9a-${randomUUID()}`, roles: ['Admin'] })
  assert.equal(account.status, 200)
  assert.deepEqual(account.body.roles, ['Member'], 'Kayıt sırasında rol atanamamalı.')
  assert.equal((await request('/manage/movies', undefined, account.cookie)).status, 403)
  assert.equal((await request('/admin/users', undefined, account.cookie)).status, 403)
  assert.equal((await request('/auth/register', { name: 'Zayıf Şifre', email: `weak-${randomUUID()}@example.test`, password: 'weak' })).status, 400)
  const rolePath = `/admin/users/${account.body.id}/role`
  assert.equal((await request(rolePath, { role: 'Manager' }, admin.cookie)).status, 200)
  assert.deepEqual((await request('/auth/me', undefined, account.cookie)).body.roles, ['Manager'])
  assert.equal((await request('/manage/movies', undefined, account.cookie)).status, 200)
  assert.equal((await request('/admin/users', undefined, account.cookie)).status, 403)
  assert.equal((await request(rolePath, { role: 'Admin' }, account.cookie)).status, 403)
  const movieInput = { title: `Yönetim Testi ${randomUUID().slice(0, 8)}`, tagline: 'Demo film', description: 'Yönetim ve rol entegrasyon testi.', genre: 'Dram', art: 'city', duration: 90, age: 'Genel', rating: 8, director: 'Test Yönetmen' }
  const movie = await request('/manage/movies', movieInput, account.cookie)
  assert.equal(movie.status, 200)
  assert.equal((await request(`/manage/movies/${movie.body.id}`, { ...movieInput, title: `${movieInput.title} Güncel` }, account.cookie)).status, 200)
  assert.equal((await request('/manage/movies', { ...movieInput, title: '' }, account.cookie)).status, 400)
  const existing = await request('/manage/screenings', undefined, account.cookie)
  const start = Math.max(Date.now() + 14 * 86400000, ...existing.body.map(s => new Date(s.startsAt).getTime() + 2 * 86400000))
  const input = { movieId: movie.body.id, startsAt: new Date(start).toISOString(), price: 275, hall: 'Salon 6', format: '2D · Türkçe' }
  const session = await request('/manage/screenings', input, account.cookie)
  assert.equal(session.status, 200)
  const id = session.body.id
  const plan = await request(`/screenings/${id}/seats`)
  assert.equal(plan.body.rows.length * plan.body.columns, 96)
  assert.equal((await request('/manage/screenings', input, account.cookie)).status, 400, 'Çakışan salon saati reddedilmeli.')
  const changed = { ...input, startsAt: new Date(start + 3 * 3600000).toISOString() }
  assert.equal((await request(`/manage/screenings/${id}`, changed, account.cookie)).status, 200)
  assert.equal((await request(`/movies/${movie.body.id}/screenings`)).body[0].startsAt.slice(0, 19), changed.startsAt.slice(0, 19))
  const next = await request('/manage/screenings', { ...changed, startsAt: new Date(start + 3 * 3600000 + 105 * 60000).toISOString() }, account.cookie)
  assert.equal(next.status, 200)
  assert.equal((await request(`/manage/movies/${movie.body.id}`, { ...movieInput, duration: 120 }, account.cookie)).status, 409, 'Film süresi artırılırken seans çakışması engellenmeli.')
  assert.equal((await request(`/manage/screenings/${next.body.id}/delete`, {}, account.cookie)).status, 204)
  const payment = { cardholder: 'Demo Test', cardNumber: '0000000000000000', expiry: '12/29', cvv: '123' }
  const booking = await request('/bookings', { screeningId: id, seats: ['A1'], payment, contactName: 'Misafir Test', contactEmail: 'guest@example.test' })
  assert.equal(booking.status, 200)
  assert.equal((await request(`/manage/screenings/${id}`, input, account.cookie)).status, 409)
  assert.equal((await request(`/manage/screenings/${id}/delete`, {}, account.cookie)).status, 409)
  assert.equal((await request(`/manage/movies/${movie.body.id}/delete`, {}, account.cookie)).status, 409)
  assert.equal((await request('/bookings', { screeningId: id, seats: ['A1'], payment }, account.cookie)).status, 409)
  const users = await request('/admin/users', undefined, admin.cookie)
  assert.equal(users.status, 200)
  assert.ok(users.body.some(user => user.id === account.body.id && user.roles.includes('Manager')))
  assert.ok(!JSON.stringify(users.body).toLowerCase().includes('password'))
  const tickets = await request('/admin/bookings', undefined, admin.cookie)
  assert.ok(tickets.body.some(ticket => ticket.id === booking.body.id && ticket.isGuest))
  const pdfUrl = `${base}/api/bookings/${booking.body.id}/pdf`
  assert.equal((await fetch(pdfUrl, { headers: { Cookie: account.cookie } })).status, 404)
  assert.equal((await fetch(pdfUrl, { headers: { Cookie: admin.cookie } })).headers.get('content-type'), 'application/pdf')
  const disposable = await request('/manage/movies', { ...movieInput, title: 'Silinebilir test filmi' }, account.cookie)
  const removable = await request('/manage/screenings', { ...input, movieId: disposable.body.id, startsAt: new Date(start + 2 * 86400000).toISOString() }, account.cookie)
  assert.equal(removable.status, 200)
  assert.equal((await request(`/manage/screenings/${removable.body.id}/delete`, {}, account.cookie)).status, 204)
  assert.equal((await request(`/manage/movies/${disposable.body.id}/delete`, {}, account.cookie)).status, 204)
  assert.equal((await request(`/admin/users/${admin.body.id}/role`, { role: 'Member' }, admin.cookie)).status, 400)
  assert.equal((await request(rolePath, { role: 'SuperAdmin' }, admin.cookie)).status, 400)
  assert.equal((await request(rolePath, { role: 'Admin' }, admin.cookie)).status, 200)
  assert.equal((await request('/admin/users', undefined, account.cookie)).status, 200)
  assert.equal((await request(rolePath, { role: 'Member' }, admin.cookie)).status, 200)
  assert.equal((await request('/manage/movies', undefined, account.cookie)).status, 403)
  assert.equal((await request('/admin/users', undefined, account.cookie)).status, 403)
  assert.deepEqual((await request('/auth/me', undefined, account.cookie)).body.roles, ['Member'])
})
