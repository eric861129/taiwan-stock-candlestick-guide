import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import StageQuiz from './StageQuiz.vue';

describe('StageQuiz', () => {
  it('uses fieldsets, real buttons, and an aria-live result region', async () => {
    const wrapper = mount(StageQuiz, { props: { stageId: 'stage-1' } });

    expect(wrapper.findAll('fieldset')).toHaveLength(5);
    expect(wrapper.findAll('legend')).toHaveLength(5);
    expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true);

    const options = wrapper.findAll('input[type="radio"]');
    for (const option of options) {
      await option.setValue(true);
    }
    await wrapper.find('form').trigger('submit');
    expect(wrapper.find('[aria-live="polite"]').text()).toContain('分');
  });

  it('shows an unlimited retry button after a failed attempt', async () => {
    const wrapper = mount(StageQuiz, { props: { stageId: 'stage-1' } });
    const firstOptionPerQuestion = wrapper.findAll('input[type="radio"]').filter((_input, index) => index % 4 === 0);
    for (const option of firstOptionPerQuestion) {
      await option.setValue(true);
    }
    await wrapper.find('form').trigger('submit');

    expect(wrapper.find('button[type="button"]').text()).toContain('再試一次');
    await wrapper.find('button[type="button"]').trigger('click');
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('');
  });
});
