/**
 * TEMPORAL — prueba de ESCRITURA en WooCommerce desde Vercel con la llave
 * "Checkout Orders v2" (NUXT_WOO_ORDERS_CONSUMER_KEY/_SECRET, Secret en Vercel:
 * no se puede copiar al .env local, por eso la prueba corre aquí).
 *
 * GET /api/admin/test-woo-escritura[?sku=001003001]  — requiere sesión del panel.
 * Solo toca un producto EN BORRADOR: lee su primera variación, escribe
 * regular_price = actual + 1, relee, revierte al valor original y relee.
 * Devuelve un JSON con cada paso. Se BORRA en el commit siguiente.
 */
interface Step { paso: string, ok: boolean, detalle?: unknown }

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const { wooBaseUrl, wooOrdersConsumerKey, wooOrdersConsumerSecret } = useRuntimeConfig()
  const steps: Step[] = []
  const redact = (s: unknown) => String((s as Error)?.message ?? s).replace(/(consumer_key|consumer_secret)=[^&"'\s]+/g, '$1=***')
  const t0 = Date.now()

  if (!wooBaseUrl || !wooOrdersConsumerKey || !wooOrdersConsumerSecret) {
    return { ok: false, steps: [{ paso: 'config', ok: false, detalle: 'faltan NUXT_WOO_BASE_URL / NUXT_WOO_ORDERS_CONSUMER_KEY / _SECRET en el entorno' }] }
  }
  const woo = <T>(path: string, opts: { method?: string, body?: unknown, query?: Record<string, string | number> } = {}) =>
    $fetch<T>(`${wooBaseUrl}/wp-json/wc/v3${path}`, {
      method: (opts.method ?? 'GET') as never,
      body: opts.body as never,
      query: { ...(opts.query ?? {}), consumer_key: wooOrdersConsumerKey, consumer_secret: wooOrdersConsumerSecret },
      timeout: 20_000,
    })

  const wantSku = String(getQuery(event).sku ?? '').trim()
  let product: any
  let variation: any
  let original = ''
  const restore = async () => {
    try {
      const back: any = await woo(`/products/${product.id}/variations/${variation.id}`, { method: 'PUT', body: { regular_price: original } })
      steps.push({ paso: 'revertir al valor original', ok: back.regular_price === original, detalle: { regular_price: back.regular_price } })
      const reread: any = await woo(`/products/${product.id}/variations/${variation.id}`)
      steps.push({ paso: 'relectura confirma la reversión', ok: reread.regular_price === original, detalle: { regular_price: reread.regular_price } })
    }
    catch (err) {
      steps.push({ paso: 'revertir al valor original', ok: false, detalle: `⚠️ NO SE PUDO REVERTIR: ${redact(err)} — restaurar a mano regular_price="${original}" en ${variation?.sku}` })
    }
  }

  try {
    // 1. producto en borrador (llave de escritura leyendo)
    if (wantSku) {
      product = ((await woo<any[]>('/products', { query: { sku: wantSku } })) ?? [])[0]
      if (!product) return { ok: false, steps: [{ paso: 'buscar sku', ok: false, detalle: `no existe ${wantSku}` }] }
      if (product.status !== 'draft') return { ok: false, steps: [{ paso: 'buscar sku', ok: false, detalle: `${wantSku} NO está en borrador (status=${product.status}); solo se tocan borradores` }] }
    }
    else {
      const drafts = await woo<any[]>('/products', { query: { status: 'draft', type: 'variable', per_page: 20 } })
      product = drafts.find(p => p.sku && (p.variations?.length ?? 0) > 0)
      if (!product) return { ok: false, steps: [{ paso: 'buscar borrador', ok: false, detalle: 'no hay producto variable en borrador con variaciones' }] }
    }
    steps.push({ paso: 'la llave lee productos', ok: true, detalle: { sku: product.sku, nombre: product.name, id: product.id, status: product.status, ms: Date.now() - t0 } })

    // 2. primera variación
    const vars = await woo<any[]>(`/products/${product.id}/variations`, { query: { per_page: 5 } })
    variation = vars[0]
    if (!variation) return { ok: false, steps: [...steps, { paso: 'variaciones', ok: false, detalle: 'sin variaciones' }] }
    original = variation.regular_price ?? ''
    const base = Number(original) || 1000
    const nuevo = String(base + 1)
    steps.push({ paso: 'variación de prueba', ok: true, detalle: { sku: variation.sku, id: variation.id, regular_price_actual: original, valor_de_prueba: nuevo } })

    // 3. escribir
    const changed: any = await woo(`/products/${product.id}/variations/${variation.id}`, { method: 'PUT', body: { regular_price: nuevo } })
    steps.push({ paso: 'PUT variación (escritura)', ok: changed.regular_price === nuevo, detalle: { regular_price: changed.regular_price } })
    const reread: any = await woo(`/products/${product.id}/variations/${variation.id}`)
    steps.push({ paso: 'relectura confirma el cambio', ok: reread.regular_price === nuevo, detalle: { regular_price: reread.regular_price } })

    // 4. revertir
    await restore()

    // 5. batch sin cambio neto
    const batch: any = await woo(`/products/${product.id}/variations/batch`, { method: 'POST', body: { update: [{ id: variation.id, regular_price: original }] } })
    steps.push({ paso: 'POST variations/batch responde', ok: Array.isArray(batch?.update) && batch.update[0]?.id === variation.id, detalle: { regular_price: batch?.update?.[0]?.regular_price } })
  }
  catch (err) {
    steps.push({ paso: 'error', ok: false, detalle: redact(err) })
    if (product && variation && !steps.some(s => s.paso.startsWith('revertir'))) await restore()
  }

  const ok = steps.length > 0 && steps.every(s => s.ok)
  return { ok, conclusion: ok ? 'La llave escribe: el adaptador woo puede activarse' : 'Falló algún paso (ver steps)', ms: Date.now() - t0, steps }
})
