<script setup lang="ts">
const cart = useCartStore()
const { contact, categories } = useSiteNav()
const route = useRoute()

useHead({ title: 'Tu carrito — Kustom Disfraces' })

// Sembrado de demo para revisar la vista llena (solo con ?demo=1 y carrito vacío).
onMounted(() => {
  if (route.query.demo && cart.items.length === 0) {
    cart.add({ productId: 1, name: 'Spider-Man Clásico', slug: 'spider-man-clasico', price: 129900, image: '/images/products/spider-man-clasico-super-acolchado.webp', size: 6, gama: 'Súper Acolchado', quantity: 1 })
    cart.add({ productId: 49, name: 'Pollito', slug: 'pollito', price: 79900, image: '/images/products/pollito.webp', size: 'Bebé', quantity: 2 })
  }
})

const waCheckout = computed(() => {
  const lines = cart.items.map(i => `• ${i.name} (talla ${i.size}${i.gama ? `, ${i.gama}` : ''}) x${i.quantity}`).join('\n')
  const text = `Hola, quiero finalizar mi pedido:\n${lines}\n\nSubtotal: ${formatCOP(cart.subtotal)}`
  return `${contact.whatsapp}?text=${encodeURIComponent(text)}`
})
</script>

<template>
  <div>
  <!-- Carrito SIN patrón de página (flujo de checkout: hueso sólido).
       El pattern-morado vive SOLO en .empty (estado especial con KO).
       Div raíz único: gotcha pageTransition. -->
  <div class="cart">
    <Breadcrumb :items="[{ label: 'Inicio', to: '/' }, { label: 'Carrito' }]" />
    <h1 class="cart__title">Tu carrito</h1>

    <!-- ===================== VACÍO ===================== -->
    <div v-if="!cart.items.length" class="empty">
      <img src="/images/ko/ko-caja.webp" alt="KO, la mascota de Kustom, cargando una caja de envío" class="empty__ko">
      <p class="empty__msg">Tu carrito está vacío.</p>
      <p class="empty__sub">KO ya tiene la caja lista — solo falta tu disfraz.</p>
      <KButton variant="turq" to="/categoria/ninos">Ver catálogo</KButton>
    </div>

    <!-- ===================== CON ITEMS ===================== -->
    <div v-else class="cart__layout">
      <ul class="items">
        <li v-for="(it, i) in cart.items" :key="i" class="item">
          <div class="item__img">
            <img v-if="it.image" :src="it.image" :alt="it.name" class="item__photo">
            <PhotoPlaceholder v-else :caption="`[ ${it.name} ]`" />
          </div>
          <div class="item__info">
            <NuxtLink :to="`/producto/${it.slug}`" class="item__name">{{ it.name }}</NuxtLink>
            <div class="item__meta">
              Talla {{ it.size }}<template v-if="it.gama"> · {{ it.gama }}</template>
            </div>
            <button type="button" class="item__remove" @click="cart.remove(i)">Eliminar</button>
          </div>
          <div class="item__bottom">
            <div class="item__qty">
              <button type="button" aria-label="Restar" @click="cart.setQty(i, it.quantity - 1)">−</button>
              <span>{{ it.quantity }}</span>
              <button type="button" aria-label="Sumar" @click="cart.setQty(i, it.quantity + 1)">+</button>
            </div>
            <div class="item__price">{{ formatCOP(it.price * it.quantity) }}</div>
          </div>
        </li>
      </ul>

      <aside class="summary">
        <h2 class="summary__title">Resumen</h2>
        <div class="summary__row">
          <span>Subtotal ({{ cart.count }} {{ cart.count === 1 ? 'artículo' : 'artículos' }})</span>
          <strong>{{ formatCOP(cart.subtotal) }}</strong>
        </div>
        <div class="summary__row summary__row--muted">
          <span>Envío</span>
          <span>Se calcula al finalizar</span>
        </div>
        <div class="summary__total">
          <span>Total</span>
          <strong>{{ formatCOP(cart.subtotal) }}</strong>
        </div>
        <KButton variant="primary" size="lg" block to="/checkout">Finalizar compra</KButton>
        <KButton variant="whatsapp" size="lg" block :to="waCheckout">
          <template #icon-left>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 0 1 6.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1 1 12 3.8zm-3 3.6c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 2.3 1 2.8.8 3.3.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.2-.5-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.2 0-.4.1-.5l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.4-.5-.6-.5z"/>
            </svg>
          </template>
          Finalizar por WhatsApp
        </KButton>
        <NuxtLink to="/categoria/ninos" class="summary__continue">← Seguir comprando</NuxtLink>
      </aside>
    </div>
  </div>
  </div>
</template>

<style scoped>
.cart {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-5);
}
.cart__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  color: var(--ink);
  margin: var(--space-4) 0 var(--space-5);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-7) var(--space-5);
  /* patrón doodle espacial morado (bg3 del pack de marca), repetido sin estirar */
  background-color: #5F2B7D;
  background-image: url('/images/pattern-morado.webp');
  background-repeat: repeat;
  background-size: 480px auto;
  border-radius: var(--r-lg);
}
.empty__ko {
  height: 190px;
  width: auto;
  filter: drop-shadow(0 12px 18px rgba(17, 17, 17, 0.3));
}
.empty__msg {
  color: #fff;
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-xl);
  letter-spacing: 0.02em;
}
.empty__sub {
  color: rgba(255, 255, 255, 0.75);
  font-size: var(--text-sm);
  margin-bottom: var(--space-2);
}

.cart__layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--space-6);
  align-items: start;
}

/* ---------- items ---------- */
.items { list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
.item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--space-3);
}
.item__img {
  width: 86px;
  height: 86px;
  flex-shrink: 0;
  border-radius: var(--r-sm);
  overflow: hidden;
  border: 1px solid var(--line);
  background: #fff;
}
.item__photo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.item__info { flex: 1; min-width: 0; }
.item__bottom {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-shrink: 0;
}
.item__name {
  font-weight: 600;
  font-size: 14.5px;
  color: var(--ink);
  text-decoration: none;
}
.item__name:hover { color: var(--purple); }
.item__meta { font-size: 12.5px; color: var(--mut); margin: 3px 0 6px; }
.item__remove {
  font-size: 12px;
  font-weight: 600;
  color: var(--mut-2);
  background: none;
  border: 0;
  cursor: pointer;
  padding: 0;
}
.item__remove:hover { color: var(--fucsia); }
.item__qty {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line-2);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.item__qty button {
  width: 32px;
  height: 32px;
  font-size: 16px;
  font-weight: 700;
  background: #fff;
  border: 0;
  cursor: pointer;
  color: var(--ink);
}
.item__qty button:hover { background: var(--hueso); }
.item__qty span { min-width: 28px; text-align: center; font-weight: 600; font-size: 14px; }
.item__price { font-weight: 700; font-size: 15px; white-space: nowrap; }

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
.summary__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-lg);
  margin-bottom: var(--space-2);
}
.summary__row { display: flex; justify-content: space-between; font-size: 14px; }
.summary__row--muted { color: var(--mut); font-size: 13px; }
.summary__total {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-lg);
  padding-top: var(--space-3);
  margin-top: var(--space-1);
  border-top: 1px solid var(--line);
}
.summary__total strong { color: var(--purple); }
.summary__continue {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  /* convención de links de texto: morado -> morado oscuro (como .section__link) */
  color: var(--purple);
  text-decoration: none;
  margin-top: var(--space-1);
}
.summary__continue:hover { color: var(--purple-d); }

/* ---------- responsive ---------- */
@media (max-width: 860px) {
  .cart__layout { grid-template-columns: 1fr; }
  .summary { position: static; }
}
@media (max-width: 520px) {
  .item { flex-wrap: wrap; }
  .item__img { width: 64px; height: 64px; }
  .item__bottom {
    flex: 0 0 100%; /* fuerza fila propia debajo del nombre */
    justify-content: space-between;
    padding-left: calc(64px + var(--space-4));
  }
}
</style>
