<script setup lang="ts">
/**
 * Banner flotante de envío gratis. Solo en home y PDP (`/`, `/producto/*`).
 * Se cierra con la X y no vuelve a aparecer en esa sesión — usa sessionStorage
 * (NO localStorage: en una pestaña/sesión nueva vuelve a aparecer). CSS puro.
 */
const route = useRoute()
const STORAGE_KEY = 'kustom-promo-envio-cerrado'

const showOnThisRoute = computed(() => route.path === '/' || route.path.startsWith('/producto/'))
const dismissed = ref(false)
const visible = computed(() => showOnThisRoute.value && !dismissed.value)

onMounted(() => {
  try {
    dismissed.value = sessionStorage.getItem(STORAGE_KEY) === '1'
  }
  catch {
    // sessionStorage bloqueado (privado/incógnito estricto): se muestra igual,
    // solo que el cierre no se recuerda entre navegaciones.
  }
})

function close() {
  dismissed.value = true
  try { sessionStorage.setItem(STORAGE_KEY, '1') }
  catch { /* ver onMounted */ }
}
</script>

<template>
  <Transition name="promo">
    <div v-if="visible" class="promo" role="note" aria-label="Promoción de envío">
      <span class="promo__text">🚚 Envío gratis a todo el país</span>
      <button type="button" class="promo__close" aria-label="Cerrar aviso" @click="close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.promo {
  position: fixed;
  left: var(--space-4);
  bottom: var(--space-4);
  z-index: 45; /* sobre el contenido y el navbar (30); el drawer del carrito (60) lo tapa al abrirse */
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--purple);
  color: #fff;
  padding: 13px 14px 13px 18px;
  border-radius: var(--r-pill);
  box-shadow: var(--shadow-lift);
  border: 1px solid var(--purple-d);
  max-width: calc(100vw - var(--space-4) * 2);
}
.promo__text {
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: 13.5px;
  color: #fff;
  white-space: nowrap;
}
.promo__close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.promo__close:hover { background: rgba(255, 255, 255, 0.3); }
.promo__close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

/* entrada: fade + slide sutil */
.promo-enter-active { transition: opacity var(--dur-med) var(--ease-out), transform var(--dur-med) var(--ease-out); }
.promo-leave-active { transition: opacity var(--dur-fast) var(--ease-out); }
.promo-enter-from { opacity: 0; transform: translateY(14px); }
.promo-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .promo-enter-active, .promo-leave-active { transition: opacity var(--dur-fast) linear; }
  .promo-enter-from { transform: none; }
}

/* mobile: barra completa abajo (no pastilla flotante), compacta para no tapar
   CTAs en flujo normal; respeta el home-indicator del iPhone (safe-area) */
@media (max-width: 640px) {
  .promo {
    left: 0;
    right: 0;
    bottom: 0;
    max-width: none;
    justify-content: center;
    border-radius: 0;
    border-width: 1px 0 0;
    padding: 12px var(--space-5) calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .promo__text { white-space: normal; text-align: center; }
}
</style>
