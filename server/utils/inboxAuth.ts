import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * Sesión de la BANDEJA (/admin/chats): una sola contraseña (NUXT_INBOX_PASSWORD),
 * sin usuarios ni registro. Al validarla se emite una cookie httpOnly firmada
 * (HMAC-SHA256) con fecha de expiración a 7 días. La clave de firma se deriva de
 * la contraseña: cambiarla en Vercel invalida todas las sesiones al instante.
 */

export const INBOX_COOKIE = 'kinbox'
const SESSION_DAYS = 7

function secret(): string {
  return String(useRuntimeConfig().inboxPassword || '')
}

export function inboxConfigured(): boolean {
  return secret().length >= 6
}

function sign(payload: string): string {
  return createHmac('sha256', `${secret()}::kustom-inbox`).update(payload).digest('base64url')
}

export function issueSession(event: H3Event): void {
  const exp = String(Date.now() + SESSION_DAYS * 86_400_000)
  const token = `${exp}.${sign(exp)}`
  setCookie(event, INBOX_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export function clearInboxSession(event: H3Event): void {
  deleteCookie(event, INBOX_COOKIE, { path: '/' })
}

export function hasValidSession(event: H3Event): boolean {
  if (!inboxConfigured()) return false
  const token = getCookie(event, INBOX_COOKIE)
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false
  const expected = sign(exp)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Comparación en tiempo constante de la contraseña. */
export function passwordMatches(candidate: string): boolean {
  const s = secret()
  if (!inboxConfigured() || typeof candidate !== 'string') return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(s)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Lanza 401 si no hay sesión válida (o 503 si la bandeja no está configurada). */
export function requireInbox(event: H3Event): void {
  if (!inboxConfigured()) throw createError({ statusCode: 503, statusMessage: 'inbox_not_configured' })
  if (!hasValidSession(event)) throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
}
