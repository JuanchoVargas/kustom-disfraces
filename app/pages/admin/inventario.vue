<script setup lang="ts">
/**
 * PANEL DE INVENTARIO — /admin/inventario (Fase 1)
 * Tabla de productos con filtros, buscador, paginación y edición en línea de
 * precio (normal / rebajado) y stock por talla, selección múltiple (base de las
 * operaciones masivas, siguiente entregable) y registro de cambios por producto.
 * Misma contraseña y cookie que la bandeja (/api/inbox/login).
 *
 * El panel NO sabe qué adaptador hay detrás: consume /api/inventario/* que
 * devuelve el shape de Woo. En modo simulación (adaptador mock) muestra el
 * aviso "Modo simulación — los cambios no se reflejan en el sitio".
 */
import { defineComponent, h } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { InvChange, InvOpResult, InvProduct, InvStatus, InvVariation } from '~~/shared/types/inventory'
import { tallaFromSku } from '~~/shared/utils/tallas'

definePageMeta({ layout: 'inbox' })
useHead({ title: 'Inventario — Kustom', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const GRUPOS: Record<string, string> = {
  'super': 'Súper Acolchado', 'economico': 'Línea Eco', 'semi': 'Semi Acolchado', 'super-adulto': 'Súper Adulto',
  'anime': 'Anime', 'ninja': 'Ninjas', 'trusa-infantil': 'Trusa infantil', 'trusa-adulto': 'Trusa adulto',
  'vestidos': 'Vestidos', 'peluche-plus': 'Peluche Plus', 'peluche-linea': 'Peluche de Línea', 'personajes': 'Personajes', 'chaqueta': 'Chaquetas',
}
const PUBLICOS: Record<string, string> = { bebes: 'Bebés', ninos: 'Niños', ninas: 'Niñas', damas: 'Damas', caballeros: 'Caballeros' }
const ESTADOS: Record<string, string> = { publish: 'Publicado', draft: 'Borrador', pending: 'Pendiente', private: 'Privado' }

// ---------- sesión ----------
const checking = ref(true)
const authed = ref(false)
const configured = ref(true)
const password = ref('')
const loginError = ref('')
const loggingIn = ref(false)

async function checkSession() {
  try {
    const me = await $fetch<{ configured: boolean, authenticated: boolean }>('/api/inbox/me')
    configured.value = me.configured
    authed.value = me.authenticated
  }
  catch { authed.value = false }
  checking.value = false
  if (authed.value) await boot()
}
async function login() {
  loginError.value = ''
  loggingIn.value = true
  try {
    await $fetch('/api/inbox/login', { method: 'POST', body: { password: password.value } })
    password.value = ''
    authed.value = true
    await boot()
  }
  catch (e: any) {
    loginError.value = e?.statusCode === 503 ? 'El panel no está configurado (NUXT_INBOX_PASSWORD).' : 'Contraseña incorrecta.'
  }
  loggingIn.value = false
}
async function logout() {
  await $fetch('/api/inbox/logout', { method: 'POST' })
  authed.value = false
}
function onUnauthorized(e: any) {
  if (e?.statusCode === 401) authed.value = false
}

// ---------- estado del módulo + sincronización ----------
const estado = ref<InvStatus | null>(null)
const syncing = ref(false)
const syncMsg = ref('')
async function loadEstado() {
  try { estado.value = await $fetch<InvStatus>('/api/inventario/estado') }
  catch (e) { onUnauthorized(e) }
}
/** Repite pasos de sincronización hasta que no queden pendientes. */
async function sync(force = false) {
  if (syncing.value) return
  syncing.value = true
  syncMsg.value = 'Leyendo productos de Woo…'
  try {
    for (let i = 0; i < 40; i++) {
      const r = await $fetch<{ total: number, pendientes: number, error?: string }>('/api/inventario/sincronizar', { method: 'POST', body: { force: force && i === 0 } })
      if (r.error) { syncMsg.value = `Woo no respondió: ${r.error}`; break }
      syncMsg.value = r.pendientes ? `Sincronizando con Woo… faltan ${r.pendientes} de ${r.total}` : ''
      if (!r.pendientes) break
    }
    await Promise.all([loadEstado(), refresh()])
  }
  catch (e: any) { onUnauthorized(e); syncMsg.value = 'No se pudo sincronizar.' }
  syncing.value = false
}
// ---------- prueba en vivo del adaptador woo (solo borradores) ----------
interface ProbeResult { ok: boolean, conclusion: string, ms?: number, steps: { paso: string, ok: boolean, detalle?: unknown }[] }
const probing = ref(false)
const probeResult = ref<ProbeResult | null>(null)
async function probarWoo() {
  if (probing.value) return
  probing.value = true
  try {
    probeResult.value = await $fetch<ProbeResult>('/api/inventario/probar-woo', { method: 'POST', body: {} })
    await Promise.all([loadEstado(), refresh()])
  }
  catch (e: any) {
    onUnauthorized(e)
    probeResult.value = { ok: false, conclusion: 'No se pudo ejecutar la prueba', steps: [{ paso: 'error', ok: false, detalle: e?.data?.statusMessage ?? e?.message ?? String(e) }] }
  }
  probing.value = false
}
async function copyProbe() {
  try { await navigator.clipboard.writeText(JSON.stringify(probeResult.value, null, 2)) } catch {}
}

async function boot() {
  await loadEstado()
  await refresh()
  const s = estado.value
  // Primera vez (sin snapshot) o snapshot viejo → sincroniza sola.
  if (s && (s.origen !== 'woo' || (s.snapshot_age_s ?? 0) > 10 * 60)) sync(false)
}

// ---------- lista ----------
const q = ref('')
const status = ref('any')
const grupo = ref('')
const publico = ref('')
const stock = ref('any')
const orderby = ref('sku')
const order = ref('asc')
const page = ref(1)
const perPage = ref(25)
const items = ref<InvProduct[]>([])
const total = ref(0)
const totalPages = ref(1)
const loading = ref(false)
/** true solo hasta la primera respuesta: skeleton en vez de spinner */
const firstLoad = ref(true)
const listError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
// Debounce de 300 ms en el buscador; los filtros de select aplican de inmediato.
watch(q, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; refresh() }, 300) })
watch([status, grupo, publico, stock, orderby, order, perPage], () => { page.value = 1; refresh() })
watch(page, () => refresh())

async function refresh() {
  loading.value = true
  listError.value = ''
  try {
    const r = await $fetch<{ items: InvProduct[], total: number, total_pages: number, page: number }>('/api/inventario/productos', {
      query: { q: q.value, status: status.value, grupo: grupo.value, publico: publico.value, stock: stock.value, orderby: orderby.value, order: order.value, page: page.value, per_page: perPage.value },
    })
    items.value = r.items
    total.value = r.total
    totalPages.value = r.total_pages
    if (r.page !== page.value) page.value = r.page
    // Re-sembrar borradores de edición de los productos abiertos (sin pisar lo que se está editando).
    for (const p of r.items) if (open.value.has(p.sku)) seedDrafts(p, false)
    if (firstLoad.value) { firstLoad.value = false; performance.mark?.('inventario:filas') }
  }
  catch (e: any) { onUnauthorized(e); listError.value = 'No se pudo cargar la lista.' }
  loading.value = false
}
function sortBy(col: string) {
  if (orderby.value === col) order.value = order.value === 'asc' ? 'desc' : 'asc'
  else { orderby.value = col; order.value = 'asc' }
}
function clearFilters() {
  q.value = ''; status.value = 'any'; grupo.value = ''; publico.value = ''; stock.value = 'any'
}

// ---------- selección múltiple (base de las operaciones masivas) ----------
const selected = ref(new Set<string>())
const allOnPage = computed(() => items.value.length > 0 && items.value.every(p => selected.value.has(p.sku)))
function toggleSel(sku: string) {
  const s = new Set(selected.value)
  s.has(sku) ? s.delete(sku) : s.add(sku)
  selected.value = s
}
function toggleAll() {
  const s = new Set(selected.value)
  if (allOnPage.value) for (const p of items.value) s.delete(p.sku)
  else for (const p of items.value) s.add(p.sku)
  selected.value = s
}

// ---------- expandir + edición en línea ----------
const open = ref(new Set<string>())
interface Draft { regular_price: string, sale_price: string, stock_quantity: string, manage_stock: boolean }
const drafts = ref<Record<string, Draft>>({})
/** Estado por talla: guardando (indicador sutil), destello de éxito, error con mensaje. */
const rowState = ref<Record<string, { saving?: boolean, msg?: string, ok?: boolean, flash?: boolean }>>({})
const history = ref<Record<string, InvChange[]>>({})

function draftOf(v: InvVariation): Draft {
  return { regular_price: v.regular_price, sale_price: v.sale_price, stock_quantity: v.manage_stock ? String(v.stock_quantity ?? 0) : '', manage_stock: v.manage_stock }
}
/** Siembra los borradores; con overwrite=false respeta los que ya están sucios (edición en curso). */
function seedDrafts(p: InvProduct, overwrite = true) {
  for (const v of p.variations) {
    if (!overwrite && drafts.value[v.sku] && dirty(v)) continue
    drafts.value[v.sku] = draftOf(v)
  }
}
function toggleOpen(p: InvProduct) {
  const s = new Set(open.value)
  if (s.has(p.sku)) { s.delete(p.sku); open.value = s; return }
  s.add(p.sku)
  open.value = s
  seedDrafts(p, false)
  if (!history.value[p.sku]) loadHistory(p.sku)
  loadImages(p.sku)
}
async function loadHistory(sku: string) {
  try {
    const r = await $fetch<{ cambios: InvChange[] }>(`/api/inventario/productos/${encodeURIComponent(sku)}`)
    history.value[sku] = r.cambios
  }
  catch (e) { onUnauthorized(e) }
}
function dirty(v: InvVariation): boolean {
  const d = drafts.value[v.sku]
  if (!d) return false
  const stockNow = v.manage_stock ? String(v.stock_quantity ?? 0) : ''
  return d.regular_price !== v.regular_price || d.sale_price !== v.sale_price || d.stock_quantity !== stockNow
}
/** Copia optimista de la variación con el borrador aplicado (lo que se verá al instante). */
function optimistic(v: InvVariation, d: Draft): InvVariation {
  const regular = d.regular_price.trim(), sale = d.sale_price.trim()
  const manage = d.stock_quantity !== '' ? true : v.manage_stock
  const qty = d.stock_quantity !== '' ? Number(d.stock_quantity) : v.stock_quantity
  const next: InvVariation = { ...v, regular_price: regular, sale_price: sale, price: sale || regular, manage_stock: manage, stock_quantity: Number.isFinite(qty as number) ? qty : v.stock_quantity }
  next.stock_status = !manage ? next.stock_status : ((next.stock_quantity ?? 0) > 0 ? 'instock' : 'outofstock')
  return next
}
function replaceVariation(p: InvProduct, v: InvVariation) {
  const i = items.value.findIndex(x => x.sku === p.sku)
  if (i < 0) return
  const prod = items.value[i]!
  const vi = prod.variations.findIndex(x => x.sku === v.sku)
  if (vi < 0) return
  const variations = prod.variations.slice()
  variations[vi] = v
  const prices = variations.map(x => Number(x.price)).filter(n => n > 0)
  const anyIn = variations.some(x => x.stock_status === 'instock')
  items.value[i] = { ...prod, variations, price: prices.length ? String(Math.min(...prices)) : prod.price, stock_status: anyIn ? 'instock' : 'outofstock' }
}
/**
 * Guarda una variación con ACTUALIZACIÓN OPTIMISTA: la fila cambia al instante,
 * se manda solo lo que cambió y, si el servidor rechaza, se revierte al valor
 * anterior con el mensaje de error visible en la fila.
 */
async function save(p: InvProduct, v: InvVariation) {
  const d = drafts.value[v.sku]
  if (!d || !dirty(v)) return
  const ops: any[] = []
  if (d.regular_price !== v.regular_price || d.sale_price !== v.sale_price) ops.push({ op: 'price', sku: v.sku, regular_price: d.regular_price, sale_price: d.sale_price })
  const stockNow = v.manage_stock ? String(v.stock_quantity ?? 0) : ''
  if (d.stock_quantity !== stockNow && d.stock_quantity !== '') ops.push({ op: 'stock', sku: v.sku, stock_quantity: Number(d.stock_quantity) })
  if (!ops.length) return
  const before = v
  const guess = optimistic(v, d)
  replaceVariation(p, guess)
  drafts.value[v.sku] = draftOf(guess)
  rowState.value[v.sku] = { saving: true }
  try {
    const r = await $fetch<{ resultados: InvOpResult[] }>('/api/inventario/operaciones', { method: 'POST', body: { operaciones: ops, origen: 'panel' } })
    const bad = r.resultados.filter(x => !x.ok)
    if (bad.length) {
      // Revertir al valor anterior y dejar el borrador con lo que el usuario había escrito.
      replaceVariation(p, before)
      drafts.value[v.sku] = d
      rowState.value[v.sku] = { ok: false, msg: bad.map(b => b.error).join(' · ') }
      return
    }
    // Confirmado por el servidor: sustituir la conjetura por el valor real (después) y destello verde.
    const real = r.resultados.reduce((acc, res) => ({ ...acc, ...(res.after ?? {}) }), guess) as InvVariation
    replaceVariation(p, real)
    drafts.value[v.sku] = draftOf(real)
    rowState.value[v.sku] = { ok: true, flash: true }
    setTimeout(() => { if (rowState.value[v.sku]?.ok) rowState.value[v.sku] = {} }, 1200)
    // Historial y cabecera del producto, en segundo plano (no bloquea la edición).
    $fetch<{ product: InvProduct, cambios: InvChange[] }>(`/api/inventario/productos/${encodeURIComponent(p.sku)}`)
      .then((fresh) => {
        history.value[p.sku] = fresh.cambios
        const i = items.value.findIndex(x => x.sku === p.sku)
        if (i >= 0) { items.value[i] = fresh.product; seedDrafts(fresh.product, false) }
      })
      .catch(() => {})
    loadEstado()
  }
  catch (e: any) {
    onUnauthorized(e)
    replaceVariation(p, before)
    drafts.value[v.sku] = d
    rowState.value[v.sku] = { ok: false, msg: e?.data?.statusMessage ?? 'No se pudo guardar; se revirtió el valor' }
  }
}
function reset(v: InvVariation) {
  drafts.value[v.sku] = draftOf(v)
  rowState.value[v.sku] = {}
}

// ---------- virtualización (@tanstack/vue-virtual) ----------
// Una lista plana de "filas virtuales": cada producto aporta su fila de cabecera y,
// si está abierto, su bloque de tallas. Así SOLO se pintan las filas visibles aunque
// los 100 productos estén expandidos. Las alturas son dinámicas (measureElement).
type VRow = { key: string, kind: 'row', p: InvProduct } | { key: string, kind: 'detail', p: InvProduct }
const vrows = computed<VRow[]>(() => {
  const out: VRow[] = []
  for (const p of items.value) {
    out.push({ key: `r:${p.sku}`, kind: 'row', p })
    if (open.value.has(p.sku)) out.push({ key: `d:${p.sku}`, kind: 'detail', p })
  }
  return out
})
// ---------- densidad (compacto / cómodo), guardada en el navegador ----------
const densidad = ref<'comodo' | 'compacto'>('comodo')
onMounted(() => { try { const d = localStorage.getItem('kustom-inv-densidad'); if (d === 'compacto' || d === 'comodo') densidad.value = d } catch {} })
watch(densidad, (d) => { try { localStorage.setItem('kustom-inv-densidad', d) } catch {} nextTick(() => virtualizer.value.measure()) })
const ROW_H_BY = { comodo: 76, compacto: 56 }
const scrollEl = ref<HTMLElement | null>(null)
const DETAIL_H = 420
const virtualizer = useVirtualizer(computed(() => ({
  count: vrows.value.length,
  getScrollElement: () => scrollEl.value,
  estimateSize: (i: number) => (vrows.value[i]?.kind === 'detail' ? DETAIL_H : ROW_H_BY[densidad.value]),
  getItemKey: (i: number) => vrows.value[i]?.key ?? i,
  overscan: 6,
})))
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())
function measure(el: Element | null) {
  if (el) virtualizer.value.measureElement(el)
}
// Al cambiar el conjunto de filas (filtro/página) se vuelve arriba.
watch(items, () => { virtualizer.value.scrollToOffset(0) })

// ---------- operación masiva / importación ----------
interface PreviewRow { sku: string, producto: string, codigo: string, talla: string, status: string, antes: any, despues: any, ops: any[], cambia: boolean, error?: string }
interface Preview { filas: PreviewRow[], con_cambios: number, sin_cambio: number, errores: number, ignoradas?: { fila: number, motivo: string }[] }
const fileInput = ref<HTMLInputElement | null>(null)
const bulk = reactive({
  open: false, mode: 'bulk' as 'bulk' | 'import', target: 'selected' as 'selected' | 'filtered', busy: false, error: '',
  tallas: '', precioModo: '', precioValor: '', ofertaModo: '', ofertaValor: '', stockModo: '', stockValor: '',
  preview: null as Preview | null, soloCambios: true, result: null as { msg: string, fallidas: number } | null,
})
const previewRows = computed(() => {
  const f = bulk.preview?.filas ?? []
  return bulk.soloCambios ? f.filter(r => r.cambia || r.error) : f
})
function currentFilters() {
  return { q: q.value, status: status.value, grupo: grupo.value, publico: publico.value, stock: stock.value }
}
function exportUrl(formato: 'xlsx' | 'csv') {
  const p = new URLSearchParams({ ...currentFilters(), formato })
  return `/api/inventario/exportar?${p.toString()}`
}
function openBulk() {
  bulk.mode = 'bulk'; bulk.target = selected.value.size ? 'selected' : 'filtered'
  bulk.preview = null; bulk.result = null; bulk.error = ''; bulk.open = true
}
function openImport() {
  bulk.mode = 'import'; bulk.preview = null; bulk.result = null; bulk.error = ''; bulk.open = true
}
function closeBulk() { bulk.open = false }
async function previewBulk() {
  bulk.busy = true; bulk.error = ''
  try {
    const num = (v: string) => Number(String(v).replace(/[$.\s]/g, '').replace(',', '.'))
    const spec: any = {
      tallas: bulk.tallas.split(',').map(t => t.trim()).filter(Boolean),
    }
    if (bulk.target === 'selected' && selected.value.size) spec.skus = [...selected.value]
    else spec.filtros = currentFilters()
    if (bulk.precioModo) spec.precio = { modo: bulk.precioModo, valor: num(bulk.precioValor), redondeo: 100 }
    if (bulk.ofertaModo) spec.oferta = { modo: bulk.ofertaModo, valor: bulk.ofertaModo === 'quitar' ? undefined : num(bulk.ofertaValor) }
    if (bulk.stockModo) spec.stock = { modo: bulk.stockModo, valor: bulk.stockModo === 'agotar' ? undefined : num(bulk.stockValor) }
    const r = await $fetch<Preview & { total: number }>('/api/inventario/masivo', { method: 'POST', body: spec })
    bulk.preview = { ...r, sin_cambio: r.total - r.con_cambios - r.errores }
  }
  catch (e: any) { onUnauthorized(e); bulk.error = e?.data?.statusMessage ?? e?.message ?? 'No se pudo calcular la vista previa' }
  bulk.busy = false
}
async function previewImport() {
  const file = fileInput.value?.files?.[0]
  if (!file) { bulk.error = 'Elige un archivo .xlsx o .csv'; return }
  bulk.busy = true; bulk.error = ''
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    const r = await $fetch<{ filas: PreviewRow[], resumen: { con_cambios: number, sin_cambio: number, errores: number }, ignoradas: { fila: number, motivo: string }[] }>('/api/inventario/importar', { method: 'POST', body: fd })
    bulk.preview = { filas: r.filas, ignoradas: r.ignoradas, ...r.resumen }
  }
  catch (e: any) { onUnauthorized(e); bulk.error = e?.data?.statusMessage ?? e?.message ?? 'No se pudo leer el archivo' }
  bulk.busy = false
}
async function applyPreview() {
  if (!bulk.preview) return
  const ops = bulk.preview.filas.filter(f => f.cambia && !f.error).flatMap(f => f.ops)
  if (!ops.length) return
  bulk.busy = true
  try {
    const r = await $fetch<{ ok: number, fallidas: number, resultados: InvOpResult[] }>('/api/inventario/operaciones', { method: 'POST', body: { operaciones: ops, origen: bulk.mode === 'import' ? 'importacion' : 'masivo' } })
    const fallos = r.resultados.filter(x => !x.ok)
    bulk.result = { fallidas: r.fallidas, msg: r.fallidas ? `${r.ok} aplicadas · ${r.fallidas} fallidas: ${fallos.slice(0, 5).map(x => `${x.sku} (${x.error})`).join(', ')}${fallos.length > 5 ? '…' : ''}` : `${r.ok} cambios aplicados.` }
    await Promise.all([loadEstado(), refresh()])
  }
  catch (e: any) { onUnauthorized(e); bulk.result = { fallidas: 1, msg: e?.data?.statusMessage ?? 'No se pudieron aplicar los cambios' } }
  bulk.busy = false
}
const stockText = (s: any) => (s.manage_stock ? String(s.stock_quantity ?? 0) : 'sin gestionar')
/** "antes → después" en una celda; solo la flecha cuando cambia. */
const Delta = defineComponent({
  props: { a: { type: String, required: true }, b: { type: String, required: true } },
  setup(props) {
    return () => props.a === props.b
      ? h('span', { class: 'muted' }, props.a)
      : h('span', [h('s', { class: 'muted' }, props.a), ' → ', h('b', props.b)])
  },
})

// ---------- imágenes del producto (Fase A) ----------
interface ImgInfo { id: number, src: string, name?: string, alt?: string }
interface ImgState {
  loading: boolean
  images: ImgInfo[]
  variaciones: { sku: string, id: number, talla: string, image: ImgInfo | null }[]
  bloqueo: string | null
  /** subidas en curso o terminadas, por archivo */
  uploads: { name: string, size: number, pct: number, status: 'pendiente' | 'subiendo' | 'ok' | 'error', msg?: string }[]
  busy: boolean
  msg?: string
  dragFrom: number | null
  dragOver: boolean
}
const imgs = ref<Record<string, ImgState>>({})
function imgState(sku: string): ImgState {
  return (imgs.value[sku] ??= { loading: false, images: [], variaciones: [], bloqueo: null, uploads: [], busy: false, dragFrom: null, dragOver: false })
}
async function loadImages(sku: string) {
  const s = imgState(sku)
  s.loading = true
  try {
    const r = await $fetch<{ images: ImgInfo[], variaciones: ImgState['variaciones'], bloqueo: string | null }>(`/api/inventario/productos/${encodeURIComponent(sku)}/imagenes`)
    s.images = r.images; s.variaciones = r.variaciones; s.bloqueo = r.bloqueo
  }
  catch (e: any) { onUnauthorized(e); s.bloqueo = e?.data?.statusMessage ?? 'No se pudieron cargar las imágenes' }
  s.loading = false
}
/** Sube varios archivos, uno por uno, con progreso y error por archivo. */
function uploadFiles(sku: string, files: FileList | File[]) {
  const s = imgState(sku)
  if (s.bloqueo) { s.msg = s.bloqueo; return }
  const list = [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
  if (!list.length) { s.msg = 'Elige archivos de imagen (JPG, PNG, WebP, HEIC).'; return }
  for (const f of list) {
    const entry: ImgState['uploads'][number] = { name: f.name, size: f.size, pct: 0, status: 'pendiente' }
    s.uploads.push(entry)
    if (f.size > 10 * 1024 * 1024) { entry.status = 'error'; entry.msg = `Pesa ${(f.size / 1048576).toFixed(1)} MB; el máximo es 10 MB.`; continue }
  }
  runUploads(sku)
}
async function runUploads(sku: string) {
  const s = imgState(sku)
  if (s.busy) return
  s.busy = true
  for (const u of s.uploads) {
    if (u.status !== 'pendiente') continue
    const file = pendingFiles.get(u)
    if (!file) { u.status = 'error'; u.msg = 'archivo no disponible'; continue }
    u.status = 'subiendo'
    try {
      const r = await uploadWithProgress(`/api/inventario/productos/${encodeURIComponent(sku)}/imagenes`, file, pct => { u.pct = pct })
      u.status = 'ok'; u.pct = 100
      u.msg = `${r.procesado.ancho}×${r.procesado.alto} · ${r.procesado.entrada_kb} KB → ${r.procesado.salida_kb} KB`
      s.images = r.images
    }
    catch (e: any) {
      u.status = 'error'; u.msg = e?.message ?? 'No se pudo subir'
    }
  }
  s.busy = false
  await refreshProduct(sku)
}
// Los File no se guardan en estado reactivo (pesan): se asocian por referencia a su entrada.
const pendingFiles = new WeakMap<object, File>()
function onFilesChosen(sku: string, ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  const s = imgState(sku)
  const before = s.uploads.length
  uploadFilesWithRefs(sku, files)
  input.value = ''
  void before
}
function onDrop(sku: string, ev: DragEvent) {
  ev.preventDefault()
  imgState(sku).dragOver = false
  const files = [...(ev.dataTransfer?.files ?? [])]
  if (files.length) uploadFilesWithRefs(sku, files)
}
function uploadFilesWithRefs(sku: string, files: File[]) {
  const s = imgState(sku)
  if (s.bloqueo) { s.msg = s.bloqueo; return }
  const list = files.filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
  if (!list.length) { s.msg = 'Elige archivos de imagen (JPG, PNG, WebP, HEIC).'; return }
  s.msg = undefined
  for (const f of list) {
    const entry: ImgState['uploads'][number] = { name: f.name, size: f.size, pct: 0, status: 'pendiente' }
    if (f.size > 10 * 1024 * 1024) { entry.status = 'error'; entry.msg = `Pesa ${(f.size / 1048576).toFixed(1)} MB; el máximo es 10 MB.` }
    s.uploads.push(entry)
    pendingFiles.set(s.uploads[s.uploads.length - 1]!, f)
  }
  runUploads(sku)
}
/** XHR para tener progreso real de subida (fetch no lo expone). */
function uploadWithProgress(url: string, file: File, onPct: (pct: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 90)) }
    xhr.onload = () => {
      let json: any = {}
      try { json = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(json)
      else reject(new Error(json?.statusMessage ?? json?.message ?? `HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Error de red al subir'))
    const fd = new FormData()
    fd.append('file', file, file.name)
    xhr.send(fd)
  })
}
async function imgAction(sku: string, body: Record<string, unknown>) {
  const s = imgState(sku)
  if (s.bloqueo) { s.msg = s.bloqueo; return }
  s.busy = true; s.msg = undefined
  try {
    const r = await $fetch<{ images: ImgInfo[], variaciones: { sku: string, image: ImgInfo | null }[] }>(`/api/inventario/productos/${encodeURIComponent(sku)}/imagenes`, { method: 'PUT', body })
    s.images = r.images
    for (const v of s.variaciones) { const nv = r.variaciones.find(x => x.sku === v.sku); if (nv) v.image = nv.image }
    await refreshProduct(sku)
  }
  catch (e: any) { onUnauthorized(e); s.msg = e?.data?.statusMessage ?? 'No se pudo aplicar el cambio' }
  s.busy = false
}
const setMain = (sku: string, id: number) => imgAction(sku, { accion: 'principal', id })
const removeImg = (sku: string, id: number) => imgAction(sku, { accion: 'quitar', id })
const setVariationImg = (sku: string, skuTalla: string, id: number | null) => imgAction(sku, { accion: 'talla', sku_talla: skuTalla, id })
// reordenar arrastrando miniaturas
function imgDragStart(sku: string, i: number) { imgState(sku).dragFrom = i }
function imgDropOn(sku: string, i: number) {
  const s = imgState(sku)
  const from = s.dragFrom
  s.dragFrom = null
  if (from === null || from === i) return
  const ids = s.images.map(x => x.id)
  const [moved] = ids.splice(from, 1)
  ids.splice(i, 0, moved!)
  imgAction(sku, { accion: 'orden', ids })
}
async function refreshProduct(sku: string) {
  try {
    const fresh = await $fetch<{ product: InvProduct }>(`/api/inventario/productos/${encodeURIComponent(sku)}`)
    const i = items.value.findIndex(x => x.sku === sku)
    if (i >= 0) items.value[i] = fresh.product
  }
  catch {}
}
const fmtKB = (n: number) => (n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)

// ---------- presentación ----------
const cop = (v: string | number | null | undefined) => (v === '' || v == null ? '—' : formatCOP(Number(v)))
const talla = (v: InvVariation) => String(v.attributes.find(a => a.name === 'Talla')?.option ?? tallaFromSku(v.sku) ?? '?')
function priceRange(p: InvProduct): string {
  const ps = p.variations.map(v => Number(v.price)).filter(n => n > 0)
  if (!ps.length) return cop(p.price)
  const min = Math.min(...ps), max = Math.max(...ps)
  return min === max ? cop(min) : `${cop(min)} – ${cop(max)}`
}
function stockKind(v: InvVariation): 'sin' | 'agotado' | 'bajo' | 'ok' {
  if (!v.manage_stock) return v.stock_status === 'outofstock' ? 'agotado' : 'sin'
  const n = v.stock_quantity ?? 0
  if (n <= 0) return 'agotado'
  if (n <= (estado.value?.stock_bajo_umbral ?? 5)) return 'bajo'
  return 'ok'
}
function stockLabel(v: InvVariation): string {
  const k = stockKind(v)
  if (k === 'sin') return 'sin gestionar'
  if (k === 'agotado') return 'agotado'
  return String(v.stock_quantity)
}
function productStock(p: InvProduct): { kind: 'sin' | 'agotado' | 'bajo' | 'ok', text: string } {
  const kinds = p.variations.map(stockKind)
  if (!kinds.length) return { kind: 'sin', text: '—' }
  if (kinds.every(k => k === 'sin')) return { kind: 'sin', text: 'sin gestionar' }
  const managed = p.variations.filter(v => v.manage_stock)
  const totalQ = managed.reduce((s, v) => s + (v.stock_quantity ?? 0), 0)
  if (kinds.every(k => k === 'agotado')) return { kind: 'agotado', text: 'agotado' }
  if (kinds.some(k => k === 'agotado' || k === 'bajo')) return { kind: 'bajo', text: `${totalQ} u · revisar` }
  return { kind: 'ok', text: `${totalQ} u` }
}
const fecha = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const campoLabel: Record<string, string> = { regular_price: 'precio', sale_price: 'oferta', stock_quantity: 'stock', manage_stock: 'gestión de stock' }
const changeValue = (campo: string, v: string | null) => (v === null ? '—' : campo.includes('price') ? (v === '' ? '—' : cop(v)) : v === 'true' ? 'sí' : v === 'false' ? 'no' : v)
const snapshotAge = computed(() => {
  const s = estado.value?.snapshot_age_s
  if (s == null) return 'sin snapshot'
  if (s < 90) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  return `hace ${Math.round(s / 3600)} h`
})

onMounted(() => {
  checkSession()
  // Gancho de pruebas/medición (solo en dev): abrir o cerrar todos los productos de la página.
  if (import.meta.dev) (window as any).__inv = { openAll: () => { open.value = new Set(items.value.map(p => p.sku)); for (const p of items.value) seedDrafts(p, false) }, closeAll: () => { open.value = new Set() } }
})
</script>

<template>
  <div class="inv">
    <!-- ===== login ===== -->
    <div v-if="checking" class="inv__center"><span class="muted">Cargando…</span></div>
    <div v-else-if="!authed" class="inv__center">
      <form class="login" @submit.prevent="login">
        <div class="login__brand">
          <span class="login__k">K</span>
          <div>
            <div class="login__title">Inventario</div>
            <div class="login__sub">Kustom Disfraces · precios y stock</div>
          </div>
        </div>
        <p v-if="!configured" class="login__warn">Falta NUXT_INBOX_PASSWORD en el servidor.</p>
        <label class="login__label" for="pw">Contraseña</label>
        <input id="pw" v-model="password" class="login__input" type="password" autocomplete="current-password" required>
        <p v-if="loginError" class="login__error">{{ loginError }}</p>
        <KButton type="submit" variant="primary" block :loading="loggingIn">Entrar</KButton>
      </form>
    </div>

    <!-- ===== panel ===== -->
    <div v-else class="inv__app">
      <!-- cabecera pegajosa: marca, totales, buscador y acciones siempre a mano -->
      <header class="top" :class="{ 'top--compact': densidad === 'compacto' }">
        <div class="top__row">
          <div class="top__brand">
            <span class="login__k login__k--sm">K</span>
            <h1 class="top__title">Inventario</h1>
            <span v-if="estado" class="pill" :class="estado.simulation ? 'pill--sim' : 'pill--live'">{{ estado.simulation ? 'simulación' : 'Woo en vivo' }}</span>
          </div>
          <div v-if="estado" class="top__totals" :title="estado.snapshot_age_s != null ? `Snapshot de Woo leído hace ${estado.snapshot_age_s} s` : 'Sin snapshot de Woo'">
            <span><b>{{ estado.productos }}</b> productos</span>
            <span><b>{{ estado.variaciones }}</b> tallas</span>
            <span v-if="estado.agotadas" class="tot--err"><b>{{ estado.agotadas }}</b> agotadas</span>
            <span v-if="estado.stock_bajo" class="tot--warn"><b>{{ estado.stock_bajo }}</b> bajas</span>
            <span :class="{ 'tot--warn': (estado.snapshot_age_s ?? 0) > 600 }">Woo {{ snapshotAge }}</span>
          </div>
          <div class="top__right">
            <button class="btn btn--ghost" type="button" :disabled="syncing" @click="sync(true)">{{ syncing ? 'Sincronizando…' : 'Sincronizar' }}</button>
            <button v-if="estado?.woo_write" class="btn btn--ghost" type="button" :disabled="probing" :title="estado.woo_only_drafts ? 'Escribe, relee y revierte precios en un BORRADOR; nunca toca publicados' : 'Escribe, relee y revierte precios en un borrador'" @click="probarWoo">{{ probing ? 'Probando…' : 'Probar Woo' }}</button>
            <NuxtLink class="btn btn--ghost" to="/admin/chats">Bandeja</NuxtLink>
            <button class="btn btn--ghost" type="button" @click="logout">Salir</button>
          </div>
        </div>
        <div class="top__search">
          <label class="search">
            <span class="search__icon" aria-hidden="true">⌕</span>
            <input v-model="q" class="search__input" type="search" placeholder="Buscar por nombre o SKU…" aria-label="Buscar">
            <button v-if="q" class="search__clear" type="button" aria-label="Limpiar búsqueda" @click="q = ''">×</button>
          </label>
          <select v-model="status" class="input" aria-label="Estado">
            <option value="any">Todos los estados</option>
            <option value="publish">Publicados</option>
            <option value="draft">Borradores</option>
          </select>
          <select v-model="grupo" class="input" aria-label="Línea">
            <option value="">Todas las líneas</option>
            <option v-for="(label, key) in GRUPOS" :key="key" :value="key">{{ label }}</option>
          </select>
          <select v-model="publico" class="input" aria-label="Público">
            <option value="">Todos los públicos</option>
            <option v-for="(label, key) in PUBLICOS" :key="key" :value="key">{{ label }}</option>
          </select>
          <select v-model="stock" class="input" aria-label="Stock">
            <option value="any">Todo el stock</option>
            <option value="bajo">Stock bajo o agotado</option>
            <option value="agotado">Agotados</option>
            <option value="sin_gestion">Sin gestionar</option>
          </select>
          <button v-if="q || status !== 'any' || grupo || publico || stock !== 'any'" class="btn btn--ghost" type="button" @click="clearFilters">Limpiar</button>
        </div>
      </header>

      <div v-if="estado?.simulation" class="banner banner--sim">
        <strong>Modo simulación</strong> — los cambios no se reflejan en el sitio ni en WooCommerce. Quedan guardados aquí ({{ estado.overrides }} tallas con cambios pendientes) para aplicarlos cuando se active la escritura.
      </div>
      <div v-if="estado && !estado.simulation && estado.woo_only_drafts" class="banner banner--info">
        <strong>Woo en vivo, solo borradores</strong> — la guarda de validación rechaza cualquier escritura a un producto publicado hasta que se validen las operaciones masivas.
      </div>
      <div v-if="estado && (estado.stock_bajo || estado.agotadas)" class="banner banner--alert">
        <strong>⚠ Alertas de stock:</strong>
        <button v-if="estado.agotadas" class="linkbtn" type="button" @click="stock = 'agotado'">{{ estado.agotadas }} {{ estado.agotadas === 1 ? 'talla agotada' : 'tallas agotadas' }}</button>
        <span v-if="estado.agotadas && estado.stock_bajo"> · </span>
        <button v-if="estado.stock_bajo" class="linkbtn" type="button" @click="stock = 'bajo'">{{ estado.stock_bajo }} con stock bajo (≤ {{ estado.stock_bajo_umbral }})</button>
        <span class="muted small"> · en productos publicados · aviso por correo a ventas al cruzar el umbral y resumen diario</span>
      </div>
      <div v-if="estado && estado.simulation && estado.public_stock" class="banner banner--warn">
        <strong>Ojo:</strong> el stock simulado SÍ se está aplicando al sitio, al bot y al checkout (NUXT_INVENTORY_PUBLIC_STOCK=on). Úsalo solo en local o preview.
      </div>
      <div v-if="estado && !estado.ok" class="banner banner--warn">{{ estado.detail }}</div>
      <div v-if="syncMsg" class="banner banner--info">{{ syncMsg }}</div>

      <div v-if="probeResult" class="modal" @click.self="probeResult = null">
        <div class="modal__box" role="dialog" aria-label="Resultado de la prueba de escritura">
          <h3>{{ probeResult.ok ? '✅' : '❌' }} {{ probeResult.conclusion }} <span v-if="probeResult.ms" class="muted small">· {{ probeResult.ms }} ms</span></h3>
          <ol class="steps">
            <li v-for="(s, i) in probeResult.steps" :key="i" :class="s.ok ? 'ok' : 'err'">
              <b>{{ s.ok ? '✓' : '✗' }} {{ s.paso }}</b>
              <pre v-if="s.detalle !== undefined">{{ typeof s.detalle === 'string' ? s.detalle : JSON.stringify(s.detalle, null, 1) }}</pre>
            </li>
          </ol>
          <div class="modal__row">
            <button class="btn btn--ghost btn--sm" type="button" @click="copyProbe">Copiar JSON</button>
            <button class="btn btn--sm" type="button" @click="probeResult = null">Cerrar</button>
          </div>
        </div>
      </div>

      <div class="toolbar">
        <label class="check"><input type="checkbox" :checked="allOnPage" @change="toggleAll"> <span>Seleccionar página</span></label>
        <span v-if="selected.size" class="muted small">{{ selected.size }} seleccionados <button class="linkbtn" type="button" @click="selected = new Set()">quitar</button></span>
        <button class="btn btn--sm" type="button" :disabled="!selected.size && !total" @click="openBulk">Operación masiva ({{ selected.size || total }})</button>
        <a class="btn btn--ghost btn--sm" :href="exportUrl('xlsx')">Exportar Excel</a>
        <a class="btn btn--ghost btn--sm" :href="exportUrl('csv')">CSV</a>
        <button class="btn btn--ghost btn--sm" type="button" @click="openImport">Importar</button>
        <span class="toolbar__right">
          <span class="muted small">{{ total }} productos</span>
          <span class="seg" role="group" aria-label="Densidad">
            <button type="button" :class="{ 'is-on': densidad === 'comodo' }" @click="densidad = 'comodo'">Cómodo</button>
            <button type="button" :class="{ 'is-on': densidad === 'compacto' }" @click="densidad = 'compacto'">Compacto</button>
          </span>
        </span>
      </div>

      <!-- ===== operación masiva / importación ===== -->
      <div v-if="bulk.open" class="modal" @click.self="closeBulk">
        <div class="modal__box modal__box--wide" role="dialog" :aria-label="bulk.mode === 'import' ? 'Importar' : 'Operación masiva'">
          <h3 v-if="bulk.mode === 'bulk'">Operación masiva sobre {{ bulk.target === 'selected' ? `${selected.size} seleccionados` : `los ${total} productos filtrados` }}</h3>
          <h3 v-else>Importar precios y stock desde Excel o CSV</h3>

          <template v-if="!bulk.preview">
            <form v-if="bulk.mode === 'bulk'" class="bform" @submit.prevent="previewBulk">
              <div v-if="selected.size && total" class="bform__row">
                <label class="check"><input v-model="bulk.target" type="radio" value="selected"> <span>Solo los {{ selected.size }} seleccionados</span></label>
                <label class="check"><input v-model="bulk.target" type="radio" value="filtered"> <span>Todos los {{ total }} filtrados</span></label>
              </div>
              <label class="bform__field">Solo estas tallas (opcional, separadas por coma)
                <input v-model="bulk.tallas" class="input" placeholder="ej. 4, 6, Bebé">
              </label>
              <fieldset class="bform__group">
                <legend>Precio normal</legend>
                <select v-model="bulk.precioModo" class="input">
                  <option value="">Sin cambio</option>
                  <option value="fijar">Fijar en</option>
                  <option value="porcentaje">Subir o bajar %</option>
                  <option value="monto">Sumar o restar monto</option>
                </select>
                <input v-if="bulk.precioModo" v-model="bulk.precioValor" class="input" inputmode="numeric" :placeholder="bulk.precioModo === 'porcentaje' ? 'ej. 10 o -5' : 'pesos'">
                <span v-if="bulk.precioModo === 'porcentaje'" class="muted small">redondea a $100</span>
              </fieldset>
              <fieldset class="bform__group">
                <legend>Precio rebajado</legend>
                <select v-model="bulk.ofertaModo" class="input">
                  <option value="">Sin cambio</option>
                  <option value="fijar">Fijar en</option>
                  <option value="porcentaje">% de descuento sobre el normal</option>
                  <option value="quitar">Quitar oferta</option>
                </select>
                <input v-if="bulk.ofertaModo && bulk.ofertaModo !== 'quitar'" v-model="bulk.ofertaValor" class="input" inputmode="numeric" :placeholder="bulk.ofertaModo === 'porcentaje' ? 'ej. 20' : 'pesos'">
              </fieldset>
              <fieldset class="bform__group">
                <legend>Stock</legend>
                <select v-model="bulk.stockModo" class="input">
                  <option value="">Sin cambio</option>
                  <option value="fijar">Fijar cantidad</option>
                  <option value="sumar">Sumar o restar</option>
                  <option value="gestionar">Activar gestión (con cantidad inicial)</option>
                  <option value="agotar">Marcar agotado (0)</option>
                </select>
                <input v-if="bulk.stockModo && bulk.stockModo !== 'agotar'" v-model="bulk.stockValor" class="input" inputmode="numeric" placeholder="unidades">
              </fieldset>
              <p v-if="bulk.error" class="err small">{{ bulk.error }}</p>
              <div class="modal__row">
                <button class="btn btn--ghost btn--sm" type="button" @click="closeBulk">Cancelar</button>
                <button class="btn btn--sm" type="submit" :disabled="bulk.busy || (!bulk.precioModo && !bulk.ofertaModo && !bulk.stockModo)">{{ bulk.busy ? 'Calculando…' : 'Previsualizar' }}</button>
              </div>
            </form>
            <form v-else class="bform" @submit.prevent="previewImport">
              <p class="muted small">Sube el archivo exportado (Excel o CSV) con las columnas <b>Precio normal</b>, <b>Precio rebajado</b> y <b>Stock</b> editadas. Solo se aplican las columnas presentes; celda vacía en precio o stock = no tocar; vacía en precio rebajado = quitar oferta.</p>
              <input ref="fileInput" class="input" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv">
              <p v-if="bulk.error" class="err small">{{ bulk.error }}</p>
              <div class="modal__row">
                <button class="btn btn--ghost btn--sm" type="button" @click="closeBulk">Cancelar</button>
                <button class="btn btn--sm" type="submit" :disabled="bulk.busy">{{ bulk.busy ? 'Leyendo…' : 'Previsualizar' }}</button>
              </div>
            </form>
          </template>

          <template v-else>
            <div class="preview__summary">
              <span class="pill pill--ok">{{ bulk.preview.con_cambios }} con cambios</span>
              <span class="pill pill--draft">{{ bulk.preview.sin_cambio }} sin cambio</span>
              <span v-if="bulk.preview.errores" class="pill pill--sim">{{ bulk.preview.errores }} con error (no se aplican)</span>
              <span v-if="bulk.preview.ignoradas?.length" class="muted small">Filas ignoradas: {{ bulk.preview.ignoradas.map(i => `${i.fila} (${i.motivo})`).join(', ') }}</span>
              <label class="check small"><input v-model="bulk.soloCambios" type="checkbox"> <span>Ver solo cambios y errores</span></label>
            </div>
            <div class="preview__wrap">
              <table class="vars">
                <thead><tr><th>Producto</th><th>Talla</th><th>SKU</th><th class="num">Precio</th><th class="num">Oferta</th><th class="num">Stock</th><th>Resultado</th></tr></thead>
                <tbody>
                  <tr v-for="f in previewRows" :key="f.sku" :class="{ 'is-dirty': f.cambia && !f.error, 'is-err': !!f.error }">
                    <td>{{ f.producto }} <span v-if="f.status !== 'publish'" class="chip chip--soft">borrador</span></td>
                    <td class="talla-cell">{{ f.talla }}</td>
                    <td class="mono small">{{ f.sku }}</td>
                    <td class="num"><Delta :a="cop(f.antes.regular_price)" :b="cop(f.despues.regular_price)" /></td>
                    <td class="num"><Delta :a="f.antes.sale_price ? cop(f.antes.sale_price) : '—'" :b="f.despues.sale_price ? cop(f.despues.sale_price) : '—'" /></td>
                    <td class="num"><Delta :a="stockText(f.antes)" :b="stockText(f.despues)" /></td>
                    <td class="small"><span v-if="f.error" class="err">{{ f.error }}</span><span v-else-if="!f.cambia" class="muted">sin cambio</span><span v-else class="ok">se actualiza</span></td>
                  </tr>
                  <tr v-if="!previewRows.length"><td colspan="7" class="empty">Nada que mostrar.</td></tr>
                </tbody>
              </table>
            </div>
            <p v-if="bulk.result" class="small" :class="bulk.result.fallidas ? 'err' : 'ok'">{{ bulk.result.msg }}</p>
            <p v-if="estado?.simulation" class="muted small">Modo simulación: los cambios se guardan aquí, no llegan a Woo ni al sitio.</p>
            <div class="modal__row">
              <button class="btn btn--ghost btn--sm" type="button" @click="bulk.preview = null; bulk.result = null">Volver</button>
              <button class="btn btn--ghost btn--sm" type="button" @click="closeBulk">Cerrar</button>
              <button v-if="!bulk.result" class="btn btn--sm" type="button" :disabled="bulk.busy || !bulk.preview.con_cambios" @click="applyPreview">{{ bulk.busy ? 'Aplicando…' : `Aplicar ${bulk.preview.con_cambios} cambios` }}</button>
            </div>
          </template>
        </div>
      </div>

      <p v-if="listError" class="banner banner--warn">{{ listError }}</p>

      <!-- lista virtualizada: cabecera de columnas + solo las filas visibles -->
      <div class="tbl-wrap" :class="`tbl-wrap--${densidad}`">
        <div class="thead" role="row">
          <span class="col-check"></span>
          <span class="col-img"></span>
          <button class="th-btn" type="button" @click="sortBy('name')">Producto <i v-if="orderby === 'name'">{{ order === 'asc' ? '↑' : '↓' }}</i></button>
          <button class="th-btn" type="button" @click="sortBy('sku')">SKU <i v-if="orderby === 'sku'">{{ order === 'asc' ? '↑' : '↓' }}</i></button>
          <span>Estado</span>
          <button class="th-btn num" type="button" @click="sortBy('price')">Precio <i v-if="orderby === 'price'">{{ order === 'asc' ? '↑' : '↓' }}</i></button>
          <span>Tallas</span>
          <button class="th-btn num" type="button" @click="sortBy('stock')">Stock <i v-if="orderby === 'stock'">{{ order === 'asc' ? '↑' : '↓' }}</i></button>
          <span class="col-exp"></span>
        </div>

        <!-- skeleton en la carga inicial -->
        <div v-if="firstLoad && loading" class="sk-list" aria-busy="true" aria-label="Cargando productos">
          <div v-for="i in 8" :key="i" class="row row--sk">
            <span class="col-check"><Skeleton w="16px" h="16px" radius="4px" /></span>
            <span class="col-img"><Skeleton w="56px" h="56px" radius="12px" /></span>
            <span><Skeleton :w="`${120 + (i % 4) * 30}px`" h="15px" /><Skeleton w="150px" h="11px" radius="999px" /></span>
            <span><Skeleton w="72px" h="12px" /></span>
            <span><Skeleton w="76px" h="20px" radius="999px" /></span>
            <span class="num"><Skeleton w="82px" h="20px" /></span>
            <span><Skeleton w="200px" h="22px" /></span>
            <span class="num"><Skeleton w="70px" h="14px" /></span>
            <span class="col-exp"></span>
          </div>
        </div>

        <!-- estado vacío con ilustración (KO, la mascota) -->
        <div v-else-if="!loading && !items.length" class="empty">
          <img class="empty__ko" src="/images/ko/ko-caja.webp" alt="" width="120" height="120">
          <h2 class="empty__title">Nada por aquí</h2>
          <p class="empty__text">Ningún producto coincide con <b v-if="q">"{{ q }}"</b><span v-else>esos filtros</span>. Prueba otro nombre o quita algún filtro.</p>
          <button class="btn btn--sm" type="button" @click="clearFilters">Quitar filtros</button>
        </div>

        <div v-else ref="scrollEl" class="vlist" :class="{ 'is-loading': loading }">
          <div class="vlist__inner" :style="{ height: `${totalSize}px` }">
            <TransitionGroup name="vrow">
              <div
                v-for="vi in virtualItems"
                :key="String(vi.key)"
                :ref="measure"
                :data-index="vi.index"
                class="vitem"
                :style="{ transform: `translateY(${vi.start}px)` }"
              >
                <!-- fila de producto (grilla en escritorio, tarjeta en celular) -->
                <div
                  v-if="vrows[vi.index]!.kind === 'row'"
                  class="row"
                  :class="{ 'is-open': open.has(vrows[vi.index]!.p.sku), 'is-sel': selected.has(vrows[vi.index]!.p.sku), 'is-draft': vrows[vi.index]!.p.status !== 'publish' }"
                  role="row"
                  @click="toggleOpen(vrows[vi.index]!.p)"
                >
                  <span class="col-check" @click.stop><input type="checkbox" :checked="selected.has(vrows[vi.index]!.p.sku)" :aria-label="`Seleccionar ${vrows[vi.index]!.p.name}`" @change="toggleSel(vrows[vi.index]!.p.sku)"></span>
                  <span class="col-img">
                    <img v-if="vrows[vi.index]!.p.kustom.imagen" class="thumb" :src="vrows[vi.index]!.p.kustom.imagen" alt="" decoding="async" width="56" height="56">
                    <span v-else class="thumb thumb--none" aria-label="sin foto">✦</span>
                  </span>
                  <span class="cell-name">
                    <span class="name">{{ vrows[vi.index]!.p.name }}</span>
                    <span class="sub">
                      <span class="mono mono--m">{{ vrows[vi.index]!.p.sku }}</span>
                      <span v-if="vrows[vi.index]!.p.kustom.grupo" class="chip">{{ GRUPOS[vrows[vi.index]!.p.kustom.grupo!] ?? vrows[vi.index]!.p.kustom.grupo }}</span>
                      <span v-for="pu in vrows[vi.index]!.p.kustom.publicos" :key="pu" class="chip chip--soft">{{ PUBLICOS[pu] ?? pu }}</span>
                      <span v-if="vrows[vi.index]!.p.kustom.soloWoo" class="chip chip--warn">solo en Woo</span>
                    </span>
                  </span>
                  <span class="mono cell-sku">{{ vrows[vi.index]!.p.sku }}</span>
                  <span class="cell-status"><span class="pill" :class="vrows[vi.index]!.p.status === 'publish' ? 'pill--ok' : 'pill--draft'">{{ ESTADOS[vrows[vi.index]!.p.status] ?? vrows[vi.index]!.p.status }}</span></span>
                  <span class="num cell-price">
                    <span class="price">{{ priceRange(vrows[vi.index]!.p) }}</span>
                    <span v-if="vrows[vi.index]!.p.variations.some(v => v.sale_price)" class="price__tag">oferta</span>
                  </span>
                  <span class="cell-tallas">
                    <span class="tallas">
                      <span v-for="v in vrows[vi.index]!.p.variations" :key="v.sku" class="talla" :class="[`talla--${stockKind(v)}`, { 'talla--edit': dirty(v), 'talla--saving': rowState[v.sku]?.saving, 'talla--saved': rowState[v.sku]?.flash, 'talla--err': rowState[v.sku]?.ok === false }]" :title="`${v.sku} · ${stockLabel(v)}`">{{ talla(v) }}</span>
                      <span v-if="!vrows[vi.index]!.p.variations.length" class="muted small">sin tallas</span>
                    </span>
                  </span>
                  <span class="num cell-stock"><span class="stock" :class="`stock--${productStock(vrows[vi.index]!.p).kind}`"><i class="dot"></i>{{ productStock(vrows[vi.index]!.p).text }}</span></span>
                  <span class="col-exp"><span class="caret" :class="{ 'is-open': open.has(vrows[vi.index]!.p.sku) }">›</span></span>
                </div>

                <!-- bloque expandido: tallas + imágenes + historial -->
                <div v-else class="detail is-open">
                  <div class="detail__clip">
                    <div class="detail__grid">
                      <div class="detail__vars">
                        <h3 class="detail__h">Precio y stock por talla</h3>
                        <div class="vars-wrap">
                          <table class="vars">
                            <thead>
                              <tr><th>Talla</th><th>SKU</th><th class="num">Precio normal</th><th class="num">Precio rebajado</th><th class="num">Stock</th><th>Estado</th><th></th></tr>
                            </thead>
                            <tbody>
                              <tr v-for="v in vrows[vi.index]!.p.variations" :key="v.sku" :class="{ 'is-dirty': dirty(v), 'is-saving': rowState[v.sku]?.saving, 'is-flash': rowState[v.sku]?.flash, 'is-err': rowState[v.sku]?.ok === false }">
                                <td class="talla-cell" data-label="Talla">{{ talla(v) }}</td>
                                <td class="mono small" data-label="SKU">{{ v.sku }}</td>
                                <td class="num" data-label="Precio normal">
                                  <input v-if="drafts[v.sku]" v-model="drafts[v.sku]!.regular_price" class="input input--num" inputmode="numeric" placeholder="—" :disabled="rowState[v.sku]?.saving" @keydown.enter.prevent="save(vrows[vi.index]!.p, v)">
                                </td>
                                <td class="num" data-label="Precio rebajado">
                                  <input v-if="drafts[v.sku]" v-model="drafts[v.sku]!.sale_price" class="input input--num" inputmode="numeric" placeholder="sin oferta" :disabled="rowState[v.sku]?.saving" @keydown.enter.prevent="save(vrows[vi.index]!.p, v)">
                                </td>
                                <td class="num" data-label="Stock">
                                  <input v-if="drafts[v.sku]" v-model="drafts[v.sku]!.stock_quantity" class="input input--num" inputmode="numeric" :placeholder="v.manage_stock ? '0' : 'sin gestionar'" :disabled="rowState[v.sku]?.saving" @keydown.enter.prevent="save(vrows[vi.index]!.p, v)">
                                </td>
                                <td data-label="Estado"><span class="stock" :class="`stock--${stockKind(v)}`"><i class="dot"></i>{{ stockLabel(v) }}</span></td>
                                <td class="actions-cell">
                                  <div class="actions">
                                    <span v-if="rowState[v.sku]?.saving" class="saving" aria-live="polite"><span class="saving__dot"></span> guardando</span>
                                    <template v-else-if="dirty(v)">
                                      <button class="btn btn--primary btn--sm" type="button" @click="save(vrows[vi.index]!.p, v)">Guardar</button>
                                      <button class="btn btn--ghost btn--sm" type="button" @click="reset(v)">Deshacer</button>
                                    </template>
                                    <span v-if="rowState[v.sku]?.msg" class="small" :class="rowState[v.sku]?.ok ? 'ok' : 'err'">{{ rowState[v.sku]?.msg }}</span>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <p class="hint muted small">Precios en pesos, sin puntos. Escribe un stock para activar la gestión de esa talla; en 0 queda agotada. Enter guarda.</p>

                        <!-- imágenes del producto (Fase A) -->
                        <h3 class="detail__h">Imágenes</h3>
                        <div class="imgs" :class="{ 'is-over': imgState(vrows[vi.index]!.p.sku).dragOver, 'is-blocked': !!imgState(vrows[vi.index]!.p.sku).bloqueo }" @dragover.prevent="imgState(vrows[vi.index]!.p.sku).dragOver = true" @dragleave="imgState(vrows[vi.index]!.p.sku).dragOver = false" @drop="onDrop(vrows[vi.index]!.p.sku, $event)">
                          <p class="imgs__note">Las imágenes se guardan en WordPress. La web seguirá mostrando las fotos actuales hasta que activemos el cambio de origen.</p>
                          <p v-if="imgState(vrows[vi.index]!.p.sku).bloqueo" class="imgs__block">🔒 {{ imgState(vrows[vi.index]!.p.sku).bloqueo }}</p>
                          <div v-if="imgState(vrows[vi.index]!.p.sku).loading" class="imgs__grid"><Skeleton w="96px" h="96px" radius="10px" /><Skeleton w="96px" h="96px" radius="10px" /></div>
                          <div v-else class="imgs__grid">
                            <figure
                              v-for="(im, ii) in imgState(vrows[vi.index]!.p.sku).images"
                              :key="im.id"
                              class="imgs__item"
                              :class="{ 'is-main': ii === 0 }"
                              :draggable="!imgState(vrows[vi.index]!.p.sku).bloqueo"
                              :title="im.name"
                              @dragstart="imgDragStart(vrows[vi.index]!.p.sku, ii)"
                              @dragover.prevent
                              @drop.stop="imgDropOn(vrows[vi.index]!.p.sku, ii)"
                            >
                              <img :src="im.src" :alt="im.alt || ''" loading="lazy" width="96" height="96">
                              <figcaption v-if="ii === 0" class="imgs__main">Principal</figcaption>
                              <span v-if="!imgState(vrows[vi.index]!.p.sku).bloqueo" class="imgs__acts">
                                <button v-if="ii !== 0" type="button" title="Hacer principal" @click.stop="setMain(vrows[vi.index]!.p.sku, im.id)">★</button>
                                <button type="button" title="Quitar del producto (el archivo sigue en WordPress)" @click.stop="removeImg(vrows[vi.index]!.p.sku, im.id)">×</button>
                              </span>
                            </figure>
                            <label v-if="!imgState(vrows[vi.index]!.p.sku).bloqueo" class="imgs__add" :class="{ 'is-busy': imgState(vrows[vi.index]!.p.sku).busy }">
                              <input type="file" accept="image/*,.heic,.heif" multiple hidden @change="onFilesChosen(vrows[vi.index]!.p.sku, $event)">
                              <span class="imgs__plus">+</span>
                              <span>Subir o arrastrar</span>
                              <small>≤ 10 MB · se convierten a WebP 1600 px</small>
                            </label>
                            <p v-if="!imgState(vrows[vi.index]!.p.sku).images.length && !imgState(vrows[vi.index]!.p.sku).bloqueo" class="muted small imgs__none">Sin imágenes en Woo. La web sigue mostrando la foto local.</p>
                          </div>
                          <ul v-if="imgState(vrows[vi.index]!.p.sku).uploads.length" class="uploads">
                            <li v-for="(u, ui) in imgState(vrows[vi.index]!.p.sku).uploads" :key="ui" :class="`is-${u.status}`">
                              <span class="uploads__name">{{ u.name }} <small class="muted">{{ fmtKB(u.size) }}</small></span>
                              <span class="uploads__bar"><i :style="{ width: `${u.status === 'ok' ? 100 : u.pct}%` }"></i></span>
                              <span class="uploads__msg">{{ u.status === 'ok' ? `✓ ${u.msg ?? 'subida'}` : u.status === 'error' ? `✗ ${u.msg}` : u.status === 'subiendo' ? `${u.pct}%` : 'en cola' }}</span>
                            </li>
                          </ul>
                          <p v-if="imgState(vrows[vi.index]!.p.sku).msg" class="err small">{{ imgState(vrows[vi.index]!.p.sku).msg }}</p>
                          <details v-if="imgState(vrows[vi.index]!.p.sku).images.length > 1 && imgState(vrows[vi.index]!.p.sku).variaciones.length" class="imgs__vars">
                            <summary>Imagen por talla (opcional)</summary>
                            <div class="imgs__vargrid">
                              <label v-for="va in imgState(vrows[vi.index]!.p.sku).variaciones" :key="va.sku" class="imgs__var">
                                <span class="talla-cell">{{ va.talla }}</span>
                                <select class="input input--sm" :disabled="!!imgState(vrows[vi.index]!.p.sku).bloqueo" :value="va.image?.id ?? ''" @change="setVariationImg(vrows[vi.index]!.p.sku, va.sku, ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)">
                                  <option value="">Hereda la principal</option>
                                  <option v-for="(im, ii) in imgState(vrows[vi.index]!.p.sku).images" :key="im.id" :value="im.id">{{ ii === 0 ? 'Principal' : `Imagen ${ii + 1}` }} · {{ im.name }}</option>
                                </select>
                              </label>
                            </div>
                          </details>
                        </div>
                      </div>
                      <aside class="detail__hist">
                        <h3 class="detail__h">Últimos cambios</h3>
                        <ul v-if="history[vrows[vi.index]!.p.sku]?.length">
                          <li v-for="c in history[vrows[vi.index]!.p.sku]" :key="c.id">
                            <span class="mono small">{{ c.sku.replace(`${vrows[vi.index]!.p.sku}-T`, 'T ') }}</span>
                            <span>{{ campoLabel[c.campo] ?? c.campo }}: {{ changeValue(c.campo, c.anterior) }} → <b>{{ changeValue(c.campo, c.nuevo) }}</b></span>
                            <span class="muted small">{{ fecha(c.created_at) }} · {{ c.origen }}{{ c.autor ? ` · ${c.autor}` : '' }}{{ c.backend === 'mock' ? ' · simulado' : '' }}</span>
                          </li>
                        </ul>
                        <p v-else-if="history[vrows[vi.index]!.p.sku]" class="muted small">Sin cambios registrados.</p>
                        <p v-else class="muted small"><Skeleton w="60%" h="12px" /></p>
                      </aside>
                    </div>
                  </div>
                </div>
              </div>
            </TransitionGroup>
          </div>
        </div>
      </div>

      <footer class="pager">
        <label class="small muted">Por página
          <select v-model.number="perPage" class="input input--sm"><option :value="25">25</option><option :value="50">50</option><option :value="100">100</option></select>
        </label>
        <div class="pager__nav">
          <button class="btn btn--ghost btn--sm" type="button" :disabled="page <= 1" @click="page--">‹ Anterior</button>
          <span class="small">Página {{ page }} de {{ totalPages }}</span>
          <button class="btn btn--ghost btn--sm" type="button" :disabled="page >= totalPages" @click="page++">Siguiente ›</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* =====================================================================
   Panel de inventario — identidad Kustom (morado, crema, Luckiest Guy)
   Tokens de tokens.css; aquí solo composición del panel.
   ===================================================================== */
.inv { min-height: 100dvh; display: flex; flex-direction: column; }
.inv__center { flex: 1; display: grid; place-items: center; padding: 24px; }
.muted { color: var(--mut); }
.small { font-size: 12.5px; }
.mono { font-family: var(--ff-mono); font-size: 12.5px; letter-spacing: .01em; }
.ok { color: #1B7F4B; }
.err { color: #B00020; }
.warn { color: #9A5B00; }

/* ---------- login (mismo look que la bandeja) ---------- */
.login { width: min(380px, 100%); background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: var(--shadow-card); display: flex; flex-direction: column; gap: 10px; }
.login__brand { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.login__k { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--purple); color: #fff; font-family: var(--ff-display); font-size: 26px; line-height: 1; }
.login__k--sm { width: 30px; height: 30px; font-size: 18px; border-radius: 9px; }
.login__title { font-family: var(--ff-display); font-size: 22px; letter-spacing: .5px; }
.login__sub { font-size: 13px; color: var(--mut); }
.login__label { font-size: 13px; font-weight: 600; color: var(--mut); }
.login__input { font: inherit; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 12px; }
.login__input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.login__error { color: #B00020; font-size: 13px; margin: 0; }
.login__warn { background: #FFF1D6; color: #9A5B00; font-size: 13px; padding: 10px 12px; border-radius: 10px; margin: 0; }

/* ---------- app ---------- */
.inv__app { flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 0 20px 48px; max-width: 1440px; width: 100%; margin: 0 auto; }

/* cabecera pegajosa */
.top { position: sticky; top: 0; z-index: 20; margin: 0 -20px; padding: 12px 20px 12px; background: color-mix(in srgb, var(--hueso) 88%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); display: grid; gap: 10px; }
.top__row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; }
.top__brand { display: flex; align-items: center; gap: 10px; }
.top__title { font-family: var(--ff-display); font-size: 28px; letter-spacing: .5px; margin: 0; line-height: 1; padding-top: 3px; }
.top__totals { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13.5px; color: var(--mut); font-variant-numeric: tabular-nums; }
.top__totals b { color: var(--ink); font-weight: 700; }
.tot--warn, .tot--warn b { color: #9A5B00; }
.tot--err, .tot--err b { color: #B00020; }
.top__right { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
.top__search { display: grid; grid-template-columns: minmax(240px, 2.2fr) repeat(4, minmax(140px, 1fr)) auto; gap: 8px; align-items: center; }
.search { position: relative; display: flex; align-items: center; }
.search__icon { position: absolute; left: 12px; font-size: 18px; color: var(--mut-2); pointer-events: none; }
.search__input { width: 100%; font: inherit; font-size: 15px; padding: 10px 36px 10px 36px; border: 1px solid var(--line-2); border-radius: 12px; background: #fff; color: var(--ink); }
.search__input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.search__input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
.search__clear { position: absolute; right: 8px; appearance: none; border: 0; background: var(--hueso); color: var(--mut); width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 16px; line-height: 1; }
.search__clear:hover { background: var(--purple-soft); color: var(--purple-d); }

.btn { appearance: none; font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--purple); background: var(--purple); color: #fff; cursor: pointer; text-decoration: none; transition: filter .12s, background-color .12s; }
.btn--ghost { background: #fff; color: var(--purple-d); border-color: var(--purple-line); }
.btn--sm { padding: 6px 11px; font-size: 13px; border-radius: 9px; }
.btn:disabled { opacity: .5; cursor: default; }
.btn:not(:disabled):hover { filter: brightness(1.05); }
.btn:focus-visible { outline: 2px solid var(--purple); outline-offset: 2px; }

.pill { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.pill--sim { background: #FFF1D6; color: #9A5B00; }
.pill--live { background: #DDF7E8; color: #1B7F4B; }
.pill--ok { background: #DDF7E8; color: #1B7F4B; }
.pill--draft { background: var(--line); color: var(--mut); }

.banner { padding: 10px 14px; border-radius: 12px; font-size: 14px; }
.banner--sim { background: #FFF1D6; color: #7A4A00; border: 1px solid #F5D58F; }
.banner--warn { background: #FDE7E9; color: #8A1C2B; }
.banner--info { background: var(--purple-soft); color: var(--purple-d); }
.banner--alert { background: #FDE7E9; color: #8A1C2B; border: 1px solid #F3B1B8; }
.banner--alert .linkbtn { color: inherit; font-weight: 700; }
.linkbtn { appearance: none; background: none; border: 0; padding: 0; font: inherit; color: var(--purple-d); text-decoration: underline; cursor: pointer; }
.input { font: inherit; font-size: 14px; padding: 9px 10px; border: 1px solid var(--line-2); border-radius: 10px; background: #fff; color: var(--ink); min-width: 0; width: 100%; }
.input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.input--num { width: 112px; text-align: right; font-variant-numeric: tabular-nums; }
.input--sm { width: auto; padding: 5px 8px; font-size: 13px; }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.toolbar__right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.check { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; }
.seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: 999px; padding: 2px; background: #fff; }
.seg button { appearance: none; border: 0; background: transparent; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--mut); padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.seg button.is-on { background: var(--purple); color: #fff; }

/* ---------- lista ---------- */
.tbl-wrap { background: #fff; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 0 rgba(17,17,17,.03); }
.thead, .row { display: grid; grid-template-columns: 32px 68px minmax(220px, 1.7fr) 110px 104px 150px minmax(190px, 1.2fr) 130px 28px; align-items: center; column-gap: 18px; padding: 0 16px; }
.thead { font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--mut); background: var(--hueso); border-bottom: 1px solid var(--line); height: 42px; white-space: nowrap; }
.thead > * { text-align: left; }
.thead .num, .row .num { text-align: right; justify-self: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
.th-btn { appearance: none; background: none; border: 0; font: inherit; color: inherit; cursor: pointer; padding: 0; text-transform: inherit; letter-spacing: inherit; }
.th-btn i { font-style: normal; color: var(--purple); }
.vlist { position: relative; overflow-y: auto; overflow-x: auto; height: clamp(420px, calc(100dvh - 290px), 1400px); contain: strict; }
.vlist.is-loading { opacity: .65; transition: opacity .15s; }
.vlist__inner { position: relative; width: 100%; min-width: 1020px; }
.vitem { position: absolute; top: 0; left: 0; width: 100%; will-change: transform; }

.row { min-height: 76px; border-bottom: 1px solid var(--line); cursor: pointer; font-size: 14.5px; transition: background-color .15s, box-shadow .15s; }
.tbl-wrap--compacto .row { min-height: 56px; font-size: 13.5px; }
.tbl-wrap--compacto .thumb { width: 40px; height: 40px; }
.tbl-wrap--compacto .thead, .tbl-wrap--compacto .row { grid-template-columns: 32px 52px minmax(220px, 1.7fr) 110px 104px 140px minmax(190px, 1.2fr) 120px 28px; }
.tbl-wrap--compacto .price { font-size: 17px; }
.tbl-wrap--compacto .sub { display: none; }
.row:hover { background: #FCFBF8; box-shadow: inset 4px 0 0 var(--purple-line); }
.row.is-open { background: var(--purple-soft); box-shadow: inset 4px 0 0 var(--purple); }
.row.is-sel { box-shadow: inset 4px 0 0 var(--purple); }
.row.is-draft .name { color: var(--ink-2, #3A3835); }
.row--sk { cursor: default; }
.row--sk > span { display: grid; gap: 6px; }
.col-check { width: 32px; }
.col-check input { width: 16px; height: 16px; accent-color: var(--purple); }
.col-img { width: 68px; }
.thumb { display: block; width: 56px; height: 56px; object-fit: cover; border-radius: 12px; background: #fff; border: 1px solid var(--line); box-shadow: 0 2px 6px rgba(17,17,17,.06); image-rendering: auto; }
.thumb--none { display: grid; place-items: center; color: var(--purple-line); background: var(--hueso); font-size: 18px; }
.col-exp { width: 28px; }
.cell-name { min-width: 0; display: grid; gap: 4px; }
.name { font-weight: 700; font-size: 15.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -.005em; }
.sub { display: flex; flex-wrap: wrap; gap: 4px; font-size: 12px; align-items: center; }
.mono--m { display: none; }
.chip { background: var(--purple-soft); color: var(--purple-d); border-radius: 999px; padding: 1px 8px; font-size: 11.5px; font-weight: 600; }
.chip--soft { background: var(--hueso); color: var(--mut); font-weight: 500; }
.chip--warn { background: #FFF1D6; color: #9A5B00; }
.cell-price { display: grid; justify-items: end; gap: 2px; }
.price { font-family: var(--ff-display); font-size: 21px; letter-spacing: .02em; color: var(--purple-d); line-height: 1; padding-top: 3px; }
.price__tag { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--fucsia, #FF4DA6); }
.tallas { display: flex; flex-wrap: wrap; gap: 4px; }
.talla { min-width: 28px; text-align: center; font-size: 12px; font-weight: 700; padding: 2px 6px; border-radius: 7px; border: 1px solid var(--line-2); background: #fff; color: var(--ink-2, #3A3835); transition: background-color .2s, border-color .2s, color .2s, transform .15s; }
.talla--ok { border-color: #9BD7B5; background: #EAF8F0; color: #1B7F4B; }
.talla--bajo { border-color: #F5D58F; background: #FFF6E0; color: #9A5B00; }
.talla--agotado { border-color: var(--line-2); background: var(--hueso); color: var(--mut-2); text-decoration: line-through; }
.talla--sin { color: var(--mut); }
.talla--edit { border-color: var(--purple); background: var(--purple-soft); color: var(--purple-d); border-style: dashed; }
.talla--saving { border-color: var(--purple); background: #fff; color: var(--purple-d); animation: talla-pulse 1s ease-in-out infinite; }
.talla--saved { border-color: #1B7F4B; background: #BFEFD3; color: #0E5C33; transform: scale(1.06); }
.talla--err { border-color: #B00020; background: #FDE7E9; color: #8A1C2B; }
@keyframes talla-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.stock { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stock .dot { width: 9px; height: 9px; border-radius: 50%; background: currentColor; flex: none; opacity: .9; }
.stock--ok { color: #1B7F4B; }
.stock--bajo { color: #C27700; }
.stock--agotado { color: #B00020; }
.stock--sin { color: var(--mut); font-weight: 500; }
.stock--sin .dot { opacity: .35; }
.caret { display: inline-block; transition: transform .18s var(--ease-out, ease); color: var(--mut); font-size: 22px; }
.caret.is-open { transform: rotate(90deg); color: var(--purple); }

/* estado vacío */
.empty { display: grid; place-items: center; text-align: center; padding: 48px 24px 56px; gap: 8px; }
.empty__ko { width: 120px; height: 120px; object-fit: contain; opacity: .95; }
.empty__title { font-family: var(--ff-display); font-size: 28px; margin: 6px 0 0; color: var(--purple-d); letter-spacing: .5px; }
.empty__text { margin: 0 0 10px; color: var(--mut); max-width: 44ch; }

/* ---------- detalle expandido ---------- */
.detail { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .22s var(--ease-out, ease); background: #FBFAF7; border-bottom: 1px solid var(--line); box-shadow: inset 4px 0 0 var(--purple); }
.detail.is-open { grid-template-rows: 1fr; }
.detail__clip { min-height: 0; overflow: hidden; }
.detail__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); gap: 22px; padding: 18px 20px 22px; }
.detail__h { font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--purple-d); margin: 0 0 8px; font-weight: 700; }
.detail__h + .detail__h { margin-top: 0; }
.detail__vars .detail__h:not(:first-child) { margin-top: 18px; }
.vars-wrap { overflow-x: auto; }
.vars { width: 100%; border-collapse: collapse; font-size: 13.5px; background: #fff; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.vars th { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--mut); padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; background: var(--hueso); }
.vars td { padding: 7px 10px; border-bottom: 1px solid var(--line); transition: background-color .25s; }
.vars tr:last-child td { border-bottom: 0; }
.vars tr.is-dirty td { background: #FFFBEE; }
.vars tr.is-saving td { background: #F5F2FB; }
.vars tr.is-err td { background: #FDE7E9; }
.vars tr.is-flash td { animation: flash-ok .9s var(--ease-out, ease) 1; }
@keyframes flash-ok { 0% { background: #BFEFD3; } 100% { background: transparent; } }
.talla-cell { font-weight: 800; font-size: 14px; }
.actions-cell { width: 1%; }
.actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; min-width: 170px; min-height: 28px; }
.saving { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--purple-d); }
.saving__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--purple); animation: pulse .9s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
.hint { margin: 8px 2px 0; }
.detail__hist ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-height: 360px; overflow-y: auto; }
.detail__hist li { display: grid; gap: 1px; font-size: 13px; padding-bottom: 6px; border-bottom: 1px dashed var(--line); }

/* imágenes */
.imgs { border: 1.5px dashed var(--line-2); border-radius: 12px; padding: 12px; background: #fff; transition: border-color .15s, background-color .15s; }
.imgs.is-over { border-color: var(--purple); background: var(--purple-soft); }
.imgs.is-blocked { background: var(--hueso); }
.imgs__note { margin: 0 0 10px; font-size: 12.5px; color: var(--mut); }
.imgs__block { margin: 0 0 8px; font-size: 13px; color: #7A4A00; background: #FFF1D6; padding: 8px 10px; border-radius: 8px; }
.imgs__grid { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
.imgs__item { position: relative; margin: 0; width: 96px; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); background: #fff; cursor: grab; transition: box-shadow .15s, transform .15s; }
.imgs__item:hover { box-shadow: var(--shadow-card); transform: translateY(-1px); }
.imgs__item img { display: block; width: 96px; height: 96px; object-fit: cover; }
.imgs__item.is-main { border-color: var(--purple); box-shadow: 0 0 0 2px var(--purple-line); }
.imgs__main { position: absolute; left: 0; right: 0; bottom: 0; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; text-align: center; padding: 3px 0; background: var(--purple); color: #fff; }
.imgs__acts { position: absolute; top: 4px; right: 4px; display: flex; gap: 3px; opacity: 0; transition: opacity .15s; }
.imgs__item:hover .imgs__acts, .imgs__item:focus-within .imgs__acts { opacity: 1; }
.imgs__acts button { appearance: none; border: 0; width: 22px; height: 22px; border-radius: 6px; background: rgba(17,17,17,.75); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; }
.imgs__acts button:hover { background: var(--purple); }
.imgs__add { width: 96px; height: 96px; border: 1.5px dashed var(--purple-line); border-radius: 10px; display: grid; place-items: center; align-content: center; gap: 2px; text-align: center; font-size: 11.5px; font-weight: 600; color: var(--purple-d); cursor: pointer; background: var(--purple-soft); padding: 6px; transition: background-color .15s; }
.imgs__add:hover { background: #E4DBF5; }
.imgs__add.is-busy { opacity: .6; pointer-events: none; }
.imgs__add small { font-weight: 400; color: var(--mut); font-size: 9.5px; line-height: 1.2; }
.imgs__plus { font-family: var(--ff-display); font-size: 22px; line-height: 1; }
.imgs__none { width: 100%; margin: 4px 0 0; }
.uploads { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
.uploads li { display: grid; grid-template-columns: minmax(0, 1fr) 160px minmax(0, 1.2fr); gap: 10px; align-items: center; font-size: 12.5px; }
.uploads__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uploads__bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.uploads__bar i { display: block; height: 100%; background: var(--purple); border-radius: 999px; transition: width .2s; }
.uploads li.is-ok .uploads__bar i { background: #1B7F4B; }
.uploads li.is-error .uploads__bar i { background: #B00020; width: 100% !important; }
.uploads li.is-ok .uploads__msg { color: #1B7F4B; }
.uploads li.is-error .uploads__msg { color: #B00020; }
.uploads__msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imgs__vars { margin-top: 10px; font-size: 13px; }
.imgs__vars summary { cursor: pointer; color: var(--purple-d); font-weight: 600; }
.imgs__vargrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-top: 8px; }
.imgs__var { display: flex; align-items: center; gap: 8px; }
.imgs__var .input { flex: 1; }

/* filas entrando / saliendo al filtrar */
.vrow-enter-active { transition: opacity .18s var(--ease-out, ease), transform .18s var(--ease-out, ease); }
.vrow-leave-active { transition: opacity .15s ease, transform .15s ease; pointer-events: none; }
.vrow-enter-from { opacity: 0; transform: translateY(6px); }
.vrow-leave-to { opacity: 0; transform: translateY(-6px); }

/* ---------- celular: tarjetas apiladas ---------- */
@media (max-width: 900px) {
  .inv__app { padding: 0 12px 32px; }
  .top { margin: 0 -12px; padding: 8px 12px; gap: 8px; }
  .top__row { gap: 8px; }
  .top__title { font-size: 24px; }
  .top__totals { display: none; }
  .top__search { grid-template-columns: 1fr 1fr; gap: 6px; }
  .search { grid-column: 1 / -1; }
  .search__input { padding: 8px 32px; font-size: 14px; }
  .top__search .input { padding: 7px 8px; font-size: 13px; }
  .top__right { margin-left: auto; gap: 6px; }
  .top__right .btn { padding: 6px 9px; font-size: 12.5px; }
  .banner { font-size: 13px; padding: 8px 12px; }
  .toolbar { gap: 8px; }
  .thead { display: none; }
  .vlist { height: clamp(360px, calc(100dvh - 260px), 1400px); }
  .vlist__inner { min-width: 0; }
  .row, .tbl-wrap--compacto .row {
    display: grid; grid-template-columns: 28px 64px minmax(0, 1fr) 28px; grid-template-areas:
      "check img name exp"
      "check img price exp"
      "check img tallas exp";
    row-gap: 6px; padding: 12px 12px; min-height: 0;
  }
  .col-check { grid-area: check; align-self: start; padding-top: 4px; }
  .col-img { grid-area: img; align-self: start; }
  .cell-name { grid-area: name; }
  .cell-sku, .cell-status { display: none; }
  .mono--m { display: inline; }
  .cell-price { grid-area: price; justify-items: start; display: flex; align-items: baseline; gap: 10px; }
  .cell-tallas { grid-area: tallas; }
  .cell-stock { display: none; }
  .col-exp { grid-area: exp; align-self: center; }
  .thead .num, .row .num { justify-self: start; text-align: left; }
  .detail__grid { grid-template-columns: 1fr; padding: 14px 12px 18px; }
  .detail__hist ul { max-height: 220px; }
  /* tabla de tallas → filas apiladas */
  .vars thead { display: none; }
  .vars, .vars tbody, .vars tr, .vars td { display: block; }
  .vars tr { padding: 10px 12px; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
  .vars td { padding: 0; border: 0; }
  .vars td.talla-cell { grid-column: 1 / -1; font-size: 15px; }
  .vars td[data-label]:not(.talla-cell)::before { content: attr(data-label); display: block; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--mut); margin-bottom: 2px; }
  .vars td.num { text-align: left; }
  .input--num { width: 100%; text-align: left; }
  .actions-cell { grid-column: 1 / -1; }
  .actions { min-width: 0; flex-wrap: wrap; }
  .uploads li { grid-template-columns: 1fr; gap: 3px; }
  .toolbar .btn { font-size: 12.5px; }
  .toolbar__right { width: 100%; justify-content: space-between; margin-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .detail, .caret, .row, .vars td, .talla, .btn, .imgs, .imgs__item, .uploads__bar i, .vrow-enter-active, .vrow-leave-active, .vlist.is-loading { transition: none; }
  .vars tr.is-flash td { animation: none; background: #BFEFD3; }
  .saving__dot, .talla--saving { animation: none; opacity: 1; }
  .talla--saved { transform: none; }
  .vrow-enter-from, .vrow-leave-to { opacity: 1; transform: none; }
}


/* ---------- modales (operación masiva, importación, prueba Woo) ---------- */
.modal__box--wide { width: min(1080px, 100%); }
.bform { display: grid; gap: 12px; }
.bform__row { display: flex; gap: 16px; flex-wrap: wrap; }
.bform__field { display: grid; gap: 4px; font-size: 13px; font-weight: 600; color: var(--mut); }
.bform__group { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0; }
.bform__group legend { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--mut); font-weight: 700; padding: 0 4px; }
.bform__group .input { width: auto; min-width: 160px; }
.preview__summary { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.preview__wrap { max-height: 55dvh; overflow: auto; border: 1px solid var(--line); border-radius: 10px; }
.preview__wrap .vars { border: 0; }
.modal { position: fixed; inset: 0; z-index: 30; background: rgba(17,17,17,.45); display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal__box { background: #fff; border-radius: 16px; padding: 20px; width: min(760px, 100%); max-height: 90dvh; overflow-y: auto; display: grid; gap: 12px; }
.modal__box h3 { margin: 0; font-size: 17px; }
.modal__row { display: flex; justify-content: flex-end; gap: 8px; }
.steps { margin: 0; padding-left: 20px; display: grid; gap: 8px; font-size: 14px; }
.steps pre { margin: 4px 0 0; font-size: 12.5px; white-space: pre-wrap; background: var(--hueso); padding: 8px 10px; border-radius: 8px; color: var(--ink); }
.steps li.err > b { color: #B00020; }
.steps li.ok > b { color: #1B7F4B; }
</style>
