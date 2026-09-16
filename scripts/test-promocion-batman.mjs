// Verifica SIN RED ni BD la promoción por fecha (app/data/promociones.json) con
// fecha SIMULADA: antes, en el borde de inicio, en medio, en el borde de cierre
// (23:59:59 del último día) y después (00:00:00 del día siguiente).
//
//   node scripts/test-promocion-batman.mjs
//
// Carga la lógica REAL vía jiti: shared/utils/promociones.ts (precio de cobro y de
// la línea), server/utils/promoClock.ts (reloj del servidor con NUXT_PROMO_AHORA),
// server/utils/productSearch.ts + botReplies.ts (lo que cotiza el bot) y la misma
// fórmula de cinta que usan ProductCard y la PDP. pricing.ts y useProducts.ts no se
// pueden cargar fuera de Nitro/Nuxt: se comprueba sobre la fuente que ambos pasan
// por precioEfectivo (un solo lugar calcula el descuento).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
process.env.VERCEL_ENV = 'preview' // el override de hora solo vale fuera de producción
let AHORA = ''
globalThis.useRuntimeConfig = () => ({ promoAhora: AHORA, public: { siteUrl: 'https://www.disfraceskustom.com' }, botTextoPromocion: '' })

const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const P = await jiti.import('../shared/utils/promociones.ts')
const C = await jiti.import('../server/utils/promoClock.ts')
const S = await jiti.import('../server/utils/productSearch.ts')
const B = await jiti.import('../server/utils/botReplies.ts')
const catalogo = JSON.parse(readFileSync(`${root}app/data/catalogo.json`, 'utf8'))
const promo = JSON.parse(readFileSync(`${root}app/data/promociones.json`, 'utf8'))[0]

let fallos = 0
const ok = (cond, msg) => { if (cond) console.log(`✅ ${msg}`); else { fallos++; console.error(`❌ ${msg}`) } }
const precioDe = codigo => catalogo.find(p => p.codigo === codigo)?.precio
const cinta = (precio, pleno) => Math.round((1 - precio / pleno) * 100) // misma fórmula que ProductCard/PDP
const fmt = n => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

console.log(`Promoción: ${promo.id} · ${promo.pct} % · ${promo.codigos.join(', ')} · ${promo.desde} → ${promo.hasta}`)
ok(promo.codigos.every(c => catalogo.some(p => p.codigo === c && p.disponibleWeb)), 'todos los códigos de la promoción existen en el catálogo y están visibles')

const INSTANTES = [
  ['antes',          '2026-09-16T23:59:59-05:00', false],
  ['borde inicio',   '2026-09-17T00:00:00-05:00', true],
  ['en medio',       '2026-09-18T12:00:00-05:00', true],
  ['borde cierre',   '2026-09-19T23:59:59-05:00', true],
  ['después',        '2026-09-20T00:00:00-05:00', false],
]
const ESPERADO = { '001001008': 95400, '001002010': 41400, '001008003': 66000 }
const OTROS = ['001010001', '001001001', '001006004-P']

for (const [nombre, iso, activa] of INSTANTES) {
  AHORA = iso
  console.log(`\n── ${nombre}: ${iso} ──`)
  const ahora = C.ahoraPromo()
  ok(ahora.toISOString() === new Date(iso).toISOString(), 'el reloj del servidor usa la hora simulada (NUXT_PROMO_AHORA)')
  const activas = C.promocionesActivas()
  ok((activas.length > 0) === activa, `promoción ${activa ? 'ACTIVA' : 'inactiva'} (activas=${activas.length})`)

  for (const codigo of promo.codigos) {
    const pleno = precioDe(codigo)
    const { precio, precioPleno, promo: pr } = P.precioEfectivo(codigo, pleno, activas) // = pricing.ts (cobro) y línea de la orden
    if (activa) {
      ok(precio === ESPERADO[codigo] && precioPleno === pleno && pr?.id === promo.id, `${codigo}: cobro ${fmt(precio)} (pleno ${fmt(pleno)}, ${promo.pct} %)`)
      ok(cinta(precio, precioPleno) === promo.pct, `${codigo}: cinta -${cinta(precio, precioPleno)} %`)
      ok(precio % 100 === 0, `${codigo}: múltiplo de 100`)
    }
    else {
      ok(precio === pleno && !pr, `${codigo}: precio pleno ${fmt(precio)} sin promoción`)
    }
  }
  for (const codigo of OTROS) {
    const pleno = precioDe(codigo)
    const r = P.precioEfectivo(codigo, pleno, activas)
    ok(r.precio === pleno && !r.promo, `${codigo}: otro producto no cambia (${fmt(pleno)})`)
  }

  // Bot: mismo util, mismo reloj.
  const batman = S.searchProducts('batman')?.matches.find(m => m.codigo === '001001008')
  ok(!!batman && batman.precio === (activa ? 95400 : 159000), `bot: "batman" cotiza ${fmt(batman?.precio ?? 0)}`)
  const bati = S.getProductBySlug('batichica')
  ok(!!bati && bati.precio === (activa ? 66000 : 110000) && (!!bati.promo === activa), `bot: ficha de Batichica ${fmt(bati?.precio ?? 0)}${activa ? ' con promo' : ''}`)
  const thor = S.getProductBySlug('thor')
  ok(!!thor && !thor.promo && thor.precio === precioDe(thor.codigo), 'bot: Thor sin promoción')
  const out = B.buildReplies({ from: '570000000088', canal: 'wa', kind: 'text', text: 'batichica' }, { step: '', flaggedForHuman: false, updatedAt: Date.now() })
  const txt = JSON.stringify(out.replies)
  ok(txt.includes(activa ? '66.000' : '110.000') && txt.includes('Batman Day') === activa, `bot: la ficha por WhatsApp dice ${activa ? '$66.000 y Batman Day' : '$110.000 sin Batman Day'}`)
}

// Un solo lugar calcula el descuento: cobro (pricing.ts), UI (useProducts.ts), bot
// (productSearch.ts) y preferencia/orden (metadata anclada) pasan por precioEfectivo.
console.log('\n── un solo cálculo ──')
const usa = (f, re) => re.test(readFileSync(`${root}${f}`, 'utf8'))
ok(usa('server/utils/pricing.ts', /precioEfectivo\(/) && usa('server/utils/pricing.ts', /promocionesActivas\(\)/), 'pricing.ts (cobro y validación del checkout) usa precioEfectivo con el reloj del servidor')
ok(usa('app/composables/useProducts.ts', /precioEfectivo\(/) && !usa('app/composables/useProducts.ts', /new Date\(/), 'useProducts.ts usa precioEfectivo con la decisión hidratada, sin reloj del navegador')
ok(usa('server/utils/productSearch.ts', /precioEfectivo\(/), 'productSearch.ts (bot) usa precioEfectivo')
ok(usa('server/api/checkout/mercadopago.post.ts', /kustom_lineas/) && usa('server/api/webhooks/mercadopago.post.ts', /kustom_lineas/), 'la preferencia ancla el precio por línea y el webhook lo lee')
ok(!usa('server/utils/pricing.ts', /\* \(1 - |\* 0\.6|0\.4 \*/) && !usa('app/composables/useProducts.ts', /\* \(1 - /), 'nadie recalcula el 40 % por su cuenta')
ok(usa('server/utils/promoClock.ts', /VERCEL_ENV === 'production'/), 'el override de hora se ignora en producción')
ok(usa('server/api/checkout/mercadopago.post.ts', /promoOverrideActivo\(\)/) && usa('server/api/checkout/mercadopago.post.ts', /promo_override/), 'con el override activo el checkout solo acepta dry_run (403 promo_override)')

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto')
process.exit(fallos ? 1 : 0)
