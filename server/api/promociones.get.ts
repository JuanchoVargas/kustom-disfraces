import { ahoraPromo, promoOverrideActivo, promocionesActivas } from '../utils/promoClock'

/**
 * GET /api/promociones — promociones vigentes AHORA según el reloj del servidor.
 * Público (solo códigos, porcentajes y fechas). Lo hidrata app/plugins/promo.ts en
 * el SSR para que la UI muestre precio, tachado y cinta sin usar el reloj del
 * navegador. Sin caché: el inicio y el fin son exactos al segundo.
 */
export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return {
    ahora: ahoraPromo().toISOString(),
    override: promoOverrideActivo(),
    activas: promocionesActivas(),
  }
})
