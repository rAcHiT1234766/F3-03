<script setup lang="ts">
// Due date and priority, worded for a technician ("Due today", "High priority").
import { ArrowDown, CalendarDays, Flag } from '@lucide/vue'
import { computed } from 'vue'
import type { JobFields } from '../domain'
import { PRIORITY_LABELS, describeDue } from '../ui'

const props = defineProps<{ fields: JobFields }>()
const due = computed(() => describeDue(props.fields.dueDate, props.fields.status))
</script>

<template>
  <span class="meta-item due" :class="`due-${due.tone}`">
    <CalendarDays :size="15" />
    <time v-if="fields.dueDate" :datetime="fields.dueDate">{{ due.text }}</time>
    <template v-else>{{ due.text }}</template>
  </span>
  <span class="meta-item" :class="`prio-${fields.priority}`">
    <Flag v-if="fields.priority !== 'low'" :size="15" />
    <ArrowDown v-else :size="15" />
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

.meta-item svg {
  color: var(--text-3);
}

.due-overdue,
.due-overdue svg {
  color: var(--danger);
  font-weight: 650;
}

.due-today,
.due-today svg {
  color: var(--warn);
  font-weight: 650;
}

.prio-high,
.prio-high svg {
  color: var(--danger);
  font-weight: 600;
}
</style>
