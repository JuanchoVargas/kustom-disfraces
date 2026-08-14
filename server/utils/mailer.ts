import nodemailer from 'nodemailer'

/**
 * Transporte SMTP compartido (Hostinger) — mismas credenciales que el formulario
 * de mayoristas (runtimeConfig, solo servidor). Lo usan /api/mayoristas y el
 * correo de confirmación de pago (Fase 4).
 */

export function mailerConfigured(): boolean {
  const c = useRuntimeConfig()
  return !!(c.smtpHost && c.smtpUser && c.smtpPass)
}

export function createMailTransport() {
  const c = useRuntimeConfig()
  const port = Number(c.smtpPort) || 465
  return nodemailer.createTransport({
    host: c.smtpHost,
    port,
    secure: port === 465, // 465 = SSL directo; 587 = STARTTLS
    auth: { user: c.smtpUser, pass: c.smtpPass },
  })
}
