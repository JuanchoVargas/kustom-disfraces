// Prueba de ESCRITURA en WooCommerce con la llave "Checkout Orders v2"
// (WOO_ORDERS_CONSUMER_KEY / WOO_ORDERS_CONSUMER_SECRET en .env). Las llaves de
// Woo no distinguen recursos: si crea órdenes, también puede editar productos.
//
// Qué hace (SOLO sobre un producto EN BORRADOR, nunca uno publicado):
//   1. Busca el primer producto variable con status=draft y variaciones.
//   2. Lee su primera variación (precio regular actual).
//   3. PUT regular_price = actual + 1 → verifica leyendo de nuevo.
//   4. PUT regular_price = actual (revierte) → verifica.
//   5. Prueba también el endpoint batch (misma variación, mismo valor: sin cambio neto).
// Sale con código 0 si todo casó; 1 si algo falló (y deja el precio como estaba).
//
//   node scripts/test-woo-escritura.mjs [--sku 001003001]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function loadEnv() {
  const env = {}
  const raw = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim()
  }
  return env
}
const env = loadEnv()
const BASE = env.WOO_API_URL
const KEY = env.WOO_ORDERS_CONSUMER_KEY || env.NUXT_WOO_ORDERS_CONSUMER_KEY
const SECRET = env.WOO_ORDERS_CONSUMER_SECRET || env.NUXT_WOO_ORDERS_CONSUMER_SECRET
if (!BASE || !KEY || !SECRET) {
  console.error('❌ Falta WOO_API_URL / WOO_ORDERS_CONSUMER_KEY / WOO_ORDERS_CONSUMER_SECRET en .env')
  process.exit(1)
}
const args = process.argv.slice(2)
const wantSku = args[args.indexOf('--sku') + 1]
const redact = s => String(s).replace(/consumer_(key|secret)=[^&\s"']+/g, '$1=***')

async function woo(path, { method = 'GET', body, query = {} } = {}) {
  const qs = new URLSearchParams({ ...query, consumer_key: KEY, consumer_secret: SECRET })
  const res = await fetch(`${BASE}/wp-json/wc/v3${path}?${qs}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${redact(typeof json === 'string' ? json : JSON.stringify(json)).slice(0, 300)}`)
  return json
}

let fails = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) fails++ }

const t0 = Date.now()
// 1. producto en borrador
let product
if (wantSku) {
  product = (await woo('/products', { query: { sku: wantSku } }))[0]
  if (!product) { console.error(`❌ No existe el SKU ${wantSku}`); process.exit(1) }
  if (product.status !== 'draft') { console.error(`❌ ${wantSku} NO está en borrador (status=${product.status}); la prueba solo toca borradores`); process.exit(1) }
}
else {
  const drafts = await woo('/products', { query: { status: 'draft', type: 'variable', per_page: 20 } })
  product = drafts.find(p => p.sku && (p.variations?.length ?? 0) > 0)
}
if (!product) { console.error('❌ No hay producto variable en borrador con variaciones'); process.exit(1) }
console.log(`Producto de prueba: ${product.sku} "${product.name}" (id ${product.id}, status ${product.status})`)
check('llave de escritura lee productos', true, `${Date.now() - t0} ms`)

// 2. variación
const vars = await woo(`/products/${product.id}/variations`, { query: { per_page: 5 } })
const v = vars[0]
if (!v) { console.error('❌ Sin variaciones'); process.exit(1) }
const original = v.regular_price ?? ''
const base = Number(original) || 1000
console.log(`Variación: ${v.sku} (id ${v.id}) regular_price actual = "${original}"`)

const restore = async () => {
  const back = await woo(`/products/${product.id}/variations/${v.id}`, { method: 'PUT', body: { regular_price: original } })
  return back.regular_price === original
}

try {
  // 3. cambiar
  const changed = await woo(`/products/${product.id}/variations/${v.id}`, { method: 'PUT', body: { regular_price: String(base + 1) } })
  check('PUT variación acepta escritura', changed.regular_price === String(base + 1), `respuesta regular_price=${changed.regular_price}`)
  const reread = await woo(`/products/${product.id}/variations/${v.id}`)
  check('relectura confirma el cambio', reread.regular_price === String(base + 1), `regular_price=${reread.regular_price}`)

  // 4. revertir
  check('revertido al valor original', await restore(), `regular_price="${original}"`)
  const reread2 = await woo(`/products/${product.id}/variations/${v.id}`)
  check('relectura confirma la reversión', reread2.regular_price === original)

  // 5. batch (sin cambio neto)
  const batch = await woo(`/products/${product.id}/variations/batch`, { method: 'POST', body: { update: [{ id: v.id, regular_price: original }] } })
  check('POST variations/batch responde', Array.isArray(batch.update) && batch.update[0]?.id === v.id, `update[0].regular_price=${batch.update?.[0]?.regular_price}`)
}
catch (err) {
  check('escritura', false, redact(err.message))
  try { await restore(); console.log('↩️  precio restaurado') } catch (e) { console.error('⚠️ NO se pudo restaurar:', redact(e.message)) }
}

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ La llave escribe: el adaptador woo puede probarse (NUXT_INVENTORY_BACKEND=woo).')
process.exit(fails ? 1 : 0)
