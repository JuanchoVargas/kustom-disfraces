// Previsualiza SIN RED el mapeo del cerebro del bot → Messenger/Instagram.
//   node scripts/test-msg-menu.mjs            (todos los casos)
//   node scripts/test-msg-menu.mjs "<texto>"  (un texto libre puntual)
//
// Carga la lógica real (server/utils/whatsappBot.ts + messenger.ts) vía jiti, sin
// duplicarla ni tocar la red. Muestra, por cada mensaje del bot, el payload de
// Messenger: texto + quick replies (título → payload).
import { fileURLToPath } from 'node:url'

const { createJiti } = await import('jiti')
const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.useRuntimeConfig = () => ({
  public: { siteUrl: 'https://www.disfraceskustom.com' },
  // El mapeo no usa el token; solo lo haría el envío real (aquí no se envía).
  messengerPageToken: '',
})
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const bot = await jiti.import(fileURLToPath(new URL('../server/utils/whatsappBot.ts', import.meta.url)))
const msgr = await jiti.import(fileURLToPath(new URL('../server/utils/messenger.ts', import.meta.url)))

const st = () => ({ step: 'start', flaggedForHuman: false, updatedAt: 0 })
const repliesFor = input => bot.buildBotReplies(
  typeof input === 'string' ? { from: 'preview', kind: 'text', text: input } : { from: 'preview', kind: 'reply', replyId: input.replyId },
  st(),
).replies

function render(label, input) {
  console.log(`\n════════ ${label} ════════`)
  const replies = repliesFor(input)
  const { messages, lastMenu } = msgr.toMessengerReplies(replies)
  messages.forEach((m, i) => {
    console.log(`\n[messenger · mensaje ${i + 1}/${messages.length}]`)
    console.log(m.text.split('\n').map(l => `  ${l}`).join('\n'))
    if (m.quick_replies?.length) {
      console.log(`  quick_replies (${m.quick_replies.length}):`)
      for (const qr of m.quick_replies) console.log(`    [ ${qr.title} ] → ${qr.payload}`)
    }
  })
  if (lastMenu) console.log(`\n  (lastMenu para respuestas numéricas: ${lastMenu.join(', ')})`)
}

// Caso puntual por argumento.
if (process.argv[2]) {
  render(`texto libre: "${process.argv[2]}"`, process.argv[2])
  process.exit(0)
}

// Suite por defecto.
render('MENÚ PRINCIPAL (hola)', 'hola')
render('PÚBLICOS (tap "Ver disfraces")', { replyId: 'main:ver' })
render('CATEGORÍAS · Niñas (tap pub:ninas)', { replyId: 'pub:ninas' })
render('SUBLINK · Niñas/Trusas (enlace + quick replies)', { replyId: 'sub:ninas:trusas' })
render('FICHA (goku) — texto con URL', 'goku')
render('BÚSQUEDA (hombre araña) — texto agrupado + quick replies', 'hombre araña')
render('CATÁLOGO (tap main:catalogo) — texto con URL', { replyId: 'main:catalogo' })
