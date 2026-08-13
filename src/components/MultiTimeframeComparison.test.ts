import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { MultiTimeframeAnalysisResult } from '../domain/multi-timeframe';
import MultiTimeframeComparison from './MultiTimeframeComparison.vue';

const snapshots = (['1m', '1w', '1d'] as const).map((timeframe, index) => ({
  timeframe,
  learningRole: (['long-term-background', 'medium-term-structure', 'short-term-check'] as const)[index],
  snapshot: {
    schemaVersion: 4,
    code: '2330',
    name: '台積電',
    market: 'TWSE' as const,
    securityType: 'common-stock' as const,
    priceMode: 'raw' as const,
    timeframe,
    currency: 'TWD' as const,
    comparisonUnitPolicy: { version: 1, effectiveFrom: '2026-01-01', sourceUrl: 'https://example.com' },
    bars: [],
    noQuoteEvidence: [],
    corporateActions: [],
    sourceUrls: [],
  },
  cutoffDate: '2026-08-12',
  latestCompletedBarDate: null,
  availableCompletedBarCount: 0,
  formingBar: null,
  structureAnalysis: {
    status: 'insufficient-evidence' as const,
    matcherVersion: 'structure-v2' as const,
    timeframe,
    priceMode: 'raw' as const,
    cutoffDate: '2026-08-12',
    features: {
      configVersion: 'structure-features-v2' as const,
      sourceBarCount: 0,
      analyzedBarCount: 0,
      smoothedClose: [],
      atr: { version: 'atr-v1' as const, period: 14, latest: null, values: [] },
      pivots: [],
      warnings: [],
    },
    candidates: [],
    nearMisses: [],
    reasonCodes: ['too-few-bars'],
  },
  patternAnalysis: { status: 'unavailable' as const, reason: 'load-error' as const, message: 'fixture' },
  selectedCandidate: null,
  selectedCandidateId: null,
  selectedStructureId: null,
  backgroundDirection: 'undetermined' as const,
  backgroundHint: `${timeframe} 尚無方向`,
  warnings: [],
}));

const analysis: MultiTimeframeAnalysisResult = {
  code: '2330',
  requestedPriceMode: 'raw',
  priceMode: 'raw',
  priceModeResolution: 'requested',
  cutoffDate: '2026-08-12',
  timeframes: snapshots,
  summary: { state: 'insufficient-evidence', label: '證據不足', explanation: '保留原結果' },
  warnings: [],
};

describe('MultiTimeframeComparison', () => {
  it('keeps three independent charts in month, week, and day reading order', () => {
    const wrapper = mount(MultiTimeframeComparison, { props: { analysis } });

    expect(wrapper.findAll('[data-timeframe-chart]').map((item) => item.attributes('data-timeframe-chart')))
      .toEqual(['1m', '1w', '1d']);
    expect(wrapper.text()).toContain('月 K');
    expect(wrapper.text()).toContain('週 K');
    expect(wrapper.text()).toContain('日 K');
    expect(wrapper.text()).toContain('不把不同週期的錨點畫在同一張圖上');
  });
});
