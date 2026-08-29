<script setup lang="ts">
/**
 * BANDEJA DE ATENCIÓN HUMANA — /admin/chats
 * Lista de conversaciones (wa/msg/ig) a la izquierda y chat a la derecha; en
 * celular se muestra una u otra. Login con contraseña única (cookie firmada),
 * refresco por polling cada 5 s, respuesta por el adaptador del canal, tomar /
 * devolver al bot, y bloqueo del campo cuando la ventana de 24h de WhatsApp
 * está cerrada.
 */
definePageMeta({ layout: 'inbox' })
useHead({
  title: 'Bandeja de chats — Kustom',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

type Canal = 'wa' | 'msg' | 'ig'
type Estado = 'bot' | 'humano' | 'cerrado'
interface Conv {
  id: number
  canal: Canal
  external_id: string
  nombre: string | null
  ultimo_mensaje: string | null
  ultima_actividad: string
  ultimo_cliente_at: string | null
  estado: Estado
  no_leidos: number
  window_open: boolean
}
interface Msg { id: number, direccion: 'in' | 'out', texto: string, autor: string, created_at: string }

const POLL_MS = 5000
const CANAL: Record<Canal, { label: string, icon: string, cls: string }> = {
  wa: { label: 'WhatsApp', icon: '💬', cls: 'wa' },
  msg: { label: 'Messenger', icon: '📨', cls: 'msg' },
  ig: { label: 'Instagram', icon: '📸', cls: 'ig' },
}
const ESTADO: Record<Estado, string> = { bot: 'Bot', humano: 'Humano', cerrado: 'Cerrada' }

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

// ---------- lista ----------
const convs = ref<Conv[]>([])
const search = ref('')
const listError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(refreshList, 250)
})

async function refreshList() {
  if (!authed.value) return
  try {
    const r = await $fetch<{ conversations: Conv[] }>('/api/inbox/conversations', { query: { q: search.value } })
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
}

const totalUnread = computed(() => convs.value.reduce((n, c) => n + (c.no_leidos || 0), 0))

// ---------- conversación abierta ----------
const selected = ref<Conv | null>(null)
const messages = ref<Msg[]>([])
const loadingConv = ref(false)
const chatBody = ref<HTMLElement | null>(null)
const mobileView = ref<'list' | 'chat'>('list')

async function openConv(id: number) {
  loadingConv.value = true
  mobileView.value = 'chat'
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
function backToList() {
  mobileView.value = 'list'
}

// ---------- acciones ----------
const draft = ref('')
const sending = ref(false)
const actionError = ref('')
const canType = computed(() => !!selected.value && selected.value.estado !== 'cerrado' && selected.value.window_open)

async function send() {
  const conv = selected.value
  const text = draft.value.trim()
  if (!conv || !text || sending.value || !canType.value) return
  sending.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/inbox/conversations/${conv.id}/send`, { method: 'POST', body: { text } })
    draft.value = ''
    await loadConv(conv.id, true)
    await refreshList()
  }
  catch (e: any) {
    onUnauthorized(e)
    const code = e?.statusMessage || e?.data?.statusMessage
    actionError.value = code === 'window_closed'
      ? 'Ventana de 24h cerrada: este cliente debe escribir primero.'
      : code === 'whatsapp_not_configured' || code === 'messenger_not_configured'
        ? 'El canal no está configurado en el servidor.'
        : 'No se pudo enviar. Intenta de nuevo.'
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
onBeforeUnmount(() => clearInterval(timer))

// ---------- formato ----------
function displayName(c: Conv) {
  return c.nombre || (c.canal === 'wa' ? `+${c.external_id}` : `${CANAL[c.canal].label} · ${c.external_id.slice(-6)}`)
}
function contact(c: Conv) {
  return c.canal === 'wa' ? `+${c.external_id}` : `${CANAL[c.canal].label} id ${c.external_id}`
}
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
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}
function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}
function dayOf(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long' })
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
        <div class="list__search">
          <input
            v-model="search"
            type="search"
            class="input"
            placeholder="Buscar por nombre o número"
            aria-label="Buscar conversación"
          >
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
          <li v-if="!convs.length && dbOk && !listError" class="list__empty">
            {{ search ? 'Sin resultados.' : 'Todavía no hay conversaciones.' }}
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
              <div class="chat__meta">{{ contact(selected) }} · <span class="tag" :class="`tag--${selected.estado}`">{{ ESTADO[selected.estado] }}</span></div>
            </div>
            <div class="chat__actions">
              <button v-if="selected.estado !== 'humano'" class="btn btn--primary btn--sm" type="button" @click="setEstado('humano')">Tomar conversación</button>
              <button v-else class="btn btn--sm" type="button" @click="setEstado('bot')">Devolver al bot</button>
              <button v-if="selected.estado !== 'cerrado'" class="btn btn--ghost btn--sm" type="button" title="Cerrar conversación" @click="setEstado('cerrado')">Cerrar</button>
            </div>
          </header>

          <div ref="chatBody" class="chat__body">
            <div v-if="loadingConv && !messages.length" class="chat__loading"><div class="spinner" /></div>
            <template v-for="(m, i) in messages" :key="m.id">
              <div v-if="showDay(i)" class="day">{{ dayOf(m.created_at) }}</div>
              <div class="bubble" :class="[`bubble--${m.direccion}`, `bubble--${m.autor}`]">
                <div class="bubble__text">{{ m.texto }}</div>
                <div class="bubble__meta">
                  <span v-if="m.direccion === 'out'" class="bubble__autor">{{ m.autor === 'bot' ? '🤖 Bot' : '🧑 Tú' }}</span>
                  {{ timeOf(m.created_at) }}
                </div>
              </div>
            </template>
          </div>

          <footer class="chat__foot">
            <p v-if="selected.canal === 'wa' && !selected.window_open" class="notice notice--closed">
              ⏳ Ventana de 24h cerrada: este cliente debe escribir primero.
            </p>
            <p v-else-if="selected.estado === 'cerrado'" class="notice">
              Conversación cerrada. Si el cliente vuelve a escribir, se reabre con el bot.
            </p>
            <p v-else-if="selected.estado === 'bot'" class="notice notice--bot">
              🤖 El bot está atendiendo. Al responder, la conversación pasa a ti automáticamente.
              <span v-if="selected.canal === 'wa'" class="notice__win">Ventana: {{ windowLeft(selected) }} restantes.</span>
            </p>
            <p v-else-if="selected.canal === 'wa'" class="notice notice--ok">
              🧑 Estás atendiendo. Ventana de 24h: {{ windowLeft(selected) }} restantes.
            </p>
            <p v-if="actionError" class="notice notice--error">{{ actionError }}</p>
            <div class="composer">
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
.list__search { padding: 10px 12px; border-bottom: 1px solid var(--line); }
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
.chat__meta { font-size: 12px; color: var(--mut); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
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
.bubble__text { white-space: pre-wrap; word-break: break-word; font-size: 14.5px; line-height: 1.4; }
.bubble__meta { font-size: 11px; color: var(--mut-2); text-align: right; margin-top: 4px; display: flex; gap: 6px; justify-content: flex-end; }
.bubble__autor { font-weight: 600; color: var(--mut); }

.chat__foot { background: #fff; border-top: 1px solid var(--line); padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); }
.notice { margin: 0 0 8px; font-size: 13px; color: var(--mut); padding: 8px 12px; border-radius: 10px; background: var(--hueso); }
.notice--closed { background: #FFF1D6; color: #9A5B00; font-weight: 600; }
.notice--bot { background: var(--purple-soft); color: var(--purple-d); }
.notice--ok { background: #E1F7F1; color: #007A68; }
.notice--error { background: #FDE7EA; color: #B00020; font-weight: 600; }
.notice__win { margin-left: 6px; font-weight: 400; opacity: .85; }
.composer { display: flex; gap: 8px; align-items: flex-end; }
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
