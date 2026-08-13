import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import SidebarCollapseToggle from './SidebarCollapseToggle.vue';

const frontmatter = ref<Record<string, unknown>>({});

vi.mock('vitepress', () => ({
  useData: () => ({ frontmatter }),
}));

describe('SidebarCollapseToggle', () => {
  beforeEach(() => {
    frontmatter.value = {};
    window.localStorage.clear();
    document.documentElement.classList.remove('site-sidebar-collapsed');
  });

  afterEach(() => {
    document.documentElement.classList.remove('site-sidebar-collapsed');
  });

  it('首次進入時展開側欄，並透過原生按鈕提供鍵盤操作', () => {
    const wrapper = mount(SidebarCollapseToggle);
    const button = wrapper.get('button');

    expect(button.attributes('aria-expanded')).toBe('true');
    expect(button.attributes('aria-controls')).toBe('VPSidebarNav');
    expect(button.element.tagName).toBe('BUTTON');
    expect(button.text()).toContain('收合選單');
    expect(document.documentElement.classList.contains('site-sidebar-collapsed')).toBe(false);
  });

  it('收合後重新掛載仍保留使用者選擇', async () => {
    const firstVisit = mount(SidebarCollapseToggle);

    await firstVisit.get('button').trigger('click');

    expect(firstVisit.get('button').attributes('aria-expanded')).toBe('false');
    expect(firstVisit.get('button').text()).toContain('展開選單');
    expect(document.documentElement.classList.contains('site-sidebar-collapsed')).toBe(true);

    firstVisit.unmount();
    const returnVisit = mount(SidebarCollapseToggle);
    await nextTick();

    expect(returnVisit.get('button').attributes('aria-expanded')).toBe('false');
    expect(document.documentElement.classList.contains('site-sidebar-collapsed')).toBe(true);
  });

  it('首頁不顯示側欄收合按鈕', () => {
    frontmatter.value = { layout: 'home' };

    const wrapper = mount(SidebarCollapseToggle);

    expect(wrapper.find('button').exists()).toBe(false);
  });
});
