import type { ProductoCatalogo } from '~~/shared/types/catalogo'
import { CATALOGO_LOCAL, getWooCatalogo } from './woo'

/**
 * Fuente de verdad de precios en el SERVIDOR (seguridad — Fase 3). El endpoint de
 * pago y el webhook NO confían en el precio que manda el cliente: lo recalculan
 * por SKU desde el mismo catálogo autoritativo que consume el sitio.
 *
 * `DATA_SOURCE=local` (default) -> catalogo.json empaquetado.
 * `DATA_SOURCE=woo` -> catálogo Woo->interno cacheado (server/utils/woo.ts).
 */

export interface PriceEntry {
  /** Precio unitario real en COP (entero). */
  price: number
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
 */
export async function getPriceMapBySku(): Promise<Map<string, PriceEntry>> {
  const catalogo = await authoritativeCatalogo()
  const map = new Map<string, PriceEntry>()
  for (const it of catalogo) {
    if (it.disponibleWeb !== true) continue
    if (typeof it.precio !== 'number' || it.precio <= 0) continue
    map.set(it.codigo, { price: it.precio, name: it.nombre, slug: (it.slug as string) || '' })
  }
  return map
}
