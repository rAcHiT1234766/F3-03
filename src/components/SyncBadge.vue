<script setup lang="ts">
import { computed } from 'vue'
import { JOB_SYNC_LABELS, type JobSyncState } from '../ui'

const props = defineProps<{ state: JobSyncState }>()

// Shape + text, so the state never depends on color alone.
const ICONS: Record<JobSyncState, string> = {
  synced: '✓',
  pending: '●',
  syncing: '↻',
  retrying: '⟳',
  attention: '!',
}
const TONES: Record<JobSyncState, string> = {
  synced: 'badge-ok',
  pending: '',
  syncing: '',
  retrying: 'badge-warn',
  attention: 'badge-danger',
}
const tone = computed(() => TONES[props.state])
</script>

<template>
  <span class="badge" :class="tone" :data-sync-state="state">
    <span aria-hidden="true">{{ ICONS[state] }}</span
    >{{ JOB_SYNC_LABELS[state] }}
  </span>
</template>
