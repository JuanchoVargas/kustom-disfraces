<script setup lang="ts">
/**
 * AnnouncementBar — barra global sobre el navbar.
 * Ajuste sep 2026: pareja visual del DiscountBanner del home (misma altura,
 * misma display de marca en mayúsculas, amarillo sobre morado y los ✦).
 * Mantener ambos componentes alineados si se toca uno.
 * Sin animación ni botón de cierre (por ahora).
 */
// Dos tramos: en móvil se apilan (corte controlado, sin dejar "PAÍS" solo)
const ANNOUNCEMENT_TEXT_1 = 'ENVÍO GRATIS'
const ANNOUNCEMENT_TEXT_2 = 'A TODO EL PAÍS'
</script>

<template>
  <div class="announce">
    <div class="announce__inner">
      <span class="announce__spark" aria-hidden="true">✦</span>
      <p class="announce__text">
        <span class="announce__part">{{ ANNOUNCEMENT_TEXT_1 }}</span>
        <span class="announce__part">{{ ANNOUNCEMENT_TEXT_2 }}</span>
      </p>
      <span class="announce__spark" aria-hidden="true">✦</span>
    </div>
  </div>
</template>

<style scoped>
/* Mismos valores que .dbanner / .dbanner__pct (DiscountBanner.vue) */
.announce {
  background: var(--purple);
  border-bottom: 1px solid var(--purple-d);
}
.announce__inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
}
.announce__spark {
  color: var(--yellow);
  font-size: var(--text-xl);
  line-height: 1;
  flex-shrink: 0;
}
.announce__text {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  line-height: 1.05;
  color: var(--yellow);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  text-align: center;
}

/* Móvil: destacada pero sin comerse el hero (máx. ~2 líneas) */
@media (max-width: 640px) {
  .announce__inner { padding: var(--space-3) var(--space-4); gap: var(--space-3); }
  .announce__text { font-size: var(--text-xl); line-height: 1.1; letter-spacing: 0.03em; }
  .announce__spark { font-size: var(--text-md); }
  .announce__part { display: block; }
}
</style>
