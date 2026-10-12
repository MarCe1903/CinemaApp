import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const payment = { cardholder: 'Demo Test', cardNumber: '0000000000000000', expiry: '12/29', cvv: '123' }
const base = process.env.CINEMA_API_URL ?? 'http://localhost:5080'
async function request(path, body, cookie, customHeader = true) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(customHeader ? { 'X-Cinema-Request': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
}

test('MSSQL: üyelik, oturum, bilet, yetki ve eşzamanlı koltuk güvenliği', async () => {
  const movies = await request('/movies')
  assert.equal(movies.status, 200)
  assert.ok(movies.body.length >= 6)
  const screenings = await request(`/movies/${movies.body[0].id}/screenings`)
  assert.ok(screenings.body.length > 0)
  let screening, free
  for (const candidate of screenings.body.toReversed()) {
    const plan = await request(`/screenings/${candidate.id}/seats`)
    const available = [...plan.body.rows].flatMap(row => Array.from({ length: plan.body.columns }, (_, i) => `${row}${i + 1}`)).filter(seat => !plan.body.occupied.includes(seat))
    if (available.length >= 5) { screening = candidate; free = available.slice(0, 5); break }
  }
  assert.ok(screening, 'Test için üç boş koltuk gerekir.')
  assert.equal((await request('/bookings')).status, 401)
  const password = `Test!9a-${randomUUID()}`
  const email = `cinema-test-${randomUUID()}@example.test`
  const first = await request('/auth/register', { name: 'Otomatik Test', email, password })
  assert.equal(first.status, 200)
  assert.ok(first.cookie.includes('Cinema.Session'))
  const second = await request('/auth/register', { name: 'İkinci Test', email: `cinema-test-${randomUUID()}@example.test`, password })
  assert.equal(second.status, 200)
  assert.equal((await request('/auth/me', undefined, first.cookie)).body.email, email)
  assert.equal((await request('/auth/login', { email, password: 'Yanlis!123' })).status, 401)
  assert.equal((await request('/auth/register', { name: 'Tekrar', email, password })).status, 400)
  assert.equal((await request('/bookings', { payment, screeningId: screening.id, seats: [free[0]] }, first.cookie, false)).status, 400)
  assert.equal((await request('/bookings', { payment, screeningId: screening.id, seats: ['Z99'] }, first.cookie)).status, 400)
  assert.equal((await request('/bookings', { payment, screeningId: screening.id, seats: [free[0], free[0]] }, first.cookie)).status, 400)
  for (const invalid of [null, {}, { ...payment, cardholder: '' }, { ...payment, cardNumber: '1234' }, { ...payment, cardNumber: '12345678901234567' }, { ...payment, expiry: '13/29' }, { ...payment, cvv: '12' }]) {
    const rejected = await request('/bookings', { screeningId: screening.id, seats: [free[0]], payment: invalid }, first.cookie)
    assert.equal(rejected.status, 400, 'Eksik veya biçimi hatalı ödeme reddedilmeli.')
  }
  const purchased = await request('/bookings', { payment, screeningId: screening.id, seats: [free[0]], total: 1 }, first.cookie)
  assert.equal(purchased.status, 200)
  assert.equal(purchased.body.total, screening.price, 'Fiyat istemci tarafından değiştirilemez.')
  assert.equal((await request('/bookings', undefined, second.cookie)).body.length, 0, 'Başkasının biletleri görünmemeli.')
  const conflict = await request('/bookings', { payment, screeningId: screening.id, seats: [free[0], free[1]] }, second.cookie)
  assert.equal(conflict.status, 409)
  const afterConflict = await request(`/screenings/${screening.id}/seats`)
  assert.ok(!afterConflict.body.occupied.includes(free[1]), 'Başarısız işlem diğer koltuğu işgal etmemeli.')
  const race = await Promise.all([first, second].map(account => request('/bookings', { payment, screeningId: screening.id, seats: [free[2]] }, account.cookie)))
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409], 'Aynı koltuk yalnızca bir kez satılmalı.')
  const tickets = await request('/bookings', undefined, first.cookie)
  assert.ok(tickets.body.some(ticket => ticket.code === purchased.body.code && ticket.seats.includes(free[0])))
  const memberPdfUrl = `${base}/api/bookings/${purchased.body.id}/pdf`
  assert.equal((await fetch(memberPdfUrl)).status, 404)
  assert.equal((await fetch(memberPdfUrl, { headers: { Cookie: second.cookie } })).status, 404)
  assert.equal((await fetch(memberPdfUrl, { headers: { Cookie: first.cookie } })).headers.get('content-type'), 'application/pdf')

  const guestData = { payment, screeningId: screening.id, seats: [free[3]], contactName: 'Misafir İzleyici', contactEmail: 'guest@example.test' }
  assert.equal((await request('/bookings', { ...guestData, contactEmail: '' })).status, 400)
  const guestRace = await Promise.all([request('/bookings', guestData), request('/bookings', { payment, screeningId: screening.id, seats: [free[3]] }, first.cookie)])
  assert.deepEqual(guestRace.map(result => result.status).sort(), [200, 409], 'Misafir ve üye aynı koltuğu alamamalı.')
  const guest = await request('/bookings', { ...guestData, seats: [free[4]] })
  assert.equal(guest.status, 200)
  assert.equal(guest.body.isGuest, true)
  assert.ok(guest.cookie.includes('Cinema.Guest.'))
  const occupied = await request(`/screenings/${screening.id}/seats`)
  assert.ok(occupied.body.occupied.includes(free[4]))
  assert.equal((await request('/bookings', { ...guestData, seats: [free[4]] }, first.cookie)).status, 409)
  assert.equal((await request('/bookings', undefined, guest.cookie)).status, 401)
  const guestPdfUrl = `${base}/api/bookings/${guest.body.id}/pdf`
  assert.equal((await fetch(guestPdfUrl)).status, 404)
  assert.equal((await fetch(guestPdfUrl, { headers: { Cookie: first.cookie } })).status, 404)
  assert.equal((await fetch(guestPdfUrl, { headers: { Cookie: guest.cookie + 'tampered' } })).status, 404)
  const pdf = await fetch(guestPdfUrl, { headers: { Cookie: guest.cookie } })
  assert.equal(pdf.status, 200)
  assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  assert.ok(pdf.headers.get('content-disposition').includes(guest.body.code))
  assert.equal(pdf.headers.get('cache-control'), 'no-store')
  const bytes = Buffer.from(await pdf.arrayBuffer())
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.ok(bytes.length > 5000)
  await mkdir('artifacts/pdfs', { recursive: true })
  await writeFile('artifacts/pdfs/guest-ticket.pdf', bytes)
  await writeFile('artifacts/pdfs/expected.json', JSON.stringify({ code: guest.body.code, seat: free[4], title: movies.body[0].title }))
  assert.equal((await request('/auth/logout', {}, first.cookie)).status, 204)
  const login = await request('/auth/login', { email, password })
  assert.equal(login.status, 200)
  assert.equal((await request('/auth/me', undefined, login.cookie)).body.email, email)
})

