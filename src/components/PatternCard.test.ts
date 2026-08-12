import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { getPatternCard, PATTERN_CARDS } from '../domain/patterns/catalog';
import PatternCard from './PatternCard.vue';
import PatternCatalog from './PatternCatalog.vue';

describe('Pattern Card interactions', () => {
  it('uses a real button to flip while retaining focus and exposing its expanded state', async () => {
    const wrapper = mount(PatternCard, {
      attachTo: document.body,
      props: { card: PATTERN_CARDS[0] },
    });
    const button = wrapper.get('button');

    expect(button.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[data-card-side="front"]').exists()).toBe(true);

    await button.element.focus();
    await button.trigger('click');

    expect(document.activeElement).toBe(button.element);
    expect(button.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[data-card-side="back"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('可觀察定義');
    expect(wrapper.text()).not.toContain('確認方式');
    expect(wrapper.text()).toContain('失效或減弱條件');

    wrapper.unmount();
  });

  it('gives catalog-only and guardrail cards an explicit first-release matcher limit', () => {
    const catalogOnly = mount(PatternCard, {
      props: { card: PATTERN_CARDS.find((card) => card.id === 'rounding-bottom')! },
    });
    const guardrail = mount(PatternCard, {
      props: { card: PATTERN_CARDS.find((card) => card.id === 'insufficient-evidence')! },
    });

    expect(catalogOnly.text()).toContain('第一版不參與自動比對');
    expect(guardrail.text()).toContain('第一版不參與自動比對');
    expect(guardrail.text()).toContain('守門提醒');
  });

  it('labels structures implemented by the long-window engine as automatically comparable', () => {
    const wrapper = mount(PatternCard, { props: { card: getPatternCard('range') } });

    expect(wrapper.text()).toContain('結構引擎可參與自動比對');
    expect(wrapper.text()).not.toContain('不參與自動比對');
  });

  it('shows month, week, and day reading guidance on the back of every price-structure card', async () => {
    const wrapper = mount(PatternCard, { props: { card: getPatternCard('head-and-shoulders-top') } });
    await wrapper.get('button').trigger('click');

    expect(wrapper.text()).toContain('月、週、日 K 解讀順序');
    expect(wrapper.text()).toContain('月 K：長期背景');
    expect(wrapper.text()).toContain('週 K：中期結構');
    expect(wrapper.text()).toContain('日 K：近期條件');
  });

  it('filters by category and support while announcing the result count', async () => {
    const wrapper = mount(PatternCatalog);

    expect(wrapper.find('h2').text()).toContain('型態卡目錄');
    expect(wrapper.findAll('h1')).toHaveLength(0);
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('96');

    await wrapper.get('select[name="match-support"]').setValue('short-window');
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('17');

    await wrapper.get('select[name="category"]').setValue('結構型態');
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('0');

    await wrapper.get('select[name="match-support"]').setValue('structure');
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('9');
    expect(wrapper.findAll('article').length).toBe(9);
  });

  it('shows one collection without cloning canonical card content', () => {
    const wrapper = mount(PatternCatalog, {
      props: { collection: 'price-structure' },
    });

    expect(wrapper.find('h2').text()).toBe('價格結構型態主館');
    expect(wrapper.find('[data-pattern-id="range"]').exists()).toBe(true);
    expect(wrapper.find('[data-pattern-id="hammer"]').exists()).toBe(false);
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('29');
  });

  it('shows confirmation guidance on a second-stage structure card', async () => {
    const wrapper = mount(PatternCard, {
      props: { card: PATTERN_CARDS.find((card) => card.id === 'rounding-top')! },
    });

    expect(wrapper.text()).toContain('結構引擎可參與自動比對');
    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('確認方式');
    expect(wrapper.text()).toContain('收盤有效跌破');
  });

  it('searches and filters the TA-Lib gallery by function, bars, direction, and purpose', async () => {
    const wrapper = mount(PatternCatalog, {
      props: { collection: 'talib-advanced' },
    });

    await wrapper.get('input[name="pattern-query"]').setValue('CDL2CROWS');
    expect(wrapper.findAll('article')).toHaveLength(1);
    expect(wrapper.text()).toContain('兩隻烏鴉');

    await wrapper.get('input[name="pattern-query"]').setValue('');
    await wrapper.get('select[name="bars"]').setValue('5');
    await wrapper.get('select[name="direction"]').setValue('both');
    await wrapper.get('select[name="purpose"]').setValue('reversal');
    expect(wrapper.find('[data-pattern-id="talib-breakaway"]').exists()).toBe(true);
    expect(wrapper.find('[data-pattern-id="doji"]').exists()).toBe(false);
  });

  it('separates the official TA-Lib teaching scope from a reused site matcher', async () => {
    const wrapper = mount(PatternCatalog, {
      props: { collection: 'talib-advanced' },
    });

    await wrapper.get('input[name="pattern-query"]').setValue('CDLDOJI');
    expect(wrapper.text()).toContain('官方函式只供教學查閱');
    expect(wrapper.text()).toContain('不是官方函式執行結果');

    await wrapper.get('[data-pattern-id="doji"] button').trigger('click');
    expect(wrapper.text()).toContain('TA-Lib 官方函式口徑');
    expect(wrapper.text()).toContain('BodyDoji');
    expect(wrapper.text()).toContain('相關型態');
  });

  it('keeps the TA-Lib and site matcher distinction visible outside the advanced gallery', () => {
    const reusedCard = PATTERN_CARDS.find((card) => card.id === 'doji')!;
    const wrapper = mount(PatternCard, { props: { card: reusedCard } });

    expect(wrapper.text()).toContain('TA-Lib：CDLDOJI');
    expect(wrapper.text()).toContain('教學用短窗規則');
    expect(wrapper.text()).toContain('不是 TA-Lib 官方函式執行結果');
  });

  it('does not expose TA-Lib-only filters in the price structure gallery', () => {
    const wrapper = mount(PatternCatalog, {
      props: { collection: 'price-structure' },
    });

    expect(wrapper.find('select[name="bars"]').exists()).toBe(false);
    expect(wrapper.find('select[name="direction"]').exists()).toBe(false);
    expect(wrapper.find('select[name="purpose"]').exists()).toBe(false);
    expect(wrapper.find('select[name="category"]').exists()).toBe(true);
    expect(wrapper.find('select[name="match-support"]').exists()).toBe(true);
  });

  it('offers every TA-Lib bar range used by the shipped cards', () => {
    const wrapper = mount(PatternCatalog, {
      props: { collection: 'talib-advanced' },
    });

    const values = wrapper.findAll('select[name="bars"] option').map((option) => option.attributes('value'));
    expect(values).toContain('6');
    expect(values).toContain('7');
  });
});
