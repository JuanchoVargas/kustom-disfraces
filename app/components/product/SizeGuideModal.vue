<script setup lang="ts">
/**
 * Modal/popup de la guía de tallas. Se abre desde la PDP (botón bajo el selector
 * de tallas) y muestra la imagen nítida. Cierra con la X, con clic afuera y con
 * Escape. En móvil ocupa casi toda la pantalla. Bloquea el scroll del fondo
 * mientras está abierto.
 */
const open = defineModel<boolean>({ required: true })

function close() {
  open.value = false
}

// Escape para cerrar + bloqueo de scroll del fondo mientras está abierto.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
watch(open, (isOpen) => {
  if (import.meta.server) return
  if (isOpen) {
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
  }
  else {
    document.removeEventListener('keydown', onKey)
    document.body.style.overflow = ''
  }
})
onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('keydown', onKey)
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sg-fade">
      <!-- Overlay: clic afuera cierra (el clic sobre la caja no se propaga). -->
      <div
        v-if="open"
        class="sg"
        role="dialog"
        aria-modal="true"
        aria-label="Guía de tallas"
        @click.self="close"
      >
        <div class="sg__box" @click.stop>
          <button type="button" class="sg__x" aria-label="Cerrar" @click="close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
          <img
            src="/images/guia-tallas.webp"
            alt="Guía de tallas de Kustom Disfraces"
            class="sg__img"
            width="1080"
            height="1350"
          >
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sg {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: var(--space-5);
  background: rgba(17, 17, 17, 0.72);
  backdrop-filter: blur(2px);
}
.sg__box {
  position: relative;
  background: #fff;
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.35));
  max-width: min(560px, 100%);
  max-height: 92vh;
  overflow: hidden;
}
.sg__img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 92vh;
  object-fit: contain;
}
.sg__x {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: var(--ink);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transition: background var(--dur-fast, 0.15s) var(--ease-out, ease);
}
.sg__x:hover { background: #fff; }
.sg__x:focus-visible { outline: 3px solid var(--turq); outline-offset: 2px; }

/* En móvil ocupa casi toda la pantalla, imagen nítida y grande. */
@media (max-width: 620px) {
  .sg { padding: var(--space-3); }
  .sg__box { max-width: 100%; max-height: 94vh; }
  .sg__img { max-height: 94vh; }
}

.sg-fade-enter-active,
.sg-fade-leave-active { transition: opacity 0.18s ease; }
.sg-fade-enter-from,
.sg-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .sg-fade-enter-active,
  .sg-fade-leave-active { transition: none; }
}
</style>
