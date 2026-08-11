<script setup lang="ts">
import { computed, ref } from 'vue';
import { normalizeStockCode } from '../domain/market-data/client';
import type { MarketDataManifest, MarketDataSymbol } from '../domain/market-data/schema';

const props = withDefaults(defineProps<{
  manifest: MarketDataManifest | null;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  selected: [symbol: MarketDataSymbol];
}>();

const codeInput = ref('');
const errorMessage = ref('');
const statusMessage = ref('');
const canSearch = computed(() => props.manifest !== null && !props.disabled);

function clearMessages(): void {
  errorMessage.value = '';
  statusMessage.value = '';
}

function submit(): void {
  clearMessages();
  if (!props.manifest) {
    errorMessage.value = '支援股票清冊尚未載入，請稍後重新查詢。';
    return;
  }

  const code = normalizeStockCode(codeInput.value);
  if (!code) {
    errorMessage.value = '請輸入支援股票清冊中的 4 至 6 位普通股代碼。';
    return;
  }

  const symbol = props.manifest.symbols.find((item) => item.code === code);
  if (!symbol) {
    errorMessage.value = '找不到這個股票代碼。請確認代碼後重新查詢。';
    return;
  }
  if (symbol.securityType !== 'common-stock') {
    errorMessage.value = '此證券不是第一版支援的普通股。請輸入上市或上櫃普通股代碼。';
    return;
  }

  codeInput.value = code;
  statusMessage.value = `已確認 ${symbol.code} ${symbol.name}（${symbol.market === 'TWSE' ? '上市' : '上櫃'}普通股），正在載入盤後資料。`;
  emit('selected', symbol);
}
</script>

<template>
  <form
    class="stock-code-search"
    data-stock-search
    aria-label="股票型態比對搜尋"
    @submit.prevent="submit"
  >
    <label for="stock-code-input">
      股票代碼
      <span class="stock-code-search__hint">僅支援清冊中的上市、上櫃普通股；可輸入全形數字。</span>
    </label>
    <div class="stock-code-search__controls">
      <input
        id="stock-code-input"
        v-model="codeInput"
        name="stock-code"
        inputmode="numeric"
        autocomplete="off"
        maxlength="6"
        placeholder="例如：2330"
        :disabled="!canSearch"
        @input="clearMessages"
      >
      <button
        type="submit"
        :disabled="!canSearch"
      >
        {{ disabled ? '載入中…' : '查詢盤後資料' }}
      </button>
    </div>
    <p
      v-if="statusMessage"
      class="stock-code-search__status"
      aria-live="polite"
    >
      {{ statusMessage }}
    </p>
    <p
      v-if="errorMessage"
      class="stock-code-search__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>
  </form>
</template>

<style scoped>
.stock-code-search {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.stock-code-search label {
  display: grid;
  gap: 0.25rem;
  color: var(--vp-c-text-1);
  font-weight: 700;
}

.stock-code-search__hint {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  font-weight: 400;
}

.stock-code-search__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.stock-code-search input,
.stock-code-search button {
  min-height: 2.75rem;
  border-radius: 0.45rem;
  font: inherit;
}

.stock-code-search input {
  min-width: min(100%, 16rem);
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.stock-code-search button {
  padding: 0.5rem 1rem;
  border: 1px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: #fff;
  cursor: pointer;
}

.stock-code-search button:disabled,
.stock-code-search input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.stock-code-search__status,
.stock-code-search__error {
  margin: 0;
}

.stock-code-search__error {
  padding-left: 0.75rem;
  border-left: 4px solid #b54a3c;
  color: #7f2b22;
}

@media (max-width: 480px) {
  .stock-code-search__controls {
    display: grid;
  }

  .stock-code-search input,
  .stock-code-search button {
    width: 100%;
  }
}
</style>
