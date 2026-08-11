import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LearningMap from './LearningMap.vue';

describe('LearningMap', () => {
  it('keeps every chapter link available and labels completed stages', () => {
    const wrapper = mount(LearningMap, {
      props: {
        progress: {
          schemaVersion: 1,
          completedChapterIds: ['chapter-01'],
          passedStageIds: ['stage-1'],
          quizAttempts: { 'stage-1': 1 },
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
      },
    });

    expect(wrapper.findAll('a[href*="/chapters/"]')).toHaveLength(20);
    expect(wrapper.find('[data-stage-status="stage-1"]').text()).toContain('已通過');
    expect(wrapper.findAll('a[aria-disabled="true"]')).toHaveLength(0);
  });
});
