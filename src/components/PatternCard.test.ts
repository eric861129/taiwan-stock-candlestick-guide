import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PATTERN_CARDS } from '../domain/patterns/catalog';
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
    expect(wrapper.text()).toContain('失效或減弱條件');

    wrapper.unmount();
  });

  it('gives catalog-only and guardrail cards an explicit first-release matcher limit', () => {
    const catalogOnly = mount(PatternCard, {
      props: { card: PATTERN_CARDS.find((card) => card.id === 'range')! },
    });
    const guardrail = mount(PatternCard, {
      props: { card: PATTERN_CARDS.find((card) => card.id === 'insufficient-evidence')! },
    });

    expect(catalogOnly.text()).toContain('第一版不參與自動比對');
    expect(guardrail.text()).toContain('第一版不參與自動比對');
    expect(guardrail.text()).toContain('守門提醒');
  });

  it('filters by category and support while announcing the result count', async () => {
    const wrapper = mount(PatternCatalog);

    expect(wrapper.find('h2').text()).toContain('型態卡目錄');
    expect(wrapper.findAll('h1')).toHaveLength(0);
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('32');

    await wrapper.get('select[name="match-support"]').setValue('mvp');
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('17');

    await wrapper.get('select[name="category"]').setValue('結構型態');
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('0');

    await wrapper.get('select[name="match-support"]').setValue('catalog-only');
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('8');
    expect(wrapper.findAll('article').length).toBe(8);
  });

  it('shows one collection without cloning canonical card content', () => {
    const wrapper = mount(PatternCatalog, {
      props: { collection: 'price-structure' },
    });

    expect(wrapper.find('h2').text()).toBe('價格結構型態主館');
    expect(wrapper.find('[data-pattern-id="range"]').exists()).toBe(true);
    expect(wrapper.find('[data-pattern-id="hammer"]').exists()).toBe(false);
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('15');
  });
});
