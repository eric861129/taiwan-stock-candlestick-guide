<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const instanceId = useId();
const titleId = `${instanceId}-title`;
const descriptionId = `${instanceId}-description`;
const workspace = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let mounted = false;
let previouslyFocusedElement: HTMLElement | null = null;
let bodyOverflowBeforeOpen: string | null = null;

function lockBackgroundScroll(): void {
  if (bodyOverflowBeforeOpen !== null || typeof document === 'undefined') return;
  bodyOverflowBeforeOpen = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockBackgroundScroll(): void {
  if (bodyOverflowBeforeOpen === null || typeof document === 'undefined') return;
  document.body.style.overflow = bodyOverflowBeforeOpen;
  bodyOverflowBeforeOpen = null;
}

async function enterDialogMode(): Promise<void> {
  if (typeof document === 'undefined') return;
  previouslyFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  lockBackgroundScroll();
  await nextTick();
  closeButton.value?.focus();
}

function leaveDialogMode(): void {
  unlockBackgroundScroll();
  const returnTarget = previouslyFocusedElement?.isConnected
    ? previouslyFocusedElement
    : document.querySelector<HTMLElement>('[data-analyzer-expand]');
  returnTarget?.focus();
  previouslyFocusedElement = null;
}

function focusableElements(): HTMLElement[] {
  if (!workspace.value) return [];
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'details > summary:first-of-type',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(workspace.value.querySelectorAll<HTMLElement>(selector))
    .filter((element) => {
      if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
      let current: HTMLElement | null = element;
      while (current && current !== workspace.value) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        current = current.parentElement;
      }
      return true;
    });
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;

  const elements = focusableElements();
  if (elements.length === 0) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  const activeElement = document.activeElement;
  const focusOutsideDialog = activeElement instanceof Node && !workspace.value?.contains(activeElement);

  if (event.shiftKey && (activeElement === first || focusOutsideDialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (activeElement === last || focusOutsideDialog)) {
    event.preventDefault();
    first.focus();
  }
}

watch(() => props.open, (open) => {
  if (!mounted) return;
  if (open) void enterDialogMode();
  else leaveDialogMode();
});

onMounted(() => {
  mounted = true;
  document.addEventListener('keydown', handleDocumentKeydown);
  if (props.open) void enterDialogMode();
});

onBeforeUnmount(() => {
  mounted = false;
  document.removeEventListener('keydown', handleDocumentKeydown);
  unlockBackgroundScroll();
  const returnTarget = previouslyFocusedElement?.isConnected
    ? previouslyFocusedElement
    : document.querySelector<HTMLElement>('[data-analyzer-expand]');
  returnTarget?.focus();
});
</script>

<template>
  <section
    ref="workspace"
    data-analyzer-workspace
    class="analyzer-workspace-dialog"
    :class="{ 'analyzer-workspace-dialog--open': open }"
    :role="open ? 'dialog' : undefined"
    :aria-modal="open ? 'true' : undefined"
    :aria-labelledby="open ? titleId : undefined"
    :aria-describedby="open && description ? descriptionId : undefined"
  >
    <div class="analyzer-workspace-dialog__surface">
      <header
        v-show="open"
        class="analyzer-workspace-dialog__header"
      >
        <div>
          <h2 :id="titleId">
            {{ title }}
          </h2>
          <p
            v-if="description"
            :id="descriptionId"
          >
            {{ description }}
          </p>
        </div>
        <button
          ref="closeButton"
          type="button"
          data-dialog-close
          aria-label="關閉放大分析區"
          @click="emit('close')"
        >
          關閉放大分析區
        </button>
      </header>

      <div class="analyzer-workspace-dialog__content">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.analyzer-workspace-dialog--open {
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: auto;
  padding: clamp(0.5rem, 2vw, 1.5rem);
  background: rgb(0 0 0 / 55%);
}

.analyzer-workspace-dialog--open .analyzer-workspace-dialog__surface {
  min-height: calc(100dvh - clamp(1rem, 4vw, 3rem));
  padding: clamp(0.75rem, 2vw, 1.5rem);
  border-radius: 0.75rem;
  background: var(--vp-c-bg);
  box-shadow: var(--vp-shadow-5);
}

.analyzer-workspace-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--vp-c-divider);
}

.analyzer-workspace-dialog__header h2,
.analyzer-workspace-dialog__header p {
  margin: 0;
}

.analyzer-workspace-dialog__header p {
  margin-top: 0.25rem;
  color: var(--vp-c-text-2);
}

.analyzer-workspace-dialog__header button {
  flex: 0 0 auto;
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.45rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}

@media (max-width: 640px) {
  .analyzer-workspace-dialog--open {
    padding: 0;
  }

  .analyzer-workspace-dialog--open .analyzer-workspace-dialog__surface {
    min-height: 100dvh;
    border-radius: 0;
  }

  .analyzer-workspace-dialog__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
