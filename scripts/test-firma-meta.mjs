// Verifica SIN RED EXTERNA la firma de los webhooks de Meta (server/utils/metaFirma.ts).
// Levanta un servidor h3 en 127.0.0.1 con un handler que hace exactamente lo que
// hacen /api/whatsapp y /api/messenger en su primera línea: verificarFirmaMeta(event)
// y parsear el JSON desde el cuerpo CRUDO.
//
//   node scripts/test-firma-meta.mjs
//
// Casos: firma válida → pasa (con tildes y emoji en el cuerpo, que es donde falla
// firmar un JSON re-serializado); sin firma, firma alterada, cuerpo alterado, firma de
// otro secreto, formato inválido y variable ausente → 401 en WhatsApp. Messenger va en
// MODO OBSERVACIÓN (no se confirmó que comparta la app de Meta): nunca rechaza, solo
// deja el log [meta-firma] … observación; con firma válida no deja log.
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let CONFIG = { metaAppSecret: 'secreto-de-prueba-wa', messengerAppSecret: '' }
globalThis.useRuntimeConfig = () => CONFIG

const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root } })
const F = await jiti.import('../server/utils/metaFirma.ts')
const { createApp, createRouter, eventHandler, toNodeListener } = await import('h3')

const app = createApp()
const router = createRouter()
for (const canal of ['whatsapp', 'messenger']) {
  router.post(`/api/${canal}`, eventHandler(async (event) => {
    const crudo = await F.verificarFirmaMeta(event, canal, canal === 'messenger' ? { soloObservar: true } : {})
    const body = F.jsonDeCrudo(crudo)
    return { ok: true, texto: body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ?? body?.entry?.[0]?.messaging?.[0]?.message?.text ?? null }
  }))
}
app.use(router)
const server = createServer(toNodeListener(app))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const B = `http://127.0.0.1:${server.address().port}`

// Silencia los avisos [meta-firma] y comprueba que no llevan cuerpo ni firma.
const avisos = []
const warnReal = console.warn
console.warn = (...a) => avisos.push(a.join(' '))

let fallos = 0
const ok = (cond, msg, extra = '') => { if (cond) console.log(`✅ ${msg}`); else { fallos++; console.error(`❌ ${msg}${extra ? ` — ${extra}` : ''}`) } }
const firmar = (raw, secreto) => 'sha256=' + createHmac('sha256', secreto).update(raw).digest('hex')
const post = async (ruta, raw, headers = {}) => {
  const r = await fetch(B + ruta, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

// Cuerpo con la forma real de un mensaje de texto de Meta, con tildes, ñ y emoji, y
// con los no-ASCII ESCAPADOS como los manda Meta (\uXXXX): re-serializarlo lo cambiaría.
const TEXTO = 'prueba bloque: niño, acción 🎃'
const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Perfil De Prueba' }, wa_id: '570000000001' }], messages: [{ from: '570000000001', id: 'wamid.PRUEBA-FIRMA-1', timestamp: '0', type: 'text', text: { body: TEXTO } }] } }] }] })
  .replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
const raw = Buffer.from(cuerpo, 'utf8')
const SECRETO = CONFIG.metaAppSecret

let r = await post('/api/whatsapp', raw, { 'x-hub-signature-256': firmar(raw, SECRETO) })
ok(r.status === 200 && r.json.texto === TEXTO, 'firma válida → 200 y el JSON se parsea desde el cuerpo crudo (tildes y emoji intactos)', JSON.stringify(r))
ok(JSON.stringify(JSON.parse(cuerpo)) !== cuerpo && firmar(Buffer.from(JSON.stringify(JSON.parse(cuerpo))), SECRETO) !== firmar(raw, SECRETO), '(control) el JSON re-serializado tendría OTRA firma: por eso se verifica el cuerpo crudo')

r = await post('/api/whatsapp', raw)
ok(r.status === 401, 'sin cabecera X-Hub-Signature-256 → 401', String(r.status))
const buena = firmar(raw, SECRETO)
r = await post('/api/whatsapp', raw, { 'x-hub-signature-256': buena.slice(0, -1) + (buena.endsWith('0') ? '1' : '0') })
ok(r.status === 401, 'firma alterada (un dígito) → 401', String(r.status))
r = await post('/api/whatsapp', Buffer.from(cuerpo.replace('570000000001', '570000000002')), { 'x-hub-signature-256': buena })
ok(r.status === 401, 'cuerpo alterado con la firma original → 401', String(r.status))
r = await post('/api/whatsapp', raw, { 'x-hub-signature-256': firmar(raw, 'otro-secreto') })
ok(r.status === 401, 'firma hecha con otro secreto → 401', String(r.status))
for (const [nombre, h] of [['sin prefijo sha256=', buena.slice(7)], ['sha1', 'sha1=' + 'a'.repeat(40)], ['hex corto', 'sha256=abcd'], ['vacía', ''], ['no hex', 'sha256=' + 'z'.repeat(64)]]) {
  r = await post('/api/whatsapp', raw, { 'x-hub-signature-256': h })
  ok(r.status === 401, `formato inválido (${nombre}) → 401, nunca 500`, String(r.status))
}
r = await post('/api/whatsapp', Buffer.alloc(0), { 'x-hub-signature-256': firmar(Buffer.alloc(0), SECRETO) })
ok(r.status === 401, 'cuerpo vacío → 401', String(r.status))

CONFIG = { metaAppSecret: '', messengerAppSecret: '' }
r = await post('/api/whatsapp', raw, { 'x-hub-signature-256': buena })
ok(r.status === 401, 'variable NUXT_META_APP_SECRET ausente → 401 (fail-closed) aunque la firma fuera buena', String(r.status))
const antesObs = avisos.length
r = await post('/api/messenger', raw, { 'x-hub-signature-256': buena })
ok(r.status === 200 && avisos.slice(antesObs).some(a => /observación: sin_variable/.test(a)), 'Messenger (observación) sin ningún secreto → 200 y log "observación: sin_variable"', String(r.status))

// Messenger: mismo secreto por defecto; secreto propio si la app de Meta es otra.
const msg = Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: '1', messaging: [{ sender: { id: '1234567890123456' }, message: { mid: 'm.1', text: 'hola' } }] }] }))
CONFIG = { metaAppSecret: SECRETO, messengerAppSecret: '' }
let n0 = avisos.length
r = await post('/api/messenger', msg, { 'x-hub-signature-256': firmar(msg, SECRETO) })
ok(r.status === 200 && r.json.texto === 'hola' && avisos.length === n0, 'Messenger con firma válida de NUXT_META_APP_SECRET (misma app) → 200 y SIN log')
n0 = avisos.length
r = await post('/api/messenger', msg)
ok(r.status === 200 && /observación: sin_cabecera/.test(avisos.slice(n0).join('|')), 'Messenger sin firma → 200 (no rechaza) y log "observación: sin_cabecera"')
CONFIG = { metaAppSecret: SECRETO, messengerAppSecret: 'secreto-de-la-app-de-messenger' }
r = await post('/api/messenger', msg, { 'x-hub-signature-256': firmar(msg, 'secreto-de-la-app-de-messenger') })
ok(r.status === 200, 'Messenger con NUXT_MESSENGER_APP_SECRET propio (otra app) → 200')
n0 = avisos.length
r = await post('/api/messenger', msg, { 'x-hub-signature-256': firmar(msg, SECRETO) })
ok(r.status === 200 && /observación: firma_distinta/.test(avisos.slice(n0).join('|')), 'Messenger con secreto propio: la firma del de WhatsApp deja log "observación: firma_distinta" (así se detecta que es otra app)')
r = await post('/api/whatsapp', raw, { 'x-hub-signature-256': buena })
ok(r.status === 200, 'WhatsApp sigue usando NUXT_META_APP_SECRET → 200')

// Función pura
ok(F.firmaValida(raw, buena, SECRETO) === true && F.firmaValida(raw, buena, '') === false && F.firmaValida(raw, undefined, SECRETO) === false, 'firmaValida(): pura, false sin secreto o sin cabecera')

console.warn = warnReal
const MOTIVO = '(sin_variable|sin_cabecera|cuerpo_vacio|firma_distinta)'
const reWa = new RegExp(`^\\[meta-firma\\] /api/whatsapp rechazado \\(401\\): ${MOTIVO}$`)
const reMsg = new RegExp(`^\\[meta-firma\\] /api/messenger observación: ${MOTIVO} \\(no se rechaza\\)$`)
ok(avisos.length >= 10 && avisos.every(a => reWa.test(a) || reMsg.test(a)), `cada log lleva solo el prefijo [meta-firma], la ruta y el motivo (${avisos.length} avisos)`, avisos.find(a => !reWa.test(a) && !reMsg.test(a)) ?? '')
ok(['sin_cabecera', 'firma_distinta', 'sin_variable', 'cuerpo_vacio'].every(m => avisos.some(a => a.endsWith(`rechazado (401): ${m}`))), 'WhatsApp registra los motivos sin_cabecera, firma_distinta, sin_variable y cuerpo_vacio')
ok(!avisos.some(a => /570000000001|Perfil|prueba bloque|sha256=|[0-9a-f]{32}/.test(a)), 'los logs no llevan cuerpo, remitente ni firma')

// Cierre ordenado: en Windows, process.exit() con el servidor aún cerrándose dispara
// una aserción de libuv (exit 127). Se cierran las conexiones y se deja salir solo.
server.closeAllConnections?.()
await new Promise(r => server.close(r))
console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto')
process.exitCode = fallos ? 1 : 0
