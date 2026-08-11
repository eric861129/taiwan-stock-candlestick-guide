import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LearningHome from './LearningHome.vue';
import { createLearningProgressContext, LEARNING_PROGRESS_KEY } from './learningProgressContext';

describe('LearningHome', () => {
  it('keeps the page heading hierarchy below the Markdown page heading', () => {
    const wrapper = mount(LearningHome, {
      props: { compact: true },
      global: {
        provide: {
          [LEARNING_PROGRESS_KEY as symbol]: createLearningProgressContext(),
        },
      },
    });

    expect(wrapper.findAll('h1')).toHaveLength(0);
    expect(wrapper.find('h2').text()).toContain('五階段學習旅程');
  });
});
