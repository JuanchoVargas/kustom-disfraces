// Prueba SIN Meta la bandeja v2 contra un dev server local (npm run dev +
// POSTGRES_URL + NUXT_INBOX_PASSWORD en .env). Simula webhooks de WhatsApp y
// Messenger con remitentes FICTICIOS y luego usa la API de la bandeja como lo
// haría /admin/chats. En local no hay credenciales de Meta, así que nada se envía
// de verdad: los medios de Messenger llegan por URL (data:) y se descargan y
// guardan de verdad; los de WhatsApp (por media_id) quedan como "[Audio recibido]"
// con meta.download_failed = sin_token (el camino real se prueba en producción).
//
//   node scripts/test-bandeja-v2.mjs [baseUrl] [--keep]   (default http://localhost:3000)
//   node scripts/test-bandeja-v2.mjs cleanup                (borra las filas de prueba)
//
// Escenarios:
//   1. Preguntas informativas por WhatsApp (tallas, precio, envíos, pago) → el bot
//      responde con la info y NO con "no encontré ese disfraz".
//   2. Remitente con identidad nueva (BSUID + username, sin teléfono) → la
//      conversación guarda bsuid/username y telefono queda vacío.
//   3. Sticker por WhatsApp (media_id) → tipo sticker + "[Sticker recibido]" + sin_token.
//   4. Ubicación por WhatsApp → tipo location con lat/lng en meta.
//   5. Audio e imagen por Messenger (data: URL) → descargados y guardados en `media`,
//      servidos en /api/media/<token> con su MIME.
//   6. API de la bandeja: búsqueda en el histórico (texto de un mensaje), filtro
//      por fecha, archivar/desarchivar (nunca se borra), envío de imagen desde la
//      bandeja (en seco, multipart) y envío de texto en seco.
// Con --keep NO limpia (para tomar capturas en /admin/chats). Sin él limpia al final.
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const KEEP = args.includes('--keep')
const MODE = args.includes('cleanup') ? 'cleanup' : 'run'
const BASE = args.find(a => a.startsWith('http')) ?? 'http://localhost:3000'

const WA_PHONE = '570000000002' // ficticios SOLO para pruebas
const WA_BSUID = 'CO.9990000000000001'
const MSG_PSID = '9990000000000002'
const WA_PHONE_NAME = 'Prueba Bandeja'
const WA_BSUID_NAME = 'Cliente Username'

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
const sql = neon(env.POSTGRES_URL || env.DATABASE_URL)

let fails = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}
const uid = () => `test.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`

// ---------- payloads ----------
function waWebhook(msg, contact) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [contact], messages: [msg] } }] }],
  }
}
const waPhoneContact = { profile: { name: WA_PHONE_NAME }, wa_id: WA_PHONE }
const waBsuidContact = { profile: { name: WA_BSUID_NAME, username: 'cliente.username' }, user_id: WA_BSUID }

async function postWa(msg, contact = waPhoneContact) {
  const r = await fetch(`${BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(waWebhook(msg, contact)) })
  return r.json()
}
async function postMsg(messaging) {
  const r = await fetch(`${BASE}/api/messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'page', entry: [{ id: '0', time: Date.now(), messaging: [messaging] }] }) })
  return r.json()
}
const waText = (text, from = WA_PHONE) => ({ from, id: uid(), timestamp: String(Date.now() / 1000 | 0), type: 'text', text: { body: text } })

// ---------- archivos de prueba (generados, sin dependencias) ----------
// PNG 8x8 rojo (mínimo válido) y WAV de 0,5 s con un tono de 440 Hz.
function tinyPng() {
  // 1x1 PNG rojo, base64 conocido
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
}
function tinyWav() {
  const rate = 8000, secs = 0.5, n = Math.round(rate * secs)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}
const dataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`

// ---------- BD ----------
async function conv(canal, externalId) {
  const rows = await sql.query(`SELECT * FROM conversations WHERE canal=$1 AND external_id=$2`, [canal, externalId])
  return rows[0] ?? null
}
async function msgs(convId) {
  return sql.query(`SELECT m.*, md.token AS media_token, md.mime AS media_mime FROM messages m LEFT JOIN media md ON md.id = m.media_id WHERE m.conversation_id=$1 ORDER BY m.id`, [convId])
}
async function cleanup() {
  const rows = await sql.query(`SELECT id FROM conversations WHERE (canal='wa' AND external_id IN ($1, $2)) OR (canal='msg' AND external_id=$3)`, [WA_PHONE, WA_BSUID, MSG_PSID])
  for (const r of rows) {
    await sql.query(`DELETE FROM media WHERE id IN (SELECT media_id FROM messages WHERE conversation_id=$1 AND media_id IS NOT NULL)`, [r.id]).catch(() => {})
  }
  await sql.query(`DELETE FROM conversations WHERE (canal='wa' AND external_id IN ($1, $2)) OR (canal='msg' AND external_id=$3)`, [WA_PHONE, WA_BSUID, MSG_PSID])
  console.log(`🧹 filas de prueba eliminadas (${rows.length} conversaciones)`)
}

// ---------- API de la bandeja ----------
let cookie = ''
async function api(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } })
  const setc = r.headers.get('set-cookie')
  if (setc) cookie = setc.split(';')[0]
  let body = null
  try { body = await r.json() } catch {}
  return { status: r.status, body }
}

if (MODE === 'cleanup') {
  await cleanup()
  process.exit(0)
}

console.log(`▶ bandeja v2 contra ${BASE}\n`)
await cleanup().catch(() => {})

// 1. preguntas informativas por WhatsApp
console.log('— 1. preguntas informativas (WhatsApp)')
const INFO = [
  ['EN QUÉ TALLA VIENEN LOS DISFRACES', 'tallas de la 0 a la 14', '/tallas'],
  ['precio', 'van desde', 'catalogo-kustom.pdf'],
  ['hacen envíos?', 'GRATIS', '/envios'],
  ['como se paga', 'contra entrega', '/como-comprar'],
]
for (const [q, ...expect] of INFO) {
  await postWa(waText(q))
  const c = await conv('wa', WA_PHONE)
  const all = await msgs(c.id)
  // El bot manda info + menú (que en texto se parte en 2 chunks): se miran los últimos 3.
  const last = all.filter(m => m.direccion === 'out').slice(-3).map(m => m.texto).join('\n')
  check(`"${q}" → info`, expect.every(e => last.includes(e)) && !last.includes('No encontré ese disfraz'), expect.join(' + '))
}

// 2. BSUID sin teléfono + username
console.log('\n— 2. identidad nueva (BSUID + username, sin teléfono)')
await postWa({ from_user_id: WA_BSUID, id: uid(), timestamp: String(Date.now() / 1000 | 0), type: 'text', text: { body: 'hola' } }, waBsuidContact)
{
  const c = await conv('wa', WA_BSUID)
  check('conversación creada con external_id = BSUID', !!c)
  check('telefono vacío, bsuid y username guardados', c && !c.telefono && c.bsuid === WA_BSUID && c.username === 'cliente.username', `telefono=${c?.telefono} bsuid=${c?.bsuid} username=${c?.username}`)
}

// 3. sticker por WhatsApp (media_id → sin token en local)
console.log('\n— 3. sticker por WhatsApp (media_id)')
await postWa({ from: WA_PHONE, id: uid(), timestamp: String(Date.now() / 1000 | 0), type: 'sticker', sticker: { id: '1234567890', mime_type: 'image/webp', animated: false } })
{
  const c = await conv('wa', WA_PHONE)
  const last = (await msgs(c.id)).filter(m => m.direccion === 'in').at(-1)
  check('tipo=sticker con texto de aviso', last?.tipo === 'sticker' && last.texto === '[Sticker recibido]', last?.texto)
  check('meta.download_failed = sin_token (local sin token)', last?.meta?.download_failed === 'sin_token', JSON.stringify(last?.meta))
}
// audio por WhatsApp (mismo camino): aviso "[Audio recibido]"
await postWa({ from: WA_PHONE, id: uid(), timestamp: String(Date.now() / 1000 | 0), type: 'audio', audio: { id: '1234567891', mime_type: 'audio/ogg; codecs=opus', voice: true } })
{
  const c = await conv('wa', WA_PHONE)
  const last = (await msgs(c.id)).filter(m => m.direccion === 'in').at(-1)
  check('audio WA → "[Audio recibido]" (tipo audio)', last?.tipo === 'audio' && last.texto === '[Audio recibido]', last?.texto)
}

// 4. ubicación por WhatsApp
console.log('\n— 4. ubicación por WhatsApp')
await postWa({ from: WA_PHONE, id: uid(), timestamp: String(Date.now() / 1000 | 0), type: 'location', location: { latitude: 4.60971, longitude: -74.08175, name: 'Plaza de Bolívar', address: 'Bogotá' } })
{
  const c = await conv('wa', WA_PHONE)
  const last = (await msgs(c.id)).filter(m => m.direccion === 'in').at(-1)
  check('tipo=location con lat/lng', last?.tipo === 'location' && Math.abs(last.meta?.lat - 4.60971) < 1e-6 && Math.abs(last.meta?.lng + 74.08175) < 1e-6, last?.texto)
}

// 5. audio e imagen por Messenger (URL data:) → se descargan y guardan
console.log('\n— 5. audio e imagen por Messenger (descarga real por URL)')
const mid = () => `m_${uid()}`
await postMsg({ sender: { id: MSG_PSID }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: mid(), text: 'Hola, busco un disfraz de Goku' } })
await postMsg({ sender: { id: MSG_PSID }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: mid(), attachments: [{ type: 'audio', payload: { url: dataUrl(tinyWav(), 'audio/wav') } }] } })
await postMsg({ sender: { id: MSG_PSID }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: mid(), text: 'esta es la foto', attachments: [{ type: 'image', payload: { url: dataUrl(tinyPng(), 'image/png') } }] } })
await postMsg({ sender: { id: MSG_PSID }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: mid(), attachments: [{ type: 'location', payload: { coordinates: { lat: 6.2442, long: -75.5812 } } }] } })
let audioToken = ''
{
  const c = await conv('msg', MSG_PSID)
  const all = (await msgs(c.id)).filter(m => m.direccion === 'in')
  const audio = all.find(m => m.tipo === 'audio')
  const img = all.find(m => m.tipo === 'image')
  const loc = all.find(m => m.tipo === 'location')
  check('audio Messenger guardado en media (audio/wav)', !!audio?.media_token && audio.media_mime === 'audio/wav', `token=${audio?.media_token} mime=${audio?.media_mime}`)
  check('imagen Messenger guardada (image/png) con caption como texto', !!img?.media_token && img.media_mime === 'image/png' && img.texto === 'esta es la foto', img?.texto)
  check('ubicación Messenger', loc?.tipo === 'location' && Math.abs(loc.meta?.lat - 6.2442) < 1e-6)
  audioToken = audio?.media_token ?? ''
  const r = await fetch(`${BASE}/api/media/${audioToken}`)
  const buf = Buffer.from(await r.arrayBuffer())
  check('GET /api/media/<token> sirve el audio con su MIME', r.status === 200 && r.headers.get('content-type')?.startsWith('audio/wav') && buf.length === tinyWav().length, `${r.status} ${r.headers.get('content-type')} ${buf.length}B`)
  const r404 = await fetch(`${BASE}/api/media/00000000000000000000000000000000`)
  check('token inexistente → 404', r404.status === 404)
}

// 6. API de la bandeja
console.log('\n— 6. API de la bandeja')
{
  const login = await api('/api/inbox/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.NUXT_INBOX_PASSWORD }) })
  check('login', login.status === 200, `status ${login.status}`)
  const list = await api('/api/inbox/conversations?estado=activas')
  const ids = (list.body?.conversations ?? []).map(c => c.external_id)
  check('lista activas incluye las 3 de prueba con telefono/bsuid/username', ids.includes(WA_PHONE) && ids.includes(WA_BSUID) && ids.includes(MSG_PSID))
  const bs = list.body.conversations.find(c => c.external_id === WA_BSUID)
  check('BSUID en la lista: telefono null + username', bs && bs.telefono === null && bs.username === 'cliente.username' && bs.bsuid === WA_BSUID)
  const ph = list.body.conversations.find(c => c.external_id === WA_PHONE)
  check('teléfono visible en la lista', ph && ph.telefono === WA_PHONE)

  // búsqueda en el HISTÓRICO: texto que solo está en un mensaje viejo de Messenger
  const s = await api(`/api/inbox/conversations?estado=todas&q=${encodeURIComponent('busco un disfraz de goku')}`)
  const sids = (s.body?.conversations ?? []).map(c => c.external_id)
  check('búsqueda por texto de un mensaje encuentra la conversación', sids.includes(MSG_PSID) && !sids.includes(WA_PHONE), sids.join(','))
  const s2 = await api(`/api/inbox/conversations?estado=todas&q=${encodeURIComponent('cliente.username')}`)
  check('búsqueda por username', (s2.body?.conversations ?? []).some(c => c.external_id === WA_BSUID))

  // filtro por fecha: rango de ayer→hoy incluye; rango de hace un año excluye
  const day = 86400_000
  const today = new Date(Date.now() + day).toISOString()
  const yesterday = new Date(Date.now() - day).toISOString()
  const f1 = await api(`/api/inbox/conversations?estado=todas&desde=${encodeURIComponent(yesterday)}&hasta=${encodeURIComponent(today)}`)
  const f2 = await api(`/api/inbox/conversations?estado=todas&desde=2020-01-01T00:00:00Z&hasta=2020-02-01T00:00:00Z`)
  check('filtro por fecha (hoy) incluye / (2020) excluye', (f1.body?.conversations ?? []).some(c => c.external_id === WA_PHONE) && !(f2.body?.conversations ?? []).some(c => c.external_id === WA_PHONE), `2020 → ${(f2.body?.conversations ?? []).length}`)

  // archivar / desarchivar: nunca se borra
  const c = await conv('wa', WA_PHONE)
  c.id = Number(c.id) // BIGSERIAL llega como string por el driver HTTP
  const before = (await msgs(c.id)).length
  await api(`/api/inbox/conversations/${c.id}/estado`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: 'cerrado' }) })
  const arch = await api('/api/inbox/conversations?estado=archivadas')
  const act = await api('/api/inbox/conversations?estado=activas')
  check('archivar → aparece en Archivadas y no en Activas', (arch.body?.conversations ?? []).some(x => x.id === c.id) && !(act.body?.conversations ?? []).some(x => x.id === c.id))
  const after = (await msgs(c.id)).length
  const c2 = await conv('wa', WA_PHONE)
  check('archivada conserva TODOS los mensajes y archivada_at', after === before && !!c2.archivada_at, `${before}→${after}`)
  await api(`/api/inbox/conversations/${c.id}/estado`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: 'bot' }) })
  const c3 = await conv('wa', WA_PHONE)
  check('desarchivar → estado bot y archivada_at null', c3.estado === 'bot' && !c3.archivada_at)

  // envío de texto e imagen desde la bandeja (EN SECO: local sin credenciales)
  const t = await api(`/api/inbox/conversations/${c.id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hola, te escribe Kustom 👋' }) })
  check('envío de texto en seco (local) → ok + dry_run', t.status === 200 && t.body?.dry_run === true, `status ${t.status} ${JSON.stringify(t.body?.message?.meta)}`)
  const form = new FormData()
  form.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'prueba.png')
  form.append('caption', 'Mira esta foto del disfraz')
  const up = await api(`/api/inbox/conversations/${c.id}/media`, { method: 'POST', body: form })
  check('envío de imagen desde la bandeja (multipart, en seco) → tipo image + media_id', up.status === 200 && up.body?.message?.tipo === 'image' && !!up.body?.message?.media_id, `status ${up.status} media_id=${up.body?.message?.media_id}`)
  const c4 = await conv('wa', WA_PHONE)
  check('responder toma la conversación (estado humano)', c4.estado === 'humano')
  const bad = new FormData()
  bad.append('file', new Blob([Buffer.from('hola')], { type: 'text/plain' }), 'x.txt')
  const upBad = await api(`/api/inbox/conversations/${c.id}/media`, { method: 'POST', body: bad })
  check('archivo no imagen → 415 bad_type', upBad.status === 415)
  // ventana de 24h cerrada: conversación con ultimo_cliente_at viejo
  await sql.query(`UPDATE conversations SET ultimo_cliente_at = now() - interval '25 hours' WHERE id=$1`, [c.id])
  const closed = await api(`/api/inbox/conversations/${c.id}/media`, { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'p.png'); return f })() })
  check('ventana 24h cerrada → 409 window_closed', closed.status === 409)
  await sql.query(`UPDATE conversations SET ultimo_cliente_at = now() WHERE id=$1`, [c.id])
  // detalle con medios resueltos
  const det = await api(`/api/inbox/conversations/${c.id}`)
  const withMedia = (det.body?.messages ?? []).filter(m => m.media)
  check('detalle: mensajes con media resuelta (url/mime)', withMedia.length >= 1 && withMedia.every(m => m.media.url && m.media.mime))
}

console.log(`\n${fails ? `❌ ${fails} prueba(s) fallida(s)` : '✅ todo OK'}`)
if (KEEP) console.log('ℹ️  --keep: filas de prueba conservadas (node scripts/test-bandeja-v2.mjs cleanup para borrarlas)')
else await cleanup()
process.exit(fails ? 1 : 0)
