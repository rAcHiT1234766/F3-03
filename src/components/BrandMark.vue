<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

<!-- The app icon (public/favicon.svg) as an inline, decorative mark. -->
<template>
  <svg
    class="brand-mark"
    :width="size ?? 32"
    :height="size ?? 32"
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <rect width="64" height="64" rx="14" fill="#1f6f5c" />
    <rect x="18" y="15" width="28" height="36" rx="4" fill="#fff" />
    <rect x="26" y="11.5" width="12" height="7" rx="2.2" fill="#12483b" />
    <path
      d="M23.7 34.6 29.4 40.3 40.3 28.2"
      fill="none"
      stroke="#1f6f5c"
      stroke-width="4.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
