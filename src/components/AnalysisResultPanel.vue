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
} from '../domain/market-data/types';

const props = defineProps<{
  result: AnalysisResult;
  snapshot: StockSnapshot | null;
}>();

const context = computed<AnalysisContext | undefined>(() => (
  props.result.status === 'unavailable' ? props.result.context : props.result.context
));

const statusHeading = computed(() => {
  switch (props.result.status) {
    case 'matched': return '型態候選';
    case 'no-clear-pattern': return '無明顯型態';
    case 'insufficient-evidence': return '證據不足';
    default: return '暫時無法分析';
  }
});

const nextAction = computed(() => {
  switch (props.result.status) {
    case 'matched': return '逐條核對符合、未符合與失效條件，再回到對應課程複習。';
    case 'no-clear-pattern': return '沒有候選也是正常結果；請回到圖表核對背景、位置與資料限制。';
    case 'insufficient-evidence': return '請先確認缺少的資料或受公司行動影響的條件，不要用猜測補齊。';
    default: return '請重新查詢；若問題持續，等待下一次已驗證的盤後快照。';
  }
});

function freshnessLabel(value: AnalysisContext['freshness']): string {
  const labels: Record<AnalysisContext['freshness'], string> = {
    fresh: '資料截止日符合目前預期交易日',
    'one-session-behind': '落後一個交易日，仍可比對但請留意截止日',
    stale: '落後兩個以上交易日，僅供回顧截止日當時的資料',
    unknown: '交易日曆不足，無法確認資料是否新鮮',
  };
  return labels[value];
}

function resultTitle(value: AnalysisContext): string {
  return value.freshness === 'stale'
    ? `截至 ${value.cutoffDate} 的型態`
    : `${value.cutoffDate} 的型態相似度分析`;
}

function ruleStateLabel(evaluation: RuleEvaluation): string {
  if (evaluation.group === 'invalidating' && evaluation.state === 'met') {
    return '失效條件已觸發';
  }
  const labels: Record<RuleEvaluation['state'], string> = {
    met: '符合',
    'not-met': '不符合',
    unavailable: '暫時無法評估',
  };
  return labels[evaluation.state];
}

function ruleGroupLabel(evaluation: RuleEvaluation): string {
  const labels: Record<RuleEvaluation['group'], string> = {
    required: '必要條件',
    context: '背景條件',
    supporting: '輔助條件',
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
          <dt>資料截止日</dt>
          <dd>{{ context.cutoffDate }}</dd>
        </div>
        <div>
          <dt>時間週期</dt>
          <dd>日 K（{{ context.timeframe }}）</dd>
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
            <span v-else>快照來源暫時不可用。</span>
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
            {{ action.date }}：{{ actionLabel(action.type) }}；{{ action.affectsPriceContinuity ? '受價格連續性影響的規則已停用。' : '不影響價格連續性規則。' }}
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
          候選（最多三張）
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
        v-else-if="result.status === 'insufficient-evidence'"
        aria-labelledby="analysis-evidence-title"
      >
        <h3 id="analysis-evidence-title">
          缺少的證據
        </h3>
        <p>原因：{{ result.reasonCodes.join('、') || '未提供可評估的必要資料' }}。</p>
      </section>
      <section
        v-else-if="result.status === 'unavailable'"
        aria-labelledby="analysis-error-title"
      >
        <h3 id="analysis-error-title">
          系統訊息
        </h3>
        <p role="alert">
          {{ result.message }}
        </p>
      </section>
    </template>
    <template v-else>
      <h2 id="analysis-result-title">
        暫時無法分析
      </h2>
      <p role="alert">
        {{ result.status === 'unavailable' ? result.message : '分析結果缺少必要資料。' }}
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
.analysis-result-panel__rules {
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
