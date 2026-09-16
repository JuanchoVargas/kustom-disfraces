import type { PromocionActiva } from '~~/shared/utils/promociones'

export interface PromoState {
  /** Instante que usó el servidor para decidir (ISO). Informativo. */
  ahora: string | null
  activas: PromocionActiva[]
}

/**
 * PROMOCIONES POR FECHA (Batman Day). Durante el SSR trae de /api/promociones las
 * promociones vigentes según el RELOJ DEL SERVIDOR y las hidrata en
 * useState('promo-activas'); useProducts las aplica (precio, precio pleno tachado,
 * cinta "-40 %", texto en la PDP). El navegador nunca decide con su propia hora.
 * Si el endpoint falla, no hay promoción: los precios quedan como siempre.
 */
export default defineNuxtPlugin(async () => {
  const promo = useState<PromoState | null>('promo-activas', () => null)
  if (import.meta.server && !promo.value) {
    try {
      const r = await $fetch<{ ahora: string, activas: PromocionActiva[] }>('/api/promociones')
      promo.value = { ahora: r?.ahora ?? null, activas: Array.isArray(r?.activas) ? r.activas : [] }
    }
    catch (err) {
      console.error('[promo] /api/promociones falló; sin promociones en esta petición.', err)
      promo.value = { ahora: null, activas: [] }
    }
  }
})
