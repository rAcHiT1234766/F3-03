<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; title: string; headingLevel?: 1 | 2 }>()
</script>

<!-- An empty slot on the page: a dashed outline where the content would be. -->
<template>
  <div class="empty">
    <div class="empty-icon"><component :is="icon" :size="26" :stroke-width="1.75" /></div>
    <component :is="headingLevel === 1 ? 'h1' : 'h2'" class="empty-title">{{ title }}</component>
    <div class="empty-text"><slot /></div>
    <div v-if="$slots.actions" class="empty-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.empty {
  display: grid;
  justify-items: center;
  text-align: center;
  padding: 3rem 1.5rem 3.25rem;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
  background:
    repeating-linear-gradient(
      -45deg,
      transparent 0 10px,
      color-mix(in srgb, var(--text) 2.5%, transparent) 10px 11px
    ),
    var(--surface);
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  margin-bottom: 1.1rem;
  border: 1.5px solid var(--text);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 3px 0 var(--accent);
}

.empty-title {
  font-size: 1.625rem;
  font-weight: 700;
  font-stretch: var(--condensed);
  line-height: 1.1;
  letter-spacing: -0.015em;
  margin-bottom: 0.5rem;
}

.empty-text {
  max-width: 34rem;
  color: var(--text-2);
}

.empty-text :deep(p:last-child) {
  margin-bottom: 0;
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
  margin-top: 1.4rem;
}
</style>
