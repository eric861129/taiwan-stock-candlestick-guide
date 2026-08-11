import type { Freshness } from './types';

/** 官方市場交易日曆在瀏覽器端計算資料新鮮度所需的最小欄位。 */
export interface TradingCalendar {
  tradingSessions: readonly string[];
  validThrough: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const CUTOFF_MINUTES = 17 * 60 + 30;

/** 以資料快照的已驗證新鮮度與瀏覽器重算結果，保留較保守的狀態。 */
export function mostConservativeFreshness(
  manifestFreshness: Freshness,
  computedFreshness: Freshness,
): Freshness {
  if (manifestFreshness === 'stale' || computedFreshness === 'stale') {
    return 'stale';
  }
  if (manifestFreshness === 'unknown' || computedFreshness === 'unknown') {
    return 'unknown';
  }
  if (manifestFreshness === 'one-session-behind' || computedFreshness === 'one-session-behind') {
    return 'one-session-behind';
  }
  return 'fresh';
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function taipeiNow(now: Date): { date: string; minutes: number } | undefined {
  if (Number.isNaN(now.valueOf())) {
    return undefined;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  const minute = Number(values.minute);

  return isIsoDate(date) && Number.isInteger(hour) && Number.isInteger(minute)
    ? { date, minutes: hour * 60 + minute }
    : undefined;
}

/**
 * 依台北時間 17:30 與官方交易日曆判定快照新鮮度。
 * 17:30 前預期前一個開市日，之後預期當日；行事曆不涵蓋今天時保守回傳 unknown。
 */
export function computeFreshness(
  calendar: TradingCalendar,
  cutoff: string,
  now: Date = new Date(),
): Freshness {
  const taipei = taipeiNow(now);
  if (!taipei || !isIsoDate(cutoff) || !isIsoDate(calendar.validThrough) || calendar.validThrough < taipei.date) {
    return 'unknown';
  }

  const sessions = [...calendar.tradingSessions];
  if (
    sessions.length === 0
    || sessions.some((session, index) => !isIsoDate(session) || (index > 0 && session <= sessions[index - 1]!))
  ) {
    return 'unknown';
  }

  const expectedCandidates = sessions.filter((session) => (
    taipei.minutes >= CUTOFF_MINUTES ? session <= taipei.date : session < taipei.date
  ));
  const expectedCutoff = expectedCandidates.at(-1);
  const expectedIndex = expectedCutoff === undefined ? -1 : sessions.indexOf(expectedCutoff);
  const actualIndex = sessions.indexOf(cutoff);

  if (expectedIndex < 0 || actualIndex < 0 || actualIndex > expectedIndex) {
    return 'unknown';
  }

  const missingSessions = expectedIndex - actualIndex;
  if (missingSessions === 0) {
    return 'fresh';
  }
  if (missingSessions === 1) {
    return 'one-session-behind';
  }
  return 'stale';
}
