// Reescribe los enlaces de WhatsApp del catálogo PDF: recorre TODAS las anotaciones
// /URI y reemplaza el número de wa.me / api.whatsapp.com por el número real del
// negocio. Sin red, determinista.
//
//   node scripts/pdf-fix-wa.mjs                      → SOLO LISTA los URIs (no toca el PDF)
//   node scripts/pdf-fix-wa.mjs --write [--out X]    → reemplaza y guarda (out o sobre el original)
//   node scripts/pdf-fix-wa.mjs --new 57311...       → número destino (default abajo)
//
// Requiere pdf-lib (npm i -D pdf-lib). Se eligió pdf-lib porque el entorno no tiene
// Python/pypdf ni qpdf; hace lo mismo a nivel de objetos del PDF.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib'

const NEW_NUMBER = argValue('--new') ?? '573118844547'
const PREFILL = 'Hola 😀, estoy buscando un disfraz de...' // mensaje pre-cargado (igual al de wa.link)
const NO_TEXT = process.argv.includes('--notext')
const WA_ME = `https://wa.me/${NEW_NUMBER}${NO_TEXT ? '' : `?text=${encodeURIComponent(PREFILL)}`}`
const WRITE = process.argv.includes('--write')
const SRC = argValue('--src') ?? fileURLToPath(new URL('../public/catalogo-kustom.pdf', import.meta.url))
const OUT = argValue('--out') ?? SRC

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function decodeStr(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try { return obj.decodeText() }
    catch { return typeof obj.asString === 'function' ? obj.asString() : null }
  }
  return null
}

// Devuelve el URI corregido (o null si no es un enlace de WhatsApp):
//  - short-links wa.link/* → wa.me directo al número real (el número viejo vivía
//    en el redirect de wa.link, no en el PDF), con el texto pre-cargado.
//  - formas con número embebido (wa.me/<n>, ?phone=<n>) → se cambia el número.
function rewriteWa(uri) {
  if (/wa\.link\//i.test(uri)) return uri === WA_ME ? null : WA_ME
  const isWa = /(?:wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\/send)/i.test(uri)
  if (!isWa) return null
  const next = uri
    .replace(/(wa\.me\/)\+?\d+/i, `$1${NEW_NUMBER}`)
    .replace(/([?&]phone=)\+?\d+/i, `$1${NEW_NUMBER}`)
  return next === uri ? null : next
}

// Recorre recursivamente los objetos del PDF y recolecta (y opcionalmente reescribe)
// cada valor bajo la clave /URI, junto con el diccionario que lo contiene.
function collect(pdf) {
  const found = [] // { uri, dict }
  const seen = new Set()
  const walk = (obj) => {
    if (obj == null || seen.has(obj)) return
    if (obj instanceof PDFRawStream) { seen.add(obj); walk(obj.dict); return }
    if (obj instanceof PDFDict) {
      seen.add(obj)
      for (const [name, val] of obj.entries()) {
        if (name.asString() === '/URI') {
          const uri = decodeStr(val)
          if (uri != null) found.push({ uri, dict: obj })
        }
        walk(val)
      }
    }
    else if (obj instanceof PDFArray) {
      seen.add(obj)
      for (const el of obj.asArray()) walk(el)
    }
  }
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) walk(obj)
  return found
}

const bytes = readFileSync(SRC)
const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
const found = collect(pdf)

// --- Reporte: TODOS los URIs (únicos, con conteo) ---
const counts = new Map()
for (const { uri } of found) counts.set(uri, (counts.get(uri) ?? 0) + 1)
console.log(`\n== URIs encontrados en el PDF (${found.length} anotaciones, ${counts.size} únicos) ==`)
for (const [uri, n] of [...counts.entries()].sort()) console.log(`  [x${n}] ${uri}`)

const waNumbers = new Set()
for (const { uri } of found) {
  const m = uri.match(/(?:wa\.me\/|[?&]phone=)\+?(\d+)/i)
  if (m) waNumbers.add(m[1])
}
console.log(`\n== Números de WhatsApp detectados: ${waNumbers.size ? [...waNumbers].join(', ') : '(ninguno)'} ==`)
console.log(`== Número destino: ${NEW_NUMBER} ==`)

if (!WRITE) {
  console.log('\n(Modo listado — no se modificó el PDF. Usa --write para reemplazar.)')
  process.exit(0)
}

// --- Reemplazo ---
let changed = 0
for (const { uri, dict } of found) {
  const next = rewriteWa(uri)
  if (next && next !== uri) {
    dict.set(PDFName.of('URI'), PDFString.of(next))
    console.log(`  ✏️  ${uri}\n      → ${next}`)
    changed++
  }
}
console.log(`\n== Reemplazos aplicados: ${changed} ==`)

const outBytes = await pdf.save({ useObjectStreams: false })
writeFileSync(OUT, outBytes)
console.log(`== PDF guardado en: ${OUT} (${outBytes.length} bytes) ==`)
