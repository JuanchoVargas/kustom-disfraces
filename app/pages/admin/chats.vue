<script setup lang="ts">
/**
 * BANDEJA DE ATENCIÓN HUMANA — /admin/chats
 * Lista de conversaciones (wa/msg/ig) a la izquierda y chat a la derecha; en
 * celular se muestra una u otra. Login con contraseña única (cookie firmada),
 * refresco por polling cada 5 s, respuesta por el adaptador del canal, tomar /
 * devolver al bot, archivar (nunca se borra nada), envío de imágenes, medios
 * recibidos (fotos, stickers, audios, documentos, ubicación), número del
 * cliente visible con botón de copiar, filtro por fecha y búsqueda en el
 * histórico completo, y bloqueo del campo cuando la ventana de 24h de WhatsApp
 * está cerrada.
 */
definePageMeta({ layout: 'inbox' })
useHead({
  title: 'Bandeja de chats — Kustom',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

type Canal = 'wa' | 'msg' | 'ig'
type Estado = 'bot' | 'humano' | 'cerrado'
type Tab = 'activas' | 'archivadas' | 'todas'
interface Conv {
  id: number
  canal: Canal
  external_id: string
  nombre: string | null
  telefono: string | null
  bsuid: string | null
  username: string | null
  ultimo_mensaje: string | null
  ultima_actividad: string
  ultimo_cliente_at: string | null
  estado: Estado
  no_leidos: number
  archivada_at: string | null
  window_open: boolean
}
interface MsgMedia { url: string, mime: string, filename: string | null, bytes: number }
interface Msg {
  id: number
  direccion: 'in' | 'out'
  texto: string
  autor: string
  created_at: string
  tipo: string
  meta: Record<string, any> | null
  media: MsgMedia | null
}

const POLL_MS = 5000
const MAX_UPLOAD = 5 * 1024 * 1024 // lo que acepta el selector (se comprime antes de subir)
const CANAL: Record<Canal, { label: string, icon: string, cls: string }> = {
  wa: { label: 'WhatsApp', icon: '💬', cls: 'wa' },
  msg: { label: 'Messenger', icon: '📨', cls: 'msg' },
  ig: { label: 'Instagram', icon: '📸', cls: 'ig' },
}
const ESTADO: Record<Estado, string> = { bot: 'Bot', humano: 'Humano', cerrado: 'Archivada' }
const TABS: Array<{ id: Tab, label: string }> = [
  { id: 'activas', label: 'Activas' },
  { id: 'archivadas', label: 'Archivadas' },
  { id: 'todas', label: 'Todas' },
]
const NO_PHONE = 'Número no disponible (identidad protegida de WhatsApp)'

// ---------- sesión ----------
const route = useRoute()
const checking = ref(true)
const authed = ref(false)
const configured = ref(true)
const dbOk = ref(true)
const password = ref('')
const loginError = ref('')
const loggingIn = ref(false)

async function checkSession() {
  try {
    const me = await $fetch<{ configured: boolean, authenticated: boolean, db: boolean }>('/api/inbox/me')
    configured.value = me.configured
    authed.value = me.authenticated
    dbOk.value = me.db
  }
  catch { authed.value = false }
  checking.value = false
}
async function login() {
  loginError.value = ''
  loggingIn.value = true
  try {
    await $fetch('/api/inbox/login', { method: 'POST', body: { password: password.value } })
    password.value = ''
    authed.value = true
    await refreshList()
    const c = Number(route.query.c)
    if (c) await openConv(c)
  }
  catch (e: any) {
    loginError.value = e?.statusCode === 503 ? 'La bandeja no está configurada (NUXT_INBOX_PASSWORD).' : 'Contraseña incorrecta.'
  }
  loggingIn.value = false
}
async function logout() {
  await $fetch('/api/inbox/logout', { method: 'POST' })
  authed.value = false
  selected.value = null
  convs.value = []
}
function onUnauthorized(e: any) {
  if (e?.statusCode === 401) authed.value = false
}

// ---------- lista (pestañas, fechas, búsqueda en el histórico) ----------
const convs = ref<Conv[]>([])
const search = ref('')
const tab = ref<Tab>('activas')
const desde = ref('') // yyyy-mm-dd (fecha local)
const hasta = ref('')
const listError = ref('')
const loadingList = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(refreshList, 250)
})
watch([tab, desde, hasta], () => refreshList())

// Rango de fechas en hora LOCAL del navegador → ISO para el servidor. `hasta` es
// inclusivo para quien lo escribe: se manda el día siguiente (exclusivo).
function isoStart(d: string) {
  if (!d) return ''
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString()
}
function isoEndExclusive(d: string) {
  if (!d) return ''
  const t = new Date(`${d}T00:00:00`)
  if (Number.isNaN(t.getTime())) return ''
  t.setDate(t.getDate() + 1)
  return t.toISOString()
}
function clearDates() {
  desde.value = ''
  hasta.value = ''
}

async function refreshList() {
  if (!authed.value) return
  loadingList.value = true
  try {
    const r = await $fetch<{ conversations: Conv[] }>('/api/inbox/conversations', {
      query: { q: search.value, estado: tab.value, desde: isoStart(desde.value), hasta: isoEndExclusive(hasta.value) },
    })
    convs.value = r.conversations
    listError.value = ''
    // Mantener sincronizada la cabecera de la conversación abierta.
    const cur = selected.value && r.conversations.find(c => c.id === selected.value!.id)
    if (cur) selected.value = { ...cur, no_leidos: 0 }
  }
  catch (e: any) {
    onUnauthorized(e)
    listError.value = 'No se pudo cargar la lista.'
  }
  loadingList.value = false
}

const totalUnread = computed(() => convs.value.reduce((n, c) => n + (c.no_leidos || 0), 0))
const totalHumano = computed(() => convs.value.filter(c => c.estado === 'humano').length)
const hasFilters = computed(() => !!(search.value || desde.value || hasta.value))

// Botón de emergencia: devuelve TODAS las conversaciones en humano al bot ya.
async function resetHumano() {
  if (!window.confirm(`¿Devolver ${totalHumano.value} conversación(es) en atención humana al bot?`)) return
  try {
    await $fetch('/api/inbox/conversations/reset-humano', { method: 'POST' })
    await refreshList()
    if (selected.value) await loadConv(selected.value.id)
  }
  catch (e) {
    onUnauthorized(e)
    listError.value = 'No se pudo devolver las conversaciones al bot.'
  }
}

// ---------- conversación abierta ----------
const selected = ref<Conv | null>(null)
const messages = ref<Msg[]>([])
const loadingConv = ref(false)
const chatBody = ref<HTMLElement | null>(null)
const mobileView = ref<'list' | 'chat'>('list')

async function openConv(id: number) {
  loadingConv.value = true
  mobileView.value = 'chat'
  pending.value = null
  try {
    await loadConv(id, true)
    await $fetch(`/api/inbox/conversations/${id}/read`, { method: 'POST' })
    const c = convs.value.find(x => x.id === id)
    if (c) c.no_leidos = 0
  }
  catch (e) { onUnauthorized(e) }
  loadingConv.value = false
}
async function loadConv(id: number, scroll = false) {
  const r = await $fetch<{ conversation: Conv, messages: Msg[] }>(`/api/inbox/conversations/${id}`)
  const grew = r.messages.length !== messages.value.length
  selected.value = { ...r.conversation, no_leidos: 0 }
  messages.value = r.messages
  if (scroll || grew) await scrollBottom()
}
async function scrollBottom() {
  await nextTick()
  const el = chatBody.value
  if (el) el.scrollTop = el.scrollHeight
}
// Una imagen que termina de cargar en los últimos mensajes empuja el final del
// chat: se vuelve a pegar abajo para que lo recién enviado/recibido quede visible.
function onMediaLoad(i: number) {
  if (i >= messages.value.length - 3) scrollBottom()
}
function backToList() {
  mobileView.value = 'list'
}

// ---------- identidad del cliente (número / BSUID / username) ----------
/** Teléfono del cliente de WhatsApp (sin '+'), o null si Meta no lo entregó (BSUID). */
function phoneOf(c: Conv): string | null {
  if (c.canal !== 'wa') return null
  if (c.telefono && /^\d+$/.test(c.telefono)) return c.telefono
  if (/^\d+$/.test(c.external_id)) return c.external_id
  return null
}
function fmtPhone(p: string) {
  return `+${p}`
}
function isProtected(c: Conv) {
  return c.canal === 'wa' && !phoneOf(c)
}
function displayName(c: Conv) {
  if (c.nombre) return c.nombre
  if (c.username) return `@${c.username}`
  const p = phoneOf(c)
  if (p) return fmtPhone(p)
  return c.canal === 'wa' ? 'Cliente de WhatsApp' : `${CANAL[c.canal].label} · ${c.external_id.slice(-6)}`
}
/** Línea de contacto corta para la lista. */
function contactShort(c: Conv) {
  const p = phoneOf(c)
  if (p) return fmtPhone(p)
  if (c.canal === 'wa') return c.username ? `@${c.username} · 🔒 sin número` : '🔒 Número no disponible'
  return `${CANAL[c.canal].label} id ${c.external_id}`
}

const copied = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = '' }, 1500)
  }
  catch { window.prompt('Copia el texto:', text) }
}

// ---------- acciones ----------
const draft = ref('')
const sending = ref(false)
const actionError = ref('')
const actionInfo = ref('')
// Se puede escribir en cualquier conversación (archivadas incluidas: responder la
// reactiva); solo la ventana de 24h de WhatsApp bloquea.
const canType = computed(() => !!selected.value && selected.value.window_open)

function errorText(e: any, fallback: string) {
  const code = e?.statusMessage || e?.data?.statusMessage
  if (code === 'window_closed') return 'Ventana de 24h cerrada: este cliente debe escribir primero.'
  if (code === 'whatsapp_not_configured' || code === 'messenger_not_configured') return 'El canal no está configurado en el servidor.'
  if (code === 'too_large') return 'La imagen es demasiado pesada (máx. 5 MB).'
  if (code === 'bad_type') return 'Solo se aceptan imágenes JPG, PNG o WebP.'
  if (code === 'send_failed') return 'Meta rechazó el envío. Revisa el log del servidor.'
  return fallback
}

async function send() {
  const conv = selected.value
  const text = draft.value.trim()
  if (!conv || !text || sending.value || !canType.value) return
  sending.value = true
  actionError.value = ''
  actionInfo.value = ''
  try {
    const r = await $fetch<{ ok: boolean, dry_run?: boolean }>(`/api/inbox/conversations/${conv.id}/send`, { method: 'POST', body: { text } })
    draft.value = ''
    if (r.dry_run) actionInfo.value = 'Guardado sin enviar: el canal no tiene credenciales en este entorno (solo local).'
    await loadConv(conv.id, true)
    await refreshList()
  }
  catch (e: any) {
    onUnauthorized(e)
    actionError.value = errorText(e, 'No se pudo enviar. Intenta de nuevo.')
  }
  sending.value = false
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
    e.preventDefault()
    send()
  }
}
function isTouch() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}
async function setEstado(estado: Estado) {
  const conv = selected.value
  if (!conv) return
  actionError.value = ''
  try {
    await $fetch(`/api/inbox/conversations/${conv.id}/estado`, { method: 'POST', body: { estado } })
    await loadConv(conv.id)
    await refreshList()
  }
  catch (e) {
    onUnauthorized(e)
    actionError.value = 'No se pudo cambiar el estado.'
  }
}

// ---------- adjuntar imagen ----------
const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<{ blob: Blob, name: string, previewUrl: string, bytes: number } | null>(null)
const caption = ref('')
const uploading = ref(false)

function pickFile() {
  if (!canType.value || uploading.value) return
  fileInput.value?.click()
}
async function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  actionError.value = ''
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    actionError.value = 'Solo se aceptan imágenes JPG, PNG o WebP.'
    return
  }
  if (file.size > MAX_UPLOAD) {
    actionError.value = 'La imagen es demasiado pesada (máx. 5 MB).'
    return
  }
  try {
    const blob = await compressImage(file)
    if (pending.value) URL.revokeObjectURL(pending.value.previewUrl)
    pending.value = { blob, name: blob === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg', previewUrl: URL.createObjectURL(blob), bytes: blob.size }
    caption.value = ''
  }
  catch {
    actionError.value = 'No se pudo leer la imagen.'
  }
}
/**
 * Reduce la imagen antes de subirla (máx. 1600 px por lado, JPEG 85 %) cuando pesa
 * más de 1 MB o es muy grande; así siempre cabe en el tope del servidor (4 MB) y
 * WhatsApp la entrega rápido. Las pequeñas se mandan tal cual.
 */
async function compressImage(file: File): Promise<Blob> {
  const MAX_SIDE = 1600
  const bitmap = await createImageBitmap(file)
  const big = bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE
  if (!big && file.size <= 1024 * 1024) {
    bitmap.close()
    return file
  }
  const scale = big ? Math.min(MAX_SIDE / bitmap.width, MAX_SIDE / bitmap.height) : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff' // PNG con transparencia → fondo blanco en JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.85))
}
function cancelPending() {
  if (pending.value) URL.revokeObjectURL(pending.value.previewUrl)
  pending.value = null
  caption.value = ''
}
async function sendImage() {
  const conv = selected.value
  const p = pending.value
  if (!conv || !p || uploading.value || !canType.value) return
  uploading.value = true
  actionError.value = ''
  actionInfo.value = ''
  try {
    const form = new FormData()
    form.append('file', p.blob, p.name)
    if (caption.value.trim()) form.append('caption', caption.value.trim())
    const r = await $fetch<{ ok: boolean, dry_run?: boolean }>(`/api/inbox/conversations/${conv.id}/media`, { method: 'POST', body: form })
    cancelPending()
    if (r.dry_run) actionInfo.value = 'Imagen guardada sin enviar: el canal no tiene credenciales en este entorno (solo local).'
    await loadConv(conv.id, true)
    await refreshList()
  }
  catch (e: any) {
    onUnauthorized(e)
    actionError.value = errorText(e, 'No se pudo enviar la imagen. Intenta de nuevo.')
  }
  uploading.value = false
}

// ---------- medios recibidos ----------
const lightbox = ref<string | null>(null)
const MEDIA_TIPOS = new Set(['image', 'sticker', 'audio', 'video', 'document'])
function hasFile(m: Msg) {
  return !!m.media && MEDIA_TIPOS.has(m.tipo)
}
/** Texto a mostrar en la burbuja: caption si hay archivo; el texto (o aviso) si no. */
function bubbleText(m: Msg) {
  if (hasFile(m)) return (m.meta?.caption ?? '').trim()
  return m.texto
}
function failNote(m: Msg) {
  const f = m.meta?.download_failed
  if (!f || m.media) return ''
  if (f === 'sin_token') return 'No se descargó: el servidor no tiene el token de WhatsApp.'
  if (f === 'demasiado_grande') return 'No se guardó: el archivo supera los 4 MB.'
  return 'No se pudo descargar el archivo.'
}
function mapsUrl(m: Msg) {
  return `https://www.google.com/maps?q=${m.meta?.lat},${m.meta?.lng}`
}
function osmEmbed(m: Msg) {
  const lat = Number(m.meta?.lat)
  const lng = Number(m.meta?.lng)
  const d = 0.004
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`
}
function fmtBytes(n: number) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---------- polling ----------
let timer: ReturnType<typeof setInterval> | undefined
async function tick() {
  if (!authed.value || document.hidden) return
  await refreshList()
  if (selected.value) {
    try { await loadConv(selected.value.id) }
    catch (e) { onUnauthorized(e) }
  }
}
onMounted(async () => {
  await checkSession()
  if (authed.value) {
    await refreshList()
    const c = Number(route.query.c)
    if (c) await openConv(c)
  }
  timer = setInterval(tick, POLL_MS)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  if (pending.value) URL.revokeObjectURL(pending.value.previewUrl)
})

// ---------- formato ----------
function relTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days} d`
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: days > 300 ? '2-digit' : undefined })
}
function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}
function dayOf(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}
function showDay(i: number) {
  if (i === 0) return true
  const a = new Date(messages.value[i - 1]!.created_at).toDateString()
  const b = new Date(messages.value[i]!.created_at).toDateString()
  return a !== b
}
function windowLeft(c: Conv) {
  if (!c.ultimo_cliente_at) return ''
  const left = 24 * 3600_000 - (Date.now() - new Date(c.ultimo_cliente_at).getTime())
  if (left <= 0) return ''
  const h = Math.floor(left / 3600_000)
  const m = Math.floor((left % 3600_000) / 60000)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}
</script>

<template>
  <div class="inbox">
    <!-- ===== cargando sesión ===== -->
    <div v-if="checking" class="inbox__center">
      <div class="spinner" />
    </div>

    <!-- ===== login ===== -->
    <div v-else-if="!authed" class="inbox__center">
      <form class="login" @submit.prevent="login">
        <div class="login__brand">
          <span class="login__k">K</span>
          <div>
            <div class="login__title">Bandeja de chats</div>
            <div class="login__sub">Kustom Disfraces · atención humana</div>
          </div>
        </div>
        <p v-if="!configured" class="login__warn">
          La bandeja no está configurada. Define <code>NUXT_INBOX_PASSWORD</code> en el servidor.
        </p>
        <label class="login__label" for="pw">Contraseña</label>
        <input
          id="pw"
          v-model="password"
          class="login__input"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          :disabled="!configured || loggingIn"
          required
        >
        <p v-if="loginError" class="login__error">{{ loginError }}</p>
        <button class="btn btn--primary btn--block" type="submit" :disabled="!configured || loggingIn">
          {{ loggingIn ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
    </div>

    <!-- ===== bandeja ===== -->
    <div v-else class="inbox__app" :class="`is-${mobileView}`">
      <!-- lista -->
      <aside class="list">
        <header class="list__head">
          <div class="list__title">
            <span class="login__k login__k--sm">K</span>
            Chats
            <span v-if="totalUnread" class="badge">{{ totalUnread }}</span>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" @click="logout">Salir</button>
        </header>
        <div class="list__tabs" role="tablist">
          <button
            v-for="t in TABS"
            :key="t.id"
            class="tab-btn"
            :class="{ 'is-active': tab === t.id }"
            type="button"
            role="tab"
            :aria-selected="tab === t.id"
            @click="tab = t.id"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="list__search">
          <input
            v-model="search"
            type="search"
            class="input"
            placeholder="Buscar nombre, número o texto del chat"
            aria-label="Buscar en todas las conversaciones"
          >
        </div>
        <div class="list__dates">
          <label class="date">
            <span>Desde</span>
            <input v-model="desde" type="date" class="input input--date" aria-label="Desde">
          </label>
          <label class="date">
            <span>Hasta</span>
            <input v-model="hasta" type="date" class="input input--date" aria-label="Hasta">
          </label>
          <button v-if="desde || hasta" class="btn btn--ghost btn--sm" type="button" title="Quitar fechas" @click="clearDates">✕</button>
        </div>
        <div v-if="totalHumano" class="list__search">
          <button class="btn btn--sm" type="button" style="width:100%" @click="resetHumano">
            🤖 Devolver TODAS al bot ({{ totalHumano }})
          </button>
        </div>
        <p v-if="!dbOk" class="list__warn">Sin base de datos configurada (POSTGRES_URL).</p>
        <p v-else-if="listError" class="list__warn">{{ listError }}</p>
        <ul class="list__items">
          <li v-for="c in convs" :key="c.id">
            <button
              class="item"
              :class="{ 'is-active': selected?.id === c.id, 'is-unread': c.no_leidos > 0 }"
              type="button"
              @click="openConv(c.id)"
            >
              <span class="item__avatar" :class="`item__avatar--${CANAL[c.canal].cls}`" :title="CANAL[c.canal].label">
                {{ CANAL[c.canal].icon }}
              </span>
              <span class="item__main">
                <span class="item__row">
                  <span class="item__name">{{ displayName(c) }}</span>
                  <span class="item__time">{{ relTime(c.ultima_actividad) }}</span>
                </span>
                <span class="item__row">
                  <span class="item__contact" :class="{ 'item__contact--locked': isProtected(c) }">{{ contactShort(c) }}</span>
                </span>
                <span class="item__row">
                  <span class="item__preview">{{ c.ultimo_mensaje || '—' }}</span>
                  <span v-if="c.no_leidos" class="badge">{{ c.no_leidos }}</span>
                </span>
                <span class="item__row item__row--tags">
                  <span class="tag" :class="`tag--${c.estado}`">{{ ESTADO[c.estado] }}</span>
                  <span v-if="c.canal === 'wa' && !c.window_open" class="tag tag--closed">24h cerrada</span>
                </span>
              </span>
            </button>
          </li>
          <li v-if="!convs.length && dbOk && !listError && !loadingList" class="list__empty">
            {{ hasFilters ? 'Sin resultados para ese filtro.' : tab === 'archivadas' ? 'No hay conversaciones archivadas.' : 'Todavía no hay conversaciones.' }}
          </li>
        </ul>
      </aside>

      <!-- chat -->
      <section class="chat">
        <div v-if="!selected" class="chat__empty">
          <div class="chat__empty-icon">💬</div>
          <p>Elige una conversación para verla aquí.</p>
        </div>
        <template v-else>
          <header class="chat__head">
            <button class="btn btn--ghost btn--sm chat__back" type="button" aria-label="Volver a la lista" @click="backToList">‹</button>
            <span class="item__avatar" :class="`item__avatar--${CANAL[selected.canal].cls}`">{{ CANAL[selected.canal].icon }}</span>
            <div class="chat__who">
              <div class="chat__name">{{ displayName(selected) }}</div>
              <div class="chat__meta">
                <template v-if="phoneOf(selected)">
                  <span class="chat__phone">{{ fmtPhone(phoneOf(selected)!) }}</span>
                  <button class="copy" type="button" :title="`Copiar ${fmtPhone(phoneOf(selected)!)}`" @click="copy(fmtPhone(phoneOf(selected)!))">
                    {{ copied === fmtPhone(phoneOf(selected)!) ? '✓ copiado' : '⧉ copiar' }}
                  </button>
                </template>
                <template v-else-if="selected.canal === 'wa'">
                  <span class="chat__locked" :title="selected.bsuid || selected.external_id">🔒 {{ NO_PHONE }}</span>
                </template>
                <template v-else>
                  <span>{{ CANAL[selected.canal].label }} id {{ selected.external_id }}</span>
                  <button class="copy" type="button" title="Copiar id" @click="copy(selected.external_id)">
                    {{ copied === selected.external_id ? '✓ copiado' : '⧉ copiar' }}
                  </button>
                </template>
                <span v-if="selected.username" class="chat__user">
                  @{{ selected.username }}
                  <button class="copy" type="button" title="Copiar username" @click="copy(`@${selected.username}`)">
                    {{ copied === `@${selected.username}` ? '✓' : '⧉' }}
                  </button>
                </span>
                <span class="tag" :class="`tag--${selected.estado}`">{{ ESTADO[selected.estado] }}</span>
              </div>
            </div>
            <div class="chat__actions">
              <button v-if="selected.estado !== 'humano'" class="btn btn--primary btn--sm" type="button" @click="setEstado('humano')">Tomar conversación</button>
              <button v-else class="btn btn--sm" type="button" @click="setEstado('bot')">Devolver al bot</button>
              <button v-if="selected.estado !== 'cerrado'" class="btn btn--ghost btn--sm" type="button" title="Mover a Archivadas (no se borra nada)" @click="setEstado('cerrado')">Archivar</button>
              <button v-else class="btn btn--ghost btn--sm" type="button" title="Volver a Activas (con el bot)" @click="setEstado('bot')">Desarchivar</button>
            </div>
          </header>

          <div ref="chatBody" class="chat__body">
            <div v-if="loadingConv && !messages.length" class="chat__loading"><div class="spinner" /></div>
            <template v-for="(m, i) in messages" :key="m.id">
              <div v-if="showDay(i)" class="day">{{ dayOf(m.created_at) }}</div>
              <div class="bubble" :class="[`bubble--${m.direccion}`, `bubble--${m.autor}`, { 'bubble--media': hasFile(m) }]">
                <!-- imagen / sticker -->
                <button
                  v-if="hasFile(m) && (m.tipo === 'image' || m.tipo === 'sticker')"
                  class="media-img"
                  :class="{ 'media-img--sticker': m.tipo === 'sticker' }"
                  type="button"
                  title="Ampliar"
                  @click="lightbox = m.media!.url"
                >
                  <img :src="m.media!.url" :alt="m.tipo === 'sticker' ? 'Sticker' : 'Imagen'" loading="lazy" @load="onMediaLoad(i)">
                </button>
                <!-- audio -->
                <audio v-else-if="hasFile(m) && m.tipo === 'audio'" class="media-audio" controls preload="none" :src="m.media!.url" />
                <!-- video -->
                <video v-else-if="hasFile(m) && m.tipo === 'video'" class="media-video" controls preload="metadata" :src="m.media!.url" />
                <!-- documento -->
                <a v-else-if="hasFile(m) && m.tipo === 'document'" class="media-doc" :href="m.media!.url" target="_blank" rel="noopener" download>
                  <span class="media-doc__icon">📄</span>
                  <span class="media-doc__name">{{ m.media!.filename || 'Documento' }}</span>
                  <span class="media-doc__size">{{ fmtBytes(m.media!.bytes) }} · descargar</span>
                </a>
                <!-- ubicación -->
                <div v-if="m.tipo === 'location' && m.meta?.lat != null" class="media-loc">
                  <iframe class="media-loc__map" :src="osmEmbed(m)" loading="lazy" title="Mapa" referrerpolicy="no-referrer" />
                  <a class="media-loc__link" :href="mapsUrl(m)" target="_blank" rel="noopener">📍 Abrir en Google Maps · {{ Number(m.meta.lat).toFixed(5) }}, {{ Number(m.meta.lng).toFixed(5) }}</a>
                </div>
                <div v-if="bubbleText(m) && m.tipo !== 'location'" class="bubble__text">{{ bubbleText(m) }}</div>
                <div v-else-if="m.tipo === 'location' && (m.meta?.name || m.meta?.address)" class="bubble__text">{{ [m.meta?.name, m.meta?.address].filter(Boolean).join(' · ') }}</div>
                <div v-if="failNote(m)" class="bubble__note">{{ failNote(m) }}</div>
                <div class="bubble__meta">
                  <span v-if="m.meta?.dry_run" class="bubble__dry" title="Solo en local: el canal no tiene credenciales">no enviado (local)</span>
                  <span v-if="m.direccion === 'out'" class="bubble__autor">{{ m.autor === 'bot' ? '🤖 Bot' : '🧑 Tú' }}</span>
                  {{ timeOf(m.created_at) }}
                </div>
              </div>
            </template>
          </div>

          <footer class="chat__foot">
            <p v-if="selected.canal === 'wa' && !selected.window_open" class="notice notice--closed">
              ⏳ Ventana de 24h cerrada: este cliente debe escribir primero. No se pueden enviar textos ni imágenes.
            </p>
            <p v-else-if="selected.estado === 'cerrado'" class="notice">
              📁 Conversación archivada. Si respondes o el cliente escribe, vuelve a Activas.
            </p>
            <p v-else-if="selected.estado === 'bot'" class="notice notice--bot">
              🤖 El bot está atendiendo. Al responder, la conversación pasa a ti automáticamente.
              <span v-if="selected.canal === 'wa'" class="notice__win">Ventana: {{ windowLeft(selected) }} restantes.</span>
            </p>
            <p v-else-if="selected.canal === 'wa'" class="notice notice--ok">
              🧑 Estás atendiendo. Ventana de 24h: {{ windowLeft(selected) }} restantes.
            </p>
            <p v-if="actionError" class="notice notice--error">{{ actionError }}</p>
            <p v-else-if="actionInfo" class="notice">{{ actionInfo }}</p>

            <!-- previsualización de la imagen a enviar -->
            <div v-if="pending" class="attach">
              <img class="attach__thumb" :src="pending.previewUrl" alt="Imagen a enviar">
              <div class="attach__body">
                <div class="attach__name">{{ pending.name }} · {{ fmtBytes(pending.bytes) }}</div>
                <input v-model="caption" class="input" type="text" maxlength="1024" placeholder="Texto opcional (caption)" :disabled="uploading" @keydown.enter.prevent="sendImage">
                <div class="attach__actions">
                  <button class="btn btn--ghost btn--sm" type="button" :disabled="uploading" @click="cancelPending">Cancelar</button>
                  <button class="btn btn--primary btn--sm" type="button" :disabled="uploading || !canType" @click="sendImage">{{ uploading ? 'Enviando…' : 'Enviar imagen' }}</button>
                </div>
              </div>
            </div>

            <div class="composer">
              <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="composer__file" @change="onFileChosen">
              <button class="btn composer__attach" type="button" :disabled="!canType || uploading || sending" title="Adjuntar imagen (JPG, PNG o WebP, máx. 5 MB)" aria-label="Adjuntar imagen" @click="pickFile">📎</button>
              <textarea
                v-model="draft"
                class="composer__input"
                rows="1"
                :placeholder="canType ? 'Escribe una respuesta…' : 'No se puede escribir ahora'"
                :disabled="!canType || sending"
                @keydown="onKeydown"
              />
              <button class="btn btn--primary composer__send" type="button" :disabled="!canType || sending || !draft.trim()" @click="send">
                {{ sending ? '…' : 'Enviar' }}
              </button>
            </div>
          </footer>
        </template>
      </section>
    </div>

    <!-- ===== visor de imagen ===== -->
    <div v-if="lightbox" class="lightbox" role="dialog" aria-label="Imagen ampliada" @click="lightbox = null">
      <img :src="lightbox" alt="Imagen ampliada">
      <button class="lightbox__close" type="button" aria-label="Cerrar" @click.stop="lightbox = null">✕</button>
    </div>
  </div>
</template>

<style scoped>
/* ---------- base ---------- */
.inbox {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  font-family: var(--ff-body);
  color: var(--ink);
}
.inbox__center {
  flex: 1;
  display: grid;
  place-items: center;
  padding: var(--space-4);
}
.spinner {
  width: 28px; height: 28px;
  border: 3px solid var(--line-2);
  border-top-color: var(--purple);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.btn {
  appearance: none;
  border: 1px solid var(--line-2);
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast), border-color var(--dur-fast), opacity var(--dur-fast);
}
.btn:hover { background: var(--hueso); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn--primary { background: var(--purple); border-color: var(--purple); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--purple-d); }
.btn--ghost { border-color: transparent; background: transparent; color: var(--mut); }
.btn--ghost:hover { background: var(--purple-soft); color: var(--ink); }
.btn--sm { padding: 7px 12px; font-size: 13px; }
.btn--block { width: 100%; }
.input {
  width: 100%;
  font: inherit;
  padding: 10px 14px;
  border: 1px solid var(--line-2);
  border-radius: 12px;
  background: #fff;
  color: var(--ink);
}
.input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.input--date { padding: 6px 8px; font-size: 13px; border-radius: 8px; }
.badge {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--purple);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
.tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .3px;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--line);
  color: var(--mut);
}
.tag--bot { background: var(--purple-soft); color: var(--purple-d); }
.tag--humano { background: #E1F7F1; color: #007A68; }
.tag--cerrado { background: var(--line); color: var(--mut); }
.tag--closed { background: #FFF1D6; color: #9A5B00; }
.copy {
  appearance: none;
  border: 1px solid var(--line-2);
  background: #fff;
  color: var(--purple-d);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  cursor: pointer;
}
.copy:hover { background: var(--purple-soft); }

/* ---------- login ---------- */
.login {
  width: min(380px, 100%);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 28px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.login__brand { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.login__k {
  display: grid; place-items: center;
  width: 44px; height: 44px;
  border-radius: 12px;
  background: var(--purple);
  color: #fff;
  font-family: var(--ff-display);
  font-size: 26px;
  line-height: 1;
}
.login__k--sm { width: 28px; height: 28px; font-size: 17px; border-radius: 8px; }
.login__title { font-family: var(--ff-display); font-size: 22px; letter-spacing: .5px; }
.login__sub { font-size: 13px; color: var(--mut); }
.login__label { font-size: 13px; font-weight: 600; color: var(--mut); }
.login__input {
  font: inherit; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 12px;
}
.login__input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.login__error { color: #B00020; font-size: 13px; margin: 0; }
.login__warn { background: #FFF1D6; color: #9A5B00; font-size: 13px; padding: 10px 12px; border-radius: 10px; margin: 0; }

/* ---------- app ---------- */
.inbox__app {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  background: #fff;
}
.list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--line);
  background: #fff;
}
.list__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}
.list__title { display: flex; align-items: center; gap: 8px; font-family: var(--ff-display); font-size: 20px; letter-spacing: .5px; }
.list__tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--line); }
.tab-btn {
  appearance: none; border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 600;
  color: var(--mut); padding: 8px 10px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tab-btn:hover { color: var(--ink); }
.tab-btn.is-active { color: var(--purple-d); border-bottom-color: var(--purple); }
.list__search { padding: 10px 12px; border-bottom: 1px solid var(--line); }
.list__dates { display: flex; align-items: flex-end; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.date { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 11px; font-weight: 600; color: var(--mut); }
.list__warn { margin: 0; padding: 10px 14px; background: #FFF1D6; color: #9A5B00; font-size: 13px; }
.list__items { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
.list__empty { padding: 32px 16px; text-align: center; color: var(--mut); font-size: 14px; }

.item {
  width: 100%;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 14px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: #fff;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.item:hover { background: var(--hueso); }
.item.is-active { background: var(--purple-soft); }
.item.is-unread .item__name, .item.is-unread .item__preview { font-weight: 700; color: var(--ink); }
.item__avatar {
  flex: none;
  display: grid; place-items: center;
  width: 40px; height: 40px;
  border-radius: 50%;
  font-size: 18px;
  background: var(--line);
}
.item__avatar--wa { background: #DDF7E6; }
.item__avatar--msg { background: #DCE9FF; }
.item__avatar--ig { background: #FFE0EE; }
.item__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.item__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.item__row--tags { justify-content: flex-start; gap: 6px; margin-top: 2px; }
.item__name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item__time { flex: none; font-size: 12px; color: var(--mut-2); }
.item__contact { font-size: 12px; color: var(--purple-d); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item__contact--locked { color: var(--mut-2); }
.item__preview { flex: 1; min-width: 0; font-size: 13px; color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- chat ---------- */
.chat { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--hueso); }
.chat__empty { flex: 1; display: grid; place-items: center; text-align: center; color: var(--mut); }
.chat__empty-icon { font-size: 40px; margin-bottom: 8px; }
.chat__head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.chat__back { display: none; font-size: 22px; line-height: 1; padding: 4px 10px; }
.chat__who { flex: 1; min-width: 0; }
.chat__name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat__meta { font-size: 12px; color: var(--mut); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chat__phone { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; user-select: all; }
.chat__locked { color: #9A5B00; font-weight: 600; }
.chat__user { display: inline-flex; align-items: center; gap: 4px; color: var(--purple-d); font-weight: 600; }
.chat__actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.chat__body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex; flex-direction: column; gap: 6px;
}
.chat__loading { display: grid; place-items: center; padding: 40px; }
.day {
  align-self: center;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
  color: var(--mut);
  background: #fff;
  border: 1px solid var(--line);
  padding: 3px 10px; border-radius: 999px;
  margin: 8px 0;
}
.bubble {
  max-width: min(78%, 560px);
  padding: 8px 12px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.bubble--in { align-self: flex-start; border-bottom-left-radius: 4px; }
.bubble--out { align-self: flex-end; border-bottom-right-radius: 4px; background: var(--purple-soft); border-color: var(--purple-line); }
.bubble--agente { background: #E1F7F1; border-color: #BFEDE0; }
.bubble--media { padding: 6px; }
.bubble--media .bubble__text { padding: 4px 6px 0; }
.bubble--media .bubble__meta { padding: 0 6px 2px; }
.bubble__text { white-space: pre-wrap; word-break: break-word; font-size: 14.5px; line-height: 1.4; }
.bubble__note { font-size: 12px; color: #9A5B00; margin-top: 4px; }
.bubble__meta { font-size: 11px; color: var(--mut-2); text-align: right; margin-top: 4px; display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
.bubble__autor { font-weight: 600; color: var(--mut); }
.bubble__dry { background: #FFF1D6; color: #9A5B00; font-weight: 700; padding: 0 6px; border-radius: 999px; }

/* medios */
.media-img { display: block; padding: 0; border: 0; background: transparent; cursor: zoom-in; border-radius: 12px; overflow: hidden; }
.media-img img { display: block; max-width: 100%; max-height: 320px; width: auto; height: auto; object-fit: contain; }
.media-img--sticker img { max-height: 160px; }
.media-audio { display: block; width: 320px; max-width: 100%; }
.bubble--media:has(.media-audio) { min-width: min(340px, 88%); }
.media-video { display: block; max-width: 100%; max-height: 320px; border-radius: 12px; }
.media-doc {
  display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center;
  padding: 8px 10px; border-radius: 12px; background: #fff; border: 1px solid var(--line); color: inherit; text-decoration: none; min-width: 220px;
}
.media-doc__icon { grid-row: 1 / span 2; font-size: 26px; }
.media-doc__name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.media-doc__size { font-size: 12px; color: var(--purple-d); }
.media-loc { display: flex; flex-direction: column; gap: 6px; }
.media-loc__map { width: min(320px, 100%); height: 180px; border: 0; border-radius: 12px; background: var(--line); }
.media-loc__link { font-size: 13px; color: var(--purple-d); font-weight: 600; padding: 0 6px; }

.chat__foot { background: #fff; border-top: 1px solid var(--line); padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); }
.notice { margin: 0 0 8px; font-size: 13px; color: var(--mut); padding: 8px 12px; border-radius: 10px; background: var(--hueso); }
.notice--closed { background: #FFF1D6; color: #9A5B00; font-weight: 600; }
.notice--bot { background: var(--purple-soft); color: var(--purple-d); }
.notice--ok { background: #E1F7F1; color: #007A68; }
.notice--error { background: #FDE7EA; color: #B00020; font-weight: 600; }
.notice__win { margin-left: 6px; font-weight: 400; opacity: .85; }
.attach { display: flex; gap: 12px; align-items: flex-start; padding: 10px; margin: 0 0 8px; border: 1px dashed var(--purple-line); border-radius: 14px; background: var(--purple-soft); }
.attach__thumb { width: 84px; height: 84px; object-fit: cover; border-radius: 10px; background: #fff; flex: none; }
.attach__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.attach__name { font-size: 12px; color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attach__actions { display: flex; gap: 6px; justify-content: flex-end; }
.composer { display: flex; gap: 8px; align-items: flex-end; }
.composer__file { display: none; }
.composer__attach { height: 44px; width: 44px; padding: 0; font-size: 18px; flex: none; }
.composer__input {
  flex: 1;
  font: inherit;
  resize: none;
  min-height: 44px; max-height: 140px;
  padding: 11px 14px;
  border: 1px solid var(--line-2);
  border-radius: 14px;
  background: #fff;
  color: var(--ink);
  field-sizing: content;
}
.composer__input:focus { outline: 2px solid var(--purple-line); border-color: var(--purple); }
.composer__input:disabled { background: var(--hueso); color: var(--mut-2); cursor: not-allowed; }
.composer__send { height: 44px; padding: 0 18px; }

/* visor */
.lightbox { position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, .82); display: grid; place-items: center; padding: 24px; cursor: zoom-out; }
.lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0, 0, 0, .5); }
.lightbox__close { position: absolute; top: 14px; right: 14px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, .15); color: #fff; font-size: 18px; cursor: pointer; }

/* ---------- móvil: lista O chat ---------- */
@media (max-width: 760px) {
  .inbox__app { grid-template-columns: minmax(0, 1fr); }
  .inbox__app.is-list .chat { display: none; }
  .inbox__app.is-chat .list { display: none; }
  .list { border-right: 0; }
  .chat__back { display: inline-block; }
  .chat__actions .btn { padding: 6px 10px; font-size: 12px; }
  .bubble { max-width: 88%; }
}
</style>
