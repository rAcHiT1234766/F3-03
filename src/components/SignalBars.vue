<script setup lang="ts">
// Decorative signal meter. "drop": the bars fall away one by one and come back (sign-in cover).
// "seek": the bars light in turn, like a phone finding signal (loading). Static under reduced motion.
defineProps<{ size?: number; motion?: 'drop' | 'seek' }>()
</script>

<template>
  <svg
    class="signal"
    :class="motion ? `signal-${motion}` : null"
    :width="size ?? 40"
    :height="size ?? 40"
    viewBox="0 0 40 40"
    aria-hidden="true"
    focusable="false"
  >
    <rect class="bar bar-1" x="2" y="27" width="6" height="11" rx="1" />
    <rect class="bar bar-2" x="12" y="19" width="6" height="19" rx="1" />
    <rect class="bar bar-3" x="22" y="11" width="6" height="27" rx="1" />
    <rect class="bar bar-4" x="32" y="3" width="6" height="35" rx="1" />
  </svg>
</template>

<style scoped>
.bar {
  fill: currentcolor;
}

/* Signal falls from the top bar down to one, holds, then returns. */
.signal-drop .bar {
  animation: drop 7s var(--ease) infinite;
}

.signal-drop .bar-1 {
  animation: none;
}

.signal-drop .bar-3 {
  animation-delay: 0.35s;
}

.signal-drop .bar-2 {
  animation-delay: 0.7s;
}

@keyframes drop {
  0%,
  42% {
    opacity: 1;
  }

  47%,
  84% {
    opacity: 0.16;
  }

  89%,
  100% {
    opacity: 1;
  }
}

.signal-seek .bar {
  animation: seek 1.2s var(--ease) infinite;
  opacity: 0.2;
}

.signal-seek .bar-2 {
  animation-delay: 0.15s;
}

.signal-seek .bar-3 {
  animation-delay: 0.3s;
}

.signal-seek .bar-4 {
  animation-delay: 0.45s;
}

@keyframes seek {
  0%,
  100% {
    opacity: 0.2;
  }

  30%,
  55% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .signal .bar {
    animation: none;
    opacity: 1;
  }
}
</style>
