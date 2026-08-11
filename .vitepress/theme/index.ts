import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
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
  },
};

export default theme;
