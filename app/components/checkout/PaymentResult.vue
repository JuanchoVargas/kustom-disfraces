<script setup lang="ts">
/**
 * Pantalla de resultado del pago (retorno desde Mercado Pago). Comparte el estilo
 * de card morada con KO de error.vue. Tres variantes según la back_url de MP.
 *
 * IMPORTANTE: el estado que muestra esta página viene de la URL de retorno y es
 * solo informativo para el comprador. La CONFIRMACIÓN real del pago la da el
 * webhook (server/api/webhooks/mercadopago.post.ts), que verifica contra la API.
 */
type Variant = 'exito' | 'fallido' | 'pendiente'
const props = defineProps<{ variant: Variant }>()

const cart = useCartStore()
const route = useRoute()

// MP añade query params al volver (payment_id, status, external_reference…).
const paymentRef = computed(() => String(route.query.payment_id || route.query.collection_id || '').trim())

const content: Record<Variant, { ko: string, alt: string, emoji: string, accent: string, title: string, sub: string }> = {
  exito: {
    ko: '/images/ko/ko-paz.webp',
    alt: 'KO, la mascota de Kustom, celebrando',
    emoji: '🎉',
    accent: 'var(--yellow)',
    title: '¡Pago recibido!',
    sub: 'Gracias por tu compra. Te contactaremos por WhatsApp para coordinar el envío y confirmar los detalles.',
  },
  fallido: {
    ko: '/images/ko/ko-apunta.webp',
    alt: 'KO, la mascota de Kustom, señalando el camino de regreso',
    emoji: '',
    accent: 'var(--turq)',
    title: 'El pago no se completó',
    sub: 'No se pudo procesar tu pago y no se te cobró nada. Puedes intentarlo de nuevo o finalizar tu pedido por WhatsApp.',
  },
  pendiente: {
    ko: '/images/ko/ko-caja.webp',
    alt: 'KO, la mascota de Kustom, esperando con la caja lista',
    emoji: '⏳',
    accent: 'var(--turq)',
    title: 'Tu pago está pendiente',
    sub: 'Estamos esperando la confirmación del pago. Te avisaremos por WhatsApp en cuanto se acredite.',
  },
}
const c = computed(() => content[props.variant])

// En éxito, el carrito ya cumplió su función: se vacía (solo cliente).
onMounted(() => {
  if (props.variant === 'exito') cart.clear()
})
</script>

<template>
  <div class="prwrap">
    <div class="prcard">
      <img :src="c.ko" :alt="c.alt" class="prcard__ko">
      <h1 class="prcard__title">
        {{ c.title }}<span v-if="c.emoji"> {{ c.emoji }}</span>
      </h1>
      <p class="prcard__sub">{{ c.sub }}</p>
      <p v-if="variant === 'exito' && paymentRef" class="prcard__ref">
        Referencia de pago: <strong>#{{ paymentRef }}</strong>
      </p>

      <div class="prcard__actions">
        <template v-if="variant === 'exito'">
          <KButton variant="turq" size="lg" to="/">Volver al inicio</KButton>
          <NuxtLink to="/categoria/ninos" class="prcard__link">Seguir comprando</NuxtLink>
        </template>
        <template v-else-if="variant === 'fallido'">
          <KButton variant="turq" size="lg" to="/carrito">Volver al carrito</KButton>
          <NuxtLink to="/categoria/ninos" class="prcard__link">Ver catálogo</NuxtLink>
        </template>
        <template v-else>
          <KButton variant="turq" size="lg" to="/">Volver al inicio</KButton>
          <NuxtLink to="/carrito" class="prcard__link">Ver mi carrito</NuxtLink>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Mismo lenguaje visual que error.vue: card morada con patrón espacial + KO. */
.prwrap {
  min-height: 70vh;
  display: grid;
  place-items: center;
  padding: var(--space-5);
  background: var(--hueso);
}
.prcard {
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  padding: var(--space-7) var(--space-6);
  background-color: #5F2B7D;
  background-image: url('/images/pattern-morado.webp');
  background-repeat: repeat;
  background-size: 480px auto;
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lift);
}
.prcard__ko {
  height: 200px;
  width: auto;
  filter: drop-shadow(0 12px 18px rgba(17, 17, 17, 0.3));
}
.prcard__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-2xl);
  color: #fff;
  letter-spacing: 0.02em;
  text-wrap: balance;
}
.prcard__sub {
  color: rgba(255, 255, 255, 0.78);
  font-size: var(--text-md);
  line-height: 1.5;
  max-width: 42ch;
}
.prcard__ref {
  color: v-bind('c.accent');
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.prcard__actions {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  margin-top: var(--space-2);
}
.prcard__link {
  color: #fff;
  font-weight: 600;
  font-size: var(--text-md);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.prcard__link:hover { color: var(--yellow); }
</style>
