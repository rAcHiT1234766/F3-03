<script setup lang="ts">
import type { JobStatus } from '../domain'

defineProps<{ status: JobStatus; size?: number }>()
</script>

<!-- Empty, half or full: how far the job has come. Always shown next to the status in words. -->
<template>
  <svg
    class="status-dot"
    :width="size ?? 11"
    :height="size ?? 11"
    viewBox="0 0 12 12"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6" />
    <path v-if="status === 'in_progress'" d="M6 1.4a4.6 4.6 0 0 1 0 9.2z" fill="currentColor" />
    <circle v-else-if="status === 'completed'" cx="6" cy="6" r="4.6" fill="currentColor" />
  </svg>
</template>
