<script setup lang="ts">
/**
 * Formulario de ventas al por mayor. Valida en cliente y servidor; el envío del
 * correo lo hace /api/mayoristas (SMTP). Mientras el SMTP no esté configurado,
 * el endpoint responde 503 y aquí mostramos un fallback con el correo directo.
 */
useHead({
  title: 'Ventas al por mayor — Kustom Disfraces',
  meta: [{ name: 'description', content: 'Compra al por mayor con Kustom Disfraces. Déjanos tus datos y nuestro equipo comercial te contactará.' }],
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTACT_EMAIL = 'contacto@disfraceskustom.com'

const form = reactive({
  nombre: '',
  apellido: '',
  telefono: '',
  email: '',
  ciudad: '',
  mensaje: '',
  acepta: false,
  website: '', // honeypot (oculto)
})

const errors = reactive<Record<string, string>>({})
const status = ref<'idle' | 'sending' | 'success' | 'error' | 'not_configured'>('idle')

function validate() {
  for (const k of Object.keys(errors)) delete errors[k]
  if (!form.nombre.trim()) errors.nombre = 'Ingresa tu nombre'
  if (!form.apellido.trim()) errors.apellido = 'Ingresa tu apellido'
  if (!form.telefono.trim()) errors.telefono = 'Ingresa un teléfono de contacto'
  if (!form.email.trim()) errors.email = 'Ingresa tu correo'
  else if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Correo no válido'
  if (!form.ciudad.trim()) errors.ciudad = 'Ingresa tu ciudad'
  if (!form.mensaje.trim()) errors.mensaje = 'Cuéntanos qué necesitas'
  if (!form.acepta) errors.acepta = 'Debes aceptar la política de tratamiento de datos'
  return Object.keys(errors).length === 0
}

function clearError(field: string) {
  if (errors[field]) delete errors[field]
}

async function onSubmit() {
  if (!validate()) return
  status.value = 'sending'
  try {
    await $fetch('/api/mayoristas', { method: 'POST', body: { ...form } })
    status.value = 'success'
  }
  catch (err: unknown) {
    const e = err as { statusCode?: number, data?: { data?: { code?: string, errors?: Record<string, string> } } }
    const code = e?.data?.data?.code
    const serverErrors = e?.data?.data?.errors
    if (code === 'not_configured') {
      status.value = 'not_configured'
    }
    else if (serverErrors) {
      Object.assign(errors, serverErrors)
      status.value = 'idle'
    }
    else {
      status.value = 'error'
    }
  }
}

const reduced = usePreferredReducedMotion()
const isReduced = computed(() => reduced.value === 'reduce')
</script>

<template>
  <div class="textured mayoristas">
    <div class="mwrap">
      <!-- ===================== ÉXITO ===================== -->
      <section v-if="status === 'success'" class="done">
        <img
          src="/images/ko/ko-paz.webp"
          alt=""
          aria-hidden="true"
          class="done__ko"
          :class="{ 'done__ko--still': isReduced }"
          width="150"
          height="268"
        >
        <h1 class="done__title">¡Recibimos tus datos!</h1>
        <p class="done__text">Gracias por escribirnos. Nuestro equipo comercial te contactará pronto.</p>
        <KButton variant="primary" to="/">Volver al inicio</KButton>
      </section>

      <!-- ===================== FORMULARIO ===================== -->
      <template v-else>
        <header class="mhead">
          <h1 class="mtitle">VENTAS AL POR MAYOR</h1>
          <p class="msub">Ingresa tus datos y nuestro equipo comercial se pondrá en contacto contigo</p>
        </header>

        <p v-if="status === 'not_configured'" class="notice notice--warn" role="alert">
          Estamos activando el envío automático del formulario. Mientras tanto, escríbenos directamente a
          <a :href="`mailto:${CONTACT_EMAIL}`">{{ CONTACT_EMAIL }}</a>.
        </p>
        <p v-else-if="status === 'error'" class="notice notice--err" role="alert">
          No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos a
          <a :href="`mailto:${CONTACT_EMAIL}`">{{ CONTACT_EMAIL }}</a>.
        </p>

        <form class="form" novalidate @submit.prevent="onSubmit">
          <!-- honeypot: oculto para humanos, cebo para bots -->
          <div class="hp" aria-hidden="true">
            <label>No llenar<input v-model="form.website" type="text" tabindex="-1" autocomplete="off"></label>
          </div>

          <div class="row">
            <div class="field">
              <label for="nombre">Nombre</label>
              <input
                id="nombre" v-model="form.nombre" type="text" autocomplete="given-name"
                :aria-invalid="!!errors.nombre" :class="{ bad: errors.nombre }"
                @input="clearError('nombre')"
              >
              <span v-if="errors.nombre" class="err">{{ errors.nombre }}</span>
            </div>
            <div class="field">
              <label for="apellido">Apellido</label>
              <input
                id="apellido" v-model="form.apellido" type="text" autocomplete="family-name"
                :aria-invalid="!!errors.apellido" :class="{ bad: errors.apellido }"
                @input="clearError('apellido')"
              >
              <span v-if="errors.apellido" class="err">{{ errors.apellido }}</span>
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label for="telefono">Teléfono de contacto</label>
              <input
                id="telefono" v-model="form.telefono" type="tel" inputmode="tel" autocomplete="tel"
                :aria-invalid="!!errors.telefono" :class="{ bad: errors.telefono }"
                @input="clearError('telefono')"
              >
              <span v-if="errors.telefono" class="err">{{ errors.telefono }}</span>
            </div>
            <div class="field">
              <label for="email">Correo electrónico</label>
              <input
                id="email" v-model="form.email" type="email" inputmode="email" autocomplete="email"
                :aria-invalid="!!errors.email" :class="{ bad: errors.email }"
                @input="clearError('email')"
              >
              <span v-if="errors.email" class="err">{{ errors.email }}</span>
            </div>
          </div>

          <div class="field">
            <label for="ciudad">Ciudad</label>
            <input
              id="ciudad" v-model="form.ciudad" type="text" autocomplete="address-level2"
              :aria-invalid="!!errors.ciudad" :class="{ bad: errors.ciudad }"
              @input="clearError('ciudad')"
            >
            <span v-if="errors.ciudad" class="err">{{ errors.ciudad }}</span>
          </div>

          <div class="field">
            <label for="mensaje">Mensaje</label>
            <textarea
              id="mensaje" v-model="form.mensaje" rows="4"
              placeholder="Cuéntanos qué productos y cantidades te interesan"
              :aria-invalid="!!errors.mensaje" :class="{ bad: errors.mensaje }"
              @input="clearError('mensaje')"
            />
            <span v-if="errors.mensaje" class="err">{{ errors.mensaje }}</span>
          </div>

          <div class="field field--check">
            <label class="check">
              <input v-model="form.acepta" type="checkbox" @change="clearError('acepta')">
              <span>
                Tus datos personales se utilizarán para procesar tu solicitud y otros propósitos
                descritos en nuestra
                <NuxtLink to="/politica-datos">política de privacidad</NuxtLink>.
              </span>
            </label>
            <span v-if="errors.acepta" class="err">{{ errors.acepta }}</span>
          </div>

          <KButton type="submit" variant="primary" size="lg" :loading="status === 'sending'">
            Enviar solicitud
          </KButton>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mayoristas { min-height: 60vh; }
.mwrap {
  max-width: 680px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5) var(--space-8);
}

/* ---------- cabecera ---------- */
.mhead { margin-bottom: var(--space-6); text-align: center; }
.mtitle {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  line-height: 1.05;
  color: var(--ink);
}
.msub {
  margin-top: var(--space-3);
  color: var(--mut);
  font-size: var(--text-lg);
  line-height: 1.5;
}

/* ---------- avisos ---------- */
.notice {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--r-md);
  font-size: var(--text-sm);
  margin-bottom: var(--space-5);
}
.notice a { color: inherit; font-weight: 700; }
.notice--warn { background: #FFF6E0; border: 1px solid var(--yellow); color: #6a4e00; }
.notice--err { background: #FDEAEA; border: 1px solid #F3B4B4; color: #8a1f1f; }

/* ---------- formulario ---------- */
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--space-6);
  box-shadow: var(--shadow-card);
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.field { display: flex; flex-direction: column; gap: 6px; }
.field label {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--ink);
}
.field input,
.field textarea {
  font-family: var(--ff-body);
  font-size: var(--text-md);
  color: var(--ink);
  background: #fff;
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
  padding: 11px 13px;
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.field textarea { resize: vertical; min-height: 96px; }
.field input:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--purple);
  box-shadow: 0 0 0 3px var(--purple-soft);
}
.field input.bad,
.field textarea.bad { border-color: #d64545; }
.err { color: #c62828; font-size: 12.5px; font-weight: 600; }

/* checkbox de política */
.field--check { gap: 8px; }
.check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--mut);
  cursor: pointer;
}
.check input {
  margin-top: 2px;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: var(--purple);
  cursor: pointer;
}
.check a { color: var(--purple); font-weight: 600; text-decoration: none; }
.check a:hover { text-decoration: underline; }

/* honeypot: fuera de pantalla, sin display:none (algunos bots lo saltan) */
.hp {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

/* ---------- éxito ---------- */
.done {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  padding: var(--space-7) var(--space-4);
}
.done__ko {
  width: 150px;
  height: auto;
  margin-bottom: var(--space-2);
  animation: ko-float 4.5s var(--ease-out) infinite;
}
.done__ko--still { animation: none; }
.done__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  color: var(--ink);
}
.done__text {
  color: var(--mut);
  font-size: var(--text-md);
  line-height: 1.55;
  max-width: 44ch;
  margin-bottom: var(--space-2);
}
@keyframes ko-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
}

@media (max-width: 560px) {
  .row { grid-template-columns: 1fr; }
  .form { padding: var(--space-5); }
  .mtitle { font-size: var(--text-2xl); }
}
@media (prefers-reduced-motion: reduce) {
  .done__ko { animation: none; }
  .field input, .field textarea { transition: none; }
}
</style>
