<script setup lang="ts">
import { FREE_SHIPPING_THRESHOLD } from '~/stores/cart'

/**
 * Drawer lateral del carrito. Se abre desde el ícono del navbar y al
 * agregar un producto. Cierra con X, Escape u overlay. La animación de
 * entrada respeta prefers-reduced-motion (CSS).
 */
const cart = useCartStore()
const { contact } = useSiteNav()
const { products } = useProducts()

// ---- upsell "Completa tu disfraz" (lógica PROVISIONAL en utils/relatedProducts.ts) ----
// El botón de cada sugerido NAVEGA a su PDP (cerrando el drawer): la talla se
// elige allá. En Fase D, con variaciones reales de Woo, se evaluará volver a
// "añadir directo" con un selector de talla inline en la propia fila.
const suggestions = computed(() => relatedForCart(cart.items, products, 3))

const panel = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLElement | null>(null)

// Escape para cerrar (solo mientras está abierto)
onKeyStroke('Escape', () => { if (cart.drawerOpen) cart.closeDrawer() })

// Bloquear el scroll del fondo y enfocar el botón de cierre al abrir
watch(() => cart.drawerOpen, (open) => {
  if (import.meta.client) document.documentElement.style.overflow = open ? 'hidden' : ''
  if (open) nextTick(() => closeBtn.value?.focus())
})

// ---- envío gratis (umbral PROVISIONAL, ver stores/cart.ts) ----
const shippingProgress = computed(() => Math.min(1, cart.subtotal / FREE_SHIPPING_THRESHOLD))
const shippingRemaining = computed(() => Math.max(0, FREE_SHIPPING_THRESHOLD - cart.subtotal))
const hasFreeShipping = computed(() => shippingRemaining.value === 0)

const waCheckout = computed(() => {
  const lines = cart.items.map(i => `• ${i.name} (talla ${i.size}${i.gama ? `, ${i.gama}` : ''}) x${i.quantity}`).join('\n')
  const text = `Hola, quiero finalizar mi pedido:\n${lines}\n\nSubtotal: ${formatCOP(cart.subtotal)}`
  return `${contact.whatsapp}?text=${encodeURIComponent(text)}`
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="cart.drawerOpen" class="cd" role="dialog" aria-modal="true" aria-label="Tu carrito">
        <div class="cd__overlay" @click="cart.closeDrawer()" />

        <aside ref="panel" class="cd__panel">
          <!-- ---------- header ---------- -->
          <header class="cd__head">
            <h2 class="cd__title">Tu carrito <span v-if="cart.count" class="cd__count">({{ cart.count }})</span></h2>
            <button ref="closeBtn" type="button" class="cd__close" aria-label="Cerrar carrito" @click="cart.closeDrawer()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <!-- ---------- envío gratis ---------- -->
          <div v-if="cart.items.length" class="cd__ship" :class="{ ok: hasFreeShipping }">
            <p class="cd__shiptext">
              <template v-if="hasFreeShipping">🎉 ¡Tienes <strong>envío gratis</strong>!</template>
              <template v-else>Te faltan <strong>{{ formatCOP(shippingRemaining) }}</strong> para el envío gratis</template>
            </p>
            <div class="cd__bar" role="progressbar" :aria-valuenow="Math.round(shippingProgress * 100)" aria-valuemin="0" aria-valuemax="100">
              <div class="cd__fill" :style="{ width: `${shippingProgress * 100}%` }" />
            </div>
          </div>

          <!-- ---------- items ---------- -->
          <div class="cd__body">
            <div v-if="!cart.items.length" class="cd__empty">
              <img src="/images/ko/ko-caja.webp" alt="" class="cd__ko">
              <p class="cd__emptymsg">Tu carrito está vacío.</p>
              <KButton variant="primary" size="sm" to="/categoria/ninos" @click="cart.closeDrawer()">Ver catálogo</KButton>
            </div>

            <ul v-else class="cd__items">
              <li v-for="(it, i) in cart.items" :key="i" class="ci">
                <NuxtLink :to="`/producto/${it.slug}`" class="ci__img" @click="cart.closeDrawer()">
                  <img v-if="it.image" :src="it.image" :alt="it.name">
                </NuxtLink>
                <div class="ci__info">
                  <NuxtLink :to="`/producto/${it.slug}`" class="ci__name" @click="cart.closeDrawer()">{{ it.name }}</NuxtLink>
                  <p class="ci__meta">Talla {{ it.size }}<template v-if="it.gama"> · {{ it.gama }}</template></p>
                  <div class="ci__row">
                    <div class="ci__qty">
                      <button type="button" aria-label="Restar una unidad" @click="cart.setQty(i, it.quantity - 1)">−</button>
                      <span>{{ it.quantity }}</span>
                      <button type="button" aria-label="Sumar una unidad" @click="cart.setQty(i, it.quantity + 1)">+</button>
                    </div>
                    <strong class="ci__price">{{ formatCOP(it.price * it.quantity) }}</strong>
                  </div>
                </div>
                <button type="button" class="ci__remove" aria-label="Eliminar del carrito" @click="cart.remove(i)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />
                  </svg>
                </button>
              </li>
            </ul>

            <!-- ---------- upsell "Completa tu disfraz" ---------- -->
            <section v-if="cart.items.length && suggestions.length" class="up" aria-label="Sugerencias para completar tu disfraz">
              <h3 class="up__title">Completa tu disfraz</h3>
              <div class="up__row">
                <article v-for="s in suggestions" :key="s.slug" class="up__card">
                  <NuxtLink :to="`/producto/${s.slug}`" class="up__img" @click="cart.closeDrawer()">
                    <img :src="s.images?.[0]" :alt="s.name">
                  </NuxtLink>
                  <p class="up__name">{{ s.name }}</p>
                  <p class="up__price">{{ formatCOP(s.price) }}</p>
                  <NuxtLink :to="`/producto/${s.slug}`" class="up__add" :aria-label="`Ver ${s.name}`" @click="cart.closeDrawer()">
                    Ver
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </NuxtLink>
                </article>
              </div>
            </section>
          </div>

          <!-- ---------- subtotal sticky ---------- -->
          <footer v-if="cart.items.length" class="cd__foot">
            <div class="cd__subtotal">
              <span>Subtotal</span>
              <strong>{{ formatCOP(cart.subtotal) }}</strong>
            </div>
            <p class="cd__note">El envío se calcula al finalizar</p>
            <KButton variant="whatsapp" size="lg" block :to="waCheckout">
              <template #icon-left>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 0 1 6.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1 1 12 3.8zm-3 3.6c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 2.3 1 2.8.8 3.3.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.2-.5-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.2 0-.4.1-.5l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.4-.5-.6-.5z"/>
                </svg>
              </template>
              Finalizar por WhatsApp
            </KButton>
            <NuxtLink to="/carrito" class="cd__full" @click="cart.closeDrawer()">Ver carrito completo</NuxtLink>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cd {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.cd__overlay {
  position: absolute;
  inset: 0;
  background: rgba(17, 17, 17, 0.45);
}
.cd__panel {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: min(420px, 92vw);
  background: #fff;
  box-shadow: var(--shadow-lift);
  display: flex;
  flex-direction: column;
}

/* ---------- header ---------- */
.cd__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
}
.cd__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-xl);
  color: var(--ink);
}
.cd__count {
  color: var(--mut-2);
  font-size: var(--text-md);
}
.cd__close {
  width: 36px;
  height: 36px;
  border: 1px solid var(--line-2);
  border-radius: 50%;
  background: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--ink);
}
.cd__close:hover { background: var(--hueso); }
.cd__close:focus-visible { outline: 2px solid var(--turq); outline-offset: 2px; }

/* ---------- envío gratis ---------- */
.cd__ship {
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--hueso);
}
.cd__shiptext {
  font-size: 12.5px;
  color: var(--mut);
  margin-bottom: 8px;
}
.cd__shiptext strong { color: var(--ink); }
.cd__ship.ok .cd__shiptext { color: var(--ink); }
.cd__bar {
  height: 7px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.cd__fill {
  height: 100%;
  border-radius: 999px;
  background: var(--turq);
  transition: width 0.35s var(--ease-out);
}
.cd__ship.ok .cd__fill { background: var(--lima); }

/* ---------- items ---------- */
.cd__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 20px;
}
.cd__items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
}
.ci {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
  position: relative;
}
.ci:last-child { border-bottom: 0; }
.ci__img {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: #fff;
}
.ci__img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.ci__info { flex: 1; min-width: 0; }
.ci__name {
  display: block;
  font-weight: 600;
  font-size: 13.5px;
  color: var(--ink);
  text-decoration: none;
  line-height: 1.25;
  padding-right: 22px;
}
.ci__name:hover { color: var(--purple); }
.ci__meta {
  font-size: 11.5px;
  color: var(--mut-2);
  margin: 3px 0 8px;
}
.ci__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ci__qty {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 2px;
}
.ci__qty button {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: 15px;
  cursor: pointer;
  color: var(--ink);
  display: grid;
  place-items: center;
  font-family: var(--ff-body);
}
.ci__qty button:hover { background: var(--hueso); }
.ci__qty span {
  min-width: 22px;
  text-align: center;
  font-weight: 700;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.ci__price {
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}
.ci__remove {
  position: absolute;
  top: 14px;
  right: 0;
  border: 0;
  background: none;
  color: var(--mut-2);
  cursor: pointer;
  padding: 2px;
}
.ci__remove:hover { color: var(--fucsia); }

/* ---------- upsell ---------- */
.up {
  margin-top: var(--space-2);
  padding: var(--space-4) 0 var(--space-3);
  border-top: 1px solid var(--line);
}
/* heading secundario: no compite con el título display del drawer */
.up__title {
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--mut);
  margin-bottom: var(--space-3);
}
.up__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
}
.up__card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.up__img {
  display: block;
  aspect-ratio: 1;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: #fff;
}
.up__img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.up__name {
  font-weight: 600;
  font-size: 11.5px;
  line-height: 1.25;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.5em;
}
.up__price {
  font-weight: 700;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.up__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: 11px;
  color: var(--ink);
  background: #fff;
  border: 1.5px solid var(--line-2);
  border-radius: var(--r-pill);
  padding: 5px 0;
  cursor: pointer;
  margin-top: 2px;
  text-decoration: none;
}
.up__add:hover {
  border-color: var(--turq);
  color: var(--turq-d);
}
.up__add:focus-visible {
  outline: 2px solid var(--turq);
  outline-offset: 2px;
}

/* ---------- vacío ---------- */
.cd__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 48px 12px;
}
.cd__ko { height: 130px; width: auto; }
.cd__emptymsg { color: var(--mut); font-size: var(--text-md); }

/* ---------- footer sticky ---------- */
.cd__foot {
  border-top: 1px solid var(--line);
  padding: 16px 20px 18px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cd__subtotal {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-weight: 700;
  font-size: var(--text-md);
}
.cd__subtotal strong { font-size: var(--text-lg); font-variant-numeric: tabular-nums; }
.cd__note {
  font-size: 11.5px;
  color: var(--mut-2);
  margin-top: -6px;
}
.cd__full {
  text-align: center;
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.cd__full:hover { color: var(--purple); }

/* ---------- animación entrada/salida (respeta reduced-motion) ---------- */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.24s var(--ease-out);
}
.drawer-enter-active .cd__panel,
.drawer-leave-active .cd__panel {
  transition: transform 0.28s var(--ease-out);
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .cd__panel,
.drawer-leave-to .cd__panel {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active,
  .drawer-enter-active .cd__panel,
  .drawer-leave-active .cd__panel {
    transition: none;
  }
}
</style>
