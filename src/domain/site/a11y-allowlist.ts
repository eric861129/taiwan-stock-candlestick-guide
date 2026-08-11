/** 可審核的 axe 例外；每筆例外都必須指向明確路由與到期日。 */
export interface AccessibilityException {
  readonly ruleId: string;
  readonly route: string;
  readonly reason: string;
  readonly owner: string;
  readonly expiry: string;
}

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_EXCEPTION_AGE_DAYS = 90;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

function calendarDateTimestamp(value: string): number | null {
  const matches = ISO_CALENDAR_DATE.exec(value);
  if (!matches) {
    return null;
  }

  const year = Number(matches[1]);
  const month = Number(matches[2]);
  const day = Number(matches[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10) === value ? date.getTime() : null;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`axe allowlist 的 ${field} 必須是非空白字串。`);
  }
  return value;
}

/**
 * 驗證 axe 例外的欄位與到期日，避免以字串排序誤收不存在的日期或過期例外。
 */
export function validateAccessibilityAllowlist(
  value: unknown,
  today: string = new Date().toISOString().slice(0, 10),
): readonly AccessibilityException[] {
  const todayTimestamp = calendarDateTimestamp(today);
  if (todayTimestamp === null) {
    throw new Error('allowlist 驗證基準必須是有效的 ISO 日曆日期。');
  }
  if (!Array.isArray(value)) {
    throw new Error('axe allowlist 必須是陣列。');
  }

  return value.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`axe allowlist 第 ${index + 1} 筆必須是物件。`);
    }
    const candidate = item as Record<string, unknown>;
    const exception: AccessibilityException = {
      ruleId: asNonEmptyString(candidate.ruleId, 'ruleId'),
      route: asNonEmptyString(candidate.route, 'route'),
      reason: asNonEmptyString(candidate.reason, 'reason'),
      owner: asNonEmptyString(candidate.owner, 'owner'),
      expiry: asNonEmptyString(candidate.expiry, 'expiry'),
    };
    if (!exception.route.startsWith('/')) {
      throw new Error('axe allowlist 的 route 必須以 / 開頭。');
    }

    const expiryTimestamp = calendarDateTimestamp(exception.expiry);
    if (expiryTimestamp === null) {
      throw new Error('axe allowlist 的 expiry 必須是有效的 ISO 日曆日期。');
    }
    if (expiryTimestamp <= todayTimestamp) {
      throw new Error('axe allowlist 例外已到期，必須移除或重新審核。');
    }
    if ((expiryTimestamp - todayTimestamp) / MILLISECONDS_PER_DAY > MAX_EXCEPTION_AGE_DAYS) {
      throw new Error(`axe allowlist 例外有效期限不可超過 ${MAX_EXCEPTION_AGE_DAYS} 天。`);
    }
    return exception;
  });
}
