<script setup lang="ts">
/**
 * KTag — etiqueta/chip suave (categorías, atributos, filtros).
 * Primera versión basada en tokens; ajustable al CSS original .tag si existe.
 */
interface Props {
  color?: 'purple' | 'turq' | 'yellow' | 'fucsia' | 'lima' | 'neutral'
  size?: 'sm' | 'md'
}
withDefaults(defineProps<Props>(), {
  color: 'purple',
  size: 'md',
})
</script>

<template>
  <span class="ktag" :class="[`ktag--${color}`, `ktag--${size}`]">
    <slot name="icon" />
    <slot />
  </span>
</template>

<style scoped>
.ktag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--ff-body);
  font-weight: 600;
  line-height: 1;
  border-radius: var(--r-pill);
  border: 1px solid transparent;
  white-space: nowrap;
}

/* ---------- TAMAÑOS ---------- */
.ktag--sm {
  font-size: var(--text-xs);
  padding: 4px var(--space-2);
}
.ktag--md {
  font-size: var(--text-sm);
  padding: 6px var(--space-3);
}

/* ---------- COLORES (tinte suave + texto saturado) ---------- */
.ktag--purple {
  background: var(--purple-soft);
  color: var(--purple-d);
  border-color: var(--purple-line);
}
.ktag--turq {
  background: rgba(0, 191, 166, 0.12);
  color: var(--turq-d);
  border-color: rgba(0, 191, 166, 0.28);
}
.ktag--yellow {
  background: rgba(255, 196, 77, 0.18);
  color: #9a6800;
  border-color: rgba(255, 196, 77, 0.45);
}
.ktag--fucsia {
  background: rgba(255, 77, 166, 0.12);
  color: #c2196f;
  border-color: rgba(255, 77, 166, 0.30);
}
.ktag--lima {
  background: rgba(166, 226, 46, 0.18);
  color: #5a7d00;
  border-color: rgba(166, 226, 46, 0.45);
}
.ktag--neutral {
  background: var(--hueso);
  color: var(--mut);
  border-color: var(--line-2);
}
</style>
