// EVIDENCIA con casos reales de las 113 conversaciones analizadas (feature/bot-conversion).
// Contra un dev server local (npm run dev + POSTGRES_URL + NUXT_INBOX_PASSWORD en .env).
// Cada frase es un mensaje REAL de un cliente (copiado de la BD); se manda por el
// webhook simulado del canal donde ocurrió y se comprueba la respuesta del bot.
//
//   node scripts/test-bot-conversion.mjs [baseUrl]
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) ?? 'http://localhost:3000'
const env = {}
for (const l of readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim() }
const sql = neon(env.POSTGRES_URL || env.DATABASE_URL)
const PSID = '9990000000000089', WA = '570000000089'
let fails = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) fails++ }
const cleanup = async () => {
  await sql.query(`DELETE FROM conversations WHERE external_id IN ($1,$2)`, [PSID, WA])
  await sql.query(`DELETE FROM bot_busquedas_fallidas WHERE external_id IN ($1,$2)`, [PSID, WA])
}
await cleanup()

async function send(canal, text, reply = false) {
  if (canal === 'msg') {
    const message = reply ? { mid: `m.${Date.now()}.${Math.random()}`, text, quick_reply: { payload: text } } : { mid: `m.${Date.now()}.${Math.random()}`, text }
    await fetch(`${BASE}/api/messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'page', entry: [{ id: '0', time: Date.now(), messaging: [{ sender: { id: PSID }, recipient: { id: '1' }, timestamp: Date.now(), message }] }] }) })
  }
  else {
    const msg = reply
      ? { from: WA, id: `w.${Date.now()}.${Math.random()}`, timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: text, title: text } } }
      : { from: WA, id: `w.${Date.now()}.${Math.random()}`, timestamp: '1', type: 'text', text: { body: text } }
    await fetch(`${BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Prueba Conversión' }, wa_id: WA }], messages: [msg] } }] }] }) })
  }
  const rows = await sql.query(`SELECT m.texto FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.external_id = $1 AND m.direccion = 'out' ORDER BY m.id DESC LIMIT 2`, [canal === 'msg' ? PSID : WA])
  return rows.map(r => r.texto).reverse().join('\n')
}

// ---------- 1. Messenger: las frases que causaban el 40 % de "no encontrado" ----------
console.log('— 1. Messenger: preguntas reales (Ice Breakers de la página) que antes caían en "No tenemos ese disfraz"')
let r = await send('msg', '¿Qué tallas están disponibles en los disfraces?')
check('"¿Qué tallas están disponibles…?" → guía de tallas (niños 0–14, adultos S–XL)', /0 a la 14/.test(r) && /S, M, L y XL/.test(r) && !/No tengo/.test(r))
r = await send('msg', '¿Cuál es el código de descuento para aplicar?')
check('"¿Cuál es el código de descuento…?" → "No necesitas código", 20 % ya aplicado, envío gratis', /No necesitas código/.test(r) && /20% de descuento ya está aplicado/.test(r) && /gratis/.test(r))
check('  …con botones Ver disfraces · Cómo comprar · Hablar con alguien', /Ver disfraces/.test(r) && /Cómo comprar/.test(r) && /Hablar con alguien/.test(r))
r = await send('msg', '¿Se puede personalizar un disfraz con mi propio diseño?')
check('"¿Se puede personalizar…?" → qué incluye cada diseño y que no hay personalización a medida', /Personalización/.test(r) && /No hacemos diseños a la medida/.test(r))
r = await send('msg', 'Spider-Man Clásico L')
check('"Spider-Man Clásico L" (título de botón tecleado) → lista de Spider-Man, no falla', /Spider-Man Clásico/.test(r) && !/No tengo/.test(r))
for (const q of ['descuento', 'tienen promoción?', 'codigo', 'cupon', 'hay 20%']) {
  r = await send('msg', q)
  check(`"${q}" → respuesta de descuento`, /No necesitas código/.test(r), r.split('\n')[0].slice(0, 60))
}

// ---------- 2. "No encontrado" nunca es un callejón sin salida ----------
console.log('— 2. Sin resultado exacto: parecidos + Hablar con alguien + registro de demanda')
r = await send('msg', 'Tiene deep pool')
check('"Tiene deep pool" → sugiere Deadpool (fonético)', /Deadpool/.test(r) && /Hablar con alguien/.test(r))
r = await send('wa', 'Hola buenas tiene disfraz de venimos talla 12')
check('"…venimos talla 12" (WhatsApp real) → sugiere Venom, repite solo el término', /Venom/.test(r) && /"venimos"/.test(r) && !/hola buenas/.test(r))
r = await send('msg', 'Woody')
check('"Woody" (no existe) → sin sugerencias falsas, ofrece categorías y Hablar con alguien', /No tengo \*"woody"\*/.test(r) && /Hablar con alguien/.test(r) && !/Lady Bug/.test(r))
r = await send('msg', 'Mario bros talla 14')
check('"Mario bros talla 14" → sin inventar parecidos (puntaje bajo), Hablar con alguien presente', /Hablar con alguien/.test(r) && !/Mujer Maravilla/.test(r))
const nf = await sql.query(`SELECT canal, texto, termino, motivo FROM bot_busquedas_fallidas WHERE external_id IN ($1,$2) ORDER BY id`, [PSID, WA])
check('cada búsqueda fallida quedó registrada con canal, texto exacto, término y motivo', nf.length >= 4 && nf.every(x => x.canal && x.texto && x.termino && x.motivo), nf.map(x => `${x.canal}:${x.termino}:${x.motivo}`).join(' · '))
const login = await fetch(`${BASE}/api/inbox/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.NUXT_INBOX_PASSWORD }) })
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
const dem = await fetch(`${BASE}/api/inbox/demanda`, { headers: { cookie } }).then(x => x.json())
check('reporte de demanda /api/inbox/demanda agrupa por término', Array.isArray(dem.items) && dem.items.some(i => i.termino === 'woody' && i.veces >= 1))

// ---------- 4. Ficha que empuja a la venta + ¿Qué talla? ----------
console.log('— 4. Ficha de producto con botones de venta y sugerencia de talla')
r = await send('wa', 'buzz lightyear')
check('ficha: nombre, precio, tallas, enlace y botones Comprar ahora · ¿Qué talla? · Hablar con alguien', /Buzz Lightyear/.test(r) && /\$146\.000/.test(r) && /Tallas:/.test(r) && /producto\/buzz-lightyear/.test(r) && /Comprar ahora/.test(r) && /¿Qué talla\?/.test(r) && /Hablar con alguien/.test(r) && !/Escribe \*MENÚ\*/.test(r))
r = await send('wa', 'talla:buzz-lightyear', true)
check('"¿Qué talla?" pregunta edad o estatura', /edad/.test(r) && /estatura/.test(r))
r = await send('wa', '5 años')
check('"5 años" → talla 4 sugerida (≈ edad) con enlace ?talla=4', /talla 4\*/.test(r) && /\?talla=4/.test(r))
r = await send('wa', '1,10 m')
check('"1,10 m" → talla 8 (guía: 101–110 cm)', /talla 8\*/.test(r) && /\?talla=8/.test(r))
r = await send('wa', 'buyp:buzz-lightyear', true)
check('"Comprar ahora" → enlace a la web con formas de pago y envío gratis', /producto\/buzz-lightyear/.test(r) && /Mercado Pago/.test(r) && /gratis/.test(r))
r = await send('wa', 'talla:spider-woman-adulto', true)
check('producto de adulto: "¿Qué talla?" muestra S/M/L/XL con estaturas de referencia', /S, M, L, XL/.test(r) && /1,70/.test(r))

// ---------- 5. Preguntas nuevas ----------
console.log('— 5. Personalización y tallas de adulto')
r = await send('wa', 'bienas tardes, ustedes fabrican disfraces por encargo?')
const ultimos = (await sql.query(`SELECT m.texto FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.external_id = $1 AND m.direccion = 'out' ORDER BY m.id DESC LIMIT 4`, [WA])).map(x => x.texto).join(' ')
check('"fabrican disfraces por encargo?" → respuesta de personalización', /Personalización/.test(ultimos))
r = await send('wa', 'Que disfraces tiene para niño de 1 año y medio')
check('"para niño de 1 año y medio" → no cae en "no encontrado" (pide personaje o muestra categorías)', !/No tengo/.test(r), r.split('\n')[0].slice(0, 80))

// ---------- 6. Leads con teléfono ----------
console.log('— 6. Teléfono escrito en el chat (casos reales 3127318424 y 3223170651)')
r = await send('msg', '3127318424')
check('"3127318424" (Messenger) → "Anotado", guarda el número', /Guardé tu número \*3127318424\*/.test(r))
let conv = (await sql.query(`SELECT telefono_lead, no_leidos FROM conversations WHERE external_id = $1`, [PSID]))[0]
check('la conversación guarda telefono_lead y queda no leída', conv?.telefono_lead === '3127318424' && conv.no_leidos >= 1, JSON.stringify(conv))
r = await send('wa', 'me pueden llamar al 322 317 0651 porfa')
conv = (await sql.query(`SELECT telefono_lead FROM conversations WHERE external_id = $1`, [WA]))[0]
check('"322 317 0651" con espacios (WhatsApp) → normalizado a 3223170651', conv?.telefono_lead === '3223170651' && /Guardé tu número/.test(r))
r = await send('wa', '3')
check('un "3" suelto NO es teléfono ni búsqueda fallida: vuelve al menú', !/Guardé tu número/.test(r) && !/No tengo/.test(r) && /asistente de/.test(r))

await cleanup()
console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exit(fails ? 1 : 0)
