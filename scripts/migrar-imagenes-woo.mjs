// MIGRACIÓN de las fotos locales (public/images/products, las que muestra la
// web) a WooCommerce como imagen principal + galería, respetando el orden de
// catalogo.json. Para cada producto visible: sube las fotos que falten a la
// biblioteca de WordPress (≤1600 px, WebP 85, nombre = SKU) y deja la lista de
// imágenes del producto en Woo igual a la lista local.
//
//   node scripts/migrar-imagenes-woo.mjs                       → VISTA PREVIA (no sube ni escribe)
//   node scripts/migrar-imagenes-woo.mjs --sku 001010001        → vista previa de UN producto
//   node scripts/migrar-imagenes-woo.mjs --sku 001010001 --aplicar
//   node scripts/migrar-imagenes-woo.mjs --aplicar              → todo (SOLO después de probar uno)
//
// COPIA DE SEGURIDAD: con --aplicar guarda antes backups/imagenes-woo-<fecha>.json
// con la lista de imágenes actual de cada producto en Woo (ids y URLs). Para
// revertir un producto: PUT /products/<id> con esas images.
//
// Corre DIRECTO contra Woo/WordPress (no pasa por el servidor): necesita en .env
//   WOO_API_URL, WOO_CONSUMER_KEY/SECRET (lectura), WOO_WRITE_CONSUMER_KEY/SECRET
//   (o WOO_ORDERS_*) y WP_APP_USER / WP_APP_PASSWORD (contraseña de aplicación).
// Reutiliza las imágenes que ya existen en la biblioteca si el nombre coincide
// (idempotente: se puede repetir sin duplicar).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = {}
for (const l of readFileSync(`${root}.env`, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim() }
const args = process.argv.slice(2)
const APLICAR = args.includes('--aplicar')
const skus = args.flatMap((a, i) => (a === '--sku' && args[i + 1] ? args[i + 1].split(',') : [])).map(s => s.trim()).filter(Boolean)
const BASE = env.WOO_API_URL
const RK = env.WOO_CONSUMER_KEY, RS = env.WOO_CONSUMER_SECRET
const WK = env.WOO_WRITE_CONSUMER_KEY || env.NUXT_WOO_WRITE_CONSUMER_KEY || env.WOO_ORDERS_CONSUMER_KEY || env.NUXT_WOO_ORDERS_CONSUMER_KEY
const WS = env.WOO_WRITE_CONSUMER_SECRET || env.NUXT_WOO_WRITE_CONSUMER_SECRET || env.WOO_ORDERS_CONSUMER_SECRET || env.NUXT_WOO_ORDERS_CONSUMER_SECRET
const WPU = env.WP_APP_USER || env.NUXT_WP_APP_USER, WPP = (env.WP_APP_PASSWORD || env.NUXT_WP_APP_PASSWORD || '').replace(/\s+/g, '')
if (!BASE || !RK || !RS) { console.error('❌ Faltan WOO_API_URL / WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET en .env'); process.exit(1) }
if (APLICAR && (!WK || !WS || !WPU || !WPP)) { console.error('❌ Para --aplicar faltan la llave de escritura de Woo y/o WP_APP_USER / WP_APP_PASSWORD en .env'); process.exit(1) }
const redact = s => String(s).replace(/consumer_(key|secret)=[^&\s"']+/g, '$1=***').replace(/Basic\s+\S+/g, 'Basic ***')
const wooQ = (write) => `consumer_key=${write ? WK : RK}&consumer_secret=${write ? WS : RS}`
const wpAuth = `Basic ${Buffer.from(`${WPU}:${WPP}`).toString('base64')}`

async function woo(path, { method = 'GET', body, write = false } = {}) {
  const res = await fetch(`${BASE}/wp-json/wc/v3${path}${path.includes('?') ? '&' : '?'}${wooQ(write)}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${redact(j?.message ?? JSON.stringify(j)).slice(0, 200)}`)
  return j
}
async function wpFind(filename) {
  const res = await fetch(`${BASE}/wp-json/wp/v2/media?search=${encodeURIComponent(filename.replace(/\.webp$/, ''))}&per_page=20`, { headers: { Authorization: wpAuth } })
  if (!res.ok) return null
  const list = await res.json()
  return list.find(m => (m.source_url ?? '').split('/').pop() === filename || m.slug === filename.replace(/\.webp$/, '').replace(/\./g, '-') + '-webp' || m.slug === filename.replace(/\.webp$/, '')) ?? null
}
async function wpUpload(data, filename, title, alt) {
  const res = await fetch(`${BASE}/wp-json/wp/v2/media`, { method: 'POST', headers: { 'Authorization': wpAuth, 'Content-Type': 'image/webp', 'Content-Disposition': `attachment; filename="${filename}"` }, body: data })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`wp/v2/media → ${res.status} ${redact(j?.message ?? JSON.stringify(j)).slice(0, 200)}`)
  await fetch(`${BASE}/wp-json/wp/v2/media/${j.id}`, { method: 'POST', headers: { 'Authorization': wpAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, alt_text: alt }) }).catch(() => {})
  return j
}

// ---- plan ----
const catalogo = JSON.parse(readFileSync(`${root}app/data/catalogo.json`, 'utf8'))
const visibles = catalogo.filter(p => p.disponibleWeb && p.imagenes?.length && (!skus.length || skus.includes(p.codigo)))
const wooAll = []
for (let page = 1; page <= 3; page++) { const b = await woo(`/products?per_page=100&page=${page}&status=any`); wooAll.push(...b); if (b.length < 100) break }
const wooBySku = new Map(wooAll.map(p => [p.sku, p]))
const plan = []
for (const p of visibles) {
  const w = wooBySku.get(p.codigo)
  if (!w) { plan.push({ sku: p.codigo, nombre: p.nombre, error: 'no existe en Woo' }); continue }
  const locales = p.imagenes.map(rel => `${root}public${rel}`)
  const faltan = locales.filter(f => !existsSync(f))
  const nombres = p.imagenes.map((_, i) => (i === 0 ? `${p.codigo}.webp` : `${p.codigo}-${i + 1}.webp`))
  plan.push({ sku: p.codigo, nombre: p.nombre, wooId: w.id, status: w.status, actualesWoo: (w.images ?? []).map(i => ({ id: i.id, name: (i.src ?? '').split('/').pop() })), locales: p.imagenes, nombres, faltan })
}
const conError = plan.filter(x => x.error || x.faltan?.length)
console.log(`\nProductos visibles con fotos locales: ${visibles.length}${skus.length ? ` (filtro --sku ${skus.join(',')})` : ''} · fotos locales en total: ${visibles.reduce((n, p) => n + p.imagenes.length, 0)} · con problema: ${conError.length}`)
console.log('SKU'.padEnd(13), 'PRODUCTO'.padEnd(30), 'WOO HOY'.padEnd(14), '→ DESPUÉS (orden local)')
for (const x of plan) {
  if (x.error) { console.log(x.sku.padEnd(13), x.nombre.slice(0, 29).padEnd(30), `❌ ${x.error}`); continue }
  const hoy = `${x.actualesWoo.length} img (${x.status})`
  console.log(x.sku.padEnd(13), x.nombre.slice(0, 29).padEnd(30), hoy.padEnd(14), `${x.nombres.length} img: ${x.nombres.join(', ')}${x.faltan?.length ? `  ❌ faltan locales: ${x.faltan.length}` : ''}`)
}
if (!APLICAR) { console.log('\nVista previa. Para subir y escribir en Woo: --aplicar (primero con --sku <uno>).'); process.exit(0) }
if (conError.length) { console.error('\n❌ Hay productos con problema; corrige antes de aplicar.'); process.exit(1) }

// ---- copia de seguridad de lo que Woo tiene HOY ----
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
mkdirSync(`${root}backups`, { recursive: true })
const bk = `${root}backups/imagenes-woo-${stamp}.json`
writeFileSync(bk, JSON.stringify(plan.map(x => ({ sku: x.sku, wooId: x.wooId, images: wooBySku.get(x.sku)?.images ?? [] })), null, 2))
console.log(`\n💾 Copia de seguridad de las imágenes actuales en Woo: ${bk}`)

// ---- aplicar ----
let subidas = 0, reutilizadas = 0, escritos = 0, fallos = 0
for (const x of plan) {
  try {
    const ids = []
    for (let i = 0; i < x.locales.length; i++) {
      const filename = x.nombres[i]
      const existente = await wpFind(filename)
      if (existente) { ids.push(existente.id); reutilizadas++; continue }
      const raw = readFileSync(`${root}public${x.locales[i]}`)
      const data = await sharp(raw).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
      const m = await wpUpload(data, filename, `${x.nombre} (${x.sku})`, x.nombre)
      ids.push(m.id); subidas++
      process.stdout.write(`  ↑ ${filename} (${Math.round(data.length / 1024)} KB, id ${m.id})\n`)
    }
    await woo(`/products/${x.wooId}`, { method: 'PUT', body: { images: ids.map(id => ({ id })) }, write: true })
    escritos++
    console.log(`✅ ${x.sku} ${x.nombre}: ${ids.length} imágenes (${ids.join(',')})`)
  }
  catch (err) {
    fallos++
    console.log(`❌ ${x.sku} ${x.nombre}: ${redact(err.message)}`)
  }
}
console.log(`\nProductos escritos: ${escritos} · fotos subidas: ${subidas} · reutilizadas de la biblioteca: ${reutilizadas} · fallos: ${fallos}`)
process.exit(fallos ? 1 : 0)
