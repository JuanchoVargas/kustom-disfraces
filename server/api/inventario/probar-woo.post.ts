import type { InvProduct } from '~~/shared/types/inventory'
import { createWooStore, wooOnlyDrafts } from '../../utils/inventoryWoo'
import { loadInventory, loadProductBySku } from '../../utils/inventorySnapshot'
import { sanitizeWooWriteError, wooWriteCredentials, wooWriteFetch } from '../../utils/wooWrite'

/**
 * PRUEBA EN VIVO del adaptador WOO, SOLO sobre productos EN BORRADOR, sin
 * importar qué adaptador esté activo (NUXT_INVENTORY_BACKEND). Ejercita el
 * camino real del módulo (no llamadas sueltas a la API):
 *   1. updateVariationPrice(+1) en la 1ª talla de un borrador → Woo y snapshot
 *   2. relectura directa en Woo (llave de escritura) confirma el valor
 *   3. revierte con updateVariationPrice(original) → confirma
 *   4. bulkUpdate (batch) en 2 tallas del mismo borrador (+1) → revierte en batch
 *   5. guarda: intenta escribir en un PUBLICADO y espera el bloqueo (sin tocar Woo)
 * Cada paso queda en inventory_changes con origen 'prueba'. Devuelve JSON por paso.
 *   { sku?: '001003001' }  para elegir el borrador.
 */
interface Step { paso: string, ok: boolean, detalle?: unknown }

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const body = await readBody<{ sku?: unknown }>(event).catch(() => ({} as any))
  const steps: Step[] = []
  const t0 = Date.now()
  const cred = wooWriteCredentials()
  if (!cred) return { ok: false, conclusion: 'Sin llave de escritura en este entorno', steps: [{ paso: 'config', ok: false, detalle: 'faltan NUXT_WOO_WRITE_CONSUMER_KEY/_SECRET (ni respaldo NUXT_WOO_ORDERS_*)' }] }
  steps.push({ paso: 'llave de escritura', ok: true, detalle: { origen: cred.origen === 'write' ? 'NUXT_WOO_WRITE_*' : 'respaldo NUXT_WOO_ORDERS_*', solo_borradores: wooOnlyDrafts() } })

  const store = createWooStore()
  const ctx = { origen: 'prueba' as const, autor: 'probar-woo' }
  const { products, origen } = await loadInventory()
  if (origen !== 'woo') return { ok: false, conclusion: 'No hay snapshot de Woo: pulsa "Sincronizar con Woo" primero', steps }

  const wantSku = typeof body?.sku === 'string' ? body.sku.trim() : ''
  let draft: InvProduct | undefined = wantSku
    ? products.find(p => p.sku === wantSku)
    : products.find(p => p.status === 'draft' && p.variations.length >= 2 && p.variations.every(v => v.id > 0))
  if (wantSku && draft && draft.status === 'publish') return { ok: false, conclusion: `${wantSku} está PUBLICADO; solo se prueban borradores`, steps }
  if (!draft) return { ok: false, conclusion: 'No se encontró un borrador con ≥2 variaciones leídas de Woo', steps }
  const v0 = draft.variations[0]!
  const v1 = draft.variations[1] ?? draft.variations[0]!
  const orig0 = v0.regular_price, orig1 = v1.regular_price
  const plus = (s: string) => String((Number(s) || 1000) + 1)
  steps.push({ paso: 'borrador de prueba', ok: true, detalle: { sku: draft.sku, nombre: draft.name, status: draft.status, tallas: [v0.sku, v1.sku], precios: [orig0, orig1] } })

  // Lee la variación DIRECTO en Woo (llave de escritura), con el id del padre
  // correcto: sirve tanto para el borrador de prueba como para el publicado
  // del paso 5 (antes usaba siempre el id del borrador y el publicado daba "?").
  const readWoo = async (productId: number, variationId: number) => (await wooWriteFetch<{ regular_price: string }>(`/products/${productId}/variations/${variationId}`)).regular_price

  try {
    // 1. escritura simple por el adaptador
    const r1 = await store.updateVariationPrice(v0.sku, plus(orig0), v0.sale_price || null, ctx)
    steps.push({ paso: '1. updateVariationPrice(+1) por el adaptador', ok: r1.ok && r1.after?.regular_price === plus(orig0), detalle: r1.error ?? { antes: r1.before?.regular_price, despues: r1.after?.regular_price } })
    // 2. Woo y snapshot coinciden
    const enWoo = await readWoo(draft.id, v0.id)
    const enSnap = (await loadProductBySku(v0.sku))?.variations.find(v => v.sku === v0.sku)?.regular_price
    steps.push({ paso: '2. Woo y snapshot muestran el valor nuevo', ok: enWoo === plus(orig0) && enSnap === plus(orig0), detalle: { woo: enWoo, snapshot: enSnap } })
    // 3. revertir
    const r3 = await store.updateVariationPrice(v0.sku, orig0 || null, v0.sale_price || null, ctx)
    const back = await readWoo(draft.id, v0.id)
    steps.push({ paso: '3. revertir al original (adaptador) y confirmar en Woo', ok: r3.ok && back === orig0, detalle: r3.error ?? { woo: back, esperado: orig0 } })
    // 4. batch
    const r4 = await store.bulkUpdate([
      { op: 'price', sku: v0.sku, regular_price: plus(orig0), sale_price: v0.sale_price || null },
      { op: 'price', sku: v1.sku, regular_price: plus(orig1), sale_price: v1.sale_price || null },
    ], ctx)
    steps.push({ paso: '4. bulkUpdate (variations/batch) en 2 tallas', ok: r4.every(r => r.ok) && r4.length === 2, detalle: r4.map(r => r.ok ? `${r.sku}: ${r.before?.regular_price} → ${r.after?.regular_price}` : `${r.sku}: ${r.error}`) })
    const r4b = await store.bulkUpdate([
      { op: 'price', sku: v0.sku, regular_price: orig0 || null, sale_price: v0.sale_price || null },
      { op: 'price', sku: v1.sku, regular_price: orig1 || null, sale_price: v1.sale_price || null },
    ], ctx)
    const [w0, w1] = await Promise.all([readWoo(draft.id, v0.id), readWoo(draft.id, v1.id)])
    steps.push({ paso: '4b. revertir en batch y confirmar en Woo', ok: r4b.every(r => r.ok) && w0 === orig0 && w1 === orig1, detalle: { woo: [w0, w1], esperado: [orig0, orig1] } })
    // 5. guarda sobre un publicado
    const pub = products.find(p => p.status === 'publish' && p.variations.length && p.variations[0]!.id > 0)
    if (pub) {
      const pv = pub.variations[0]!
      const r5 = await store.updateVariationPrice(pv.sku, plus(pv.regular_price), pv.sale_price || null, ctx)
      const stillWoo = await readWoo(pub.id, pv.id).catch(err => `error al leer: ${sanitizeWooWriteError(err)}`)
      const expectBlock = wooOnlyDrafts()
      steps.push({
        paso: expectBlock ? '5. guarda: escribir en un PUBLICADO se bloquea sin tocar Woo' : '5. guarda desactivada (NUXT_INVENTORY_WOO_ONLY_DRAFTS=false): no se prueba publicados',
        ok: expectBlock ? (!r5.ok && /bloqueado/.test(r5.error ?? '') && stillWoo === pv.regular_price) : true,
        detalle: expectBlock ? { sku: pv.sku, respuesta: r5.error, woo_sigue_en: stillWoo } : 'omitido',
      })
    }
  }
  catch (err) {
    steps.push({ paso: 'error', ok: false, detalle: sanitizeWooWriteError(err) })
    // Intento de dejar los precios como estaban.
    try {
      await store.bulkUpdate([
        { op: 'price', sku: v0.sku, regular_price: orig0 || null, sale_price: v0.sale_price || null },
        { op: 'price', sku: v1.sku, regular_price: orig1 || null, sale_price: v1.sale_price || null },
      ], ctx)
      steps.push({ paso: 'restauración tras error', ok: true })
    }
    catch (e2) {
      steps.push({ paso: 'restauración tras error', ok: false, detalle: `⚠️ restaurar a mano ${v0.sku}="${orig0}" ${v1.sku}="${orig1}": ${sanitizeWooWriteError(e2)}` })
    }
  }
  const ok = steps.every(s => s.ok)
  return { ok, conclusion: ok ? 'Adaptador woo OK sobre borradores (escritura, relectura, reversión, batch y guarda)' : 'Falló algún paso (ver steps)', ms: Date.now() - t0, steps }
})
