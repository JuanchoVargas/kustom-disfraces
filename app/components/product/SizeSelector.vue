<script setup lang="ts">
interface Props {
  sizes?: (string | number)[]
  disabled?: (string | number)[]
}
const props = withDefaults(defineProps<Props>(), {
  sizes: () => [2, 4, 6, 8, 10, 12],
  disabled: () => [10], // ejemplo: talla agotada
})

const model = defineModel<string | number | null>({ default: null })

function select(s: string | number) {
  if (!props.disabled.includes(s)) model.value = s
}
</script>

<template>
  <div class="sizes" role="group" aria-label="Selecciona una talla">
    <button
      v-for="s in sizes"
      :key="s"
      type="button"
      class="tpill"
      :class="{ on: model === s, dis: disabled.includes(s) }"
      :disabled="disabled.includes(s)"
      :aria-pressed="model === s"
      @click="select(s)"
    >{{ s }}</button>
  </div>
</template>

<style scoped>
.sizes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tpill {
  min-width: 40px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13.5px;
  background: #fff;
  cursor: pointer;
  color: var(--ink);
  transition: border-color 0.12s ease;
  font-family: var(--ff-body);
}
.tpill:hover {
  border-color: var(--ink);
}
.tpill.on {
  background: var(--purple);
  border-color: var(--purple);
  color: #fff;
  font-weight: 700;
}
.tpill.dis {
  color: #C9C5BC;
  background: var(--hueso);
  text-decoration: line-through;
  cursor: default;
}
</style>
