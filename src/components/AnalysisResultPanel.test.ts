import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { AnalysisContext, AnalysisResult, StockSnapshot } from '../domain/market-data/types';
import AnalysisResultPanel from './AnalysisResultPanel.vue';

const context: AnalysisContext = {
  snapshotVersion: 1,
  snapshotHash: 'a'.repeat(64),
  market: 'TWSE',
  cutoffDate: '2026-08-11',
  freshness: 'fresh',
  timeframe: '1d',
  analyzedFrom: '2026-08-10',
  analyzedTo: '2026-08-11',
  analyzedBarCount: 2,
  dataCompleteness: 100,
  reasonCodes: [],
  evaluatedCardCount: 17,
  unavailableCardIds: [],
  affectedRuleIds: [],
  suppressedRules: [],
  corporateActions: [],
  warnings: [],
};

const snapshot: StockSnapshot = {
  schemaVersion: 1,
  code: '2330',
  name: '台積電',
  market: 'TWSE',
  securityType: 'common-stock',
  priceMode: 'raw',
  currency: 'TWD',
  comparisonUnitPolicy: {
    version: 1,
    effectiveFrom: '2026-08-11',
    sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
  },
  bars: [{
    date: '2026-08-11', open: 100, high: 105, low: 95, close: 102,
    volumeShares: 1000, sourcePrecision: 0.01, comparisonUnit: 0.5,
  }],
  corporateActions: [],
  sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
};

function render(result: AnalysisResult) {
  return mount(AnalysisResultPanel, { props: { result, snapshot } });
}

describe('AnalysisResultPanel guided rendering', () => {
  it('keeps matched candidates in an evidence-oriented guided state', () => {
    const wrapper = render({
      status: 'matched',
      context,
      matches: [{
        cardId: 'hammer',
        score: 90,
        label: '高度符合',
        dataCompleteness: 100,
        analyzedFrom: '2026-08-10',
        analyzedTo: '2026-08-11',
        evaluations: [],
        warnings: [],
      }],
    });

    expect(wrapper.text()).toContain('候選型態');
    expect(wrapper.text()).toContain('規則符合度');
    expect(wrapper.text()).toContain('下一步');
  });

  it('explains no-clear-pattern as checked conditions rather than an opaque empty result', () => {
    const wrapper = render({ status: 'no-clear-pattern', context, matches: [] });

    expect(wrapper.text()).toContain('本次已檢查的條件');
    expect(wrapper.text()).toContain('17 張可評估的教學卡');
    expect(wrapper.text()).toContain('下一步');
  });

  it('maps insufficient-evidence reason codes to natural Chinese without leaking the code', () => {
    const wrapper = render({
      status: 'insufficient-evidence',
      context: { ...context, reasonCodes: ['no-completed-bars', 'prior-body-window-unavailable'] },
      reasonCodes: ['no-completed-bars', 'prior-body-window-unavailable'],
    });

    expect(wrapper.text()).toContain('沒有可用的已完成日 K');
    expect(wrapper.text()).toContain('前段實體比較窗不足');
    expect(wrapper.text()).toContain('下一步');
    expect(wrapper.text()).not.toContain('no-completed-bars');
    expect(wrapper.text()).not.toContain('prior-body-window-unavailable');
  });

  it('maps unavailable reasons to a safe actionable message instead of rendering raw error text', () => {
    const wrapper = render({
      status: 'unavailable',
      reason: 'schema-error',
      message: 'schema-error internal diagnostic',
    });

    expect(wrapper.text()).toContain('資料完整性驗證失敗');
    expect(wrapper.text()).toContain('下一步');
    expect(wrapper.text()).not.toContain('schema-error');
    expect(wrapper.text()).not.toContain('internal diagnostic');
  });
});
