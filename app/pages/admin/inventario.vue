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
const listError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; refresh() }, 250) })
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
    // Re-sembrar borradores de edición de los productos abiertos.
    for (const p of r.items) if (open.value.has(p.sku)) seedDrafts(p)
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
const rowState = ref<Record<string, { saving?: boolean, msg?: string, ok?: boolean }>>({})
const history = ref<Record<string, InvChange[]>>({})

function seedDrafts(p: InvProduct) {
  for (const v of p.variations) {
    drafts.value[v.sku] = { regular_price: v.regular_price, sale_price: v.sale_price, stock_quantity: v.manage_stock ? String(v.stock_quantity ?? 0) : '', manage_stock: v.manage_stock }
  }
}
async function toggleOpen(p: InvProduct) {
  const s = new Set(open.value)
  if (s.has(p.sku)) { s.delete(p.sku); open.value = s; return }
  s.add(p.sku)
  open.value = s
  seedDrafts(p)
  loadHistory(p.sku)
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
/** Guarda una variación: manda solo lo que cambió (precio y/o stock). */
async function save(p: InvProduct, v: InvVariation) {
  const d = drafts.value[v.sku]
  if (!d || !dirty(v)) return
  const ops: any[] = []
  if (d.regular_price !== v.regular_price || d.sale_price !== v.sale_price) ops.push({ op: 'price', sku: v.sku, regular_price: d.regular_price, sale_price: d.sale_price })
  const stockNow = v.manage_stock ? String(v.stock_quantity ?? 0) : ''
  if (d.stock_quantity !== stockNow && d.stock_quantity !== '') ops.push({ op: 'stock', sku: v.sku, stock_quantity: Number(d.stock_quantity) })
  if (!ops.length) return
  rowState.value[v.sku] = { saving: true }
  try {
    const r = await $fetch<{ resultados: InvOpResult[] }>('/api/inventario/operaciones', { method: 'POST', body: { operaciones: ops, origen: 'panel' } })
    const bad = r.resultados.filter(x => !x.ok)
    if (bad.length) rowState.value[v.sku] = { ok: false, msg: bad.map(b => b.error).join(' · ') }
    else rowState.value[v.sku] = { ok: true, msg: 'Guardado' }
    // Refrescar el producto desde el servidor (precio del padre, estado de stock).
    const fresh = await $fetch<{ product: InvProduct, cambios: InvChange[] }>(`/api/inventario/productos/${encodeURIComponent(p.sku)}`)
    const i = items.value.findIndex(x => x.sku === p.sku)
    if (i >= 0) items.value[i] = fresh.product
    history.value[p.sku] = fresh.cambios
    if (!bad.length) seedDrafts(fresh.product)
    setTimeout(() => { if (rowState.value[v.sku]?.ok) rowState.value[v.sku] = {} }, 2500)
  }
  catch (e: any) {
    onUnauthorized(e)
    rowState.value[v.sku] = { ok: false, msg: e?.data?.statusMessage ?? 'No se pudo guardar' }
  }
}
function reset(v: InvVariation) {
  drafts.value[v.sku] = { regular_price: v.regular_price, sale_price: v.sale_price, stock_quantity: v.manage_stock ? String(v.stock_quantity ?? 0) : '', manage_stock: v.manage_stock }
  rowState.value[v.sku] = {}
}

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

onMounted(checkSession)
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
      <header class="top">
        <div class="top__brand">
          <span class="login__k login__k--sm">K</span>
          <h1 class="top__title">Inventario</h1>
          <span v-if="estado" class="pill" :class="estado.simulation ? 'pill--sim' : 'pill--live'">{{ estado.simulation ? 'simulación' : 'Woo en vivo' }}</span>
        </div>
        <div class="top__right">
          <span v-if="estado" class="muted small">{{ estado.productos }} productos · {{ estado.variaciones }} tallas · Woo {{ snapshotAge }}</span>
          <button class="btn btn--ghost" type="button" :disabled="syncing" @click="sync(true)">{{ syncing ? 'Sincronizando…' : 'Sincronizar con Woo' }}</button>
          <NuxtLink class="btn btn--ghost" to="/admin/chats">Bandeja</NuxtLink>
          <button class="btn btn--ghost" type="button" @click="logout">Salir</button>
        </div>
      </header>

      <div v-if="estado?.simulation" class="banner banner--sim">
        <strong>Modo simulación</strong> — los cambios no se reflejan en el sitio ni en WooCommerce. Quedan guardados aquí ({{ estado.overrides }} tallas con cambios pendientes) para aplicarlos cuando se active la escritura.
      </div>
      <div v-if="estado && !estado.ok" class="banner banner--warn">{{ estado.detail }}</div>
      <div v-if="syncMsg" class="banner banner--info">{{ syncMsg }}</div>

      <!-- filtros -->
      <section class="filters">
        <input v-model="q" class="input input--search" type="search" placeholder="Buscar por nombre o SKU…" aria-label="Buscar">
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
      </section>

      <div class="toolbar">
        <label class="check"><input type="checkbox" :checked="allOnPage" @change="toggleAll"> <span>Seleccionar página</span></label>
        <span v-if="selected.size" class="muted small">{{ selected.size }} seleccionados · las operaciones masivas llegan en el siguiente entregable</span>
        <span class="toolbar__count muted small">{{ total }} productos</span>
      </div>

      <p v-if="listError" class="banner banner--warn">{{ listError }}</p>

      <!-- tabla -->
      <div class="tbl-wrap">
        <table class="tbl" :class="{ 'is-loading': loading }">
          <thead>
            <tr>
              <th class="col-check"></th>
              <th class="col-img"></th>
              <th><button class="th-btn" type="button" @click="sortBy('name')">Producto <i v-if="orderby === 'name'">{{ order === 'asc' ? '↑' : '↓' }}</i></button></th>
              <th><button class="th-btn" type="button" @click="sortBy('sku')">SKU <i v-if="orderby === 'sku'">{{ order === 'asc' ? '↑' : '↓' }}</i></button></th>
              <th>Estado</th>
              <th class="num"><button class="th-btn" type="button" @click="sortBy('price')">Precio <i v-if="orderby === 'price'">{{ order === 'asc' ? '↑' : '↓' }}</i></button></th>
              <th>Tallas</th>
              <th class="num"><button class="th-btn" type="button" @click="sortBy('stock')">Stock <i v-if="orderby === 'stock'">{{ order === 'asc' ? '↑' : '↓' }}</i></button></th>
              <th class="col-exp"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="p in items" :key="p.sku">
              <tr class="row" :class="{ 'is-open': open.has(p.sku), 'is-sel': selected.has(p.sku) }" @click="toggleOpen(p)">
                <td class="col-check" @click.stop><input type="checkbox" :checked="selected.has(p.sku)" :aria-label="`Seleccionar ${p.name}`" @change="toggleSel(p.sku)"></td>
                <td class="col-img"><img v-if="p.kustom.imagen" :src="p.kustom.imagen" alt="" loading="lazy"><span v-else class="noimg">sin foto</span></td>
                <td>
                  <div class="name">{{ p.name }}</div>
                  <div class="sub">
                    <span v-if="p.kustom.grupo" class="chip">{{ GRUPOS[p.kustom.grupo] ?? p.kustom.grupo }}</span>
                    <span v-for="pu in p.kustom.publicos" :key="pu" class="chip chip--soft">{{ PUBLICOS[pu] ?? pu }}</span>
                    <span v-if="p.kustom.soloWoo" class="chip chip--warn">solo en Woo</span>
                  </div>
                </td>
                <td class="mono">{{ p.sku }}</td>
                <td><span class="pill" :class="p.status === 'publish' ? 'pill--ok' : 'pill--draft'">{{ ESTADOS[p.status] ?? p.status }}</span></td>
                <td class="num">{{ priceRange(p) }}<div v-if="p.variations.some(v => v.sale_price)" class="sub muted">con oferta</div></td>
                <td>
                  <div class="tallas">
                    <span v-for="v in p.variations" :key="v.sku" class="talla" :class="`talla--${stockKind(v)}`" :title="`${v.sku} · ${stockLabel(v)}`">{{ talla(v) }}</span>
                    <span v-if="!p.variations.length" class="muted small">sin tallas</span>
                  </div>
                </td>
                <td class="num"><span class="stock" :class="`stock--${productStock(p).kind}`">{{ productStock(p).text }}</span></td>
                <td class="col-exp"><span class="caret" :class="{ 'is-open': open.has(p.sku) }">›</span></td>
              </tr>
              <tr v-if="open.has(p.sku)" class="detail">
                <td colspan="9">
                  <div class="detail__grid">
                    <div class="detail__vars">
                      <table class="vars">
                        <thead>
                          <tr><th>Talla</th><th>SKU</th><th class="num">Precio normal</th><th class="num">Precio rebajado</th><th class="num">Stock</th><th>Estado</th><th></th></tr>
                        </thead>
                        <tbody>
                          <tr v-for="v in p.variations" :key="v.sku" :class="{ 'is-dirty': dirty(v) }">
                            <td class="talla-cell">{{ talla(v) }}</td>
                            <td class="mono small">{{ v.sku }}</td>
                            <td class="num">
                              <input v-if="drafts[v.sku]" v-model="drafts[v.sku]!.regular_price" class="input input--num" inputmode="numeric" placeholder="—" @keydown.enter.prevent="save(p, v)">
                            </td>
                            <td class="num">
                              <input v-if="drafts[v.sku]" v-model="drafts[v.sku]!.sale_price" class="input input--num" inputmode="numeric" placeholder="sin oferta" @keydown.enter.prevent="save(p, v)">
                            </td>
                            <td class="num">
                              <input v-if="drafts[v.sku]" v-model="drafts[v.sku]!.stock_quantity" class="input input--num" inputmode="numeric" :placeholder="v.manage_stock ? '0' : 'sin gestionar'" @keydown.enter.prevent="save(p, v)">
                            </td>
                            <td><span class="stock" :class="`stock--${stockKind(v)}`">{{ stockLabel(v) }}</span></td>
                            <td class="actions">
                              <template v-if="rowState[v.sku]?.saving"><span class="muted small">Guardando…</span></template>
                              <template v-else-if="dirty(v)">
                                <button class="btn btn--primary btn--sm" type="button" @click="save(p, v)">Guardar</button>
                                <button class="btn btn--ghost btn--sm" type="button" @click="reset(v)">Deshacer</button>
                              </template>
                              <span v-if="rowState[v.sku]?.msg" class="small" :class="rowState[v.sku]?.ok ? 'ok' : 'err'">{{ rowState[v.sku]?.msg }}</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <p class="hint muted small">Precios en pesos, sin puntos. Escribe un stock para activar la gestión de esa talla; en 0 queda agotada. Enter guarda.</p>
                    </div>
                    <aside class="detail__hist">
                      <h3>Últimos cambios</h3>
                      <ul v-if="history[p.sku]?.length">
                        <li v-for="c in history[p.sku]" :key="c.id">
                          <span class="mono small">{{ c.sku.replace(`${p.sku}-T`, 'T ') }}</span>
                          <span>{{ campoLabel[c.campo] ?? c.campo }}: {{ changeValue(c.campo, c.anterior) }} → <b>{{ changeValue(c.campo, c.nuevo) }}</b></span>
                          <span class="muted small">{{ fecha(c.created_at) }} · {{ c.origen }}{{ c.autor ? ` · ${c.autor}` : '' }}{{ c.backend === 'mock' ? ' · simulado' : '' }}</span>
                        </li>
                      </ul>
                      <p v-else class="muted small">Sin cambios registrados.</p>
                    </aside>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!loading && !items.length"><td colspan="9" class="empty">Ningún producto coincide.</td></tr>
          </tbody>
        </table>
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
.inv { min-height: 100dvh; display: flex; flex-direction: column; }
.inv__center { flex: 1; display: grid; place-items: center; padding: 24px; }
.muted { color: var(--mut); }
.small { font-size: 12.5px; }
.mono { font-family: var(--ff-mono); font-size: 12.5px; }
.ok { color: #1B7F4B; }
.err { color: #B00020; }

/* login (mismo look que la bandeja) */
.login { width: min(380px, 100%); background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: var(--shadow-card); display: flex; flex-direction: column; gap: 10px; }
.login__brand { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.login__k { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--purple); color: #fff; font-family: var(--ff-display); font-size: 26px; line-height: 1; }
.login__k--sm { width: 28px; height: 28px; font-size: 17px; border-radius: 8px; }
.login__title { font-family: var(--ff-display); font-size: 22px; letter-spacing: .5px; }
.login__sub { font-size: 13px; color: var(--mut); }
.login__label { font-size: 13px; font-weight: 600; color: var(--mut); }
.login__input { font: inherit; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 12px; }
.login__input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.login__error { color: #B00020; font-size: 13px; margin: 0; }
.login__warn { background: #FFF1D6; color: #9A5B00; font-size: 13px; padding: 10px 12px; border-radius: 10px; margin: 0; }

/* app */
.inv__app { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 14px 18px 40px; max-width: 1400px; width: 100%; margin: 0 auto; }
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.top__brand { display: flex; align-items: center; gap: 10px; }
.top__title { font-family: var(--ff-display); font-size: 24px; letter-spacing: .5px; margin: 0; }
.top__right { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

.btn { appearance: none; font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--purple); background: var(--purple); color: #fff; cursor: pointer; text-decoration: none; }
.btn--ghost { background: #fff; color: var(--purple-d); border-color: var(--purple-line); }
.btn--sm { padding: 5px 10px; font-size: 13px; border-radius: 8px; }
.btn:disabled { opacity: .5; cursor: default; }
.btn:not(:disabled):hover { filter: brightness(1.05); }

.pill { font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.pill--sim { background: #FFF1D6; color: #9A5B00; }
.pill--live { background: #DDF7E8; color: #1B7F4B; }
.pill--ok { background: #DDF7E8; color: #1B7F4B; }
.pill--draft { background: var(--line); color: var(--mut); }

.banner { padding: 10px 14px; border-radius: 12px; font-size: 14px; }
.banner--sim { background: #FFF1D6; color: #7A4A00; border: 1px solid #F5D58F; }
.banner--warn { background: #FDE7E9; color: #8A1C2B; }
.banner--info { background: var(--purple-soft); color: var(--purple-d); }

.filters { display: grid; grid-template-columns: minmax(200px, 2fr) repeat(4, minmax(140px, 1fr)) auto; gap: 8px; align-items: center; }
.input { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid var(--line-2); border-radius: 10px; background: #fff; color: var(--ink); min-width: 0; width: 100%; }
.input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.input--num { width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
.input--sm { width: auto; padding: 4px 8px; }
.toolbar { display: flex; align-items: center; gap: 14px; }
.toolbar__count { margin-left: auto; }
.check { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; }

.tbl-wrap { overflow-x: auto; background: #fff; border: 1px solid var(--line); border-radius: 14px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.tbl.is-loading { opacity: .6; }
.tbl th { text-align: left; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--mut); padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--hueso); white-space: nowrap; }
.tbl td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.th-btn { appearance: none; background: none; border: 0; font: inherit; color: inherit; cursor: pointer; padding: 0; text-transform: inherit; letter-spacing: inherit; }
.th-btn i { font-style: normal; color: var(--purple); }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.col-check { width: 32px; }
.col-img { width: 56px; }
.col-img img { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; background: #fff; border: 1px solid var(--line); }
.noimg { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: var(--hueso); color: var(--mut-2); font-size: 10px; text-align: center; }
.col-exp { width: 28px; }
.row { cursor: pointer; }
.row:hover { background: #FBFAF7; }
.row.is-open { background: var(--purple-soft); }
.row.is-sel td:first-child { box-shadow: inset 3px 0 0 var(--purple); }
.name { font-weight: 600; }
.sub { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; font-size: 12px; }
.chip { background: var(--purple-soft); color: var(--purple-d); border-radius: 999px; padding: 1px 7px; font-size: 11.5px; }
.chip--soft { background: var(--hueso); color: var(--mut); }
.chip--warn { background: #FFF1D6; color: #9A5B00; }
.tallas { display: flex; flex-wrap: wrap; gap: 3px; }
.talla { min-width: 26px; text-align: center; font-size: 12px; font-weight: 600; padding: 1px 5px; border-radius: 6px; border: 1px solid var(--line-2); background: #fff; }
.talla--ok { border-color: #9BD7B5; background: #EAF8F0; }
.talla--bajo { border-color: #F5D58F; background: #FFF6E0; }
.talla--agotado { border-color: #F3B1B8; background: #FDE7E9; color: #8A1C2B; text-decoration: line-through; }
.talla--sin { color: var(--mut); }
.stock { font-weight: 600; }
.stock--ok { color: #1B7F4B; }
.stock--bajo { color: #9A5B00; }
.stock--agotado { color: #B00020; }
.stock--sin { color: var(--mut); font-weight: 500; }
.caret { display: inline-block; transition: transform .15s; color: var(--mut); font-size: 20px; }
.caret.is-open { transform: rotate(90deg); }
.empty { text-align: center; color: var(--mut); padding: 32px; }

.detail td { background: #FBFAF7; padding: 14px 16px 16px; }
.detail__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); gap: 18px; }
.vars { width: 100%; border-collapse: collapse; font-size: 13.5px; background: #fff; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.vars th { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--mut); padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }
.vars td { padding: 6px 10px; border-bottom: 1px solid var(--line); }
.vars tr.is-dirty td { background: #FFFBEE; }
.talla-cell { font-weight: 700; }
.actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; min-width: 160px; }
.hint { margin: 8px 2px 0; }
.detail__hist h3 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--mut); margin: 0 0 8px; }
.detail__hist ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-height: 320px; overflow-y: auto; }
.detail__hist li { display: grid; gap: 1px; font-size: 13px; padding-bottom: 6px; border-bottom: 1px dashed var(--line); }

.pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pager__nav { display: flex; align-items: center; gap: 10px; }

@media (max-width: 900px) {
  .filters { grid-template-columns: 1fr 1fr; }
  .input--search { grid-column: 1 / -1; }
  .detail__grid { grid-template-columns: 1fr; }
  .tbl th:nth-child(4), .tbl td:nth-child(4), .tbl th:nth-child(7), .tbl td:nth-child(7) { display: none; }
}
@media (max-width: 600px) {
  .inv__app { padding: 10px 10px 32px; }
  .tbl th:nth-child(2), .tbl td:nth-child(2), .tbl th:nth-child(5), .tbl td:nth-child(5) { display: none; }
  .input--num { width: 84px; }
  .actions { min-width: 0; flex-wrap: wrap; }
}
</style>
