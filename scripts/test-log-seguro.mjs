// Verifica SIN RED ni BD que los logs de los webhooks no llevan datos personales.
//
//   node scripts/test-log-seguro.mjs
//
// Dos capas:
//  1) DINÁMICA: pasa payloads con forma de webhook de Meta (fixtures propios con
//     datos ficticios + los .tmp/*.json locales, si existen) por las funciones
//     reales que registran logs (server/utils/whatsappBot.ts, botDemand.ts,
//     whatsapp.ts, messenger.ts y logSafe.ts con NUXT_DEBUG_PAYLOADS=true),
//     captura todo console.* y FALLA si la salida contiene 10 o más dígitos
//     seguidos, una '@', un nombre de perfil o un texto de cliente del payload.
//  2) ESTÁTICA: revisa cada console.* de server/** contra una lista de expresiones
//     prohibidas (profileName, .nombre, .email, ${externalId} sin maskId, …). Cubre
//     las líneas que solo se ejecutan con BD o con Mercado Pago (botSession.ts,
//     mercadopago.post.ts, orderEmail.ts).
//
// Los .tmp/*.json son payloads reales capturados en local (gitignored). Aquí solo
// se usan como entrada; nada de su contenido se imprime salvo un conteo.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

// Sin BD ni credenciales a propósito: las funciones deben degradar y SOLO loguear.
delete process.env.POSTGRES_URL
delete process.env.DATABASE_URL
globalThis.useRuntimeConfig = () => ({
  public: { siteUrl: 'https://www.disfraceskustom.com' },
  whatsappToken: '',
  whatsappPhoneId: '',
  messengerPageToken: '',
  debugPayloads: true, // la capa "shape" también se somete a la prueba
  botTextoPromocion: '',
})

const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const logSafe = await jiti.import('../server/utils/logSafe.ts')
const bot = await jiti.import('../server/utils/whatsappBot.ts')
const demand = await jiti.import('../server/utils/botDemand.ts')
const wa = await jiti.import('../server/utils/whatsapp.ts')
const msgr = await jiti.import('../server/utils/messenger.ts')

// ---------- fixtures (todos los datos son ficticios) ----------
const waBody = value => ({ object: 'whatsapp_business_account', entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', ...value } }] }] })
const FIXTURES = [
  {
    nombre: 'wa-telefono',
    body: waBody({
      contacts: [{ profile: { name: 'Perfil De Prueba' }, wa_id: '573000000001' }],
      messages: [{ from: '573000000001', id: 'wamid.PRUEBA1', timestamp: '0', type: 'text', text: { body: 'hola quiero un disfraz de batman talla 8, mi correo es prueba@correo.com' } }],
    }),
  },
  {
    nombre: 'wa-bsuid',
    body: waBody({
      contacts: [{ user_id: 'CO.1041700000000001', profile: { name: 'Usuaria Bsuid', username: 'usuaria.prueba' } }],
      messages: [{ from_user_id: 'CO.1041700000000001', id: 'wamid.PRUEBA2', timestamp: '0', type: 'text', text: { body: 'cuanto vale el de spiderman' } }],
    }),
  },
  {
    nombre: 'wa-sin-identidad',
    body: waBody({ messages: [{ id: 'wamid.PRUEBA3', timestamp: '0', type: 'text', text: { body: 'texto sin remitente conocido' } }] }),
  },
  {
    nombre: 'wa-status-failed',
    body: waBody({
      statuses: [{ id: 'wamid.PRUEBA4', status: 'failed', recipient_id: '573000000002', errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'Message failed to send to 573000000002 because more than 24 hours have passed' } }] }],
    }),
  },
  {
    nombre: 'wa-sin-entry',
    body: { object: 'whatsapp_business_account', algo: 'inesperado' },
  },
  {
    nombre: 'msg-evento',
    body: { object: 'page', entry: [{ id: '1', messaging: [{ sender: { id: '1234567890123456' }, recipient: { id: '9' }, message: { mid: 'm.PRUEBA', text: 'hola soy Cliente Messenger y mi cel es 3001234567' } }] }] },
  },
]

// Payloads reales capturados en local (si los hay). Solo se cuentan.
let locales = 0
try {
  for (const f of readdirSync(join(root, '.tmp')).filter(f => f.endsWith('.json'))) {
    try {
      const j = JSON.parse(readFileSync(join(root, '.tmp', f), 'utf8'))
      if (Array.isArray(j?.entry)) { FIXTURES.push({ nombre: `.tmp/${f}`, body: j, local: true }); locales++ }
    }
    catch { /* no es JSON válido: se ignora */ }
  }
}
catch { /* sin .tmp */ }

/** Datos que JAMÁS pueden aparecer en un log: nombres de perfil y textos de cliente del payload. */
function datosSensibles(body) {
  const out = new Set()
  const entries = Array.isArray(body?.entry) ? body.entry : []
  for (const e of entries) {
    for (const c of (e?.changes ?? [])) {
      for (const ct of (c?.value?.contacts ?? [])) if (ct?.profile?.name) out.add(String(ct.profile.name))
      for (const m of (c?.value?.messages ?? [])) if (m?.text?.body) out.add(String(m.text.body))
    }
    for (const ev of (e?.messaging ?? [])) if (ev?.message?.text) out.add(String(ev.message.text))
  }
  return [...out].filter(s => [...s].length >= 6)
}

/**
 * Identificadores de NEGOCIO que sí deben salir completos (son la forma de
 * recuperar un pedido): paymentId de Mercado Pago, SKU, product/variation id y
 * número de orden. Solo cuentan cuando llevan su etiqueta explícita; un número
 * largo suelto sigue siendo sospechoso (teléfono, PSID).
 */
const ETIQUETAS_NEGOCIO = /\b(paymentId|payment_id|sku|order|orderId|order_id|pedido|product_id|variation_id|variation|wamid)\s*[=:]\s*"?[\w.-]+/gi
const sinIdsDeNegocio = salida => salida.replace(ETIQUETAS_NEGOCIO, m => m.replace(/\d/g, '#'))
const tieneNumeroLargo = salida => /\d{10,}/.test(sinIdsDeNegocio(salida))

// ---------- captura de console ----------
const capturado = []
const original = {}
for (const k of ['log', 'info', 'warn', 'error']) {
  original[k] = console[k]
  console[k] = (...args) => capturado.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
}
const restaurar = () => { for (const k of Object.keys(original)) console[k] = original[k] }

let fallos = 0
const ok = (cond, msg) => { if (cond) original.info(`✅ ${msg}`); else { fallos++; original.error(`❌ ${msg}`) } }

// ---------- 0) utilidades de logSafe ----------
restaurar()
ok(logSafe.maskId('573000000001') === '***0001', 'maskId(teléfono) deja solo los últimos 4')
ok(logSafe.maskId('CO.1041700000000001') === 'CO.***0001', 'maskId(BSUID) conserva el prefijo y los últimos 4')
ok(logSafe.maskId('1234567890123456') === '***3456', 'maskId(PSID) deja solo los últimos 4')
ok(logSafe.maskId('') === '—' && logSafe.maskId(undefined) === '—', 'maskId(vacío) devuelve —')
ok(logSafe.maskId('123') === '***', 'maskId(corto) no revela nada')
ok(logSafe.redactDigits('enviado a 573000000002 y a 44') === 'enviado a ***0002 y a 44', 'redactDigits enmascara números de 7+ dígitos')
const shape = logSafe.payloadShape(FIXTURES[0].body)
ok(!shape.includes('Perfil') && !shape.includes('573000000001') && shape.includes('profile:{name:string}'), 'payloadShape describe claves y tipos, sin valores')
ok(!tieneNumeroLargo('[mp-webhook] pago APROBADO SIN orden. paymentId=123456789012 items=[{"sku":"001010001-T4"}] order=987654321012')
  && tieneNumeroLargo('[whatsapp] enviado a 573000000001')
  && tieneNumeroLargo('paymentId=123456789012 y además 573000000001'),
'la regla de 10+ dígitos ignora paymentId=, sku=, order=, variation= y sigue cazando un número suelto')

// ---------- 1) dinámica: payloads por las funciones reales ----------
for (const k of Object.keys(original)) console[k] = (...args) => capturado.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
for (const fx of FIXTURES) {
  const inicio = capturado.length
  const body = fx.body
  logSafe.logPayloadShape(body?.object === 'page' ? 'msg-webhook' : 'wa-webhook', body)
  if (body?.object === 'page') {
    for (const e of body.entry) for (const ev of (e?.messaging ?? [])) {
      const id = String(ev?.sender?.id ?? '')
      await msgr.sendMessengerMessage(id, { text: 'Respuesta del bot', quick_replies: [] })
      await demand.recordFailedSearch({ canal: 'msg', externalId: id, texto: String(ev?.message?.text ?? ''), termino: 'x', motivo: 'sin_coincidencia', sugerencias: [] })
    }
  }
  else {
    bot.logFailedStatuses(body)
    const incomings = bot.parseIncomingAll(body)
    if (!incomings.length) console.info(`[whatsapp] webhook sin mensajes — ${bot.webhookSummary(body)}`)
    for (const inc of incomings) {
      await demand.recordFailedSearch({ canal: 'wa', externalId: inc.from, texto: inc.text ?? '', termino: 'x', motivo: 'sin_coincidencia', sugerencias: [{ slug: 'batman', nombre: 'Batman', score: 0.5, motivo: 'parcial' }] })
      await wa.sendWhatsAppMessage(inc.from, wa.waText('Respuesta del bot con ventas@disfraceskustom.com'))
      await wa.sendTemplateMessage(inc.from, 'alerta_atencion', [inc.profileName ?? 'x', inc.from, inc.text ?? ''])
    }
  }
  const salida = capturado.slice(inicio).join('\n')
  const problemas = []
  if (tieneNumeroLargo(salida)) problemas.push('10+ dígitos seguidos (sin etiqueta de negocio)')
  if (salida.includes('@')) problemas.push("una '@'")
  for (const s of datosSensibles(body)) if (salida.includes(s)) problemas.push(fx.local ? 'nombre o texto del payload local' : `«${s}»`)
  ok(!problemas.length, `${fx.nombre}: ${capturado.length - inicio} líneas de log sin datos personales${problemas.length ? ` — contiene ${problemas.join(', ')}` : ''}`)
  if (problemas.length && !fx.local) for (const l of capturado.slice(inicio)) original.error('   ', l)
}
restaurar()
original.info(`   (${FIXTURES.length - locales} fixtures ficticios + ${locales} payloads locales de .tmp/)`)

// ---------- 2) estática: console.* de server/** ----------
const PROHIBIDO = [
  [/profileName/, 'nombre de perfil'],
  [/\.nombre\b/, 'nombre'],
  [/\.direccion\b/, 'dirección'],
  [/\.email\b/, 'correo'],
  [/\$\{buyer\}/, 'correo del comprador'],
  [/JSON\.stringify\((body|msg|buyer|message|payment|incoming)\)/, 'objeto completo'],
  [/\$\{(externalId|leadPhone|to|recipientId|senderId|incoming\.from|f\.externalId|from)\}/, 'identificador sin maskId'],
  [/\bf\.(texto|termino)\b/, 'texto del cliente'],
  [/\[wa-(raw|parse)\]/, 'log temporal de payload'],
]
function archivosTs(dir) {
  const out = []
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name)
    if (d.isDirectory()) out.push(...archivosTs(p))
    else if (d.name.endsWith('.ts')) out.push(p)
  }
  return out
}
/** Extrae cada llamada console.X(...) completa (paréntesis balanceados). */
function llamadasConsole(src) {
  const out = []
  const re = /console\.(log|info|warn|error)\(/g
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1, q = null
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i], prev = src[i - 1]
      if (q) { if (ch === q && prev !== '\\') q = null; continue }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue }
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    const linea = src.slice(0, m.index).split('\n').length
    out.push({ linea, texto: src.slice(m.index, i) })
  }
  return out
}
let revisadas = 0, hallazgos = 0
for (const f of archivosTs(join(root, 'server'))) {
  const rel = f.slice(root.length).replace(/\\/g, '/')
  const src = readFileSync(f, 'utf8')
  for (const c of llamadasConsole(src)) {
    revisadas++
    for (const [re, que] of PROHIBIDO) {
      if (re.test(c.texto)) { hallazgos++; original.error(`❌ ${rel}:${c.linea} imprime ${que}: ${c.texto.split('\n')[0].slice(0, 110)}`) }
    }
  }
}
ok(hallazgos === 0, `estática: ${revisadas} console.* revisados en server/**, ${hallazgos} con datos personales`)

// La alerta "pago aprobado SIN orden" SÍ debe llevar el paymentId completo y los SKU:
// es lo que permite recuperar el pedido desde MP. No se puede ejecutar sin h3 ni MP,
// así que se comprueba sobre la fuente.
const mpSrc = readFileSync(join(root, 'server/api/webhooks/mercadopago.post.ts'), 'utf8')
const alerta = llamadasConsole(mpSrc).find(c => c.texto.includes('SIN orden'))
ok(!!alerta && alerta.texto.includes('paymentId=${payment.id}') && alerta.texto.includes('sku: i.sku'),
  'la alerta "pago aprobado SIN orden" imprime paymentId completo y los SKU (recuperación del pedido)')
ok(!!alerta && !/payer|email|buyer\)|direccion|nombre/.test(alerta.texto.replace(/buyer \? 'sí' : 'no'/, '')),
  'esa alerta no imprime pagador, correo ni datos de envío')
// redactDigits solo se aplica a errores de Graph/Meta, nunca a ids de negocio.
const usosRedact = []
for (const f of archivosTs(join(root, 'server'))) {
  const src = readFileSync(f, 'utf8')
  if (f.endsWith('logSafe.ts')) continue
  for (const c of llamadasConsole(src)) if (c.texto.includes('redactDigits(')) usosRedact.push(f.slice(root.length).replace(/\\/g, '/'))
  if (/redactDigits\(/.test(src) && !/(whatsapp|messenger|whatsappBot)\.ts$/.test(f)) usosRedact.push(`FUERA DE GRAPH: ${f.slice(root.length)}`)
}
ok(!usosRedact.some(u => u.startsWith('FUERA')), `redactDigits solo en los clientes de Graph/Meta (whatsapp.ts, messenger.ts, whatsappBot.ts)${usosRedact.filter(u => u.startsWith('FUERA')).map(u => ` — ${u}`).join('')}`)

original.info(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ todo correcto')
process.exit(fallos ? 1 : 0)
