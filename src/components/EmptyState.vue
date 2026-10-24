<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; title: string; headingLevel?: 1 | 2 }>()
</script>

<template>
  <div class="empty">
    <div class="empty-icon"><component :is="icon" :size="28" /></div>
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
  padding: 2.5rem 1.25rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 3.75rem;
  height: 3.75rem;
  margin-bottom: 1rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-soft-text);
}

.empty-title {
  font-size: 1.1875rem;
  margin-bottom: 0.4rem;
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
  margin-top: 1.25rem;
}
</style>
