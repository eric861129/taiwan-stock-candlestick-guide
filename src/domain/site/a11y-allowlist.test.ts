import { describe, expect, it } from 'vitest';
import { validateAccessibilityAllowlist } from './a11y-allowlist';

const exception = {
  ruleId: 'color-contrast',
  route: '/analyzer',
  reason: '暫時例外，已有修正排程。',
  owner: '網站維護者',
  expiry: '2026-08-12',
};

describe('validateAccessibilityAllowlist', () => {
  it('接受未過期且在九十天內的 ISO 日曆日期', () => {
    expect(validateAccessibilityAllowlist([exception], '2026-08-11')).toEqual([exception]);
  });

  it('拒絕不存在的 ISO 日曆日期', () => {
    expect(() => validateAccessibilityAllowlist([
      { ...exception, expiry: '2026-99-99' },
    ], '2026-08-11')).toThrow('有效的 ISO 日曆日期');
  });

  it('拒絕到期與超過九十天的例外', () => {
    expect(() => validateAccessibilityAllowlist([
      { ...exception, expiry: '2026-08-11' },
    ], '2026-08-11')).toThrow('已到期');
    expect(() => validateAccessibilityAllowlist([
      { ...exception, expiry: '2026-11-10' },
    ], '2026-08-11')).toThrow('不可超過 90 天');
  });
});
