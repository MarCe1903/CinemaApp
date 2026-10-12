import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatExpiry, validateCheckout } from '../frontend/src/payment.ts'

const valid = { cardholder: 'Test Kullanıcı', cardNumber: '0000 0000 0000 0000', expiry: '12/29', cvv: '123', contactName: 'Misafir', contactEmail: 'demo@example.test' }
test('Son kullanma tarihi yazma, yapıştırma ve silme', () => {
  let value = ''
  for (const digit of '1229') value = formatExpiry(value + digit, value)
  assert.equal(value, '12/29')
  assert.equal(formatExpiry('1229'), '12/29')
  assert.equal(formatExpiry('12/29'), '12/29')
  assert.equal(formatExpiry('12', '12/'), '1')
  assert.equal(formatExpiry('ab122999'), '12/29')
  assert.equal(formatExpiry(''), '')
})
test('Ödeme alanları: boş alanlar, rakam sayıları ve biçim kontrolleri', () => {
  assert.deepEqual(validateCheckout(valid, true), {}, 'Banka doğrulaması olmadan biçimi doğru örnek bilgiler kabul edilmeli.')
  const empty = Object.fromEntries(Object.keys(valid).map(key => [key, '']))
  assert.equal(Object.keys(validateCheckout(empty, true)).length, 6)
  assert.equal(Object.keys(validateCheckout(empty, false)).length, 4)
  for (const cardNumber of ['1'.repeat(15), '1'.repeat(17), 'a'.repeat(16)]) assert.ok(validateCheckout({ ...valid, cardNumber }, false).cardNumber)
  for (const cvv of ['12', '1234', 'abc']) assert.ok(validateCheckout({ ...valid, cvv }, false).cvv)
  for (const expiry of ['00/29', '13/29', '1229', 'aa/bb']) assert.ok(validateCheckout({ ...valid, expiry }, false).expiry)
  assert.ok(validateCheckout({ ...valid, contactEmail: 'invalid' }, true).contactEmail)
  assert.equal(validateCheckout({ ...valid, contactEmail: 'invalid' }, false).contactEmail, undefined)
})
