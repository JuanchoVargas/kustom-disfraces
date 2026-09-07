// Manda frases al bot (webhook simulado de Messenger o WhatsApp) y muestra la respuesta.
//   node scripts/probar-bot.mjs msg|wa "frase" "@id-de-boton" ...   (el prefijo @ envía un tap de botón/quick reply)
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
const env = {}; for (const l of readFileSync('E:/Trabajo/KustomDisfracez/.env','utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sql = neon(env.POSTGRES_URL)
const BASE = 'http://localhost:3000'
const PSID = '9990000000000088'
const canal = process.argv[2] === 'wa' ? 'wa' : 'msg'
const frases = process.argv.slice(3)
await sql.query(`DELETE FROM conversations WHERE external_id IN ($1, $2)`, [PSID, '570000000088'])
for (const f of frases) {
  const isReply = f.startsWith('@')
  if (canal === 'msg') {
    if (isReply) { await fetch(`${BASE}/api/messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'page', entry: [{ id: '0', time: Date.now(), messaging: [{ sender: { id: PSID }, recipient: { id: '1' }, timestamp: Date.now(), message: { mid: `m.${Date.now()}.${Math.random()}`, text: f.slice(1), quick_reply: { payload: f.slice(1) } } }] }] }) }) }
    else
    await fetch(`${BASE}/api/messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'page', entry: [{ id: '0', time: Date.now(), messaging: [{ sender: { id: PSID }, recipient: { id: '1' }, timestamp: Date.now(), message: { mid: `m.${Date.now()}.${Math.random()}`, text: f } }] }] }) })
  } else {
    if (isReply) { await fetch(`${BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Prueba' }, wa_id: '570000000088' }], messages: [{ from: '570000000088', id: `w.${Date.now()}.${Math.random()}`, timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: f.slice(1), title: f.slice(1) } } }] } }] }] }) }) }
    else await fetch(`${BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Prueba' }, wa_id: '570000000088' }], messages: [{ from: '570000000088', id: `w.${Date.now()}.${Math.random()}`, timestamp: '1', type: 'text', text: { body: f } }] } }] }] }) })
  }
  const rows = await sql.query(`SELECT m.texto FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.external_id IN ($1,$2) AND m.direccion='out' ORDER BY m.id DESC LIMIT 3`, [PSID, '570000000088'])
  const outs = rows.map(r => r.texto).reverse()
  console.log(`\n>>> [${canal}] ${f}`); for (const o of outs.slice(-2)) console.log('   ' + o.replace(/\n/g, ' | ').slice(0, 230))
}
await sql.query(`DELETE FROM conversations WHERE external_id IN ($1, $2)`, [PSID, '570000000088'])
