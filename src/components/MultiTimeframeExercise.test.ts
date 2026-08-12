import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MultiTimeframeExercise from './MultiTimeframeExercise.vue';

type ExerciseAnswers = {
  monthlyDirection: 'up' | 'down' | 'neutral' | 'undetermined' | null;
  monthlyKeyArea: string;
  weeklyRelationship: 'aligned' | 'partially-aligned' | 'divergent' | 'insufficient-evidence' | null;
  dailyCheck: 'forming' | 'confirmed' | 'invalid' | 'insufficient-evidence' | null;
};

const emptyAnswers: ExerciseAnswers = {
  monthlyDirection: null,
  monthlyKeyArea: '',
  weeklyRelationship: null,
  dailyCheck: null,
};

function render(answers: ExerciseAnswers = emptyAnswers, revealed = false) {
  return mount(MultiTimeframeExercise, {
    props: {
      stockName: '台積電',
      stockCode: '2330',
      cutoffDate: '2026-08-12',
      answers,
      revealed,
    },
  });
}

describe('MultiTimeframeExercise', () => {
  it('keeps the same-stock summary locked until a reader completes month, week, and day observations in order', async () => {
    const wrapper = render();

    expect(wrapper.find('[data-multitimeframe-practice]').exists()).toBe(true);
    expect(wrapper.text()).toContain('台積電（2330）');
    expect(wrapper.text()).toContain('資料截止日 2026-08-12');
    expect(wrapper.get('[data-exercise-step-button="1m"]').text()).toContain('月 K');
    expect(wrapper.get('[data-exercise-step-button="1w"]').text()).toContain('週 K');
    expect(wrapper.get('[data-exercise-step-button="1d"]').text()).toContain('日 K');
    expect(wrapper.get('[data-exercise-step-button="1w"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-exercise-step-button="1d"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-exercise-summary-locked]').text()).toContain('完成月 K、週 K、日 K 三個步驟');

    await wrapper.get('input[name="monthly-direction"][value="up"]').setValue();
    expect(wrapper.emitted('update:answers')?.at(-1)).toEqual([{
      ...emptyAnswers,
      monthlyDirection: 'up',
    }]);
    await wrapper.setProps({ answers: { ...emptyAnswers, monthlyDirection: 'up' } });
    await wrapper.get('textarea[name="monthly-key-area"]').setValue('月 K 壓力區 1,100 元附近');
    expect(wrapper.emitted('update:answers')?.at(-1)).toEqual([{
      monthlyDirection: 'up',
      monthlyKeyArea: '月 K 壓力區 1,100 元附近',
      weeklyRelationship: null,
      dailyCheck: null,
    }]);

    await wrapper.setProps({
      answers: {
        ...emptyAnswers,
        monthlyDirection: 'up',
        monthlyKeyArea: '月 K 壓力區 1,100 元附近',
      },
    });
    const weeklyStep = wrapper.get('[data-exercise-step-button="1w"]');
    expect(weeklyStep.attributes('disabled')).toBeUndefined();
    await weeklyStep.trigger('click');
    expect(weeklyStep.attributes('aria-pressed')).toBe('true');
    expect(wrapper.emitted('select-timeframe')?.at(-1)).toEqual(['1w']);

    await wrapper.get('input[name="weekly-relationship"][value="aligned"]').setValue();
    await wrapper.setProps({
      answers: {
        monthlyDirection: 'up',
        monthlyKeyArea: '月 K 壓力區 1,100 元附近',
        weeklyRelationship: 'aligned',
        dailyCheck: null,
      },
    });
    const dailyStep = wrapper.get('[data-exercise-step-button="1d"]');
    expect(dailyStep.attributes('disabled')).toBeUndefined();
    await dailyStep.trigger('click');
    expect(dailyStep.attributes('aria-pressed')).toBe('true');
    expect(wrapper.emitted('select-timeframe')?.at(-1)).toEqual(['1d']);

    await wrapper.get('input[name="daily-check"][value="confirmed"]').setValue();
    const completedAnswers = {
      monthlyDirection: 'up' as const,
      monthlyKeyArea: '月 K 壓力區 1,100 元附近',
      weeklyRelationship: 'aligned' as const,
      dailyCheck: 'confirmed' as const,
    };
    await wrapper.setProps({ answers: completedAnswers });

    const reveal = wrapper.get('[data-exercise-reveal]');
    expect(reveal.attributes('disabled')).toBeUndefined();
    expect(reveal.text()).toBe('查看三週期摘要');
    await reveal.trigger('click');
    expect(wrapper.emitted('reveal-summary')).toEqual([[completedAnswers]]);
    expect(wrapper.find('[data-exercise-summary-revealed]').exists()).toBe(false);

    await wrapper.setProps({ revealed: true });
    expect(wrapper.get('[data-exercise-summary-revealed]').text()).toContain('三週期摘要已揭露');
  });

  it('uses native keyboard-operable field controls and announces the next required step', () => {
    const wrapper = render();

    expect(wrapper.get('input[name="monthly-direction"][value="up"]').attributes('type')).toBe('radio');
    expect(wrapper.find('textarea[name="monthly-key-area"]').exists()).toBe(true);
    expect(wrapper.get('[data-exercise-progress]').attributes('aria-live')).toBe('polite');
    expect(wrapper.get('[data-exercise-progress]').text()).toContain('月 K');
  });

  it('lets keyboard users move between unlocked step buttons', async () => {
    const wrapper = render({
      monthlyDirection: 'up',
      monthlyKeyArea: '月 K 支撐區',
      weeklyRelationship: 'aligned',
      dailyCheck: null,
    });

    const monthlyStep = wrapper.get('[data-exercise-step-button="1m"]');
    await monthlyStep.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.get('[data-exercise-step-button="1w"]').attributes('aria-pressed')).toBe('true');
  });

  it('follows a parent timeframe change so the form and primary chart cannot disagree', async () => {
    const wrapper = mount(MultiTimeframeExercise, {
      props: {
        stockName: '台積電',
        stockCode: '2330',
        cutoffDate: '2026-08-12',
        activeTimeframe: '1m',
        answers: {
          monthlyDirection: 'up',
          monthlyKeyArea: '月 K 支撐區',
          weeklyRelationship: null,
          dailyCheck: null,
        },
      },
    });

    await wrapper.setProps({ activeTimeframe: '1w' });
    expect(wrapper.get('[data-exercise-step-button="1w"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-exercise-step="1w"]').attributes('style')).toBeUndefined();
    expect(wrapper.get('[data-exercise-step="1m"]').attributes('style')).toContain('display: none');
  });

  it('blocks monthly answers until the day-K default chart is switched to the exercise timeframe', async () => {
    const wrapper = mount(MultiTimeframeExercise, {
      props: {
        stockName: '台積電',
        stockCode: '2330',
        cutoffDate: '2026-08-12',
        activeTimeframe: '1d',
        answers: emptyAnswers,
      },
    });

    expect(wrapper.get('[data-exercise-chart-sync]').text()).toContain('先切換圖表');
    expect(wrapper.find('input[name="monthly-direction"]').exists()).toBe(false);
    expect(wrapper.get('[data-exercise-step-button="1m"]').attributes('aria-pressed')).toBe('false');

    await wrapper.get('[data-exercise-sync-timeframe]').trigger('click');
    expect(wrapper.emitted('select-timeframe')?.at(-1)).toEqual(['1m']);
  });
});
