<script setup lang="ts">
import type { Product } from '~~/shared/types/woo'

const props = defineProps<{ product: Product }>()

// Wishlist OCULTA por decisión aprobada: la UI era visual-only (este ref
// local no persiste). Se reactiva con ENABLE_WISHLIST cuando exista el
// store Pinia con persistencia + página de favoritos (ver README, Fase D).
const ENABLE_WISHLIST = false
const fav = ref(false)

const isSoldOut = computed(() => props.product.badges?.some(b => b.variant === 'soldout') ?? false)

const sizeLabel = computed(() => {
  if (isSoldOut.value) return 'Agotado'
  if (!props.product.sizes?.length) return ''
  return 'Tallas ' + props.product.sizes.join(' · ')
})

const to = computed(() => `/producto/${props.product.slug}`)
</script>

<template>
  <article class="pcard">
    <div class="pimg">
      <div v-if="product.badges?.length" class="pbadges">
        <KBadge v-for="(b, i) in product.badges" :key="i" :variant="b.variant">
          {{ b.label }}
        </KBadge>
      </div>

      <button v-if="ENABLE_WISHLIST" class="pfav" type="button" :aria-pressed="fav" aria-label="Añadir a favoritos" @click="fav = !fav">
        <svg width="17" height="17" viewBox="0 0 24 24" :fill="fav ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20s-7-4.6-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.4 12 20 12 20z" />
        </svg>
      </button>

      <NuxtLink :to="to" class="plink" :aria-label="product.name">
        <!-- pos top: las fotos no cuadradas (Gokú 201x624, Batman, Spider Gwen)
             se recortan desde arriba (cabeza visible); las 800x800 no se tocan -->
        <NuxtImg v-if="product.images?.[0]" :src="product.images[0]" :alt="product.name" class="pphoto" width="400" height="400" :modifiers="{ pos: 'top' }" />
        <PhotoPlaceholder v-else :caption="`[ ${product.name} ]\nfoto 1:1`" />
      </NuxtLink>
    </div>

    <div class="pbody">
      <h3 class="pname">
        <NuxtLink :to="to" class="pnamelink">{{ product.name }}</NuxtLink>
      </h3>
      <div class="pprice">
        <s v-if="product.regularPrice">{{ formatCOP(product.regularPrice) }}</s>{{ formatCOP(product.price) }}
      </div>
      <div v-if="sizeLabel" class="psize">{{ sizeLabel }}</div>
    </div>
  </article>
</template>

<style scoped>
.pcard {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* flota sutil en reposo; al hover se levanta con intención */
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.22s var(--ease-out), transform 0.22s var(--ease-out);
}
.pcard:hover {
  box-shadow: var(--shadow-lift);
  transform: translateY(-5px);
}
.pcard .pimg {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
}
.pcard .plink {
  display: block;
  width: 100%;
  height: 100%;
}
.pcard .pphoto,
.pcard .plink :deep(.photo) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.45s var(--ease-out);
}
/* Hover: la imagen escala perceptible pero sin brusquedad */
.pcard:hover .pphoto,
.pcard:hover .plink :deep(.photo) {
  transform: scale(1.06);
}
.pcard .pbadges {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 6px;
  z-index: 2;
}
.pcard .pfav {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  z-index: 2;
  background: #fff;
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: #A9A59C;
  cursor: pointer;
}
.pcard .pfav:hover,
.pcard .pfav[aria-pressed='true'] {
  color: var(--fucsia);
  border-color: var(--fucsia);
}
.pcard .pbody {
  padding: 13px 15px 15px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pcard .pname {
  font-weight: 600;
  font-size: 14.5px;
  line-height: 1.25;
  font-family: var(--ff-body);
}
.pcard .pnamelink {
  color: inherit;
  text-decoration: none;
}
.pcard .pnamelink:hover {
  color: var(--purple);
}
.pcard .pprice {
  font-weight: 700;
  font-size: 15.5px;
  margin-top: 1px;
}
.pcard .pprice s {
  font-weight: 500;
  font-size: 12px;
  color: var(--mut-2);
  margin-right: 7px;
}
.pcard .psize {
  font-weight: 600;
  font-size: 11.5px;
  color: var(--turq);
  letter-spacing: 0.02em;
}

/* Badges y precio "vivos" al hover (sutil) */
.pcard .pbadges :deep(.kbadge) {
  transition: transform 0.25s var(--ease-out);
}
.pcard:hover .pbadges :deep(.kbadge) {
  transform: translateY(-1px) scale(1.04);
}
.pcard .pprice {
  transition: transform 0.25s var(--ease-out);
}
.pcard:hover .pprice {
  transform: translateX(2px);
}

/* Accesibilidad: sin transforms si hay movimiento reducido */
@media (prefers-reduced-motion: reduce) {
  .pcard,
  .pcard .pphoto,
  .pcard .plink :deep(.photo),
  .pcard .pbadges :deep(.kbadge),
  .pcard .pprice {
    transition: none;
  }
  .pcard:hover {
    transform: none;
  }
  .pcard:hover .pphoto,
  .pcard:hover .plink :deep(.photo),
  .pcard:hover .pbadges :deep(.kbadge),
  .pcard:hover .pprice {
    transform: none;
  }
}
</style>
