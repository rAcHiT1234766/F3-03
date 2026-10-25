<script setup lang="ts">
// Due date and priority, worded for a technician ("Due today", "High priority").
import { ArrowDown, Flag } from '@lucide/vue'
import { computed } from 'vue'
import type { JobFields } from '../domain'
import { PRIORITY_LABELS, describeDue } from '../ui'

const props = defineProps<{ fields: JobFields }>()
const due = computed(() => describeDue(props.fields.dueDate, props.fields.status))
</script>

<template>
  <span class="meta-item due" :class="`due-${due.tone}`">
    <time v-if="fields.dueDate" :datetime="fields.dueDate">{{ due.text }}</time>
    <template v-else>{{ due.text }}</template>
  </span>
  <span class="meta-item prio" :class="`prio-${fields.priority}`">
    <Flag v-if="fields.priority === 'high'" :size="14" />
    <ArrowDown v-else-if="fields.priority === 'low'" :size="14" />
    {{ PRIORITY_LABELS[fields.priority] }}
  </span>
</template>

<style scoped>
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-2);
  font-size: 0.875rem;
  white-space: nowrap;
}

.due-none,
.due-done {
  color: var(--text-3);
}

.due-overdue {
  color: var(--danger);
  font-weight: 650;
}

.due-today {
  color: var(--accent-ink);
  font-weight: 650;
}

.due-soon {
  color: var(--text);
  font-weight: 550;
}

.prio-high {
  color: var(--danger);
  font-weight: 600;
}

.prio-normal,
.prio-low {
  color: var(--text-3);
}
</style>
