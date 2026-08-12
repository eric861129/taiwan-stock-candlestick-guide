<script setup lang="ts">
import { computed } from 'vue';
import { SITE_BASE } from '../domain/site/navigation';
import { getPatternCard } from '../domain/patterns/catalog';
import type {
  AnalysisContext,
  AnalysisResult,
  PatternMatchResult,
  RuleEvaluation,
  StockSnapshot,
  UnavailableReason,
} from '../domain/market-data/types';

/** 保留市場快照與官方預期日期，避免與單一股票的日 K 資料截止日混用。 */
interface MarketSnapshotMetadata {
  marketSnapshotCutoffDate: string | null;
  officialExpectedCutoffDate: string | null;
}

const props = defineProps<{
  result: AnalysisResult;
  snapshot: StockSnapshot | null;
  marketSnapshotMetadata: MarketSnapshotMetadata;
}>();

const context = computed<AnalysisContext | undefined>(() => props.result.context);

const statusHeading = computed(() => {
  switch (props.result.status) {
    case 'matched': return '候選型態';
    case 'no-clear-pattern': return '無明顯型態';
    case 'insufficient-evidence': return '證據不足';
    default: return '暫時無法分析';
  }
});

const nextAction = computed(() => {
  switch (props.result.status) {
    case 'matched': return '下一步：逐條核對候選卡的符合、未符合與失效條件，再回到對應課程複習。';
    case 'no-clear-pattern': return '下一步：回到圖表核對背景、位置與資料限制；沒有候選也是可解釋的結果。';
    case 'insufficient-evidence': return '下一步：請於資料完整後重新查詢，並先確認資料截止日與公司行動提示。';
    default: return unavailableDescription(props.result.reason);
  }
});

const reasonCodeLabels: Record<string, string> = {
  'official-no-quote': '官方在交易日明示未提供完整 OHLC；系統不補值，也不跨越該日建立型態視窗。',
  'official-suspension': '交易所公告該股票停止買賣；系統保留公告證據，不補值，也不跨越停牌區間建立型態視窗。',
  'no-completed-bars': '沒有可用的已完成日 K，無法建立比對視窗。',
  'insufficient-evidence': '可用資料不足以可靠評估所有必要條件。',
  'prior-body-window-unavailable': '前段實體比較窗不足，無法可靠比較相對大小。',
  'comparison-unit-unavailable': '價格比較單位不足，無法用既定容忍範圍比對。',
  'range-unavailable': '目標日 K 的價格區間無法計算，不能安全判讀幾何條件。',
  'single-candle-data-unavailable': '單根 K 的必要價格資料不足，不能安全判讀形狀。',
  'incomplete-bar': '候選窗含未完成日 K，因此本次不參與計分。',
  'price-continuity-action-intersects-window': '公司行動影響候選窗的價格連續性，因此本次不參與計分。',
  'optional-context-unavailable': '部分背景資訊不足，該補充條件未納入判讀。',
  'missing-target-bar': '目標日 K 不完整，無法建立候選條件。',
};

function reasonDescription(reasonCode: string): string {
  return reasonCodeLabels[reasonCode] ?? '部分必要資料或規則條件無法確認，因此本次不以猜測補足。';
}

function unavailableDescription(reason: UnavailableReason): string {
  switch (reason) {
    case 'not-found':
      return '找不到這個股票代碼。下一步：請確認代碼後重新查詢。';
    case 'unsupported-security':
      return '此證券尚未納入第一版普通股比對範圍。下一步：請改選支援的普通股。';
    case 'load-error':
      return '盤後資料暫時無法載入。下一步：請稍後重新查詢。';
    case 'schema-error':
      return '資料完整性驗證失敗，已停止型態比對。下一步：請稍後重新載入，若持續發生請回報資料版本。';
  }
}

function fallbackDescription(result: AnalysisResult): string {
  return result.status === 'unavailable'
    ? unavailableDescription(result.reason)
    : '分析結果缺少必要資料，請重新查詢。';
}

function freshnessLabel(value: AnalysisContext['freshness']): string {
  const labels: Record<AnalysisContext['freshness'], string> = {
    fresh: '資料截止日符合目前預期交易日',
    'one-session-behind': '落後一個交易日，請留意非最新盤後資料',
    stale: '落後兩個以上交易日，請以截止日為準解讀',
    unknown: '交易日曆不足，無法確認資料是否新鮮',
  };
  return labels[value];
}

function resultTitle(value: AnalysisContext): string {
  return value.freshness === 'stale'
    ? `截至 ${value.cutoffDate} 的型態相似度分析`
    : `${value.cutoffDate} 的型態相似度分析`;
}

function timeframeLabel(value: AnalysisContext['timeframe']): string {
  return ({ '1d': '日 K', '1w': '週 K', '1m': '月 K' } as const)[value];
}

function priceModeLabel(value: AnalysisContext['priceMode']): string {
  return value === 'adjusted' ? '向後還原價格' : '官方原始價格';
}

function ruleStateLabel(evaluation: RuleEvaluation): string {
  if (evaluation.group === 'invalidating' && evaluation.state === 'met') {
    return '失效條件成立';
  }
  const labels: Record<RuleEvaluation['state'], string> = {
    met: '符合',
    'not-met': '未符合',
    unavailable: '目前無法評估',
  };
  return labels[evaluation.state];
}

function ruleGroupLabel(evaluation: RuleEvaluation): string {
  const labels: Record<RuleEvaluation['group'], string> = {
    required: '必要條件',
    context: '背景條件',
    supporting: '補充條件',
    invalidating: '失效條件',
  };
  return labels[evaluation.group];
}

function cardFor(match: PatternMatchResult) {
  return getPatternCard(match.cardId);
}

function lessonHref(lesson: string): string {
  return lesson.startsWith('/') ? `${SITE_BASE}${lesson.slice(1)}` : lesson;
}

function actionLabel(type: AnalysisContext['corporateActions'][number]['type']): string {
  const labels: Record<AnalysisContext['corporateActions'][number]['type'], string> = {
    'cash-dividend': '現金股利',
    'stock-dividend': '股票股利',
    'capital-reduction': '減資',
    split: '分割',
    other: '其他公司行動',
  };
  return labels[type];
}
</script>

<template>
  <section
    class="analysis-result-panel"
    aria-labelledby="analysis-result-title"
  >
    <template v-if="context">
      <h2 id="analysis-result-title">
        {{ resultTitle(context) }}：{{ statusHeading }}
      </h2>
      <p class="analysis-result-panel__action">
        {{ nextAction }}
      </p>

      <dl class="analysis-result-panel__facts">
        <div>
          <dt>本檔日 K 資料截止日</dt>
          <dd>{{ context.cutoffDate }}</dd>
        </div>
        <div>
          <dt>市場快照截止日</dt>
          <dd>{{ marketSnapshotMetadata.marketSnapshotCutoffDate ?? '無法判定' }}</dd>
        </div>
        <div>
          <dt>官方預期截止日</dt>
          <dd>{{ marketSnapshotMetadata.officialExpectedCutoffDate ?? '無法判定' }}</dd>
        </div>
        <div>
          <dt>時間週期</dt>
          <dd>{{ timeframeLabel(context.timeframe) }}（{{ context.timeframe }}）</dd>
        </div>
        <div>
          <dt>價格口徑</dt>
          <dd>{{ priceModeLabel(context.priceMode) }}</dd>
        </div>
        <div>
          <dt>分析區間</dt>
          <dd>{{ context.analyzedFrom }} 至 {{ context.analyzedTo }}（{{ context.analyzedBarCount }} 根）</dd>
        </div>
        <div>
          <dt>資料新鮮度</dt>
          <dd :class="`analysis-result-panel__freshness--${context.freshness}`">
            {{ freshnessLabel(context.freshness) }}
          </dd>
        </div>
        <div>
          <dt>已評估型態卡</dt>
          <dd>{{ context.evaluatedCardCount }} 張</dd>
        </div>
        <div>
          <dt>資料來源</dt>
          <dd>
            <ul
              v-if="snapshot"
              class="analysis-result-panel__sources"
            >
              <li
                v-for="source in snapshot.sourceUrls"
                :key="source"
              >
                <a
                  :href="source"
                  target="_blank"
                  rel="noopener noreferrer"
                >官方盤後資料來源</a>
              </li>
            </ul>
            <span v-else>資料來源暫時無法提供。</span>
          </dd>
        </div>
      </dl>

      <section
        v-if="context.warnings.length > 0"
        aria-labelledby="analysis-warning-title"
      >
        <h3 id="analysis-warning-title">
          限制與提醒
        </h3>
        <ul>
          <li
            v-for="warning in context.warnings"
            :key="warning"
          >
            {{ warning }}
          </li>
        </ul>
      </section>

      <section
        v-if="context.corporateActions.length > 0"
        aria-labelledby="analysis-action-title"
      >
        <h3 id="analysis-action-title">
          公司行動
        </h3>
        <ul>
          <li
            v-for="action in context.corporateActions"
            :key="`${action.date}-${action.type}`"
          >
            {{ action.date }}：{{ actionLabel(action.type) }}；{{ action.affectsPriceContinuity ? '影響候選窗的價格連續性，這次不納入該窗比對。' : '不影響候選窗的價格連續性。' }}
            <a
              :href="action.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
            >查看官方來源</a>
          </li>
        </ul>
      </section>

      <section
        v-if="context.unavailableCardIds.length > 0"
        aria-labelledby="analysis-limit-title"
      >
        <h3 id="analysis-limit-title">
          無法完整評估的型態卡
        </h3>
        <p>{{ context.unavailableCardIds.length }} 張卡因資料量、價格精度或公司行動限制未納入候選。</p>
      </section>

      <section
        v-if="result.status === 'matched'"
        aria-labelledby="analysis-candidate-title"
      >
        <h3 id="analysis-candidate-title">
          候選型態（最多三張）
        </h3>
        <article
          v-for="match in result.matches"
          :key="match.cardId"
          class="analysis-result-panel__candidate"
        >
          <h4>{{ cardFor(match).nameZhTw }}：{{ match.label }}（規則符合度 {{ match.score }}）</h4>
          <p>此分數只表示規則符合度；不是未來價格、機率或買賣建議。</p>
          <ul class="analysis-result-panel__rules">
            <li
              v-for="evaluation in match.evaluations"
              :key="evaluation.ruleId"
              :class="`analysis-result-panel__rule--${evaluation.state}`"
            >
              <strong>{{ ruleGroupLabel(evaluation) }}：{{ ruleStateLabel(evaluation) }}</strong>
              {{ evaluation.label }}（{{ evaluation.explanation }}）
            </li>
          </ul>
          <h5>失效方式</h5>
          <ul>
            <li
              v-for="invalidation in cardFor(match).invalidationGuidance"
              :key="invalidation"
            >
              {{ invalidation }}
            </li>
          </ul>
          <p>
            對應課程：
            <a
              v-for="lesson in cardFor(match).lessonLinks"
              :key="lesson"
              :href="lessonHref(lesson)"
            >{{ lesson }}</a>
          </p>
        </article>
      </section>

      <section
        v-else-if="result.status === 'no-clear-pattern'"
        aria-labelledby="analysis-no-clear-title"
      >
        <h3 id="analysis-no-clear-title">
          本次已檢查的條件
        </h3>
        <p>已依可用日 K 評估 {{ context.evaluatedCardCount }} 張可評估的教學卡；本次沒有候選同時達到必要條件與規則門檻。</p>
        <p>下一步：可回到上方圖表核對背景、位置與資料限制，再閱讀對應課程。</p>
      </section>

      <section
        v-else-if="result.status === 'insufficient-evidence'"
        aria-labelledby="analysis-evidence-title"
      >
        <h3 id="analysis-evidence-title">
          本次無法完成的條件
        </h3>
        <ul class="analysis-result-panel__reason-list">
          <li
            v-for="reasonCode in result.reasonCodes"
            :key="reasonCode"
          >
            {{ reasonDescription(reasonCode) }}
          </li>
        </ul>
        <p>下一步：請於資料完整後重新查詢，並先確認資料截止日與公司行動提示。</p>
      </section>

      <section
        v-else-if="result.status === 'unavailable'"
        aria-labelledby="analysis-error-title"
      >
        <h3 id="analysis-error-title">
          系統訊息
        </h3>
        <p role="alert">
          {{ unavailableDescription(result.reason) }}
        </p>
      </section>
    </template>
    <template v-else>
      <h2 id="analysis-result-title">
        暫時無法分析
      </h2>
      <p role="alert">
        {{ fallbackDescription(result) }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.analysis-result-panel {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.analysis-result-panel__action {
  padding-left: 0.75rem;
  border-left: 4px solid var(--vp-c-brand-1);
}

.analysis-result-panel__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
  gap: 0.75rem;
}

.analysis-result-panel__facts > div,
.analysis-result-panel__candidate {
  padding: 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.5rem;
  background: var(--vp-c-bg);
}

.analysis-result-panel dt {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}

.analysis-result-panel dd {
  margin: 0.25rem 0 0;
}

.analysis-result-panel__sources,
.analysis-result-panel__rules,
.analysis-result-panel__reason-list {
  margin: 0;
  padding-left: 1.2rem;
}

.analysis-result-panel__freshness--stale {
  color: #9d352a;
  font-weight: 700;
}

.analysis-result-panel__freshness--one-session-behind {
  color: #855b00;
  font-weight: 700;
}

.analysis-result-panel__rule--met {
  color: #1f633f;
}

.analysis-result-panel__rule--not-met {
  color: #7a3c30;
}

.analysis-result-panel__rule--unavailable {
  color: #65564e;
}

.analysis-result-panel__candidate {
  margin-top: 1rem;
}

.analysis-result-panel__candidate h4,
.analysis-result-panel__candidate h5 {
  margin-top: 0;
}

.analysis-result-panel__candidate a + a::before {
  content: '、';
}
</style>
