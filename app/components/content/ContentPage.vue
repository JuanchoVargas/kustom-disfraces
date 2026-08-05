<script setup lang="ts">
/**
 * Envoltorio de páginas informativas (Sobre nosotros, Envíos, Cambios, FAQ,
 * Cómo comprar, Política de datos). Columna de lectura centrada sobre el crema
 * texturizado, con estilos .prose compartidos para todo el texto largo del sitio.
 *
 * KO decorativo (opcional): acompaña sin tapar. En desktop va al costado, en el
 * margen derecho (fuera de la columna de 760px); en mobile pasa a flujo normal
 * DEBAJO del texto y más pequeño. La política de datos usa `discreet` (más chico
 * y tenue) por ser una página legal.
 */
interface Props {
  title: string
  lead?: string
  /** pose de KO en public/images/ko/ (sin extensión): ko-paz | ko-apunta | ko-caja */
  ko?: string
  /** versión discreta (más pequeña y tenue) para páginas formales */
  discreet?: boolean
}
defineProps<Props>()
</script>

<template>
  <div class="textured info-wrap">
    <article class="info">
      <header class="info__head">
        <h1 class="info__title">{{ title }}</h1>
        <p v-if="lead" class="info__lead">{{ lead }}</p>
      </header>
      <div class="prose">
        <slot />
      </div>
    </article>

    <!-- KO decorativo (transparente sobre el crema, sin caja). Puramente
         ornamental: aria-hidden + alt vacío para no ensuciar el lector. -->
    <img
      v-if="ko"
      :src="`/images/ko/${ko}.webp`"
      alt=""
      aria-hidden="true"
      class="ko-deco"
      :class="{ 'ko-deco--discreet': discreet }"
      width="150"
      height="268"
    >
  </div>
</template>

<style scoped>
.info-wrap {
  position: relative;
}
.info {
  position: relative;
  z-index: 1; /* el texto siempre por encima de KO si llegaran a solaparse */
  max-width: 760px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5) var(--space-8);
}

/* ---------- KO decorativo ---------- */
/* Base (mobile / tablet): en flujo normal, DEBAJO del texto y centrado.
   No empuja de forma extraña porque va al final del contenido. */
.ko-deco {
  display: block;
  width: 104px; /* KO es una figura vertical (~0.56 de proporción): ancho contenido */
  height: auto;
  margin: 0 auto var(--space-7);
  opacity: 0.96;
  pointer-events: none;
  animation: ko-float 4.5s var(--ease-out) infinite;
}
.ko-deco--discreet {
  width: 84px;
  opacity: 0.78;
}
@keyframes ko-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
}

/* Desktop ancho: KO al costado, en el margen derecho fuera de la columna.
   El breakpoint (1160px) garantiza margen suficiente para no tocar el texto. */
@media (min-width: 1160px) {
  .ko-deco {
    position: absolute;
    right: var(--space-6);
    bottom: var(--space-7);
    width: 150px;
    margin: 0;
    z-index: 0;
  }
  .ko-deco--discreet {
    width: 110px;
    right: var(--space-5);
    bottom: var(--space-6);
  }
}
.info__head {
  margin-bottom: var(--space-6);
}
.info__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  line-height: 1.05;
  color: var(--ink);
}
.info__lead {
  margin-top: var(--space-3);
  color: var(--mut);
  font-size: var(--text-lg);
  line-height: 1.5;
  max-width: 56ch;
}

/* ---------- prose: tipografía de contenido largo ---------- */
.prose :deep(p) {
  color: var(--ink);
  font-size: var(--text-md);
  line-height: 1.7;
  margin-bottom: var(--space-4);
}
.prose :deep(h2) {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-xl);
  color: var(--ink);
  margin: var(--space-6) 0 var(--space-3);
}
.prose :deep(h3) {
  font-weight: 700;
  font-size: var(--text-lg);
  color: var(--ink);
  margin: var(--space-5) 0 var(--space-2);
}
.prose :deep(ul),
.prose :deep(ol) {
  margin: 0 0 var(--space-4);
  padding-left: 1.3em;
}
.prose :deep(li) {
  color: var(--ink);
  font-size: var(--text-md);
  line-height: 1.7;
  margin-bottom: var(--space-2);
}
.prose :deep(a) {
  color: var(--purple);
  font-weight: 600;
  text-decoration: none;
}
.prose :deep(a:hover) { color: var(--purple-d); text-decoration: underline; }
.prose :deep(strong) { font-weight: 700; }

/* pasos numerados de "Cómo comprar" (lista con círculos morados) */
.prose :deep(.steps) {
  list-style: none;
  padding: 0;
  margin: var(--space-4) 0;
  counter-reset: step;
  display: grid;
  gap: var(--space-3);
}
.prose :deep(.steps li) {
  position: relative;
  padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-8) + 4px);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  margin: 0;
  box-shadow: var(--shadow);
}
.prose :deep(.steps li)::before {
  counter-increment: step;
  content: counter(step);
  position: absolute;
  left: var(--space-4);
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: var(--r-pill);
  background: var(--purple);
  color: #fff;
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-md);
}

/* bloque de preguntas frecuentes */
.prose :deep(.qa) {
  border-top: 1px solid var(--line);
  padding-top: var(--space-4);
  margin-top: var(--space-4);
}
.prose :deep(.qa__q) {
  font-weight: 700;
  font-size: var(--text-lg);
  color: var(--ink);
  margin-bottom: var(--space-2);
}

@media (max-width: 720px) {
  .info { padding: var(--space-6) var(--space-4) var(--space-7); }
  .info__title { font-size: var(--text-2xl); }
  .ko-deco { width: 92px; }
  .ko-deco--discreet { width: 76px; }
}

/* accesibilidad: sin flotación si el usuario pide movimiento reducido */
@media (prefers-reduced-motion: reduce) {
  .ko-deco { animation: none; }
}
</style>
