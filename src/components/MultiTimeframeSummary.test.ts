import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MultiTimeframeSummary from './MultiTimeframeSummary.vue';

const periods = [
  {
    timeframe: '1d' as const,
    cutoffDate: '2026-08-12',
    availableBarCount: 120,
    priceMode: 'raw' as const,
    background: 'up' as const,
    analysisStatus: 'matched' as const,
    candidates: [{
      candidateId: 'daily-range',
      name: '箱型區間',
      ruleFit: 88,
      status: 'forming' as const,
    }],
  },
  {
    timeframe: '1w' as const,
    cutoffDate: '2026-08-08',
    availableBarCount: 96,
    priceMode: 'adjusted' as const,
    background: 'up' as const,
    analysisStatus: 'matched' as const,
    candidates: [{
      candidateId: 'weekly-flag',
      name: '旗形整理',
      ruleFit: 81,
      status: 'confirmed' as const,
    }],
  },
  {
    timeframe: '1m' as const,
    cutoffDate: '2026-07-31',
    availableBarCount: 84,
    priceMode: 'adjusted' as const,
    background: 'neutral' as const,
    analysisStatus: 'no-clear-pattern' as const,
    candidates: [],
  },
];

describe('MultiTimeframeSummary', () => {
  it('orders independent month, week, and day facts without creating a combined score', () => {
    const wrapper = mount(MultiTimeframeSummary, {
      props: {
        periods,
        overallStatus: 'partially-aligned',
        activeTimeframe: '1d',
        selectedCandidateIds: { '1d': 'daily-range', '1w': 'weekly-flag', '1m': null },
      },
    });

    expect(wrapper.findAll('[data-timeframe-summary]').map((item) => item.attributes('data-timeframe-summary')))
      .toEqual(['1m', '1w', '1d']);
    expect(wrapper.text()).toContain('部分一致');
    expect(wrapper.text()).toContain('2026-07-31');
    expect(wrapper.text()).toContain('84 根');
    expect(wrapper.text()).toContain('向後還原價格');
    expect(wrapper.text()).toContain('中性背景');
    expect(wrapper.text()).toContain('旗形整理');
    expect(wrapper.text()).toContain('規則符合度 81');
    expect(wrapper.find('[data-combined-score]').exists()).toBe(false);
  });

  it('keeps the active timeframe and each candidate selection controlled by parent props and emits', async () => {
    const wrapper = mount(MultiTimeframeSummary, {
      props: {
        periods,
        overallStatus: 'aligned',
        activeTimeframe: '1d',
        selectedCandidateIds: { '1d': 'daily-range', '1w': null, '1m': null },
      },
    });

    const dayTab = wrapper.get('[data-timeframe-tab="1d"]');
    expect(dayTab.attributes('aria-pressed')).toBe('true');
    await dayTab.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('select-timeframe')?.at(-1)).toEqual(['1w']);

    await wrapper.get('[data-summary-candidate="weekly-flag"]').trigger('click');
    expect(wrapper.emitted('select-candidate')?.at(-1)).toEqual([{
      timeframe: '1w',
      candidateId: 'weekly-flag',
    }]);

    await wrapper.setProps({ activeTimeframe: '1w' });
    expect(wrapper.get('[data-summary-selection-live]').text()).toContain('週 K');
    expect(wrapper.get('[data-timeframe-tab="1w"]').attributes('aria-pressed')).toBe('true');
  });

  it.each([
    ['aligned', '週期一致'],
    ['partially-aligned', '部分一致'],
    ['divergent', '週期分歧'],
    ['insufficient-evidence', '證據不足'],
  ] as const)('shows the fixed overall state %s as %s', (overallStatus, label) => {
    const wrapper = mount(MultiTimeframeSummary, {
      props: {
        periods,
        overallStatus,
        activeTimeframe: '1d',
      },
    });

    expect(wrapper.get('[data-multitimeframe-overall-status]').text()).toBe(label);
  });
});
