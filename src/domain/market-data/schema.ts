import { z } from 'zod';
import type { CorporateAction, Market, OhlcvBar, StockSnapshot } from './types';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATA_PATH_PATTERN = /^data\/stocks\/([0-9]{4,6})\.([A-Za-z0-9_-]{1,128})\.json$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z.string().refine(isCalendarDate, '必須是 YYYY-MM-DD 日期');
const nonEmptyHttpsUrlSchema = z.string().url().refine(
  (value) => value.startsWith('https://'),
  '必須是 HTTPS 網址',
);
const marketSchema = z.enum(['TWSE', 'TPEx']);
const freshnessSchema = z.enum(['fresh', 'one-session-behind', 'stale', 'unknown']);
const securityTypeSchema = z.enum([
  'common-stock',
  'etf',
  'etn',
  'warrant',
  'emerging-stock',
  'other',
]);

const marketCutoffSchema = z.object({
  cutoffDate: isoDateSchema,
  expectedCutoffDate: isoDateSchema.nullable(),
  freshness: freshnessSchema,
  calendarSourceUrl: nonEmptyHttpsUrlSchema,
  calendarValidThrough: isoDateSchema,
  tradingSessions: z.array(isoDateSchema).min(1),
}).strict().superRefine((cutoff, context) => {
  const sessions = cutoff.tradingSessions;
  const lastSession = sessions.at(-1);
  if (new Set(sessions).size !== sessions.length || sessions.some((session, index) => index > 0 && session <= sessions[index - 1]!)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tradingSessions'],
      message: '交易日必須遞增且不可重複。',
    });
  }
  if (lastSession !== undefined && cutoff.cutoffDate !== lastSession) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cutoffDate'],
      message: '市場截止日必須等於交易日清單最後一日。',
    });
  }
  if (lastSession !== undefined && cutoff.calendarValidThrough < lastSession) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['calendarValidThrough'],
      message: '交易日曆有效日不可早於快照截止日。',
    });
  }
  if (cutoff.expectedCutoffDate === null) {
    if (cutoff.freshness !== 'unknown') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['freshness'],
        message: '沒有預期截止日只能標示為未知新鮮度。',
      });
    }
    return;
  }
  if (cutoff.calendarValidThrough < cutoff.expectedCutoffDate || cutoff.cutoffDate > cutoff.expectedCutoffDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '市場截止日或行事曆有效日不符合資料契約。',
    });
  }
  if (cutoff.cutoffDate === cutoff.expectedCutoffDate && cutoff.freshness !== 'fresh') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['freshness'],
      message: '截止日等於預期交易日必須標示為新鮮。',
    });
  }
  if (cutoff.cutoffDate < cutoff.expectedCutoffDate && cutoff.freshness === 'fresh') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['freshness'],
      message: '截止日落後預期交易日不可標示為新鮮。',
    });
  }
});

const stockIndexEntrySchema = z.object({
  code: z.string().regex(/^[0-9]{4,6}$/),
  name: z.string().trim().min(1),
  market: marketSchema,
  securityType: securityTypeSchema,
  dataPath: z.string().regex(DATA_PATH_PATTERN),
  digest: z.string().regex(SHA256_PATTERN),
  size: z.number().int().positive(),
  firstDate: isoDateSchema,
  lastDate: isoDateSchema,
  barCount: z.number().int().positive().max(120),
  listingDate: isoDateSchema,
  availableSessions: z.number().int().positive().max(120),
  shortHistoryReason: z.enum(['listing-history']).nullable(),
}).strict().superRefine((entry, context) => {
  const pathCode = DATA_PATH_PATTERN.exec(entry.dataPath)?.[1];
  if (pathCode !== entry.code) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dataPath'],
      message: '股票資料路徑必須與股票代碼相符。',
    });
  }
  if (entry.firstDate > entry.lastDate || entry.availableSessions < entry.barCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '股票索引日期或可用交易日數不符合資料契約。',
    });
  }
  if ((entry.barCount < 120) !== (entry.shortHistoryReason === 'listing-history')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shortHistoryReason'],
      message: '短歷史資料必須說明原因。',
    });
  }
});

/** 瀏覽器可載入的市場快照 v2 索引。 */
export const marketManifestSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotVersion: z.literal(2),
  sourceCommit: z.string().trim().min(1).max(128),
  snapshotHash: z.string().regex(SHA256_PATTERN),
  generatedAt: z.string().datetime({ offset: true }),
  markets: z.object({
    TWSE: marketCutoffSchema,
    TPEx: marketCutoffSchema,
  }).strict(),
  symbols: z.array(stockIndexEntrySchema).min(1),
}).strict().superRefine((manifest, context) => {
  const seenCodes = new Set<string>();
  for (const [index, entry] of manifest.symbols.entries()) {
    if (seenCodes.has(entry.code)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['symbols', index, 'code'],
        message: '股票代碼不可重複，避免輸入解析到不明確資料。',
      });
    }
    seenCodes.add(entry.code);
  }
});

const ohlcvBarSchema = z.object({
  date: isoDateSchema,
  open: z.number().finite().nonnegative(),
  high: z.number().finite().nonnegative(),
  low: z.number().finite().nonnegative(),
  close: z.number().finite().nonnegative(),
  volumeShares: z.number().finite().nonnegative(),
  transactionCount: z.number().int().nonnegative().optional(),
  sourcePrecision: z.number().finite().positive(),
  comparisonUnit: z.number().finite().positive(),
  priceUnit: z.literal('TWD'),
  completed: z.boolean().optional(),
}).strict().superRefine((bar, context) => {
  if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'OHLC 高低價關係不正確。',
    });
  }
});

const corporateActionSchema = z.object({
  date: isoDateSchema,
  type: z.enum(['cash-dividend', 'stock-dividend', 'capital-reduction', 'split', 'other']),
  affectsPriceContinuity: z.boolean(),
  sourceUrl: nonEmptyHttpsUrlSchema,
  verifiedAt: isoDateSchema,
}).strict();

/** 單一普通股原始盤後日 K 快照 v2。 */
export const stockSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotVersion: z.literal(2),
  code: z.string().regex(/^[0-9]{4,6}$/),
  name: z.string().trim().min(1),
  market: marketSchema,
  securityType: securityTypeSchema,
  priceMode: z.literal('raw'),
  currency: z.literal('TWD'),
  priceUnit: z.literal('TWD'),
  listingDate: isoDateSchema,
  availableSessions: z.number().int().positive().max(120),
  shortHistoryReason: z.enum(['listing-history']).nullable(),
  comparisonUnitPolicy: z.object({
    version: z.number().int().positive(),
    effectiveFrom: isoDateSchema,
    sourceUrl: nonEmptyHttpsUrlSchema,
  }).strict(),
  bars: z.array(ohlcvBarSchema).min(1).max(120),
  corporateActions: z.array(corporateActionSchema),
  sourceUrls: z.array(nonEmptyHttpsUrlSchema).min(1),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.availableSessions < snapshot.bars.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['availableSessions'],
      message: '可用交易日數不可少於日 K 筆數。',
    });
  }
  if ((snapshot.bars.length < 120) !== (snapshot.shortHistoryReason === 'listing-history')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shortHistoryReason'],
      message: '短歷史資料必須說明原因。',
    });
  }
  if (snapshot.bars.some((bar, index) => index > 0 && bar.date <= snapshot.bars[index - 1]!.date)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bars'],
      message: '日 K 日期必須遞增且不可重複。',
    });
  }
});

export type MarketDataManifest = z.infer<typeof marketManifestSchema>;
export type MarketDataSymbol = z.infer<typeof stockIndexEntrySchema>;
export type MarketCalendar = Pick<z.infer<typeof marketCutoffSchema>, 'tradingSessions' | 'calendarValidThrough'>;

/** 將已通過 Zod 驗證的資料收斂為 matcher 既有的共用契約。 */
export function toStockSnapshot(value: z.infer<typeof stockSnapshotSchema>): StockSnapshot {
  if (value.securityType !== 'common-stock') {
    throw new Error('非普通股不可轉換為型態比對快照。');
  }

  return {
    schemaVersion: value.schemaVersion,
    code: value.code,
    name: value.name,
    market: value.market as Market,
    securityType: 'common-stock',
    priceMode: value.priceMode,
    currency: value.currency,
    comparisonUnitPolicy: value.comparisonUnitPolicy,
    bars: value.bars as readonly OhlcvBar[],
    corporateActions: value.corporateActions as readonly CorporateAction[],
    sourceUrls: value.sourceUrls,
  };
}
