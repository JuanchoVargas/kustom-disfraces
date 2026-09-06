import { deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * Excel (.xlsx) y CSV SIN dependencias, para exportar/importar el inventario.
 *
 * - Escritura: un libro con una hoja, encabezado en negrita, textos como
 *   "inlineStr" y números como números (Excel los reconoce al abrir).
 * - Lectura: descomprime el zip (zlib nativo), resuelve la primera hoja del
 *   libro, sharedStrings y cadenas en línea; devuelve filas como arreglos.
 * - CSV: UTF-8 con BOM y separador ";" (Excel en español). La lectura acepta
 *   ";" o "," (se detecta en el encabezado) y comillas.
 * El formato es acotado (texto y números en una hoja): suficiente y estable
 * para las columnas del inventario. Sin fechas, fórmulas ni estilos avanzados.
 */

export type Cell = string | number | null

// ---------- CRC32 / ZIP ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xFF]! ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function zipWrite(files: { name: string, data: Buffer }[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const comp = deflateRawSync(f.data)
    const crc = crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12) // fecha fija (1980-01-01)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, comp)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014B50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(f.data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += local.length + name.length + comp.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054B50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...parts, cdBuf, eocd])
}

function zipRead(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054B50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('no es un archivo .xlsx (zip sin directorio central)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014B50) throw new Error('zip corrupto')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28)
    const elen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const loff = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    const lnlen = buf.readUInt16LE(loff + 26)
    const lelen = buf.readUInt16LE(loff + 28)
    const start = loff + 30 + lnlen + lelen
    const raw = buf.subarray(start, start + csize)
    let data: Buffer
    if (method === 8) data = inflateRawSync(raw)
    else if (method === 0) data = Buffer.from(raw)
    else throw new Error(`método de compresión no soportado (${method})`)
    if (usize && data.length !== usize) throw new Error(`tamaño inesperado en ${name}`)
    out.set(name, data)
    p += 46 + nlen + elen + clen
  }
  return out
}

// ---------- XML helpers ----------
const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unescXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&')

export function colLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// ---------- escritura ----------
export function writeXlsx(sheetName: string, header: string[], rows: Cell[][], widths?: number[]): Buffer {
  const cell = (r: number, c: number, v: Cell, bold = false): string => {
    if (v === null || v === '') return ''
    const ref = `${colLetter(c)}${r}`
    const s = bold ? ' s="1"' : ''
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escXml(String(v))}</t></is></c>`
  }
  const lines: string[] = []
  lines.push(`<row r="1">${header.map((h, c) => cell(1, c, h, true)).join('')}</row>`)
  rows.forEach((row, i) => lines.push(`<row r="${i + 2}">${row.map((v, c) => cell(i + 2, c, v)).join('')}</row>`))
  const cols = (widths ?? header.map(h => Math.max(10, h.length + 2)))
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${lines.join('')}</sheetData></worksheet>`
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  return zipWrite([
    { name: '[Content_Types].xml', data: Buffer.from(types) },
    { name: '_rels/.rels', data: Buffer.from(rels) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels) },
    { name: 'xl/styles.xml', data: Buffer.from(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ])
}

export function writeCsv(header: string[], rows: Cell[][], sep = ';'): Buffer {
  const q = (v: Cell) => {
    if (v === null) return ''
    const s = String(v)
    return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [header, ...rows].map(r => r.map(q).join(sep)).join('\r\n')
  return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')])
}

// ---------- lectura ----------
/** Filas de la primera hoja (incluye encabezado). Celdas vacías = null. */
export function readXlsx(buf: Buffer): Cell[][] {
  const files = zipRead(buf)
  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? ''
  const firstSheet = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  let target = firstSheet ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstSheet}"[^>]*Target="([^"]+)"`))?.[1] : undefined
  if (!target) target = rels.match(/Target="([^"]*worksheets\/[^"]+)"/)?.[1]
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`) : 'xl/worksheets/sheet1.xml'
  const sheet = files.get(sheetPath)?.toString('utf8')
  if (!sheet) throw new Error('el .xlsx no tiene hoja de cálculo legible')

  const shared: string[] = []
  const ss = files.get('xl/sharedStrings.xml')?.toString('utf8')
  if (ss) {
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unescXml(t[1]!)).join(''))
    }
  }
  const rows: Cell[][] = []
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const inner = rm[1] ?? ''
    const row: Cell[] = []
    for (const cm of inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? '', body = cm[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1]
      if (!ref) continue
      const idx = colIndex(ref)
      const t = attrs.match(/\bt="([^"]+)"/)?.[1]
      let v: Cell = null
      if (t === 's') { const i = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1]); v = shared[i] ?? null }
      else if (t === 'inlineStr') v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unescXml(x[1]!)).join('')
      else if (t === 'str' || t === 'd') v = unescXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      else if (t === 'b') v = body.match(/<v>1<\/v>/) ? 'sí' : 'no'
      else { const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]; if (raw !== undefined) { const n = Number(raw); v = Number.isFinite(n) ? n : unescXml(raw) } }
      while (row.length < idx) row.push(null)
      row[idx] = v === '' ? null : v
    }
    rows.push(row)
  }
  return rows
}

export function readCsv(buf: Buffer): Cell[][] {
  let text = buf.toString('utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: Cell[][] = []
  let row: Cell[] = [], field = '', inQ = false
  const push = () => { row.push(field === '' ? null : (/^-?\d+(\.\d+)?$/.test(field) ? Number(field) : field)); field = '' }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += ch
    }
    else if (ch === '"') inQ = true
    else if (ch === sep) push()
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; push(); rows.push(row); row = []; }
    else field += ch
  }
  if (field !== '' || row.length) { push(); rows.push(row) }
  return rows.filter(r => r.some(c => c !== null))
}

/** Detecta por firma: zip (PK) → xlsx; si no, CSV. */
export function readSpreadsheet(buf: Buffer, filename = ''): Cell[][] {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B
  if (isZip || /\.xlsx$/i.test(filename)) return readXlsx(buf)
  return readCsv(buf)
}
