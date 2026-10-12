import { t } from './i18n'
import { useState } from 'react'

export default function PdfDownload({ id, code }: { id: string; code: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function download() {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/bookings/${id}/pdf`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('PDF indirilemedi. Oturumunu kontrol edip tekrar dene.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url; link.download = `Cinema-${code}.pdf`
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="pdf-download"><button type="button" className="button primary" onClick={download} disabled={busy}>{busy ? t("PDF hazırlanıyor…") : t("PDF bilet indir")}<span aria-hidden="true">↓</span></button>{error && <p className="error" role="alert">{t(error)}</p>}</div>
}
