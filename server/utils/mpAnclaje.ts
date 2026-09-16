/**
 * PRECIO ANCLADO de un pago de Mercado Pago (promociones por fecha).
 *
 * Al crear la preferencia, el checkout guarda en la metadata `kustom_lineas`:
 * JSON de [sku, talla, cantidad, precio unitario, promo] por línea, tal como se
 * COBRÓ. Aquí se lee esa metadata y se construyen las líneas de la orden de Woo:
 *
 *  - metadata AUSENTE (preferencias anteriores a esta versión): mismo resultado que
 *    antes, línea por línea (precio real del servidor, si no el pagado).
 *  - metadata OK: el precio anclado manda sobre el recálculo; la suma anclada se
 *    compara con `transaction_amount` (lo que cobró MP, SIN financiación de cuotas:
 *    `total_paid_amount` sí la incluye y por eso no se usa).
 *  - metadata ILEGIBLE o que no casa: comportamiento anterior + motivo de ajuste
 *    manual, para que ventas lo revise.
 *
 * Funciones PURAS: no lanzan, no tocan red ni BD, no dependen de Nitro. Cualquier
 * error aquí jamás debe cambiar la respuesta a MP (el webhook las envuelve además
 * en try/catch).
 */

export interface LineaAnclada {
  sku: string
  talla: string
  cantidad: number
  precio: number
  promo: string
}

export type Anclaje =
  | { estado: 'ausente' }
  | { estado: 'invalida', motivo: string }
  | { estado: 'ok', lineas: LineaAnclada[] }

/** Ítem tal como llega en payment.additional_info.items (MP). */
export interface ItemMp {
  id?: string
  title?: string
  quantity?: string | number
  unit_price?: string | number
}

/** Precio real del servidor para un SKU (server/utils/pricing.ts). */
export interface PrecioReal { price: number, name: string, slug: string }

/** Línea lista para la orden de Woo (mismo shape que construía el webhook). */
export interface LineaOrden {
  sku?: string
  title: string
  name: string
  talla: string
  slug?: string
  quantity: number
  unitPrice: number
  /** true si el precio salió de la metadata anclada. */
  anclada: boolean
}

/** Lee `kustom_lineas` de la metadata del pago. Nunca lanza. */
export function leerAnclaje(metadata: unknown): Anclaje {
  const md = metadata as Record<string, unknown> | null | undefined
  if (!md || typeof md !== 'object' || !('kustom_lineas' in md)) return { estado: 'ausente' }
  const raw = md.kustom_lineas
  if (raw === undefined || raw === null || raw === '') return { estado: 'ausente' }
  let arr: unknown
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw
  }
  catch {
    return { estado: 'invalida', motivo: 'kustom_lineas no es JSON' }
  }
  if (!Array.isArray(arr) || !arr.length) return { estado: 'invalida', motivo: 'kustom_lineas vacío o no es una lista' }
  const lineas: LineaAnclada[] = []
  for (const l of arr) {
    if (!Array.isArray(l)) return { estado: 'invalida', motivo: 'línea anclada con forma inesperada' }
    const [sku, talla, cantidad, precio, promo] = l as unknown[]
    const p = Math.round(Number(precio))
    const q = Math.trunc(Number(cantidad))
    if (!sku || typeof sku !== 'string' || !Number.isFinite(p) || p <= 0 || !Number.isFinite(q) || q < 1) {
      return { estado: 'invalida', motivo: `línea anclada inválida (${String(sku ?? '?')})` }
    }
    lineas.push({ sku, talla: String(talla ?? '').trim(), cantidad: q, precio: p, promo: String(promo ?? '') })
  }
  return { estado: 'ok', lineas }
}

/**
 * Línea anclada para un sku + talla. Exacta por sku y talla; si la talla no casa
 * (p. ej. MP devolvió el título sin talla) cae a la ÚNICA línea de ese sku; con
 * varias tallas del mismo sku y sin talla que case, no adivina (undefined).
 */
export function precioAnclado(lineas: LineaAnclada[], sku: string | undefined, talla: string | null | undefined): LineaAnclada | undefined {
  if (!sku) return undefined
  const t = String(talla ?? '').trim()
  const delSku = lineas.filter(l => l.sku === sku)
  if (!delSku.length) return undefined
  const exacta = delSku.find(l => l.talla === t)
  if (exacta) return exacta
  return delSku.length === 1 ? delSku[0] : undefined
}

/**
 * Construye las líneas de la orden. Con `anclaje.estado === 'ausente'` reproduce
 * exactamente el comportamiento anterior del webhook. Devuelve además los motivos
 * de AJUSTE MANUAL (metadata ilegible, línea sin precio anclado) y advertencias
 * informativas (precio pagado distinto del real, anclado distinto del actual).
 */
export function construirLineas(
  items: ItemMp[],
  priceMap: Map<string, PrecioReal> | null,
  anclaje: Anclaje,
  tallaDesdeTitulo: (titulo: string) => string | null,
): { lineas: LineaOrden[], ajustes: string[], advertencias: string[] } {
  const ajustes: string[] = []
  const advertencias: string[] = []
  if (anclaje.estado === 'invalida') ajustes.push(`metadata de precios ilegible (${anclaje.motivo}); se recalculó el precio`)

  const lineas = items.map((it): LineaOrden => {
    const sku = it.id ? String(it.id) : undefined
    const real = sku ? priceMap?.get(sku) : undefined
    const paidPrice = Number(it.unit_price) || 0
    const title = String(it.title ?? 'Producto')
    const m = title.match(/^(.*?)\s*\(Talla\s*(.+?)\)\s*$/) // separa nombre y talla del título compuesto
    const talla = tallaDesdeTitulo(title)
    const anclado = anclaje.estado === 'ok' ? precioAnclado(anclaje.lineas, sku, talla) : undefined
    if (anclaje.estado === 'ok' && !anclado) {
      ajustes.push(`${sku ?? '?'}${talla ? ` talla ${talla}` : ''}: sin precio anclado en la metadata; se recalculó`)
    }
    if (anclado) {
      if (real && real.price !== anclado.precio) advertencias.push(`${sku}: anclado ${anclado.precio} (hoy ${real.price}${anclado.promo ? `, promo ${anclado.promo}` : ''})`)
    }
    else if (real && real.price !== paidPrice) {
      advertencias.push(`${sku}: pagado=${paidPrice} real=${real.price} — se usa el real`)
    }
    return {
      sku,
      title, // nombre+talla (línea de la orden en Woo)
      name: real?.name ?? (m ? m[1] : title), // nombre limpio (correo)
      talla: talla ?? '—', // talla (correo y resolución de la variación)
      slug: real?.slug || undefined, // foto pública (correo)
      quantity: Math.max(1, Math.trunc(Number(it.quantity) || 1)),
      // Anclado > real del servidor > pagado según MP.
      unitPrice: anclado?.precio ?? real?.price ?? paidPrice,
      anclada: !!anclado,
    }
  })
  return { lineas, ajustes, advertencias }
}

/**
 * Con precios anclados, la suma de las líneas debe coincidir con `transaction_amount`
 * (lo cobrado por MP; hoy no hay envío ni descuentos de MP). Devuelve el motivo de
 * ajuste manual o null. Solo tiene sentido si alguna línea quedó anclada.
 */
export function verificarMontos(lineas: LineaOrden[], transactionAmount: unknown): string | null {
  if (!lineas.some(l => l.anclada)) return null
  const cobrado = Math.round(Number(transactionAmount) || 0)
  const anclado = Math.round(lineas.reduce((n, l) => n + l.unitPrice * l.quantity, 0))
  return anclado === cobrado ? null : `total anclado ${anclado} ≠ cobrado por MP (transaction_amount) ${cobrado}`
}
