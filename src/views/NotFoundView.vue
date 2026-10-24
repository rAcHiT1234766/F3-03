<script setup lang="ts">
import { ClipboardList, MapPinOff } from '@lucide/vue'
import EmptyState from '../components/EmptyState.vue'
</script>

<template>
  <div class="page container-narrow">
    <EmptyState :icon="MapPinOff" title="Page not found" :heading-level="1">
      <p>This address does not match a FieldLog screen. Your jobs are still safe on this device.</p>
      <template #actions>
        <RouterLink class="btn btn-primary" to="/jobs"
          ><ClipboardList :size="18" />Go to jobs</RouterLink
        >
      </template>
    </EmptyState>
  </div>
</template>
