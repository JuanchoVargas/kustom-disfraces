<script setup lang="ts">
/**
 * Resultados de búsqueda. Lee ?q= de la URL y filtra el catálogo por
 * palabras clave (nombre, descripción, categoría y subcategoría), sin
 * distinguir acentos ni mayúsculas. No se indexa en Google.
 */
const route = useRoute()
const { products } = useProducts()

const q = computed(() => String(route.query.q ?? '').trim())

// normaliza: quita acentos y pasa a minúsculas ("Bebé" -> "bebe")
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const results = computed(() => {
  const tokens = norm(q.value).split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  return products.filter((p) => {
    const haystack = norm(
      [p.name, p.description, ...(p.publicos ?? []), ...(p.subcategoriasNav ?? [])]
        .filter(Boolean)
        .join(' '),
    )
    // todas las palabras deben aparecer (búsqueda AND)
    return tokens.every(t => haystack.includes(t))
  })
})

useHead(() => ({
  title: q.value ? `Búsqueda: ${q.value} — Kustom Disfraces` : 'Buscar disfraces — Kustom Disfraces',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }], // resultados de búsqueda: no indexar
}))
</script>

<template>
  <div class="textured">
    <div class="sp">
      <Breadcrumb :items="[{ label: 'Inicio', to: '/' }, { label: 'Búsqueda' }]" />

      <header class="sp__head">
        <h1 class="sp__title">
          <template v-if="q">Resultados para “{{ q }}”</template>
          <template v-else>Buscar disfraces</template>
        </h1>
        <p v-if="q" class="sp__count">
          {{ results.length }} {{ results.length === 1 ? 'disfraz encontrado' : 'disfraces encontrados' }}
        </p>
      </header>

      <!-- con resultados -->
      <div v-if="results.length" class="prod-grid">
        <ProductCard v-for="p in results" :key="p.id" :product="p" />
      </div>

      <!-- sin resultados -->
      <section v-else-if="q" class="sp__empty">
        <img src="/images/ko/ko-apunta.webp" alt="" aria-hidden="true" class="sp__ko">
        <p class="sp__emptymsg">No encontramos disfraces para <strong>“{{ q }}”</strong>.</p>
        <p class="sp__hint">Prueba con otra palabra: un personaje (“Spider”, “Venom”), un público (“niños”, “bebé”) o un tema (“anime”).</p>
        <KButton variant="primary" size="sm" to="/categoria/ninos">Ver catálogo</KButton>
      </section>

      <!-- sin término -->
      <section v-else class="sp__empty">
        <img src="/images/ko/ko-apunta.webp" alt="" aria-hidden="true" class="sp__ko">
        <p class="sp__emptymsg">Escribe una palabra clave para buscar disfraces.</p>
        <p class="sp__hint">Por ejemplo: “Spider-Man”, “heroína”, “bebé” o “anime”.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sp {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5) var(--space-8);
}
.sp__head {
  margin: var(--space-4) 0 var(--space-6);
}
.sp__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-2xl);
  color: var(--ink);
  line-height: 1.1;
}
.sp__count {
  margin-top: var(--space-2);
  color: var(--mut);
  font-size: var(--text-sm);
}

.prod-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}

/* ---------- vacío ---------- */
.sp__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  padding: var(--space-7) var(--space-4) var(--space-8);
}
.sp__ko { width: 120px; height: auto; margin-bottom: var(--space-2); }
.sp__emptymsg {
  color: var(--ink);
  font-size: var(--text-lg);
  font-weight: 600;
}
.sp__hint {
  color: var(--mut);
  font-size: var(--text-sm);
  max-width: 46ch;
  line-height: 1.5;
  margin-bottom: var(--space-2);
}

@media (max-width: 1023px) {
  .prod-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .prod-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
