<script setup lang="ts">
import type { ProductGama } from '~~/shared/types/woo'

interface Props {
  gamas?: ProductGama[]
  /** true -> tarjetas con descripción + precio (PDP); false -> chips compactos */
  detailed?: boolean
}
withDefaults(defineProps<Props>(), {
  gamas: () => [
    { label: 'Súper Acolchado', color: 'var(--purple)' },
    { label: 'Semi Acolchado', color: 'var(--turq)' },
    { label: 'Línea de Entrada', color: 'var(--yellow)' },
  ],
  detailed: false,
})

const model = defineModel<string | null>({ default: null })
</script>

<template>
  <!-- ===== Modo detallado (PDP): no venía en el CSS original, hecho con tokens ===== -->
  <div v-if="detailed" class="gama-cards" role="radiogroup" aria-label="Gama / acabado">
    <button
      v-for="g in gamas"
      :key="g.label"
      type="button"
      class="gama-card"
      :class="{ on: model === g.label }"
      role="radio"
      :aria-checked="model === g.label"
      @click="model = g.label"
    >
      <span class="gama-card__dot" :style="{ background: g.color }" />
      <span class="gama-card__main">
        <span class="gama-card__label">{{ g.label }}</span>
        <span v-if="g.description" class="gama-card__desc">{{ g.description }}</span>
      </span>
      <span v-if="g.price" class="gama-card__price">{{ formatCOP(g.price) }}</span>
    </button>
  </div>

  <!-- ===== Modo chip compacto (.gchip original) ===== -->
  <div v-else class="gamas" role="group" aria-label="Gama / acabado">
    <button
      v-for="g in gamas"
      :key="g.label"
      type="button"
      class="gchip"
      :class="{ on: model === g.label }"
      :aria-pressed="model === g.label"
      @click="model = g.label"
    >
      <span class="gd" :style="{ background: g.color }" />
      {{ g.label }}
    </button>
  </div>
</template>

<style scoped>
/* ---------- chips (.gchip original) ---------- */
.gamas {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
.gchip {
  font-weight: 600;
  font-size: 11px;
  color: var(--mut);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  cursor: pointer;
  font-family: var(--ff-body);
}
.gchip .gd {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.gchip.on {
  color: var(--ink);
}
.gchip.on .gd {
  box-shadow: 0 0 0 3px rgba(17, 17, 17, 0.08);
}

/* ---------- tarjetas detalladas (PDP) ---------- */
.gama-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gama-card {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  width: 100%;
  padding: 12px 14px;
  background: #fff;
  border: 1.5px solid var(--line-2);
  border-radius: var(--r-md);
  cursor: pointer;
  font-family: var(--ff-body);
  transition: border-color 0.14s ease, background 0.14s ease;
}
.gama-card:hover {
  border-color: var(--ink);
}
.gama-card.on {
  border-color: var(--purple);
  background: var(--purple-soft);
}
.gama-card__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
.gama-card__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.gama-card__label {
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
}
.gama-card__desc {
  font-size: 12px;
  color: var(--mut);
  line-height: 1.35;
}
.gama-card__price {
  font-weight: 700;
  font-size: 14.5px;
  color: var(--ink);
  white-space: nowrap;
}
</style>
