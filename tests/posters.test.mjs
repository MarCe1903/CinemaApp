import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
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
function chunk(type, payload) {
  const data = Buffer.concat([Buffer.from(type), payload])
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4)
  head.writeUInt32BE(payload.length); tail.writeUInt32BE((~crc) >>> 0)
  return Buffer.concat([head, data, tail])
}
function png(width = 240, height = 360, variant = 0) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3
    const bar = x > width * .2 && x < width * .8 && ((y > height * .3 && y < height * .35) || (y > height * .55 && y < height * .6))
    pixels[offset] = bar ? 213 : 15 + variant
    pixels[offset + 1] = bar ? 246 : 25 + Math.floor(y / height * 35)
    pixels[offset + 2] = bar ? 107 : 30 + Math.floor(x / width * 45)
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

test('PNG afiş yükleme, kalıcılık, güncelleme, doğrulama ve eski afişlerin korunması', async () => {
  assert.ok((await request('/health')).body.features.includes('movie-posters'))
  const before = await request('/movies')
  assert.equal(before.status, 200)
  assert.ok(process.env.CINEMA_TEST_ADMIN_PASSWORD, 'Set CINEMA_TEST_ADMIN_PASSWORD for the dedicated test database admin account.')
  const admin = await request('/auth/login', { email: process.env.CINEMA_TEST_ADMIN_USER ?? 'admin', password: process.env.CINEMA_TEST_ADMIN_PASSWORD })
  assert.equal(admin.status, 200)
  const image = png()
  await mkdir('artifacts/posters', { recursive: true })
  await writeFile('artifacts/posters/test-poster.png', image)
  const input = { title: `PNG Afiş Testi ${randomUUID().slice(0,8)}`, tagline: 'PNG test', description: 'PNG yükleme testi', genre: 'Dram', art: 'city', duration: 90, age: 'Genel', rating: 8, director: 'Test Yönetmen', posterPng: image.toString('base64') }
  assert.equal((await request('/manage/movies', input)).status, 401)
  const member = await request('/auth/register', { name: 'Afiş Testi', email: `poster-${randomUUID()}@example.test`, password: `Test!9a-${randomUUID()}` })
  assert.equal((await request('/manage/movies', input, member.cookie)).status, 403)
  const created = await request('/manage/movies', input, admin.cookie)
  assert.equal(created.status, 200)
  const id = created.body.id
  const find = async () => (await request('/movies')).body.find(m => m.id === id)
  try {
    const saved = await find()
    assert.ok(saved.posterUrl.startsWith(`/api/movies/${id}/poster?v=`))
    assert.ok(!JSON.stringify(saved).includes(input.posterPng), 'Katalogda görselin tamamı gönderilmemeli.')
    const response = await fetch(`${base}${saved.posterUrl}`)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image)
    const { posterPng, ...metadata } = input
    assert.equal((await request(`/manage/movies/${id}`, { ...metadata, title: `${input.title} Güncel` }, admin.cookie)).status, 200)
    assert.equal((await find()).posterUrl, saved.posterUrl, 'Yalnızca film bilgileri değişirse afiş korunmalı.')
    const corrupted = Buffer.from(image); corrupted[corrupted.length - 1] ^= 1
    for (const bad of ['not-base64!', Buffer.from('fake.png').toString('base64'), image.subarray(0,40).toString('base64'), corrupted.toString('base64'), png(8001,1).toString('base64'), Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')]) {
      assert.equal((await request(`/manage/movies/${id}`, { ...metadata, posterPng: bad }, admin.cookie)).status, 400)
      assert.equal((await find()).posterUrl, saved.posterUrl, 'Geçersiz yükleme eski afişi bozmamalı.')
    }
    const replacement = png(240,360,40)
    assert.equal((await request(`/manage/movies/${id}`, { ...metadata, posterPng: replacement.toString('base64') }, admin.cookie)).status, 200)
    const replaced = await find()
    assert.notEqual(replaced.posterUrl, saved.posterUrl, 'Yeni afişte tarayıcı önbellek anahtarı değişmeli.')
    assert.deepEqual(Buffer.from(await (await fetch(`${base}${replaced.posterUrl}`)).arrayBuffer()), replacement)
    assert.equal((await request(`/manage/movies/${id}`, { ...metadata, removePoster: true }, admin.cookie)).status, 200)
    assert.equal((await find()).posterUrl, null)
    assert.equal((await find()).art, 'city')
    assert.equal((await fetch(`${base}/api/movies/${id}/poster`)).status, 404)
    assert.equal((await request(`/manage/movies/${id}`, input, admin.cookie)).status, 200)
    const after = (await request('/movies')).body
    for (const original of before.body) {
      const current = after.find(m => m.id === original.id)
      if (current) { assert.equal(current.art, original.art); assert.equal(current.posterUrl, original.posterUrl) }
    }
  } finally {
    assert.equal((await request(`/manage/movies/${id}/delete`, {}, admin.cookie)).status, 204)
  }
  assert.equal((await fetch(`${base}/api/movies/${id}/poster`)).status, 404)
})
