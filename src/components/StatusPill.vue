<script setup lang="ts">
import { STATUS_LABELS, type JobStatus } from '../domain'
import StatusDot from './StatusDot.vue'

defineProps<{ status: JobStatus }>()
</script>

<!-- A status stamp: printed caps with a dot that fills as the job progresses. -->
<template>
  <span class="stamp" :class="`stamp-${status}`">
    <StatusDot :status="status" />{{ STATUS_LABELS[status] }}
  </span>
</template>

<style scoped>
.stamp {
  --tone: var(--st-scheduled);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.5rem 0.2rem 0.4rem;
  border: 1px solid color-mix(in srgb, var(--tone) 42%, transparent);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--tone) 7%, var(--surface));
  color: var(--tone);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.stamp-in_progress {
  --tone: var(--st-progress);
}

.stamp-completed {
  --tone: var(--st-done);
}

@media (forced-colors: active) {
  .stamp {
    border-color: CanvasText;
  }
}
</style>
