<script setup lang="ts">
import { CalendarClock, CircleCheck, Wrench } from '@lucide/vue'
import type { Component } from 'vue'
import { STATUS_LABELS, type JobStatus } from '../domain'

defineProps<{ status: JobStatus }>()

const ICONS: Record<JobStatus, Component> = {
  scheduled: CalendarClock,
  in_progress: Wrench,
  completed: CircleCheck,
}
</script>

<template>
  <span class="pill" :class="`pill-${status}`">
    <component :is="ICONS[status]" :size="14" />{{ STATUS_LABELS[status] }}
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 650;
  line-height: 1.35;
  white-space: nowrap;
  border: 1px solid transparent;
}

.pill-scheduled {
  background: var(--st-scheduled-soft);
  color: var(--st-scheduled);
}

.pill-in_progress {
  background: var(--st-progress-soft);
  color: var(--st-progress);
}

.pill-completed {
  background: var(--st-done-soft);
  color: var(--st-done);
}

@media (forced-colors: active) {
  .pill {
    border-color: CanvasText;
  }
}
</style>
