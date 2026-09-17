import type { InvChangeOrigin, InvOpIds, InvOpResult, InvOperation, InvVariationState } from '~~/shared/types/inventory'

/**
 * Escrituras: una o varias operaciones sobre variaciones (por SKU de talla).
 *   { operaciones: [{op:'price', sku, regular_price, sale_price} | {op:'stock', sku, stock_quantity}],
 *     origen?: 'panel'|'masivo'|'importacion'|'script', autor?: string }
 * 1 operación → updateVariationPrice/Stock; varias → bulkUpdate (batch de 100 en Woo).
 * Devuelve un resultado por operación (ok/error + antes/después) Y `variaciones`:
 * el ESTADO FINAL consolidado por SKU de talla, que es lo que el panel aplica a la
 * grilla sin recargar. Nunca 500 por una operación inválida: se reporta en su fila.
 */
const ORIGENES: InvChangeOrigin[] = ['panel', 'masivo', 'importacion', 'script', 'prueba']
const MAX_OPS = 2000

/**
 * Consolida los resultados por SKU: sobre una misma talla se envían hasta DOS
 * operaciones (precio y stock), cada una con su propio `after`. Se fusionan en un
 * único estado final. Si CUALQUIERA de ellas falló, el SKU queda `ok:false` con el
 * motivo — el panel lo pinta en rojo y no lo cuenta como aplicado.
 */
function estadoFinalPorSku(resultados: (InvOpResult | { sku: string, ok: boolean, error?: string })[]): InvVariationState[] {
  const out = new Map<string, InvVariationState>()
  for (const r of resultados) {
    let cur = out.get(r.sku)
    if (!cur) { cur = { sku: r.sku, ok: true }; out.set(r.sku, cur) }
    if (r.ok) Object.assign(cur, (r as InvOpResult).after ?? {})
    else {
      cur.ok = false
      cur.error = cur.error ? `${cur.error} · ${r.error ?? 'error'}` : (r.error ?? 'error')
    }
  }
  return [...out.values()]
}

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const body = await readBody<{ operaciones?: unknown, origen?: unknown, autor?: unknown }>(event).catch(() => ({} as any))
  const raw = Array.isArray(body?.operaciones) ? body.operaciones : []
  if (!raw.length) throw createError({ statusCode: 400, statusMessage: 'sin_operaciones' })
  if (raw.length > MAX_OPS) throw createError({ statusCode: 413, statusMessage: `maximo_${MAX_OPS}_operaciones` })

  // ¿Solo productos publicados? Etapas 3 y 4 del plan de activación escriben precios
  // SOLO sobre publicados. Bajar NUXT_INVENTORY_WOO_ONLY_DRAFTS levanta la guarda de
  // borradores pero NO habilita borradores por sí solo: hace falta este filtro
  // explícito, que el panel manda en esas etapas.
  const soloPublicados = body?.solo_publicados === true

  const operaciones: InvOperation[] = []
  const invalid: { sku: string, error: string }[] = []
  const num = (v: unknown) => Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  for (const r of raw as any[]) {
    const sku = String(r?.sku ?? '').trim()
    if (!sku) { invalid.push({ sku: '', error: 'sku vacío' }); continue }
    const bloqueo = SKUS_BLOQUEADOS[sku]
    if (bloqueo) { invalid.push({ sku, error: `bloqueado — ${bloqueo}` }); continue }
    const ids = {
      ...(Number(r?.product_id) > 0 ? { product_id: Number(r.product_id) } : {}),
      ...(Number(r?.variation_id) > 0 ? { variation_id: Number(r.variation_id) } : {}),
    }
    // Lo que el panel mostraba al decidir (ver InvOpIds.esperado). Solo tipos simples.
    const e = r?.esperado && typeof r.esperado === 'object' ? r.esperado as Record<string, unknown> : null
    if (e) {
      (ids as InvOpIds).esperado = {
        ...(typeof e.manage_stock === 'boolean' ? { manage_stock: e.manage_stock } : {}),
        ...(e.stock_quantity === null || Number.isFinite(Number(e.stock_quantity)) ? { stock_quantity: e.stock_quantity === null ? null : Number(e.stock_quantity) } : {}),
        ...(typeof e.regular_price === 'string' ? { regular_price: e.regular_price } : {}),
        ...(typeof e.sale_price === 'string' ? { sale_price: e.sale_price } : {}),
      }
    }
    if (r?.op === 'price') {
      // NUNCA escribir un precio normal en 0: en Woo eso publica el producto como
      // gratis. Los 118 SKU en cero son borradores sin precio cargado; se saltan y
      // se reportan, jamás se escriben.
      const reg = num(r.regular_price)
      if (r.regular_price === null || r.regular_price === undefined || String(r.regular_price).trim() === '' || !Number.isFinite(reg) || reg <= 0) {
        invalid.push({ sku, error: `precio normal en 0 o vacío: no se escribe (valor recibido: ${JSON.stringify(r.regular_price)})` })
        continue
      }
      operaciones.push({ op: 'price', sku, regular_price: r.regular_price, sale_price: r.sale_price ?? null, ...ids })
    }
    else if (r?.op === 'stock') operaciones.push({ op: 'stock', sku, stock_quantity: Number(r.stock_quantity), manage_stock: r.manage_stock === false ? false : true, ...ids })
    else invalid.push({ sku, error: `op desconocida: ${String(r?.op)}` })
  }
  const origenRaw = String(body?.origen ?? 'panel') as InvChangeOrigin
  const ctx = {
    origen: ORIGENES.includes(origenRaw) ? origenRaw : 'panel' as InvChangeOrigin,
    // Quién escribe. Solo se acepta un nombre de NUXT_PANEL_AUTORES: un valor
    // inventado queda en null antes que ensuciar el historial con firmas que no
    // se pueden agrupar ("Lesly", "lesly", "Lesly "). Los scripts no pasan por
    // aquí; usan /aplicar-woo, que sí admite texto libre y ya se distingue por
    // `origen: 'script'`.
    autor: autorValido(body?.autor),
  }
  const store = getInventoryStore()

  // Filtro explícito de publicados: se resuelve ANTES de escribir y lo que no pasa
  // se reporta como fallido, no se ignora en silencio.
  let aEscribir = operaciones
  if (soloPublicados && operaciones.length) {
    const productos = (await loadInventory()).products
    const statusPorSku = new Map<string, string>()
    for (const p of productos) for (const v of p.variations) statusPorSku.set(v.sku, p.status)
    aEscribir = []
    for (const op of operaciones) {
      const st = statusPorSku.get(op.sku)
      if (st === 'publish') aEscribir.push(op)
      else invalid.push({ sku: op.sku, error: `solo_publicados: el producto está en "${st ?? 'desconocido'}"` })
    }
  }

  // Siempre por bulkUpdate: es el camino que respeta los ids explícitos de cada
  // operación. La ruta de "una sola operación" resolvía por SKU otra vez.
  const resultados = aEscribir.length ? await store.bulkUpdate(aEscribir, ctx) : []
  const all = [...resultados, ...invalid.map(i => ({ sku: i.sku, ok: false, error: i.error }))]
  // Lógica de agotado + alertas: recalcular el estado de stock y avisar de lo que
  // acaba de quedar bajo/agotado (best-effort; nunca falla la escritura por esto).
  const alerta = await alertarTrasEscritura(resultados, ctx.origen).catch(err => ({ avisadas: 0, enviado: false, error: String((err as Error)?.message ?? err) }))
  const variaciones = estadoFinalPorSku(all)
  return {
    backend: store.backend,
    simulation: store.simulation,
    ok: all.filter(r => r.ok).length,
    fallidas: all.filter(r => !r.ok).length,
    resultados: all,
    // Estado final por talla: lo que el panel aplica a la grilla al instante.
    variaciones,
    tallas_ok: variaciones.filter(v => v.ok).length,
    tallas_fallidas: variaciones.filter(v => !v.ok).length,
    alerta,
  }
})
