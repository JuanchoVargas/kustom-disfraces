// Prueba SIN Meta el ciclo completo del webhook de WhatsApp contra un dev server
// local (npm run dev + POSTGRES_URL en .env). Usa un número FICTICIO de prueba, así
// que nada se envía de verdad (y en local no hay credenciales de WhatsApp): valida
// la lógica de dedupe por wamid, el auto-retorno de humano→bot y el logging,
// leyendo el estado que queda en la BD.
//
//   node scripts/test-wa-webhook.mjs [baseUrl]      (default http://localhost:3000)
//
// Escenarios:
//   1. wamid nuevo → se procesa y guarda; como en local no hay envío real, NO se
//      marca replied_at (un reintento podría responder — comportamiento buscado).
//   2. mismo wamid otra vez de inmediato → skip=duplicado_en_vuelo (no doble respuesta).
//   3. mismo wamid con el original "respondido" (replied_at simulado en BD) →
//      skip=duplicado_ya_respondido.
//   4. conversación en estado=humano con humano_at hace 31 min y sin agente →
//      el siguiente mensaje la devuelve sola al bot y el bot responde.
//   5. isHumanRequest: frases explícitas disparan handoff; "disfraz de agente
//      secreto" NO (se valida vía estado de la conversación).
// Al final limpia las filas de prueba.
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const FROM = '570000000001' // número ficticio SOLO para pruebas (no es un usuario real)

function loadEnv() {
  const env = {}
  const raw = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return env
}
const env = loadEnv()
const sql = neon(env.POSTGRES_URL || env.DATABASE_URL)

function webhook(text, wamid, type = 'text') {
  const msg = { from: FROM, id: wamid, timestamp: String(Date.now() / 1000 | 0), type }
  if (type === 'text') msg.text = { body: text }
  else if (type === 'audio') msg.audio = { id: 'fake-audio', mime_type: 'audio/ogg' }
  else if (type === 'sticker') msg.sticker = { id: 'fake-sticker', mime_type: 'image/webp' }
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '0', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      contacts: [{ profile: { name: 'Prueba Webhook' }, wa_id: FROM }],
      messages: [msg],
    } }] }],
  }
}

async function post(text, wamid, type = 'text') {
  const r = await fetch(`${BASE}/api/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(webhook(text, wamid, type)),
  })
  return r.json()
}

async function conv() {
  const rows = await sql.query(`SELECT * FROM conversations WHERE canal='wa' AND external_id=$1`, [FROM])
  return rows[0] ?? null
}
async function msgByWamid(wamid) {
  const rows = await sql.query(`SELECT * FROM messages WHERE wamid=$1`, [wamid])
  return rows[0] ?? null
}
async function cleanup() {
  await sql.query(`DELETE FROM conversations WHERE canal='wa' AND external_id=$1`, [FROM]) // messages caen por CASCADE
}

let fails = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

await cleanup()
const uid = Date.now()

// --- 1: mensaje nuevo se procesa ---
const w1 = `wamid.TEST-${uid}-1`
const r1 = await post('hola', w1)
check('1. wamid nuevo se procesa (replied>0)', r1.replied >= 1, JSON.stringify(r1))
const m1 = await msgByWamid(w1)
check('1. entrante guardado con wamid', !!m1)
check('1. SIN envío real no se marca replied_at (reintento podría responder)', m1 && !m1.replied_at)

// --- 2: mismo wamid inmediato → en vuelo, no reprocesa ---
const r2 = await post('hola', w1)
check('2. duplicado inmediato NO responde (skip en vuelo)', r2.replied === 0, JSON.stringify(r2))

// --- 3: original marcado como respondido → duplicado no responde ---
await sql.query(`UPDATE messages SET replied_at = now(), created_at = now() - interval '5 minutes' WHERE wamid=$1`, [w1])
const r3 = await post('hola', w1)
check('3. duplicado de un wamid YA respondido NO responde', r3.replied === 0, JSON.stringify(r3))

// --- 3b: original viejo SIN responder → el reintento SÍ procesa ---
await sql.query(`UPDATE messages SET replied_at = NULL WHERE wamid=$1`, [w1])
const r3b = await post('hola', w1)
check('3b. reintento de un wamid viejo NO respondido SÍ vuelve a procesar', r3b.replied >= 1, JSON.stringify(r3b))

// --- 4: auto-retorno humano→bot a los 30 min sin agente ---
const c0 = await conv()
await sql.query(`UPDATE conversations SET estado='humano', humano_at = now() - interval '31 minutes' WHERE id=$1`, [c0.id])
const r4 = await post('sigo esperando', `wamid.TEST-${uid}-4`)
const c4 = await conv()
check('4. en humano hace 31 min sin agente → vuelve al BOT y responde', c4.estado === 'bot' && r4.replied >= 1, `estado=${c4.estado} ${JSON.stringify(r4)}`)

// --- 4b: en humano RECIENTE el bot calla ---
await sql.query(`UPDATE conversations SET estado='humano', humano_at = now() WHERE id=$1`, [c0.id])
const r4b = await post('hola?', `wamid.TEST-${uid}-4b`)
const c4b = await conv()
check('4b. en humano hace <30 min → bot calla y sigue en humano', c4b.estado === 'humano' && r4b.replied === 0, `estado=${c4b.estado} ${JSON.stringify(r4b)}`)

// --- 4c: en humano con AGENTE activo hace poco NO se devuelve aunque humano_at sea viejo ---
await sql.query(`UPDATE conversations SET estado='humano', humano_at = now() - interval '31 minutes' WHERE id=$1`, [c0.id])
await sql.query(`INSERT INTO messages (conversation_id, direccion, texto, autor) VALUES ($1,'out','estoy contigo','agente')`, [c0.id])
const r4c = await post('ok', `wamid.TEST-${uid}-4c`)
const c4c = await conv()
check('4c. agente escribió hace <30 min → sigue en humano', c4c.estado === 'humano' && r4c.replied === 0, `estado=${c4c.estado}`)

// --- 5: isHumanRequest ---
await sql.query(`UPDATE conversations SET estado='bot', humano_at=NULL, bot_state='{}'::jsonb WHERE id=$1`, [c0.id])
await sql.query(`DELETE FROM messages WHERE conversation_id=$1 AND autor='agente'`, [c0.id])
await post('quiero hablar con un asesor', `wamid.TEST-${uid}-5`)
const c5 = await conv()
check('5. "quiero hablar con un asesor" → handoff (estado=humano)', c5.estado === 'humano', `estado=${c5.estado}`)

await sql.query(`UPDATE conversations SET estado='bot', humano_at=NULL, bot_state='{}'::jsonb WHERE id=$1`, [c0.id])
await post('tienen disfraz de agente secreto?', `wamid.TEST-${uid}-5b`)
const c5b = await conv()
check('5b. "disfraz de agente secreto" NO dispara handoff', c5b.estado === 'bot', `estado=${c5b.estado}`)

// --- 6: mensajes NO-TEXTO (audio, sticker) → aviso "solo texto" + menú ---
await sql.query(`UPDATE conversations SET estado='bot', humano_at=NULL, bot_state='{}'::jsonb WHERE id=$1`, [c0.id])
const r6 = await post(null, `wamid.TEST-${uid}-6`, 'audio')
check('6. audio → responde (no se ignora)', r6.replied >= 1, JSON.stringify(r6))
// El menú se parte en chunks de botones (≤3): el aviso va en el PRIMER chunk,
// así que se busca en los últimos salientes, no solo en el último.
const out6 = await sql.query(`SELECT texto FROM messages WHERE conversation_id=$1 AND direccion='out' ORDER BY id DESC LIMIT 3`, [c0.id])
check('6. la respuesta avisa "solo puedo leer mensajes de texto" + menú', out6.some(m => /solo puedo leer mensajes de texto/.test(m.texto)), JSON.stringify(out6.map(m => m.texto.slice(0, 50))))
const r6b = await post(null, `wamid.TEST-${uid}-6b`, 'sticker')
check('6b. sticker → responde igual', r6b.replied >= 1, JSON.stringify(r6b))

// --- 7: keepalive con BD viva ---
const ka = await (await fetch(`${BASE}/api/cron/keepalive`)).json()
check('7. /api/cron/keepalive responde ok con BD viva', ka.ok === true, JSON.stringify(ka))

await cleanup()
console.log(fails ? `\n${fails} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS PASARON')
process.exit(fails ? 1 : 0)
