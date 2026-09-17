// Verifica SIN RED el corte temprano de rutas de escáneres
// (server/middleware/00.rutas-basura.ts): qué se corta y, sobre todo, que NINGUNA
// ruta real del sitio cae en el corte.
//
//   node scripts/test-rutas-basura.mjs
//
// Las rutas reales se sacan del propio repo: páginas de app/pages, endpoints de
// server/api y server/routes, slugs del catálogo y archivos de public/.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.defineEventHandler = fn => fn
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root } })
const { esRutaBasura, RUTAS_BASURA } = await jiti.import('../server/middleware/00.rutas-basura.ts')

let fallos = 0
const ok = (cond, msg, extra = '') => { if (cond) console.log(`✅ ${msg}`); else { fallos++; console.error(`❌ ${msg}${extra ? ` — ${extra}` : ''}`) } }

console.log('Patrones:', RUTAS_BASURA.map(String).join('  '))

const CORTADAS = [
  '/wp-admin/install.php', '/wp-login.php', '/wp-admin/', '/wp-content/plugins/x/readme.txt', '/wp-includes/wlwmanifest.xml', '/wp-json/wp/v2/users',
  '/xmlrpc.php', '/index.php', '/admin/config.php', '/producto/shell.PHP', '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  '/.env', '/.git/config', '/.git/HEAD', '/cgi-bin/luci',
  '/wp-login.php?redirect_to=x', '/.env?x=1',
]
for (const p of CORTADAS) ok(esRutaBasura(p) === true, `se corta  ${p}`)

// ---------- rutas reales del sitio ----------
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const rel = (p, base) => p.slice(base.length).replace(/\\/g, '/')
const paginas = walk(join(root, 'app/pages')).map(p => '/' + rel(p, join(root, 'app/pages/')).replace(/\.vue$/, '').replace(/(^|\/)index$/, '').replace(/\[([^\]]+)\]/g, 'ejemplo-$1'))
const apis = walk(join(root, 'server/api')).filter(p => p.endsWith('.ts')).map(p => '/api/' + rel(p, join(root, 'server/api/')).replace(/\.(get|post|put|delete|patch)\.ts$/, '').replace(/\.ts$/, '').replace(/(^|\/)index$/, '').replace(/\[([^\]]+)\]/g, 'ejemplo'))
const rutasServer = walk(join(root, 'server/routes')).map(p => '/' + rel(p, join(root, 'server/routes/')).replace(/\.ts$/, ''))
const publicos = walk(join(root, 'public')).map(p => '/' + rel(p, join(root, 'public/')))
const catalogo = JSON.parse(readFileSync(join(root, 'app/data/catalogo.json'), 'utf8'))
const nav = JSON.parse(readFileSync(join(root, 'app/data/navegacion.json'), 'utf8'))
const productos = catalogo.filter(p => p.slug).map(p => `/producto/${p.slug}`)
const categorias = (nav.publicos ?? []).map(p => `/categoria/${p.slug}`)
const fijas = [
  '/', '/checkout', '/carrito', '/pago-exitoso', '/pago-fallido', '/pago-pendiente', '/pago-exitoso?status=approved&payment_id=1',
  '/admin', '/admin/chats', '/admin/inventario', '/admin/chats?c=12', '/categoria/ninos?sub=super', '/buscar?q=batman',
  '/api/whatsapp', '/api/messenger', '/api/webhooks/mercadopago', '/api/checkout/mercadopago', '/api/stock', '/api/promociones', '/api/version', '/api/products',
  '/api/cron/keepalive', '/api/media/0123456789abcdef0123456789abcdef', '/api/inventario/productos/001001008/imagenes',
  '/_nuxt/entry.abc123.js', '/_nuxt/builds/meta/x.json', '/_ipx/w_400/images/products/batman.webp', '/__nuxt_error',
  '/sitemap.xml', '/robots.txt', '/favicon.ico', '/manifest.webmanifest', '/catalogo-kustom.pdf', '/images/products/batman.webp',
]
const reales = [...new Set([...fijas, ...paginas, ...apis, ...rutasServer, ...publicos, ...productos, ...categorias])]
const caidas = reales.filter(esRutaBasura)
ok(caidas.length === 0, `ninguna de las ${reales.length} rutas reales cae en el corte (${paginas.length} páginas, ${apis.length} endpoints, ${publicos.length} archivos de public/, ${productos.length} productos, ${categorias.length} categorías)`, caidas.slice(0, 5).join(', '))
for (const grupo of ['/', '/producto/batman', '/categoria/ninos', '/checkout', '/pago-exitoso', '/admin/chats', '/api/whatsapp', '/_nuxt/entry.abc123.js']) ok(!esRutaBasura(grupo), `pasa      ${grupo}`)
ok(!walk(join(root, 'public')).some(p => /\.php$/i.test(p)) && !walk(join(root, 'app/pages')).some(p => /(^|\/)wp-/.test(rel(p, root))), 'el repo no tiene ningún .php ni ruta /wp-* propia')

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto')
process.exit(fallos ? 1 : 0)
