// "APLICAR OVERRIDES A WOO" — el día del cambio de adaptador (mock → woo).
// Toma las sobreescrituras hechas en modo simulación (inventory_overrides) y las
// escribe en WooCommerce a través del servidor (adaptador woo, batch de 100),
// registrando cada cambio en inventory_changes con origen 'script'.
//
//   node scripts/aplicar-overrides-woo.mjs [baseUrl]                       → VISTA PREVIA (no escribe)
//   node scripts/aplicar-overrides-woo.mjs [baseUrl] --aplicar             → escribe en Woo
//
// SUBCONJUNTO (obligatorio para la primera ejecución real: UN solo producto):
//   --sku 001003001            solo ese producto (todas sus tallas); repetible, o coma-separado
//   --sku 001003001-T4         solo esa talla
//   --estado draft|publish     solo productos en ese estado
//   --limite N                 como mucho N sobreescrituras
//
// COPIA DE SEGURIDAD: con --aplicar se descarga ANTES el Excel completo del
// catálogo (una fila por talla, valores actuales) en backups/inventario-<fecha>.xlsx.
// Si algo sale mal, se reimporta desde el panel (Importar → Previsualizar → Aplicar)
// y se vuelve a aplicar a Woo. Se omite con --sin-backup (no recomendado).
//
// Requiere NUXT_INBOX_PASSWORD en .env (misma contraseña del panel) y, para
// --aplicar, la llave de escritura configurada en el servidor destino.
// baseUrl por defecto http://localhost:3000 (usar la URL de producción para aplicar
// contra el servidor real, que es el que tiene la BD con las sobreescrituras).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const SIN_BACKUP = args.includes('--sin-backup')
const BASE = args.find(a => a.startsWith('http')) ?? 'http://localhost:3000'
const opt = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null }
const skus = args.flatMap((a, i) => (a === '--sku' && args[i + 1] ? args[i + 1].split(',') : [])).map(s => s.trim()).filter(Boolean)
const estado = opt('--estado')
const limite = opt('--limite') ? Number(opt('--limite')) : null
if (estado && estado !== 'draft' && estado !== 'publish') { console.error('❌ --estado debe ser draft o publish'); process.exit(1) }
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
const filtro = { solo: skus, estado: estado ?? undefined, limite: limite ?? undefined }
const filtroTxt = [skus.length ? `sku=${skus.join(',')}` : '', estado ? `estado=${estado}` : '', limite ? `limite=${limite}` : ''].filter(Boolean).join(' · ') || 'todas'

// ---- vista previa (siempre) ----
const prev = await api('/aplicar-woo', { preview: true, ...filtro })
console.log(`\nFiltro: ${filtroTxt}`)
console.log(`Sobreescrituras pendientes en total: ${prev.filtro?.pendientes_total ?? prev.total} · seleccionadas: ${prev.total} · omitidas por el filtro: ${prev.filtro?.omitidas ?? 0} · con cambios reales frente a Woo: ${prev.con_cambios} · llave de escritura en el servidor: ${prev.woo_escritura ? 'sí' : 'NO'}\n`)
if (!prev.total) { console.log('Nada que aplicar con ese filtro.'); process.exit(0) }
console.log('SKU'.padEnd(22), 'PRODUCTO'.padEnd(28), 'ANTES (Woo)'.padEnd(34), '→ DESPUÉS')
for (const f of prev.filas) {
  const a = f.antes, d = f.despues
  const antes = f.error ? f.error : `${cop(a.regular_price)}${a.sale_price ? ` / oferta ${cop(a.sale_price)}` : ''} · stock ${stock(a)}`
  const desp = f.error ? '' : f.sin_cambio ? '(sin cambio: Woo ya coincide)' : `${cop(d.regular_price)}${d.sale_price ? ` / oferta ${cop(d.sale_price)}` : ''} · stock ${stock(d)}`
  console.log(f.sku.padEnd(22), f.producto.slice(0, 27).padEnd(28), antes.padEnd(34), desp)
}

if (!APLICAR) {
  console.log('\nVista previa. Para escribir en Woo: añade --aplicar (y para la primera vez, --sku <un producto en borrador>)')
  process.exit(0)
}
if (!prev.woo_escritura) { console.error('\n❌ El servidor no tiene llave de escritura de Woo'); process.exit(1) }

// ---- copia de seguridad: Excel completo del catálogo ANTES de escribir ----
if (!SIN_BACKUP) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
  const dir = fileURLToPath(new URL('../backups/', import.meta.url))
  mkdirSync(dir, { recursive: true })
  const file = `${dir}inventario-${stamp}.xlsx`
  const res = await fetch(`${BASE}/api/inventario/exportar`, { headers: { cookie } })
  if (!res.ok) { console.error(`❌ No se pudo descargar la copia de seguridad (${res.status}); no se aplica nada.`); process.exit(1) }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 2000) { console.error('❌ La copia de seguridad salió vacía; no se aplica nada.'); process.exit(1) }
  writeFileSync(file, buf)
  console.log(`\n💾 Copia de seguridad: ${file} (${(buf.length / 1024).toFixed(0)} KB, una fila por talla con los valores ACTUALES). Para revertir: Importar ese Excel en el panel y volver a aplicar.`)
}

// ---- aplicar ----
console.log(`\nAplicando (${filtroTxt})…`)
const res = await api('/aplicar-woo', { preview: false, autor: 'aplicar-overrides-woo.mjs', ...filtro })
console.log(`Aplicadas (y retiradas de overrides): ${res.aplicadas} · fallidas: ${res.fallidas} · pendientes del filtro: ${res.pendientes_restantes} · pendientes en total: ${(res.filtro?.pendientes_total ?? 0) - res.aplicadas}`)
for (const r of res.resultados.filter(r => !r.ok)) console.log(`❌ ${r.sku}: ${r.error}`)
if (!res.fallidas && res.aplicadas) console.log('\n✅ Listo. Verifica en WordPress (Productos → el producto → Variaciones) antes de aplicar el resto.')
process.exit(res.fallidas ? 1 : 0)
