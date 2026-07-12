<script setup lang="ts">
const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { byPublico, pending } = useProducts()
const { publicoBySlug } = useCatalogNav()

// Skeletons: hoy se fuerzan con ?skeleton=1; en Fase D los activa `pending`.
const showSkeleton = computed(() => pending.value || route.query.skeleton === '1')

// La PLP navega por PÚBLICOS (taxonomía oficial). Los vacíos (Combos) se
// auto-ocultan de la navegación y también responden 404 hasta tener productos.
const publico = computed(() => publicoBySlug(slug.value))
if (!publico.value) {
  throw createError({ statusCode: 404, statusMessage: 'Categoría no encontrada', fatal: true })
}

// Subcategoría activa vía query param (?sub=trusas) — URL compartible y las
// tabs siguen siendo rutas. Un valor desconocido equivale a "Todos".
const activeSub = computed(() => {
  const q = route.query.sub
  return typeof q === 'string' && publico.value?.subcategorias.some(s => s.slug === q) ? q : null
})

const all = computed(() => {
  const base = byPublico(slug.value)
  return activeSub.value ? base.filter(p => p.subcategoriasNav?.includes(activeSub.value as string)) : base
})

const subNombre = computed(() => publico.value?.subcategorias.find(s => s.slug === activeSub.value)?.nombre)
useHead(() => ({ title: `${publico.value?.nombre}${subNombre.value ? ` · ${subNombre.value}` : ''} — Kustom Disfraces` }))

// ---------- opciones de filtro (derivadas de los productos de la categoría) ----------
// Orden canónico de tallas del catálogo (mezcla "Bebé", números y S-XL)
const SIZE_ORDER = ['Bebé', 0, 2, 4, 6, 8, 10, 12, 14, 'XS', 'S', 'M', 'L', 'XL']
const sizeRank = (s: number | string) => {
  const i = SIZE_ORDER.findIndex(o => String(o) === String(s))
  return i === -1 ? SIZE_ORDER.length : i
}
const allSizes = computed(() => [...new Set(all.value.flatMap(p => p.sizes))].sort((a, b) => sizeRank(a) - sizeRank(b)))
const allSeasons = computed(() => [...new Set(all.value.map(p => p.season).filter(Boolean) as string[])])
const priceRanges = [
  { label: 'Menos de $80.000', min: 0, max: 79999 },
  { label: '$80.000 – $120.000', min: 80000, max: 120000 },
  { label: 'Más de $120.000', min: 120001, max: Infinity },
]

// ---------- estado de filtros ----------
const fSizes = ref<(number | string)[]>([])
const fSeasons = ref<string[]>([])
const fRange = ref<number | null>(null) // índice de priceRanges
const sort = ref<'rel' | 'price-asc' | 'price-desc'>('rel')
const showFilters = ref(false) // toggle mobile

function toggle<T>(arr: Ref<T[]>, val: T) {
  const i = arr.value.indexOf(val)
  if (i === -1) arr.value.push(val)
  else arr.value.splice(i, 1)
}
function clearFilters() {
  fSizes.value = []
  fSeasons.value = []
  fRange.value = null
}
const activeFilterCount = computed(() =>
  fSizes.value.length + fSeasons.value.length + (fRange.value !== null ? 1 : 0),
)

// ---------- filtrado + orden ----------
const filtered = computed(() => {
  let list = all.value.filter((p) => {
    if (fSizes.value.length && !p.sizes.some(s => fSizes.value.includes(s))) return false
    if (fSeasons.value.length && !(p.season && fSeasons.value.includes(p.season))) return false
    if (fRange.value !== null) {
      const r = priceRanges[fRange.value]
      if (p.price < r.min || p.price > r.max) return false
    }
    return true
  })
  if (sort.value === 'price-asc') list = [...list].sort((a, b) => a.price - b.price)
  if (sort.value === 'price-desc') list = [...list].sort((a, b) => b.price - a.price)
  return list
})

// ---------- "Cargar más" ----------
const PAGE = 8
const visible = ref(PAGE)
watch([filtered], () => { visible.value = PAGE })
const shown = computed(() => filtered.value.slice(0, visible.value))
const hasMore = computed(() => visible.value < filtered.value.length)
</script>

<template>
  <div class="textured">
  <!-- Fondo crema texturizado global (decisión del cliente, jul 2026);
       las fotos de producto siguen mandando: cards siempre sobre blanco.
       El div raíz único se queda: un comentario a nivel raíz rompe
       pageTransition en dev. -->
  <div class="plp">
    <Breadcrumb
      :items="[
        { label: 'Inicio', to: '/' },
        { label: publico?.nombre ?? '' },
      ]"
    />

    <CategoryTabs :active-slug="slug" class="plp__tabs" />

    <!-- chips de subcategoría del público actual ("Todos" = sin filtro) -->
    <nav v-if="publico && publico.subcategorias.length" class="subchips" aria-label="Subcategorías">
      <NuxtLink
        :to="`/categoria/${slug}`"
        class="subchip"
        :class="{ on: !activeSub }"
        :aria-current="!activeSub ? 'true' : undefined"
      >Todos</NuxtLink>
      <NuxtLink
        v-for="s in publico.subcategorias"
        :key="s.slug"
        :to="{ path: `/categoria/${slug}`, query: { sub: s.slug } }"
        class="subchip"
        :class="{ on: activeSub === s.slug }"
        :aria-current="activeSub === s.slug ? 'true' : undefined"
      >{{ s.nombre }}</NuxtLink>
    </nav>

    <header class="plp__header">
      <h1 class="plp__title">{{ publico?.nombre }}<span v-if="subNombre" class="plp__sub"> · {{ subNombre }}</span></h1>
      <p class="plp__count">{{ filtered.length }} {{ filtered.length === 1 ? 'producto' : 'productos' }}</p>
    </header>

    <!-- toggle filtros (mobile) -->
    <button class="plp__filtertoggle" type="button" @click="showFilters = !showFilters">
      Filtros<span v-if="activeFilterCount"> ({{ activeFilterCount }})</span>
    </button>

    <div class="plp__layout">
      <!-- ===================== FILTROS ===================== -->
      <aside class="filters" :class="{ open: showFilters }">
        <div class="filters__head">
          <h2>Filtros</h2>
          <button v-if="activeFilterCount" type="button" class="filters__clear" @click="clearFilters">Limpiar</button>
        </div>

        <div v-if="allSizes.length" class="fgroup">
          <h3>Talla</h3>
          <div class="fpills">
            <button
              v-for="s in allSizes"
              :key="s"
              type="button"
              class="fpill"
              :class="{ on: fSizes.includes(s) }"
              @click="toggle(fSizes, s)"
            >{{ s }}</button>
          </div>
        </div>

        <div class="fgroup">
          <h3>Precio</h3>
          <label v-for="(r, i) in priceRanges" :key="i" class="fcheck">
            <input type="radio" name="price" :checked="fRange === i" @change="fRange = fRange === i ? null : i">
            <span>{{ r.label }}</span>
          </label>
        </div>

        <div v-if="allSeasons.length" class="fgroup">
          <h3>Temporada</h3>
          <label v-for="t in allSeasons" :key="t" class="fcheck">
            <input type="checkbox" :checked="fSeasons.includes(t)" @change="toggle(fSeasons, t)">
            <span>{{ t }}</span>
          </label>
        </div>
      </aside>

      <!-- ===================== RESULTADOS ===================== -->
      <div class="plp__main">
        <div class="sortbar">
          <label class="sortbar__sort">
            Ordenar:
            <select v-model="sort">
              <option value="rel">Relevancia</option>
              <option value="price-asc">Precio: menor a mayor</option>
              <option value="price-desc">Precio: mayor a menor</option>
            </select>
          </label>
        </div>

        <div v-if="showSkeleton" class="prod-grid">
          <ProductCardSkeleton v-for="i in 6" :key="i" />
        </div>
        <div v-else-if="shown.length" class="prod-grid">
          <ProductCard v-for="p in shown" :key="p.id" :product="p" />
        </div>
        <p v-else class="plp__empty">No hay productos con esos filtros. <button type="button" @click="clearFilters">Limpiar filtros</button></p>

        <div v-if="!showSkeleton && hasMore" class="plp__more">
          <KButton variant="line" @click="visible += PAGE">Cargar más</KButton>
        </div>
      </div>
    </div>
  </div>
  </div>
</template>

<style scoped>
.plp {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5) var(--space-8);
}
.plp__tabs {
  margin-top: var(--space-4);
}

/* ---------- chips de subcategoría ---------- */
.subchips {
  display: flex;
  gap: 7px;
  margin-top: var(--space-3);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.subchips::-webkit-scrollbar { display: none; }
.subchip {
  flex: 0 0 auto;
  font-weight: 600;
  font-size: 12.5px;
  padding: 6px 14px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-pill);
  white-space: nowrap;
  background: #fff;
  color: var(--ink);
  text-decoration: none;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.subchip:hover { border-color: var(--ink); }
.subchip:focus-visible {
  outline: 2px solid var(--turq);
  outline-offset: 2px;
}
.subchip.on {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}
.plp__sub {
  color: var(--mut);
  font-size: var(--text-xl);
}
@media (prefers-reduced-motion: reduce) {
  .subchip { transition: none; }
}
.plp__header {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin: var(--space-4) 0 var(--space-5);
}
.plp__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  color: var(--ink);
}
.plp__count {
  color: var(--mut);
  font-size: var(--text-md);
}
.plp__filtertoggle {
  display: none;
  font-weight: 700;
  font-size: 14px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-pill);
  padding: 9px 18px;
  background: #fff;
  cursor: pointer;
  margin-bottom: var(--space-4);
}

.plp__layout {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: var(--space-6);
  align-items: start;
}

/* ---------- filtros ---------- */
.filters {
  position: sticky;
  top: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.filters__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.filters__head h2 {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-lg);
}
.filters__clear {
  font-size: 12px;
  font-weight: 600;
  color: var(--purple);
  background: none;
  border: 0;
  cursor: pointer;
}
.fgroup h3 {
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--mut);
  font-weight: 700;
  margin-bottom: var(--space-3);
}
.fpills {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.fpill {
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-pill);
  background: #fff;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  color: var(--ink);
}
.fpill:hover { border-color: var(--ink); }
.fpill.on { background: var(--purple); border-color: var(--purple); color: #fff; }
.fcheck {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
  padding: 4px 0;
}
.fcheck input { accent-color: var(--purple); width: 16px; height: 16px; }

/* ---------- sort + grid ---------- */
.sortbar {
  display: flex;
  align-items: center;
  /* el contador oficial es "N productos" junto al título; aquí solo queda el orden */
  justify-content: flex-end;
  gap: var(--space-3);
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--line);
}
.sortbar__sort { font-size: 13px; color: var(--mut); display: flex; align-items: center; gap: 6px; }
.sortbar__sort select {
  font-family: var(--ff-body);
  font-weight: 600;
  color: var(--ink);
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
  padding: 6px 10px;
  background: #fff;
  cursor: pointer;
}
.prod-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}
.plp__empty { color: var(--mut); padding: var(--space-6) 0; }
.plp__empty button { color: var(--purple); background: none; border: 0; font-weight: 600; cursor: pointer; }
.plp__more {
  display: flex;
  justify-content: center;
  margin-top: var(--space-6);
}

/* ---------- responsive ---------- */
@media (max-width: 1023px) {
  .plp__layout { grid-template-columns: 1fr; }
  .plp__filtertoggle { display: inline-block; }
  .filters {
    position: static;
    display: none;
    padding: var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: #fff;
    margin-bottom: var(--space-5);
  }
  .filters.open { display: flex; }
  .prod-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 460px) {
  .prod-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
