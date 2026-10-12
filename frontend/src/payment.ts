export interface PaymentFields { cardholder: string; cardNumber: string; expiry: string; cvv: string }
export interface CheckoutFields extends PaymentFields { contactName: string; contactEmail: string }
export type CheckoutErrors = Partial<Record<keyof CheckoutFields, string>>

export function formatExpiry(value: string, previous = ''): string {
  if (previous.endsWith('/') && value === previous.slice(0, -1)) return value.slice(0, -1)
  const digits = value.replace(/\D/g, '').slice(0, 4)
  return digits.length >= 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

export function validateCheckout(fields: CheckoutFields, guest: boolean): CheckoutErrors {
  const errors: CheckoutErrors = {}
  if (guest) {
    if (fields.contactName.trim().length < 2 || fields.contactName.trim().length > 80) errors.contactName = 'Ad soyad alanını doldurun (2-80 karakter).'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contactEmail) || fields.contactEmail.length > 254) errors.contactEmail = 'Geçerli bir e-posta adresi girin.'
  }
  if (fields.cardholder.trim().length < 2 || fields.cardholder.trim().length > 80) errors.cardholder = 'Kart üzerindeki adı doldurun (2-80 karakter).'
  if (fields.cardNumber.length > 19 || !/^[0-9]{16}$/.test(fields.cardNumber.replace(/ /g, ''))) errors.cardNumber = 'Kart numarası 16 rakam olmalıdır.'
  if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(fields.expiry)) errors.expiry = 'AA/YY biçiminde girin (örnek: 12/29).'
  if (!/^[0-9]{3}$/.test(fields.cvv)) errors.cvv = 'CVV 3 rakam olmalıdır.'
  return errors
}
