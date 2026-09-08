<script setup lang="ts">
/**
 * /admin — hub de entrada de la administración. Misma contraseña y misma
 * cookie que /admin/inventario y /admin/chats (/api/inbox/login): si ya entró
 * a una, aquí no vuelve a pedirla. Sin sesión muestra el login y, al entrar,
 * cae en esta pantalla. Dos tarjetas grandes, tocables completas.
 */
definePageMeta({ layout: 'inbox' })
useAdminHead('Administración Kustom')

const checking = ref(true)
const authed = ref(false)
const configured = ref(true)
const password = ref('')
const loginError = ref('')
const loggingIn = ref(false)
const sinResponder = ref(0)

interface Me { configured: boolean, authenticated: boolean, sin_responder?: number }

async function checkSession() {
  try {
    const me = await $fetch<Me>('/api/inbox/me')
    configured.value = me.configured
    authed.value = me.authenticated
    sinResponder.value = me.sin_responder ?? 0
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
    // El conteo de sin responder se lee antes de mostrar las tarjetas (así el badge sale de una).
    const me = await $fetch<Me>('/api/inbox/me').catch(() => null)
    sinResponder.value = me?.sin_responder ?? 0
    authed.value = true
  }
  catch (e: any) {
    loginError.value = e?.statusCode === 503 ? 'El panel no está configurado (NUXT_INBOX_PASSWORD).' : 'Contraseña incorrecta.'
  }
  loggingIn.value = false
}
async function logout() {
  await $fetch('/api/inbox/logout', { method: 'POST' }).catch(() => {})
  authed.value = false
}
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  checkSession()
  timer = setInterval(async () => {
    if (!authed.value) return
    const me = await $fetch<Me>('/api/inbox/me').catch(() => null)
    if (me) sinResponder.value = me.sin_responder ?? 0
  }, 60_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="hub">
    <div v-if="checking" class="hub__center"><span class="muted">Cargando…</span></div>

    <!-- ===== login ===== -->
    <div v-else-if="!authed" class="hub__center">
      <form class="login" @submit.prevent="login">
        <div class="login__brand">
          <span class="login__k">K</span>
          <div>
            <div class="login__title">Administración Kustom</div>
            <div class="login__sub">Inventario, precios, fotos y mensajes</div>
          </div>
        </div>
        <p v-if="!configured" class="login__warn">Falta NUXT_INBOX_PASSWORD en el servidor.</p>
        <label class="login__label" for="pw">Contraseña</label>
        <input id="pw" v-model="password" class="login__input" type="password" autocomplete="current-password" required>
        <p v-if="loginError" class="login__error">{{ loginError }}</p>
        <KButton type="submit" variant="primary" block :loading="loggingIn">Entrar</KButton>
      </form>
    </div>

    <!-- ===== hub ===== -->
    <div v-else class="hub__app">
      <header class="hub__top">
        <div class="hub__brand">
          <span class="login__k">K</span>
          <div>
            <h1 class="hub__title">Administración Kustom</h1>
            <p class="hub__sub">Elige a dónde quieres ir</p>
          </div>
        </div>
        <button class="btn btn--ghost" type="button" @click="logout">Salir</button>
      </header>

      <nav class="cards" aria-label="Secciones de administración">
        <NuxtLink class="card card--inv" to="/admin/inventario">
          <span class="card__icon" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
              <path d="M3 7.5 12 12l9-4.5M12 12v9" />
            </svg>
          </span>
          <span class="card__text">
            <span class="card__title">Inventario y precios</span>
            <span class="card__sub">Editar precios, existencias y fotos</span>
          </span>
          <span class="card__go" aria-hidden="true">›</span>
        </NuxtLink>

        <NuxtLink class="card card--msg" to="/admin/chats">
          <span class="card__icon" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path :d="CHAT_ICON_PATH" />
            </svg>
          </span>
          <span class="card__text">
            <span class="card__title">
              Mensajes de clientes
              <span v-if="sinResponder" class="badge" :aria-label="`${sinResponder} sin responder`">{{ sinResponder }}</span>
            </span>
            <span class="card__sub">WhatsApp, Facebook e Instagram<template v-if="sinResponder"> · <b>{{ sinResponder }} sin responder</b></template></span>
          </span>
          <span class="card__go" aria-hidden="true">›</span>
        </NuxtLink>
      </nav>

      <p class="hub__hint muted">Consejo: en el celular, abre el menú del navegador y elige "Agregar a pantalla de inicio" para entrar con un toque.</p>
    </div>
  </div>
</template>

<style scoped>
.hub { --mut: #6B6860; --line: #E6E1D8; min-height: 100dvh; font-family: var(--ff-body, system-ui, sans-serif); color: var(--ink, #111); }
.hub__center { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.muted { color: var(--mut); }

/* login (mismo aspecto que inventario y chats) */
.login { width: min(420px, 100%); display: flex; flex-direction: column; gap: 12px; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 26px; box-shadow: 0 10px 30px rgba(20, 10, 40, .06); }
.login__brand { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.login__k { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--purple); color: #fff; font-family: var(--ff-display); font-size: 26px; line-height: 1; flex: none; }
.login__title { font-family: var(--ff-display); font-size: 22px; letter-spacing: .5px; }
.login__sub { font-size: 13px; color: var(--mut); }
.login__label { font-size: 13px; font-weight: 600; color: var(--mut); }
.login__input { font: inherit; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; }
.login__input:focus { outline: 2px solid var(--purple-line, #D9CCF2); border-color: var(--purple); }
.login__error { color: #B00020; font-size: 13px; margin: 0; }
.login__warn { background: #FFF1D6; color: #9A5B00; font-size: 13px; padding: 10px 12px; border-radius: 10px; margin: 0; }

/* hub */
.hub__app { max-width: 760px; margin: 0 auto; padding: 28px 20px 40px; }
.hub__top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 26px; }
.hub__brand { display: flex; align-items: center; gap: 12px; }
.hub__title { margin: 0; font-family: var(--ff-display); font-size: 24px; letter-spacing: .5px; line-height: 1.1; }
.hub__sub { margin: 2px 0 0; font-size: 14px; color: var(--mut); }
.btn { font: inherit; font-weight: 600; padding: 10px 16px; border-radius: 12px; border: 1px solid transparent; cursor: pointer; }
.btn--ghost { background: #fff; color: var(--purple-d, #6A45AD); border-color: var(--purple-line, #D9CCF2); }

.cards { display: grid; gap: 16px; }
.card { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px; padding: 24px 22px; min-height: 108px; background: #fff; border: 1.5px solid var(--line); border-radius: 20px; text-decoration: none; color: inherit; box-shadow: 0 6px 20px rgba(20, 10, 40, .05); transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
.card:hover, .card:focus-visible { transform: translateY(-2px); border-color: var(--purple); box-shadow: 0 14px 32px rgba(126, 87, 194, .18); outline: none; }
.card:active { transform: translateY(0); }
.card__icon { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 18px; color: #fff; }
.card--inv .card__icon { background: var(--purple); }
.card--msg .card__icon { background: #1E9E63; }
.card__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.card__title { display: flex; align-items: center; gap: 10px; font-family: var(--ff-display); font-size: 22px; letter-spacing: .4px; line-height: 1.15; }
.card__sub { font-size: 14.5px; color: var(--mut); }
.card__sub b { color: #B00020; font-weight: 700; }
.card__go { font-size: 34px; line-height: 1; color: var(--purple); }
.badge { display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 8px; border-radius: 999px; background: #E0192B; color: #fff; font-family: var(--ff-body, system-ui); font-size: 14px; font-weight: 700; letter-spacing: 0; }
.hub__hint { margin: 26px 0 0; font-size: 13.5px; text-align: center; }

@media (prefers-reduced-motion: reduce) { .card { transition: none; } .card:hover { transform: none; } }
@media (max-width: 480px) {
  .hub__app { padding: 22px 16px 32px; }
  .card { gap: 14px; padding: 20px 16px; }
  .card__icon { width: 56px; height: 56px; }
  .card__title { font-size: 20px; }
}
</style>
