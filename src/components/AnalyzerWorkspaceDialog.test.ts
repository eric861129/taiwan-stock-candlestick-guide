import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import AnalyzerWorkspaceDialog from './AnalyzerWorkspaceDialog.vue';

const Harness = defineComponent({
  components: { AnalyzerWorkspaceDialog },
  setup() {
    const open = ref(false);
    return { open };
  },
  template: `
    <button data-test="opener" @click="open = true">放大分析區</button>
    <AnalyzerWorkspaceDialog
      :open="open"
      title="放大分析區"
      description="比較 K 線主圖與價格結構候選"
      @close="open = false"
    >
      <label>
        測試輸入
        <input data-test="workspace-input">
      </label>
      <div style="display: none">
        <button data-test="css-hidden-action">不可聚焦的手機收合內容</button>
      </div>
    </AnalyzerWorkspaceDialog>
  `,
});

describe('AnalyzerWorkspaceDialog', () => {
  it('以同一份 slot DOM 在頁內與放大模式之間切換', async () => {
    const wrapper = mount(Harness, { attachTo: document.body });
    const inputBeforeOpen = wrapper.get<HTMLInputElement>('[data-test="workspace-input"]');
    await inputBeforeOpen.setValue('保留分析狀態');

    expect(wrapper.get('[data-analyzer-workspace]').attributes('role')).toBeUndefined();

    wrapper.vm.open = true;
    await wrapper.vm.$nextTick();

    const workspace = wrapper.get('[data-analyzer-workspace]');
    const inputAfterOpen = wrapper.get<HTMLInputElement>('[data-test="workspace-input"]');
    expect(workspace.attributes('role')).toBe('dialog');
    expect(workspace.attributes('aria-modal')).toBe('true');
    expect(inputAfterOpen.element).toBe(inputBeforeOpen.element);
    expect(inputAfterOpen.element.value).toBe('保留分析狀態');
    expect(wrapper.get('[data-dialog-close]').text()).toBe('關閉放大分析區');

    wrapper.unmount();
  });

  it('開啟時移入焦點並鎖定背景捲動，關閉後還原焦點與捲動設定', async () => {
    document.body.style.overflow = 'scroll';
    const wrapper = mount(Harness, { attachTo: document.body });
    const opener = wrapper.get<HTMLButtonElement>('[data-test="opener"]');

    opener.element.focus();
    await opener.trigger('click');

    const closeButton = wrapper.get<HTMLButtonElement>('[data-dialog-close]');
    expect(document.activeElement).toBe(closeButton.element);
    expect(document.body.style.overflow).toBe('hidden');

    await closeButton.trigger('click');

    expect(document.body.style.overflow).toBe('scroll');
    expect(document.activeElement).toBe(opener.element);

    wrapper.unmount();
    document.body.style.overflow = '';
  });

  it('原觸發按鈕因工作區切換而重建時，仍把焦點交回新的放大按鈕', async () => {
    const wrapper = mount(Harness, { attachTo: document.body });
    const opener = wrapper.get<HTMLButtonElement>('[data-test="opener"]');
    opener.element.setAttribute('data-analyzer-expand', '');
    opener.element.focus();
    await opener.trigger('click');

    const replacement = document.createElement('button');
    replacement.setAttribute('data-analyzer-expand', '');
    document.body.append(replacement);
    opener.element.remove();
    await wrapper.get('[data-dialog-close]').trigger('click');

    expect(document.activeElement).toBe(replacement);
    replacement.remove();
    wrapper.unmount();
  });

  it('限制 Tab 焦點在放大區內，並可用 Escape 關閉', async () => {
    const wrapper = mount(Harness, { attachTo: document.body });
    const opener = wrapper.get<HTMLButtonElement>('[data-test="opener"]');
    opener.element.focus();
    await opener.trigger('click');

    const closeButton = wrapper.get<HTMLButtonElement>('[data-dialog-close]');
    const input = wrapper.get<HTMLInputElement>('[data-test="workspace-input"]');
    input.element.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }));
    expect(document.activeElement).toBe(closeButton.element);
    expect(document.activeElement).not.toBe(wrapper.get('[data-test="css-hidden-action"]').element);

    closeButton.element.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(document.activeElement).toBe(input.element);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-analyzer-workspace]').attributes('role')).toBeUndefined();
    expect(document.activeElement).toBe(opener.element);
    expect(document.body.style.overflow).toBe('');

    wrapper.unmount();
  });
});
