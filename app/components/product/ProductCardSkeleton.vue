<script setup lang="ts">
// Espejo de ProductCard para el estado de carga.
</script>

<template>
  <div class="pcard-sk">
    <div class="pcard-sk__img">
      <Skeleton w="100%" h="100%" radius="0" />
    </div>
    <div class="pcard-sk__body">
      <Skeleton w="85%" h="14px" />
      <Skeleton w="50%" h="16px" />
      <Skeleton w="62%" h="11px" />
    </div>
  </div>
</template>

<style scoped>
.pcard-sk {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.pcard-sk__img {
  aspect-ratio: 1 / 1;
}
.pcard-sk__body {
  padding: 13px 15px 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
</style>
