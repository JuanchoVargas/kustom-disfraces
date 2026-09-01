<script setup lang="ts">
import { MOTIVOS_PQRS } from '~~/shared/utils/pqrs'

/**
 * Formulario PQRS (Peticiones, Quejas, Reclamos y Sugerencias). Valida en
 * cliente y servidor; el correo lo envía /api/pqrs (SMTP + acuse al cliente).
 * Anti-spam: honeypot + startedAt (trampa de tiempo) + límite por IP en el
 * servidor. Mismo patrón visual que /mayoristas (tokens de marca).
 */
useHead({
  title: 'PQRS — Kustom Disfraces',
  meta: [
    { name: 'description', content: 'Peticiones, quejas, reclamos y sugerencias de Kustom Disfraces. Cuéntanos tu caso y te respondemos por correo.' },
    { name: 'robots', content: 'noindex, nofollow' }, // formulario: no debe salir en Google
  ],
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTACT_EMAIL = 'contacto@disfraceskustom.com'

const emptyForm = () => ({
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  motivo: '',
  mensaje: '',
  acepta: false,
  website: '', // honeypot (oculto)
})
const form = reactive(emptyForm())

// trampa de tiempo anti-bots: el servidor descarta envíos a <3 s de montar
const startedAt = ref(0)
onMounted(() => { startedAt.value = Date.now() })

const errors = reactive<Record<string, string>>({})
const status = ref<'idle' | 'sending' | 'success' | 'error' | 'not_configured' | 'rate_limited'>('idle')

function validate() {
  for (const k of Object.keys(errors)) delete errors[k]
  if (!form.nombre.trim()) errors.nombre = 'Ingresa tu nombre'
  if (!form.apellido.trim()) errors.apellido = 'Ingresa tu apellido'
  if (!form.email.trim()) errors.email = 'Ingresa tu correo'
  else if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Correo no válido'
  if (!form.telefono.trim()) errors.telefono = 'Ingresa un teléfono de contacto'
  if (!form.motivo) errors.motivo = 'Selecciona el motivo de tu consulta'
  if (!form.mensaje.trim()) errors.mensaje = 'Cuéntanos tu caso'
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
    await $fetch('/api/pqrs', { method: 'POST', body: { ...form, startedAt: startedAt.value } })
    status.value = 'success'
    Object.assign(form, emptyForm()) // limpieza del formulario
  }
  catch (err: unknown) {
    const e = err as { statusCode?: number, data?: { data?: { code?: string, errors?: Record<string, string> } } }
    const code = e?.data?.data?.code
    const serverErrors = e?.data?.data?.errors
    if (code === 'not_configured') {
      status.value = 'not_configured'
    }
    else if (code === 'rate_limited') {
      status.value = 'rate_limited'
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
  <div class="textured pqrs">
    <div class="pwrap">
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
        <h1 class="done__title">¡Recibimos tu solicitud!</h1>
        <p class="done__text">
          Gracias por escribirnos. Te enviamos un correo de confirmación y
          nuestro equipo te responderá lo antes posible.
        </p>
        <KButton variant="primary" to="/">Volver al inicio</KButton>
      </section>

      <!-- ===================== FORMULARIO ===================== -->
      <template v-else>
        <header class="phead">
          <h1 class="ptitle">PQRS</h1>
          <p class="psub">
            Peticiones, quejas, reclamos y sugerencias. Cuéntanos tu caso y
            te responderemos por correo.
          </p>
        </header>

        <p v-if="status === 'not_configured'" class="notice notice--warn" role="alert">
          Estamos activando el envío automático del formulario. Mientras tanto, escríbenos directamente a
          <a :href="`mailto:${CONTACT_EMAIL}`">{{ CONTACT_EMAIL }}</a>.
        </p>
        <p v-else-if="status === 'rate_limited'" class="notice notice--warn" role="alert">
          Has enviado varias solicitudes seguidas. Espera unos minutos e inténtalo de nuevo,
          o escríbenos a <a :href="`mailto:${CONTACT_EMAIL}`">{{ CONTACT_EMAIL }}</a>.
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
              <label for="email">Correo electrónico</label>
              <input
                id="email" v-model="form.email" type="email" inputmode="email" autocomplete="email"
                :aria-invalid="!!errors.email" :class="{ bad: errors.email }"
                @input="clearError('email')"
              >
              <span v-if="errors.email" class="err">{{ errors.email }}</span>
            </div>
            <div class="field">
              <label for="telefono">Teléfono de contacto</label>
              <input
                id="telefono" v-model="form.telefono" type="tel" inputmode="tel" autocomplete="tel"
                :aria-invalid="!!errors.telefono" :class="{ bad: errors.telefono }"
                @input="clearError('telefono')"
              >
              <span v-if="errors.telefono" class="err">{{ errors.telefono }}</span>
            </div>
          </div>

          <div class="field">
            <label for="motivo">Motivo de consulta</label>
            <select
              id="motivo" v-model="form.motivo"
              :aria-invalid="!!errors.motivo" :class="{ bad: errors.motivo, placeholder: !form.motivo }"
              @change="clearError('motivo')"
            >
              <option value="" disabled>Selecciona un motivo</option>
              <option v-for="m in MOTIVOS_PQRS" :key="m" :value="m">{{ m }}</option>
            </select>
            <span v-if="errors.motivo" class="err">{{ errors.motivo }}</span>
          </div>

          <div class="field">
            <label for="mensaje">Mensaje</label>
            <textarea
              id="mensaje" v-model="form.mensaje" rows="5"
              placeholder="Cuéntanos tu petición, queja, reclamo o sugerencia"
              :aria-invalid="!!errors.mensaje" :class="{ bad: errors.mensaje }"
              @input="clearError('mensaje')"
            />
            <span v-if="errors.mensaje" class="err">{{ errors.mensaje }}</span>
          </div>

          <div class="field field--check">
            <label class="check">
              <input v-model="form.acepta" type="checkbox" @change="clearError('acepta')">
              <span>
                He leído y acepto la
                <NuxtLink to="/politica-datos">política de tratamiento de datos</NuxtLink>.
              </span>
            </label>
            <span v-if="errors.acepta" class="err">{{ errors.acepta }}</span>
          </div>

          <KButton type="submit" variant="primary" size="lg" :loading="status === 'sending'">
            Enviar
          </KButton>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pqrs { min-height: 60vh; }
.pwrap {
  max-width: 680px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5) var(--space-8);
}

/* ---------- cabecera ---------- */
.phead { margin-bottom: var(--space-6); text-align: center; }
.ptitle {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  line-height: 1.05;
  color: var(--ink);
}
.psub {
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
.field select,
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
.field select { cursor: pointer; appearance: auto; }
.field select.placeholder { color: var(--mut-2); }
.field select option { color: var(--ink); }
.field textarea { resize: vertical; min-height: 110px; }
.field input:focus,
.field select:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--purple);
  box-shadow: 0 0 0 3px var(--purple-soft);
}
.field input.bad,
.field select.bad,
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
  .ptitle { font-size: var(--text-2xl); }
}
@media (prefers-reduced-motion: reduce) {
  .done__ko { animation: none; }
  .field input, .field select, .field textarea { transition: none; }
}
</style>
