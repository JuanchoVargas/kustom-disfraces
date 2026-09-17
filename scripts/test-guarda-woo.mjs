// GUARDA DE ESCRITURA DEL ADAPTADOR WOO — local, sin red ni base.
//
//   node scripts/test-guarda-woo.mjs
//
// Los tres casos de NUXT_INVENTORY_WOO_ONLY_DRAFTS + NUXT_INVENTORY_WOO_ALLOW:
//   1. ONLY_DRAFTS=true, lista vacía   → borradores sí; ningún publicado.
//   2. ONLY_DRAFTS=true, lista con X   → borradores + X y nada más.
//   3. ONLY_DRAFTS=false               → todo.
// Y que "Probar escritura en Woo" nunca escribe en un publicado.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let cfg = {}
globalThis.useRuntimeConfig = () => ({ public: {}, ...cfg })
globalThis.defineCachedFunction = fn => fn
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const G = await jiti.import('../server/utils/inventoryWoo.ts')

let fails = 0
const ok = (c, t, d = '') => { console.log(`${c ? '✅' : '❌'} ${t}${d ? ` — ${d}` : ''}`); if (!c) fails++ }

const borrador = { id: 900, sku: '001001019', status: 'draft' }
const ladybug = { id: 901, sku: '001006004-P', status: 'publish' }
const batman = { id: 902, sku: '001001008', status: 'publish' }
const roto = { id: 747, sku: '005001001', status: 'draft' } // estructura rota en Woo (inventoryResolve)
const puede = (p, c) => G.bloqueoEscrituraWoo(p, c) === null

// ───────── 1. solo borradores, sin lista ─────────
let c = { onlyDrafts: true, allow: [] }
ok(puede(borrador, c) && !puede(ladybug, c) && !puede(batman, c), '1. ONLY_DRAFTS=true sin lista: borrador sí; publicados no')
ok(/NUXT_INVENTORY_WOO_ONLY_DRAFTS/.test(G.bloqueoEscrituraWoo(batman, c)) && /NUXT_INVENTORY_WOO_ALLOW/.test(G.bloqueoEscrituraWoo(batman, c)), '1. el bloqueo nombra las dos variables')

// ───────── 2. solo borradores + lista de permitidos ─────────
c = { onlyDrafts: true, allow: G.parseWooAllow(' 001006004-P , ,') }
ok(c.allow.length === 1 && c.allow[0] === '001006004-P', '2. la lista se parte por comas, sin espacios ni vacíos', JSON.stringify(c.allow))
ok(puede(borrador, c) && puede(ladybug, c) && !puede(batman, c), '2. ONLY_DRAFTS=true con 001006004-P: borrador + ese código y NADA más')
ok(puede({ ...ladybug, sku: '001006004-p' }, c), '2. el código no distingue mayúsculas')
ok(!puede({ ...batman, sku: '001006004-P-T12' }, c) && !puede({ ...batman, sku: '001006004' }, c) && !puede({ ...batman, sku: '' }, c), '2. coincidencia EXACTA: ni un SKU de talla, ni un prefijo, ni un SKU vacío abren nada')
ok(!puede(batman, { onlyDrafts: true, allow: ['001006004-P-T12'] }), '2. un SKU de variación en la lista no abre su producto')

// ───────── 3. guarda abierta ─────────
c = { onlyDrafts: false, allow: [] }
ok(puede(borrador, c) && puede(ladybug, c) && puede(batman, c), '3. ONLY_DRAFTS=false: se escribe en todo')

// ───────── estructura rota: bloqueada SIEMPRE ─────────
ok(!puede(roto, { onlyDrafts: true, allow: [] }) && !puede(roto, { onlyDrafts: true, allow: ['005001001'] }) && !puede(roto, { onlyDrafts: false, allow: [] }), '4. un producto con estructura rota en Woo no se escribe en ninguno de los tres casos')

// ───────── la guarda real lee la configuración del servidor ─────────
cfg = {}
ok(G.wooOnlyDrafts() === true && G.wooAllowList().length === 0 && G.guardDraft(ladybug) !== null, '5. sin variables: solo borradores y lista vacía (default seguro)')
cfg = { inventoryWooOnlyDrafts: 'true', inventoryWooAllow: '001006004-P' }
ok(G.guardDraft(ladybug) === null && G.guardDraft(batman) !== null && G.guardDraft(borrador) === null, '5. con NUXT_INVENTORY_WOO_ALLOW=001006004-P: Lady Bug sí, Batman no')
cfg = { inventoryWooOnlyDrafts: 'false', inventoryWooAllow: '' }
ok(G.guardDraft(batman) === null, '5. con NUXT_INVENTORY_WOO_ONLY_DRAFTS=false: todo')

// ───────── "Probar escritura en Woo" nunca escribe en un publicado ─────────
const src = readFileSync(new URL('../server/api/inventario/probar-woo.post.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const paso5 = src.slice(src.indexOf('// 5. guarda sobre un publicado'), src.indexOf('  catch (err) {'))
const iGuarda = paso5.indexOf('const bloqueo = guardDraft(pub)')
const iSinBloqueo = paso5.indexOf('if (!bloqueo) {')
const iElse = paso5.indexOf('else {', iSinBloqueo)
const iEscritura = paso5.indexOf('store.updateVariationPrice(pv.sku')
ok(iGuarda > 0 && iSinBloqueo > iGuarda && iElse > iSinBloqueo && iEscritura > iElse, '6. paso 5: primero pregunta a la guarda; la escritura solo existe en la rama donde BLOQUEA')
ok((paso5.match(/updateVariationPrice\(/g) || []).length === 1 && !/bulkUpdate\(/.test(paso5), '6. paso 5: una única llamada de escritura, dentro de esa rama')
const ramaSinBloqueo = paso5.slice(iSinBloqueo, iElse)
ok(/ok: false/.test(ramaSinBloqueo) && !/store\./.test(ramaSinBloqueo) && /sin tocar/.test(ramaSinBloqueo), '6. si la guarda NO bloquea: falla y no llama al adaptador (precios sin tocar)')
ok(/!permitidos\.includes\(p\.sku\.toLowerCase\(\)\)/.test(paso5), '6. el publicado de la prueba nunca es uno de la lista de permitidos')

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo correcto')
process.exitCode = fails ? 1 : 0
