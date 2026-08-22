<script setup lang="ts">
/**
 * Paso de datos del comprador antes de pagar (Fase 5). Se llega desde el botón
 * "Pagar con Mercado Pago" del carrito/drawer. Captura los datos para factura
 * electrónica + envío y, al enviar, crea la preferencia de MP con esos datos
 * (vía metadata) y redirige a la pantalla de pago. WhatsApp NO pasa por aquí.
 */
const cart = useCartStore()
const router = useRouter()
const { pay, loading, error: payError } = useMercadoPago()

useHead({
  title: 'Datos de tu compra — Kustom Disfraces',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const form = reactive<CheckoutBuyer>({
  nombre: '',
  tipoDocumento: 'CC',
  documento: '',
  email: '',
  telefono: '',
  pais: DEFAULT_PAIS,
  departamento: '',
  ciudad: '',
  localidad: '',
  barrio: '',
  direccion: '',
  notas: '',
})
const acepta = ref(false)
const errors = reactive<Record<string, string>>({})

function clearError(field: string) {
  if (errors[field]) delete errors[field]
}

// Campos obligatorios para habilitar el pago (envío + contacto). Tipo/número de
// documento y notas quedan OPCIONALES (solo sirven para la factura electrónica).
function validate() {
  for (const k of Object.keys(errors)) delete errors[k]
  if (!form.nombre.trim()) errors.nombre = 'Ingresa tu nombre completo'
  if (!form.email.trim()) errors.email = 'Ingresa tu correo'
  else if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Correo no válido'
  if (!form.telefono.trim()) errors.telefono = 'Ingresa tu celular'
  if (!form.pais.trim()) errors.pais = 'Ingresa tu país'
  if (!form.departamento) errors.departamento = 'Selecciona tu departamento'
  if (!form.ciudad.trim()) errors.ciudad = 'Ingresa tu ciudad'
  if (!form.localidad.trim()) errors.localidad = 'Ingresa tu localidad / zona'
  if (!form.barrio.trim()) errors.barrio = 'Ingresa tu barrio'
  if (!form.direccion.trim()) errors.direccion = 'Ingresa tu dirección'
  if (!acepta.value) errors.acepta = 'Debes aceptar la política de datos'
  return Object.keys(errors).length === 0
}

async function onSubmit() {
  if (!validate()) {
    // Enfoca el primer campo con error
    const first = Object.keys(errors)[0]
    if (first && import.meta.client) document.getElementById(`f-${first}`)?.focus()
    return
  }
  // pay() crea la preferencia con los datos y redirige a Mercado Pago.
  await pay({ ...form, nombre: form.nombre.trim(), documento: form.documento.trim(), email: form.email.trim() })
}
</script>

<template>
  <div class="textured">
    <div class="co">
      <Breadcrumb :items="[{ label: 'Inicio', to: '/' }, { label: 'Carrito', to: '/carrito' }, { label: 'Datos de compra' }]" />
      <h1 class="co__title">Tus datos para la compra</h1>

      <!-- carrito vacío -->
      <div v-if="!cart.items.length" class="co__empty">
        <p>Tu carrito está vacío.</p>
        <KButton variant="turq" to="/categoria/ninos">Ver catálogo</KButton>
      </div>

      <div v-else class="co__layout">
        <!-- ---------- FORMULARIO ---------- -->
        <form class="form" novalidate @submit.prevent="onSubmit">
          <p class="form__intro">Necesitamos estos datos para tu <strong>factura electrónica</strong> y el <strong>envío</strong>.</p>

          <div class="field">
            <label for="f-nombre">Nombre completo *</label>
            <input id="f-nombre" v-model="form.nombre" type="text" autocomplete="name" :class="{ err: errors.nombre }" @input="clearError('nombre')">
            <span v-if="errors.nombre" class="msg">{{ errors.nombre }}</span>
          </div>

          <div class="row2">
            <div class="field field--doc">
              <label for="f-tipoDocumento">Tipo doc. <span class="opt">(opcional)</span></label>
              <select id="f-tipoDocumento" v-model="form.tipoDocumento">
                <option v-for="t in TIPOS_DOCUMENTO" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div class="field">
              <label for="f-documento">Número de documento <span class="opt">(opcional, para factura)</span></label>
              <input id="f-documento" v-model="form.documento" type="text" inputmode="numeric">
            </div>
          </div>

          <div class="row2">
            <div class="field">
              <label for="f-pais">País *</label>
              <input id="f-pais" v-model="form.pais" type="text" autocomplete="country-name" :class="{ err: errors.pais }" @input="clearError('pais')">
              <span v-if="errors.pais" class="msg">{{ errors.pais }}</span>
            </div>
            <div class="field">
              <label for="f-departamento">Departamento *</label>
              <select id="f-departamento" v-model="form.departamento" :class="{ err: errors.departamento }" @change="clearError('departamento')">
                <option value="" disabled>Selecciona…</option>
                <option v-for="d in DEPARTAMENTOS_CO" :key="d" :value="d">{{ d }}</option>
              </select>
              <span v-if="errors.departamento" class="msg">{{ errors.departamento }}</span>
            </div>
          </div>

          <div class="row2">
            <div class="field">
              <label for="f-ciudad">Ciudad *</label>
              <input id="f-ciudad" v-model="form.ciudad" type="text" autocomplete="address-level2" :class="{ err: errors.ciudad }" @input="clearError('ciudad')">
              <span v-if="errors.ciudad" class="msg">{{ errors.ciudad }}</span>
            </div>
            <div class="field">
              <label for="f-localidad">Localidad / Zona *</label>
              <input id="f-localidad" v-model="form.localidad" type="text" placeholder="Ej: Suba, Chapinero" :class="{ err: errors.localidad }" @input="clearError('localidad')">
              <span v-if="errors.localidad" class="msg">{{ errors.localidad }}</span>
            </div>
          </div>

          <div class="field">
            <label for="f-barrio">Barrio *</label>
            <input id="f-barrio" v-model="form.barrio" type="text" :class="{ err: errors.barrio }" @input="clearError('barrio')">
            <span v-if="errors.barrio" class="msg">{{ errors.barrio }}</span>
          </div>

          <div class="field">
            <label for="f-direccion">Dirección *</label>
            <input id="f-direccion" v-model="form.direccion" type="text" autocomplete="street-address" placeholder="Calle 00 # 00-00, indicaciones adicionales" :class="{ err: errors.direccion }" @input="clearError('direccion')">
            <span v-if="errors.direccion" class="msg">{{ errors.direccion }}</span>
          </div>

          <div class="row2">
            <div class="field">
              <label for="f-email">Correo *</label>
              <input id="f-email" v-model="form.email" type="email" autocomplete="email" :class="{ err: errors.email }" @input="clearError('email')">
              <span v-if="errors.email" class="msg">{{ errors.email }}</span>
            </div>
            <div class="field">
              <label for="f-telefono">Celular *</label>
              <input id="f-telefono" v-model="form.telefono" type="tel" autocomplete="tel" :class="{ err: errors.telefono }" @input="clearError('telefono')">
              <span v-if="errors.telefono" class="msg">{{ errors.telefono }}</span>
            </div>
          </div>

          <div class="field">
            <label for="f-notas">Notas del pedido <span class="opt">(opcional)</span></label>
            <textarea id="f-notas" v-model="form.notas" rows="2" placeholder="Ej: talla de referencia, punto de entrega, etc." />
          </div>

          <label class="check" :class="{ err: errors.acepta }">
            <input type="checkbox" v-model="acepta" @change="clearError('acepta')">
            <span>Acepto la <NuxtLink to="/politica-datos" target="_blank">política de tratamiento de datos</NuxtLink>. *</span>
          </label>
          <span v-if="errors.acepta" class="msg msg--check">{{ errors.acepta }}</span>

          <p v-if="payError" class="payerr" role="alert">{{ payError }}</p>

          <KButton type="submit" variant="primary" size="lg" block :loading="loading">
            Continuar al pago
          </KButton>
          <p class="form__note">Al continuar irás a la pantalla segura de Mercado Pago.</p>
        </form>

        <!-- ---------- RESUMEN ---------- -->
        <aside class="summary">
          <h2 class="summary__title">Tu pedido</h2>
          <ul class="summary__items">
            <li v-for="(it, i) in cart.items" :key="i" class="si">
              <div class="si__img">
                <NuxtImg v-if="it.image" :src="it.image" :alt="it.name" width="104" height="104" densities="1x 2x" fit="contain" />
              </div>
              <div class="si__info">
                <p class="si__name">{{ it.name }}</p>
                <p class="si__meta">Talla {{ it.size }}<template v-if="it.gama"> · {{ it.gama }}</template> · x{{ it.quantity }}</p>
              </div>
              <strong class="si__price">{{ formatCOP(it.price * it.quantity) }}</strong>
            </li>
          </ul>
          <div class="summary__total">
            <span>Total</span>
            <strong>{{ formatCOP(cart.subtotal) }}</strong>
          </div>
          <p class="summary__ship">El envío se coordina tras la compra.</p>
          <NuxtLink to="/carrito" class="summary__back">← Volver al carrito</NuxtLink>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.co { max-width: 1080px; margin: 0 auto; padding: var(--space-5); }
.co__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  color: var(--ink);
  margin: var(--space-4) 0 var(--space-5);
}
.co__empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); padding: var(--space-7); }
.co__layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: var(--space-6);
  align-items: start;
}

/* ---------- formulario ---------- */
.form {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.form__intro { font-size: 13.5px; color: var(--mut); }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field label, .check { font-size: 13px; font-weight: 600; color: var(--ink); }
.opt { font-weight: 400; color: var(--mut-2); }
.field input, .field select, .field textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--ff-body);
  font-size: 14px;
  padding: 10px 12px;
  border: 1.5px solid var(--line-2);
  border-radius: var(--r-sm);
  background: #fff;
  color: var(--ink);
}
.field input:focus, .field select:focus, .field textarea:focus {
  outline: none;
  border-color: var(--turq);
}
.field .err { border-color: var(--fucsia); }
.msg { font-size: 12px; color: var(--fucsia); }
.msg--check { margin-top: -8px; }
.check { display: flex; align-items: flex-start; gap: 8px; font-weight: 400; font-size: 13px; color: var(--ink); cursor: pointer; }
.check input { margin-top: 2px; }
.check a { color: var(--purple); text-decoration: underline; }
.check.err span { color: var(--fucsia); }
.payerr { font-size: 13px; color: var(--fucsia); text-align: center; }
.form__note { font-size: 12px; color: var(--mut-2); text-align: center; margin-top: -4px; }

/* doc + número en una fila: 30/70 (el select es corto, el número necesita más espacio) */
.row2:has(.field--doc) { grid-template-columns: 30% 1fr; }

/* ---------- resumen ---------- */
.summary {
  position: sticky;
  top: var(--space-4);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.summary__title { font-family: var(--ff-display); font-weight: 400; font-size: var(--text-lg); }
.summary__items { list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
.si { display: flex; gap: 10px; align-items: center; }
.si__img { width: 104px; height: 104px; flex-shrink: 0; border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; background: #fff; }
.si__img img { width: 100%; height: 100%; object-fit: contain; display: block; }
.si__info { flex: 1; min-width: 0; }
.si__name { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.25; }
.si__meta { font-size: 11.5px; color: var(--mut-2); margin-top: 2px; }
.si__price { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.summary__total {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: var(--text-lg); font-weight: 700;
  padding-top: var(--space-3); border-top: 1px solid var(--line);
}
.summary__total strong { color: var(--purple); font-variant-numeric: tabular-nums; }
.summary__ship { font-size: 12px; color: var(--mut-2); }
.summary__back { font-size: 13px; font-weight: 600; color: var(--purple); text-decoration: none; }
.summary__back:hover { color: var(--purple-d); }

@media (max-width: 860px) {
  .co__layout { grid-template-columns: 1fr; }
  .summary { position: static; order: -1; }
}
@media (max-width: 480px) {
  .row2 { grid-template-columns: 1fr; }
  /* en móvil apila igual que el resto de filas: el select angosto lado a lado
     con el número de documento es lo que rompía el formulario */
  .row2:has(.field--doc) { grid-template-columns: 1fr; }
}
</style>
