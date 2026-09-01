// CRITERIO DE ACEPTACIÓN de resiliencia: con la BD CAÍDA el bot responde igual.
// Arranca el dev server con la URL de Postgres rota y verifica que el webhook
// sigue contestando (estado degradado a memoria) y que el keepalive reporta el
// fallo sin tumbar nada:
//
//   POSTGRES_URL=postgres://x:x@db.invalid/x DATABASE_URL=postgres://x:x@db.invalid/x npm run dev
//   node scripts/test-wa-db-down.mjs [baseUrl]     (default http://localhost:3000)
//
// (dotenv NO pisa variables ya presentes en el entorno, así que esas URLs rotas
// ganan sobre las del .env.)
const BASE = process.argv[2] ?? 'http://localhost:3000'
const FROM = '570000000002'

function webhook(msg) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '0', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      contacts: [{ profile: { name: 'Prueba BD caída' }, wa_id: FROM }],
      messages: [{ from: FROM, id: `wamid.DBDOWN-${Date.now()}-${Math.random()}`, timestamp: String(Date.now() / 1000 | 0), ...msg }],
    } }] }],
  }
}

async function post(msg) {
  const t0 = Date.now()
  const r = await fetch(`${BASE}/api/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(webhook(msg)),
  })
  return { ...(await r.json()), ms: Date.now() - t0 }
}

let fails = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

// 1. texto con BD caída → responde (primera vez paga los reintentos del cold start)
const r1 = await post({ type: 'text', text: { body: 'hola' } })
check('1. BD caída: texto recibe respuesta igual', r1.replied >= 1, JSON.stringify(r1))

// 2. segunda petición → el cooldown evita re-esperar los reintentos (rápida)
const r2 = await post({ type: 'text', text: { body: 'spiderman talla 6' } })
check('2. BD caída: segunda petición responde', r2.replied >= 1, JSON.stringify(r2))
check('2b. …y RÁPIDO (cooldown activo, sin reintentos): <3s', r2.ms < 3000, `${r2.ms}ms`)

// 3. no-texto con BD caída → también responde
const r3 = await post({ type: 'audio', audio: { id: 'x', mime_type: 'audio/ogg' } })
check('3. BD caída: audio recibe el aviso "solo texto" + menú', r3.replied >= 1, JSON.stringify(r3))

// 4. handoff con BD caída → no revienta y responde el mensaje de handoff
const r4 = await post({ type: 'text', text: { body: 'quiero hablar con un asesor' } })
check('4. BD caída: pedido de humano responde sin reventar', r4.replied >= 1, JSON.stringify(r4))

// 5. keepalive reporta el fallo con ok:false (sin 500)
const ka = await (await fetch(`${BASE}/api/cron/keepalive`)).json()
check('5. keepalive con BD caída → ok:false con detalle', ka.ok === false && !!ka.error, JSON.stringify(ka).slice(0, 120))

console.log(fails ? `\n${fails} PRUEBA(S) FALLARON` : '\nTODAS LAS PRUEBAS PASARON')
// process.exitCode (no process.exit): en Windows, salir con fetches aún drenando
// dispara un assert de libuv aunque todo haya pasado.
process.exitCode = fails ? 1 : 0
