<script setup lang="ts">
/**
 * AnnouncementBar — barra delgada global sobre el navbar.
 * Sin animación ni botón de cierre (por ahora).
 */
const ANNOUNCEMENT_TEXT = 'ENVÍO GRATIS EN BOGOTÁ'
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
