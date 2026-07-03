<script setup lang="ts">
/**
 * PhotoPlaceholder — porta la clase .photo del CSS original.
 * Marcador de posición para fotos reales (producto, categoría, mascota)
 * hasta que lleguen las imágenes de WooCommerce / el pack de assets.
 */
defineProps<{ caption?: string }>()
</script>

<template>
  <div class="photo">
    <span class="cap"><slot>{{ caption }}</slot></span>
  </div>
</template>

<style scoped>
.photo {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: #ECE9E1;
  background-image: repeating-linear-gradient(-45deg, rgba(17, 17, 17, 0.028) 0 12px, transparent 12px 24px);
  display: grid;
  place-items: center;
}
.photo .cap {
  font-family: var(--ff-mono);
  font-size: 10px;
  line-height: 1.55;
  color: #94908A;
  text-align: center;
  padding: 8px;
  white-space: pre-line;
}
</style>
