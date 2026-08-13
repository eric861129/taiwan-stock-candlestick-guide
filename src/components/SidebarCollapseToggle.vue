<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useData } from 'vitepress';

const STORAGE_KEY = 'taiwan-stock-guide:sidebar-collapsed';
const ROOT_CLASS = 'site-sidebar-collapsed';

const { frontmatter } = useData();
const isCollapsed = ref(false);
const isVisible = computed(
  () => frontmatter.value.layout !== 'home' && frontmatter.value.layout !== false,
);
const label = computed(() => (isCollapsed.value ? '展開選單' : '收合選單'));

function applySidebarState(): void {
  document.documentElement.classList.toggle(ROOT_CLASS, isCollapsed.value);
}

function toggleSidebar(): void {
  isCollapsed.value = !isCollapsed.value;
  window.localStorage.setItem(STORAGE_KEY, String(isCollapsed.value));
  applySidebarState();
}

onMounted(() => {
  isCollapsed.value = window.localStorage.getItem(STORAGE_KEY) === 'true';
  applySidebarState();
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove(ROOT_CLASS);
});
</script>

<template>
  <button
    v-if="isVisible"
    class="sidebar-collapse-toggle"
    type="button"
    :aria-expanded="!isCollapsed"
    aria-controls="VPSidebarNav"
    :title="label"
    @click="toggleSidebar"
  >
    <span
      aria-hidden="true"
      class="sidebar-collapse-toggle__icon"
    >
      {{ isCollapsed ? '›' : '‹' }}
    </span>
    <span class="sidebar-collapse-toggle__label">{{ label }}</span>
  </button>
</template>

<style scoped>
.sidebar-collapse-toggle {
  position: fixed;
  top: calc(var(--vp-nav-height) + 1rem);
  left: calc(var(--vp-sidebar-width) - 2.25rem);
  z-index: calc(var(--vp-z-index-sidebar) + 1);
  display: none;
  gap: 0.25rem;
  align-items: center;
  min-height: 2.5rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  box-shadow: var(--vp-shadow-2);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  transition: left 180ms ease, background-color 180ms ease, color 180ms ease;
}

.sidebar-collapse-toggle:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}

.sidebar-collapse-toggle__icon {
  font-size: 1.35rem;
  line-height: 0.75;
}

@media (min-width: 960px) {
  .sidebar-collapse-toggle {
    display: inline-flex;
  }

  :global(html.site-sidebar-collapsed) .sidebar-collapse-toggle {
    left: 0.75rem;
  }
}

@media (min-width: 1440px) {
  .sidebar-collapse-toggle {
    left: calc((100vw - var(--vp-layout-max-width)) / 2 + var(--vp-sidebar-width) - 4.25rem);
  }

  :global(html.site-sidebar-collapsed) .sidebar-collapse-toggle {
    left: 0.75rem;
  }
}
</style>
