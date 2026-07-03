<script setup lang="ts">
interface Props {
  name: string
  slug?: string
  image?: string
}
defineProps<Props>()
</script>

<template>
  <NuxtLink :to="slug ? `/categoria/${slug}` : '#'" class="ccard">
    <div class="cph">
      <NuxtImg v-if="image" :src="image" :alt="name" class="cphoto" width="320" height="400" />
      <PhotoPlaceholder v-else :caption="`[ ${name} ]\nfoto 4:5`" />
      <span class="cic">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </div>
    <span class="cname">{{ name }}</span>
  </NuxtLink>
</template>

<style scoped>
.ccard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  text-decoration: none;
  color: var(--ink);
}
.ccard .cph {
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: var(--r-md);
  overflow: hidden;
  position: relative;
  border: 1px solid var(--line);
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.22s var(--ease-out), transform 0.22s var(--ease-out);
}
.ccard:hover .cph {
  box-shadow: var(--shadow-lift);
  transform: translateY(-5px);
}
.ccard .cphoto {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ccard .cic {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.14);
  z-index: 2;
}
.ccard .cname {
  font-weight: 600;
  font-size: 13.5px;
}
</style>
