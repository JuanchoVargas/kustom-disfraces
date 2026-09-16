import { type PromocionActiva, promocionesVigentes } from '~~/shared/utils/promociones'

/**
 * RELOJ DE LAS PROMOCIONES. El servidor decide si una promoción está activa con su
 * propio reloj (UTC en Vercel; las fechas del archivo llevan zona -05:00) y la UI
 * recibe esa decisión en los datos. Nunca se usa el reloj del navegador.
 *
 * NUXT_PROMO_AHORA: override de la hora para probar en un Preview
 * (p. ej. "2026-09-18T12:00:00-05:00"). Solo se respeta si VERCEL_ENV !== 'production';
 * en producción se ignora aunque esté definida. Con el override activo el checkout
 * solo acepta dry_run (ver server/api/checkout/mercadopago.post.ts).
 */
export function promoOverrideActivo(): boolean {
  const raw = String(useRuntimeConfig().promoAhora || '').trim()
  if (!raw) return false
  if (process.env.VERCEL_ENV === 'production') return false
  return !Number.isNaN(Date.parse(raw))
}

export function ahoraPromo(): Date {
  if (promoOverrideActivo()) return new Date(String(useRuntimeConfig().promoAhora).trim())
  return new Date()
}

/** Promociones vigentes ahora mismo, según el reloj del servidor (u override en Preview). */
export function promocionesActivas(): PromocionActiva[] {
  return promocionesVigentes(ahoraPromo())
}
