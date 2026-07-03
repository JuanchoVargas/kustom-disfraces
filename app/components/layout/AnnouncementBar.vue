<script setup lang="ts">
/**
 * AnnouncementBar — barra delgada global sobre el navbar.
 * Sin animación ni botón de cierre (por ahora).
 */
// ⚠ PROVISIONAL — texto y umbral a confirmar con el cliente
// (el umbral real vive en FREE_SHIPPING_THRESHOLD, stores/cart.ts)
const ANNOUNCEMENT_TEXT = 'Envío gratis desde $200.000 · Pago contra entrega'
</script>

<template>
  <div class="announce">
    <p class="announce__text">{{ ANNOUNCEMENT_TEXT }}</p>
  </div>
</template>

<style scoped>
.announce {
  background: var(--purple);
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
}
.announce__text {
  color: #fff;
  font-weight: 600;
  font-size: var(--text-sm);
  line-height: 1.3;
  text-align: center;
  letter-spacing: 0.02em;
}
</style>
