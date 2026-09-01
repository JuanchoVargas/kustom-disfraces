<script setup lang="ts">
/**
 * Banner promocional del home: "X% DE DESCUENTO EN TODOS NUESTROS DISFRACES".
 * Atado al MISMO flag que los badges -20% de las tarjetas y el flotante de PDP
 * (NUXT_PUBLIC_SHOW_DISCOUNT): al apagar la promo en Vercel desaparece todo
 * el mensaje de descuento junto, sin deploy. El % sale de la config (pct).
 */
const { enabled, pct } = useFakeDiscount()
</script>

<template>
  <section v-if="enabled" class="dbanner" aria-label="Promoción de descuento">
    <div class="dbanner__inner">
      <span class="dbanner__spark" aria-hidden="true">✦</span>
      <p class="dbanner__text">
        <span class="dbanner__pct">{{ pct }}% de descuento</span>
        <span class="dbanner__rest">en todos nuestros disfraces</span>
      </p>
      <span class="dbanner__spark" aria-hidden="true">✦</span>
    </div>
  </section>
</template>

<style scoped>
/* Banda morada sólida (sin patrón: el pattern-morado es exclusivo de KoBlock) */
.dbanner {
  background: var(--purple);
  border-top: 1px solid var(--purple-d);
  border-bottom: 1px solid var(--purple-d);
}
.dbanner__inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
}
.dbanner__spark {
  color: var(--yellow);
  font-size: var(--text-xl);
  line-height: 1;
  flex-shrink: 0;
}
.dbanner__text {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  text-align: center;
  text-transform: uppercase;
}
.dbanner__pct {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  line-height: 1.05;
  color: var(--yellow);
  letter-spacing: 0.02em;
}
.dbanner__rest {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-xl);
  line-height: 1.15;
  color: var(--hueso);
  letter-spacing: 0.03em;
}

@media (max-width: 640px) {
  .dbanner__inner { padding: var(--space-4) var(--space-4); gap: var(--space-3); }
  .dbanner__text { flex-direction: column; gap: 4px; align-items: center; }
  .dbanner__pct { font-size: var(--text-2xl); }
  .dbanner__rest { font-size: var(--text-md); letter-spacing: 0.06em; }
  .dbanner__spark { font-size: var(--text-md); }
}
</style>
