import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import LearningHome from '../../src/components/LearningHome.vue';
import LearningMap from '../../src/components/LearningMap.vue';
import LearningProgressProvider from '../../src/components/LearningProgressProvider.vue';
import StageQuiz from '../../src/components/StageQuiz.vue';
import './styles.css';

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-top': () =>
        h(
          'a',
          {
            class: 'skip-link',
            href: '#VPContent',
          },
          '跳至主要內容',
        ),
    }),
  enhanceApp({ app }) {
    app.config.globalProperties.$siteName = '台股 K 線筆記';
    app.component('LearningHome', LearningHome);
    app.component('LearningMap', LearningMap);
    app.component('LearningProgressProvider', LearningProgressProvider);
    app.component('StageQuiz', StageQuiz);
  },
};

export default theme;
