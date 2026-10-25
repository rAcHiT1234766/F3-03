<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

<!-- The app icon (public/favicon.svg) as an inline, decorative mark: signal bars on a safety-orange
     tile, the last bar empty. FieldLog keeps working when the signal drops. -->
<template>
  <svg
    class="brand-mark"
    :width="size ?? 32"
    :height="size ?? 32"
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <rect width="64" height="64" rx="12" fill="#ff6b1a" />
    <rect x="12" y="38" width="7" height="10" rx="1.5" fill="#16171a" />
    <rect x="23" y="30" width="7" height="18" rx="1.5" fill="#16171a" />
    <rect x="34" y="22" width="7" height="26" rx="1.5" fill="#16171a" />
    <rect
      x="46.25"
      y="15.25"
      width="4.5"
      height="31.5"
      rx="1"
      fill="none"
      stroke="#16171a"
      stroke-width="2.5"
    />
  </svg>
</template>
