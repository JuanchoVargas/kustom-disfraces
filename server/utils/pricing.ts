import type { ProductoCatalogo } from '~~/shared/types/catalogo'
import { precioEfectivo } from '~~/shared/utils/promociones'
import { CATALOGO_LOCAL, getWooCatalogo } from './woo'
import { promocionesActivas } from './promoClock'

/**
 * Fuente de verdad de precios en el SERVIDOR (seguridad — Fase 3). El endpoint de
 * pago y el webhook NO confían en el precio que manda el cliente: lo recalculan
 * por SKU desde el mismo catálogo autoritativo que consume el sitio.
 *
 * `DATA_SOURCE=local` (default) -> catalogo.json empaquetado.
 * `DATA_SOURCE=woo` -> catálogo Woo->interno cacheado (server/utils/woo.ts).
 */

export interface PriceEntry {
  /** Precio unitario real en COP (entero): el que se COBRA. Con promoción vigente ya lleva el descuento. */
  price: number
  /** Precio pleno (sin promoción). Igual a `price` cuando no hay promoción. */
  precioPleno: number
  /** Id y nombre de la promoción por fecha aplicada (app/data/promociones.json), o null. */
  promoId: string | null
  promoNombre: string | null
  /** Nombre oficial (para el título del ítem en MP y la línea de la orden). */
  name: string
  /** Slug oficial (para el picture_url público). */
  slug: string
}

async function authoritativeCatalogo(): Promise<ProductoCatalogo[]> {
  const dataSource = useRuntimeConfig().public.dataSource
  return dataSource === 'woo' ? await getWooCatalogo() : CATALOGO_LOCAL
}

/**
 * Mapa SKU -> {precio, nombre, slug} de los productos VENDIBLES (disponibles en
 * web y con precio oficial). Un SKU ausente aquí no es vendible: se rechaza.
 *
 * PROMOCIONES POR FECHA: se aplican AQUÍ, después del caché del catálogo y con el
 * reloj del servidor en cada llamada (server/utils/promoClock.ts), así el inicio y
 * el fin son exactos al segundo y no dependen de la ventana de 2 min de Woo.
 */
export async function getPriceMapBySku(): Promise<Map<string, PriceEntry>> {
  const catalogo = await authoritativeCatalogo()
  const activas = promocionesActivas()
  const map = new Map<string, PriceEntry>()
  for (const it of catalogo) {
    if (it.disponibleWeb !== true) continue
    if (typeof it.precio !== 'number' || it.precio <= 0) continue
    const { precio, precioPleno, promo } = precioEfectivo(it.codigo, it.precio, activas)
    map.set(it.codigo, { price: precio, precioPleno, promoId: promo?.id ?? null, promoNombre: promo?.nombre ?? null, name: it.nombre, slug: (it.slug as string) || '' })
  }
  return map
}
