// "APLICAR OVERRIDES A WOO" — el día del cambio de adaptador (mock → woo).
// Toma las sobreescrituras hechas en modo simulación (inventory_overrides) y las
// escribe en WooCommerce a través del servidor (adaptador woo, batch de 100),
// registrando cada cambio en inventory_changes con origen 'script'.
//
//   node scripts/aplicar-overrides-woo.mjs [baseUrl]            → VISTA PREVIA (no escribe)
//   node scripts/aplicar-overrides-woo.mjs [baseUrl] --aplicar  → escribe en Woo
//
// Requiere NUXT_INBOX_PASSWORD en .env (misma contraseña del panel) y, para
// --aplicar, WOO_ORDERS_CONSUMER_KEY/SECRET configuradas en el servidor destino.
// baseUrl por defecto http://localhost:3000 (usar la URL de producción para aplicar
// contra el servidor real, que es el que tiene la BD con las sobreescrituras).
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
const args = process.argv.slice(2)
const APLICAR = args.includes('--aplicar')
const BASE = args.find(a => a.startsWith('http')) ?? 'http://localhost:3000'
const PASSWORD = env.NUXT_INBOX_PASSWORD
if (!PASSWORD) { console.error('❌ Falta NUXT_INBOX_PASSWORD en .env'); process.exit(1) }

const login = await fetch(`${BASE}/api/inbox/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
if (!login.ok) { console.error(`❌ Login falló (${login.status}) en ${BASE}`); process.exit(1) }
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
const api = async (path, body) => {
  const res = await fetch(`${BASE}/api/inventario${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} → ${res.status} ${json?.statusMessage ?? json?.message ?? ''}`)
  return json
}
const cop = v => (v === '' || v == null ? '—' : `$${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`)
const stock = v => (v.manage_stock ? String(v.stock_quantity ?? 0) : 'sin gestionar')

// ---- vista previa (siempre) ----
const prev = await api('/aplicar-woo', { preview: true })
console.log(`\nSobreescrituras pendientes: ${prev.total} · con cambios reales frente a Woo: ${prev.con_cambios} · llave de escritura en el servidor: ${prev.woo_escritura ? 'sí' : 'NO'}\n`)
if (!prev.total) { console.log('Nada que aplicar.'); process.exit(0) }
console.log('SKU'.padEnd(22), 'PRODUCTO'.padEnd(28), 'ANTES (Woo)'.padEnd(34), '→ DESPUÉS')
for (const f of prev.filas) {
  const a = f.antes, d = f.despues
  const antes = f.error ? f.error : `${cop(a.regular_price)}${a.sale_price ? ` / oferta ${cop(a.sale_price)}` : ''} · stock ${stock(a)}`
  const desp = f.error ? '' : f.sin_cambio ? '(sin cambio: Woo ya coincide)' : `${cop(d.regular_price)}${d.sale_price ? ` / oferta ${cop(d.sale_price)}` : ''} · stock ${stock(d)}`
  console.log(f.sku.padEnd(22), f.producto.slice(0, 27).padEnd(28), antes.padEnd(34), desp)
}

if (!APLICAR) {
  console.log('\nVista previa. Para escribir en Woo: añade --aplicar')
  process.exit(0)
}
if (!prev.woo_escritura) { console.error('\n❌ El servidor no tiene llave de escritura de Woo'); process.exit(1) }

// ---- aplicar ----
console.log('\nAplicando…')
const res = await api('/aplicar-woo', { preview: false, autor: 'aplicar-overrides-woo.mjs' })
console.log(`Aplicadas (y retiradas de overrides): ${res.aplicadas} · fallidas: ${res.fallidas} · pendientes: ${res.pendientes_restantes}`)
for (const r of res.resultados.filter(r => !r.ok)) console.log(`❌ ${r.sku}: ${r.error}`)
process.exit(res.fallidas ? 1 : 0)
