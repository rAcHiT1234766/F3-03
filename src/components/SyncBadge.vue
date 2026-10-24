<script setup lang="ts">
import { CircleAlert, CircleCheck, CloudUpload, LoaderCircle, RotateCw } from '@lucide/vue'
import { computed, type Component } from 'vue'
import { JOB_SYNC_LABELS, type JobSyncState } from '../ui'

const props = defineProps<{ state: JobSyncState; quiet?: boolean }>()

// Icon + text, so the state never depends on color alone.
const ICONS: Record<JobSyncState, Component> = {
  synced: CircleCheck,
  pending: CloudUpload,
  syncing: LoaderCircle,
  retrying: RotateCw,
  attention: CircleAlert,
}
const TONES: Record<JobSyncState, string> = {
  synced: 'badge-ok',
  pending: 'badge-info',
  syncing: 'badge-info',
  retrying: 'badge-warn',
  attention: 'badge-danger',
}
// A quiet badge (job lists) keeps "Synced" low-key so pending work stands out.
const tone = computed(() =>
  props.quiet && props.state === 'synced' ? 'badge-quiet' : TONES[props.state],
)
</script>

<template>
  <span class="badge" :class="tone" :data-sync-state="state">
    <component :is="ICONS[state]" :size="14" :class="{ spin: state === 'syncing' }" />{{
      JOB_SYNC_LABELS[state]
    }}
  </span>
</template>
