import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import LearningHome from '../../src/components/LearningHome.vue';
import LearningMap from '../../src/components/LearningMap.vue';
import LearningProgressProvider from '../../src/components/LearningProgressProvider.vue';
import PatternCatalog from '../../src/components/PatternCatalog.vue';
import SidebarCollapseToggle from '../../src/components/SidebarCollapseToggle.vue';
import StageQuiz from '../../src/components/StageQuiz.vue';
import StockAnalyzer from '../../src/components/StockAnalyzer.vue';
import './styles.css';

function focusMainContent(): void {
  requestAnimationFrame(() => {
    const mainContent = document.getElementById('VPContent');
    if (!mainContent) {
      return;
    }
    mainContent.setAttribute('tabindex', '-1');
    mainContent.focus();
  });
}

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-top': () =>
        [
          h(
            'a',
            {
              class: 'skip-link',
              href: '#VPContent',
              onClick: focusMainContent,
            },
            '跳至主要內容',
          ),
          h(SidebarCollapseToggle),
        ],
    }),
  enhanceApp({ app }) {
    app.config.globalProperties.$siteName = '台股 K 線筆記';
    app.component('LearningHome', LearningHome);
    app.component('LearningMap', LearningMap);
    app.component('LearningProgressProvider', LearningProgressProvider);
    app.component('PatternCatalog', PatternCatalog);
    app.component('StageQuiz', StageQuiz);
    app.component('StockAnalyzer', StockAnalyzer);
  },
};

export default theme;
