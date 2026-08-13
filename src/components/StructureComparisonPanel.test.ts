import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type {
  StructureAnalysisResult,
  StructureCandidate,
  StructureId,
} from '../domain/structures/types';
import PatternGlyph from './PatternGlyph.vue';
import StructureComparisonPanel from './StructureComparisonPanel.vue';

function candidate(
  structureId: StructureId,
  rank: number,
  status: StructureCandidate['status'] = 'forming',
): StructureCandidate {
  const candidateId = `${structureId}:1d:raw:2026-07-${rank}:2026-08-${rank}`;
  const window = {
    version: 'structure-window-v1' as const,
    startBarIndex: rank,
    endBarIndex: rank + 20,
    startDate: `2026-07-0${rank}`,
    endDate: `2026-08-0${rank}`,
    barCount: 21,
  };

  return {
    candidateId,
    structureId,
    timeframe: '1d',
    priceMode: 'raw',
    ruleFit: 100 - rank,
    geometryCompleteness: 95,
    dataCompleteness: 100,
    status,
    direction: status === 'confirmed' ? 'down' : 'undetermined',
    window,
    anchors: [],
    boundaries: [],
    evaluations: [{
      ruleId: `${structureId}-required`,
      label: '主要轉折點完整',
      group: 'required',
      state: 'met',
      explanation: '已找到規則要求的主要轉折點。',
    }],
    confirmationCondition: '完成 K 棒有效離開確認線後確認。',
    invalidationCondition: '完成 K 棒返回失效線另一側時失效。',
    warnings: ['形成區間仍可能隨新資料改變。'],
    matcherVersion: 'structure-v2',
    overlay: {
      candidateId,
      window,
      segments: [],
      anchors: [],
      scenario: status === 'confirmed' ? {
        label: '條件式情境，非價格預測',
        direction: 'down',
        conditions: [{
          kind: 'continuation',
          label: '延續情境',
          condition: '後續完成 K 棒仍在確認線下方。',
        }],
      } : undefined,
    },
  };
}

function result(candidates: readonly StructureCandidate[]): StructureAnalysisResult {
  return {
    status: candidates.length > 0 ? 'matched' : 'no-clear-pattern',
    matcherVersion: 'structure-v2',
    timeframe: '1d',
    priceMode: 'raw',
    cutoffDate: '2026-08-11',
    features: {
      configVersion: 'structure-features-v2',
      sourceBarCount: 60,
      analyzedBarCount: 60,
      smoothedClose: [],
      atr: { version: 'atr-v1', period: 14, latest: 3, values: [] },
      pivots: [],
      warnings: [],
    },
    candidates,
    nearMisses: [],
    reasonCodes: [],
  };
}

describe('StructureComparisonPanel', () => {
  it('renders the ranked true candidates in source order with a directly visible teaching diagram', () => {
    const candidates = [
      candidate('range', 1),
      candidate('double-top', 2, 'confirmed'),
      candidate('triangle-consolidation', 3),
      candidate('flag-consolidation', 4),
    ];
    const wrapper = mount(StructureComparisonPanel, {
      props: {
        structureResult: result(candidates),
        selectedStructureCandidateId: candidates[1].candidateId,
      },
    });

    const cards = wrapper.findAll('[data-structure-comparison-candidate]');
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.get('h3').text())).toEqual([
      '第 1 名・區間',
      '第 2 名・雙重頂',
      '第 3 名・三角形整理',
    ]);
    expect(wrapper.findAllComponents(PatternGlyph)).toHaveLength(3);
    expect(wrapper.text()).not.toContain('旗形整理');
  });

  it('marks the selected candidate, exposes its evidence, and emits only the candidate id', async () => {
    const candidates = [
      candidate('range', 1),
      candidate('double-top', 2, 'confirmed'),
    ];
    const wrapper = mount(StructureComparisonPanel, {
      props: {
        structureResult: result(candidates),
        selectedStructureCandidateId: candidates[1].candidateId,
      },
    });

    const cards = wrapper.findAll('[data-structure-comparison-candidate]');
    expect(cards[0].text()).toContain('形成中');
    expect(cards[1].text()).toContain('已確認');
    expect(cards[1].text()).toContain('規則符合度 98');
    expect(cards[1].text()).toContain('確認條件：完成 K 棒有效離開確認線後確認。');
    expect(cards[1].text()).toContain('失效條件：完成 K 棒返回失效線另一側時失效。');
    expect(cards[1].get('details').attributes()).toHaveProperty('open');
    expect(cards[0].get('details').attributes('open')).toBeUndefined();
    expect(cards[1].text()).toContain('主要轉折點完整：符合');
    expect(cards[1].text()).toContain('延續情境：後續完成 K 棒仍在確認線下方。');

    const buttons = wrapper.findAll('button[data-select-structure-candidate]');
    expect(buttons[0].attributes('aria-pressed')).toBe('false');
    expect(buttons[1].attributes('aria-pressed')).toBe('true');
    expect(buttons[1].attributes('aria-expanded')).toBeUndefined();
    await buttons[0].trigger('click');
    expect(wrapper.emitted('select-structure-candidate')).toEqual([[candidates[0].candidateId]]);
  });

  it('renders an honest empty state without promoting near misses into the ranking', () => {
    const structureResult = result([]);
    structureResult.nearMisses = [{
      structureId: 'rounding-top',
      status: 'insufficient-evidence',
      ruleFit: 88,
      missingConditions: ['圓弧轉折尚未完成'],
      evaluations: [],
    }];
    const wrapper = mount(StructureComparisonPanel, {
      props: { structureResult },
    });

    expect(wrapper.findAll('[data-structure-comparison-candidate]')).toHaveLength(0);
    expect(wrapper.get('[role="status"]').text()).toContain('不會為了補滿三個');
    expect(wrapper.text()).not.toContain('圓弧頂');
  });
});
