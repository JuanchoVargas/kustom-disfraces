<script setup lang="ts">
/**
 * Página de error global (404 y 500). KO apunta el camino de regreso
 * sobre el patrón doodle espacial morado del pack de marca.
 */
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const is404 = computed(() => props.error.statusCode === 404)
const title = computed(() => (is404.value ? 'Este personaje no existe (todavía)' : 'Algo salió mal'))
const sub = computed(() =>
  is404.value
    ? 'KO buscó por toda la galaxia y no encontró esta página. Volvamos al catálogo.'
    : 'Tuvimos un problema inesperado. Intenta de nuevo o vuelve al inicio.',
)

useHead(() => ({ title: `${props.error.statusCode} — Kustom Disfraces` }))

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <!-- Wrapper SIN patrón crema (crema = solo Homepage); hueso sólido.
       El pattern-morado vive solo en la card (estado especial con KO). -->
  <div class="errwrap">
    <div class="errcard">
      <img src="/images/ko/ko-apunta.webp" alt="KO, la mascota de Kustom, señalando el camino" class="errcard__ko">
      <p class="errcard__code">{{ error.statusCode }}</p>
      <h1 class="errcard__title">{{ title }}</h1>
      <p class="errcard__sub">{{ sub }}</p>
      <div class="errcard__actions">
        <KButton variant="turq" size="lg" @click="goHome">Volver al inicio</KButton>
        <a href="/categoria/ninos" class="errcard__link">Ver catálogo</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.errwrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-5);
  background: var(--hueso);
}
.errcard {
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  padding: var(--space-7) var(--space-6);
  /* patrón doodle espacial morado (bg3), repetido sin estirar */
  background-color: #5F2B7D;
  background-image: url('/images/pattern-morado.webp');
  background-repeat: repeat;
  background-size: 480px auto;
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lift);
}
.errcard__ko {
  height: 210px;
  width: auto;
  filter: drop-shadow(0 12px 18px rgba(17, 17, 17, 0.3));
}
.errcard__code {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-4xl);
  color: var(--yellow);
  line-height: 1;
}
.errcard__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-xl);
  color: #fff;
  letter-spacing: 0.02em;
  text-wrap: balance;
}
.errcard__sub {
  color: rgba(255, 255, 255, 0.75);
  font-size: var(--text-md);
  line-height: 1.5;
  max-width: 40ch;
  margin-bottom: var(--space-3);
}
.errcard__actions {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
}
.errcard__link {
  color: #fff;
  font-weight: 600;
  font-size: var(--text-md);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.errcard__link:hover { color: var(--yellow); }
</style>
