import { z } from 'zod';
import type { CorporateAction, Market, NoQuoteEvidence, OhlcvBar, StockSnapshot } from './types';

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

function isWeekday(value: string): boolean {
  const weekday = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

const OFFICIAL_HOSTS_BY_MARKET = {
  TWSE: new Set(['openapi.twse.com.tw', 'www.twse.com.tw']),
  TPEx: new Set(['www.tpex.org.tw', 'dsp.tpex.org.tw']),
} as const;
const OFFICIAL_MARKET_HOSTS = new Set([
  ...OFFICIAL_HOSTS_BY_MARKET.TWSE,
  ...OFFICIAL_HOSTS_BY_MARKET.TPEx,
]);
const EMERGENCY_CLOSURE_EVIDENCE_HOSTS = new Set([
  ...OFFICIAL_MARKET_HOSTS,
  'eoc.gov.taipei',
  'investoredu.twse.com.tw',
]);

function isApprovedOfficialHttpsUrl(value: string, allowedHosts: ReadonlySet<string>): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && allowedHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function officialHttpsUrlSchema(allowedHosts: ReadonlySet<string>) {
  return z.string().trim().min(1).refine(
    (value) => isApprovedOfficialHttpsUrl(value, allowedHosts),
    '必須是受信任官方來源的 HTTPS 網址',
  );
}

const isoDateSchema = z.string().refine(isCalendarDate, '必須是 YYYY-MM-DD 日期');
const nonEmptyHttpsUrlSchema = officialHttpsUrlSchema(OFFICIAL_MARKET_HOSTS);
const twseOfficialHttpsUrlSchema = officialHttpsUrlSchema(OFFICIAL_HOSTS_BY_MARKET.TWSE);
const emergencyClosureSourceUrlSchema = officialHttpsUrlSchema(EMERGENCY_CLOSURE_EVIDENCE_HOSTS);
const marketSchema = z.enum(['TWSE', 'TPEx']);
const MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS = new Set<Market>(['TWSE', 'TPEx']);
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
  calendarSourceUrl: twseOfficialHttpsUrlSchema,
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
  if (sessions.some((session) => !isWeekday(session))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tradingSessions'],
      message: '交易日不可包含週末日期。',
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

const emergencyMarketClosureSchema = z.object({
  date: isoDateSchema,
  markets: z.array(marketSchema),
  reason: z.string().trim().min(1),
  sourceUrls: z.array(emergencyClosureSourceUrlSchema).min(1),
}).strict().superRefine((closure, context) => {
  const declaredMarkets = new Set(closure.markets);
  if (
    closure.markets.length !== MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS.size
    || declaredMarkets.size !== MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS.size
    || [...MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS].some((market) => !declaredMarkets.has(market))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['markets'],
      message: '緊急休市目前只支援 TWSE 與 TPEx 同日全市場休市，markets 必須各含一次。',
    });
  }
  for (const market of closure.markets) {
    if (!closure.sourceUrls.some((sourceUrl) => (
      isApprovedOfficialHttpsUrl(sourceUrl, OFFICIAL_HOSTS_BY_MARKET[market])
    ))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrls'],
        message: `${market} 緊急休市必須具備該市場的官方規則來源。`,
      });
    }
  }
});

const emergencyClosureEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  closures: z.array(emergencyMarketClosureSchema),
}).strict().superRefine((evidence, context) => {
  const dates = evidence.closures.map((closure) => closure.date);
  if (new Set(dates).size !== dates.length || dates.some((date, index) => index > 0 && date <= dates[index - 1]!)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closures'],
      message: '緊急市場休市佐證日期必須遞增且不得重複。',
    });
  }
  for (const [index, closure] of evidence.closures.entries()) {
    if (new Set(closure.sourceUrls).size !== closure.sourceUrls.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closures', index, 'sourceUrls'],
        message: '緊急市場休市佐證網址不得重複。',
      });
    }
  }
});

const calendarEvidenceSchema = z.object({
  sourceUrl: twseOfficialHttpsUrlSchema,
  validThrough: isoDateSchema,
  emergencyClosureEvidence: emergencyClosureEvidenceSchema,
}).strict().superRefine((calendar, context) => {
  if (calendar.emergencyClosureEvidence.closures.some((closure) => closure.date > calendar.validThrough)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['emergencyClosureEvidence', 'closures'],
      message: '緊急市場休市佐證日期不得超出年度日曆範圍。',
    });
  }
});

const suspensionIntervalSchema = z.object({
  market: marketSchema,
  code: z.string().regex(/^[0-9]{4,6}$/),
  startDate: isoDateSchema,
  endDateExclusive: isoDateSchema.nullable(),
  reason: z.string().trim().min(1),
  sourceUrls: z.array(nonEmptyHttpsUrlSchema).min(1),
}).strict().superRefine((interval, context) => {
  if (interval.endDateExclusive !== null && interval.endDateExclusive <= interval.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDateExclusive'],
      message: '停止買賣區間結束日必須晚於起始日，且採排他語意。',
    });
  }
  if (new Set(interval.sourceUrls).size !== interval.sourceUrls.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceUrls'],
      message: '停止買賣區間佐證網址不得重複。',
    });
  }
  if (!interval.sourceUrls.every((sourceUrl) => (
    isApprovedOfficialHttpsUrl(sourceUrl, OFFICIAL_HOSTS_BY_MARKET[interval.market])
  ))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceUrls'],
      message: '停止買賣公告來源必須屬於對應市場的官方網域。',
    });
  }
});

const suspensionEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  intervals: z.array(suspensionIntervalSchema),
}).strict().superRefine((evidence, context) => {
  const priorBySymbol = new Map<string, z.infer<typeof suspensionIntervalSchema>>();
  const ordered = evidence.intervals
    .map((interval, index) => ({ interval, index }))
    .sort((left, right) => (
      left.interval.market.localeCompare(right.interval.market)
      || left.interval.code.localeCompare(right.interval.code)
      || left.interval.startDate.localeCompare(right.interval.startDate)
    ));
  for (const { interval, index } of ordered) {
    const key = `${interval.market}/${interval.code}`;
    const prior = priorBySymbol.get(key);
    if (prior !== undefined && (prior.endDateExclusive === null || interval.startDate < prior.endDateExclusive)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intervals', index],
        message: '同一股票的停止買賣區間不可重疊。',
      });
    }
    priorBySymbol.set(key, interval);
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
  firstDate: isoDateSchema.nullable(),
  lastDate: isoDateSchema.nullable(),
  barCount: z.number().int().nonnegative().max(120),
  noQuoteCount: z.number().int().nonnegative().max(120),
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
  if (
    (entry.firstDate === null) !== (entry.lastDate === null)
    || (entry.barCount === 0) !== (entry.firstDate === null)
    || (entry.firstDate !== null && entry.lastDate !== null && entry.firstDate > entry.lastDate)
    || entry.availableSessions !== entry.barCount + entry.noQuoteCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '股票索引日期或可用交易日數不符合資料契約。',
    });
  }
  if ((entry.availableSessions < 120) !== (entry.shortHistoryReason === 'listing-history')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shortHistoryReason'],
      message: '短歷史資料必須說明原因。',
    });
  }
});

/** 瀏覽器可載入的市場快照 v3 索引，含版本化停復牌公告區間。 */
export const marketManifestSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotVersion: z.literal(3),
  sourceCommit: z.string().trim().min(1).max(128),
  snapshotHash: z.string().regex(SHA256_PATTERN),
  generatedAt: z.string().datetime({ offset: true }),
  calendar: calendarEvidenceSchema,
  suspensionEvidence: suspensionEvidenceSchema,
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
  const emergencyClosureDatesByMarket = new Map<Market, Set<string>>([
    ['TWSE', new Set()],
    ['TPEx', new Set()],
  ]);
  for (const closure of manifest.calendar.emergencyClosureEvidence.closures) {
    for (const market of closure.markets) {
      emergencyClosureDatesByMarket.get(market)!.add(closure.date);
    }
  }
  const knownSymbols = new Set(manifest.symbols.map((entry) => `${entry.market}/${entry.code}`));
  for (const [index, interval] of manifest.suspensionEvidence.intervals.entries()) {
    if (!knownSymbols.has(`${interval.market}/${interval.code}`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['suspensionEvidence', 'intervals', index],
        message: '停止買賣區間必須對應 manifest 中的支援普通股。',
      });
    }
  }
  for (const [market, cutoff] of Object.entries(manifest.markets)) {
    if (
      cutoff.calendarSourceUrl !== manifest.calendar.sourceUrl
      || cutoff.calendarValidThrough !== manifest.calendar.validThrough
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['markets', market],
        message: '市場交易日視窗必須使用 manifest 年度日曆。',
      });
    }
    if (cutoff.tradingSessions.some((session) => emergencyClosureDatesByMarket.get(market as Market)!.has(session))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['markets', market, 'tradingSessions'],
        message: '市場交易日視窗不可包含緊急市場休市日。',
      });
    }
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

const noQuoteEvidenceSchema = z.object({
  market: marketSchema,
  code: z.string().regex(/^[0-9]{4,6}$/),
  date: isoDateSchema,
  reason: z.enum(['official-no-quote', 'official-suspension']),
  sourceUrl: nonEmptyHttpsUrlSchema,
}).strict();

/** 單一普通股原始盤後日 K 快照 v3。 */
export const stockSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotVersion: z.literal(3),
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
    sourceUrl: twseOfficialHttpsUrlSchema,
  }).strict(),
  bars: z.array(ohlcvBarSchema).max(120),
  noQuoteEvidence: z.array(noQuoteEvidenceSchema).max(120),
  corporateActions: z.array(corporateActionSchema),
  sourceUrls: z.array(nonEmptyHttpsUrlSchema).min(1),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.availableSessions !== snapshot.bars.length + snapshot.noQuoteEvidence.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['availableSessions'],
      message: '可用交易日數不可少於日 K 筆數。',
    });
  }
  if ((snapshot.availableSessions < 120) !== (snapshot.shortHistoryReason === 'listing-history')) {
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
  if (snapshot.noQuoteEvidence.some((evidence, index) => (
    evidence.market !== snapshot.market
    || evidence.code !== snapshot.code
    || evidence.sourceUrl.length === 0
    || !isWeekday(evidence.date)
    || !isApprovedOfficialHttpsUrl(evidence.sourceUrl, OFFICIAL_HOSTS_BY_MARKET[snapshot.market])
    || index > 0 && evidence.date <= snapshot.noQuoteEvidence[index - 1]!.date
  ))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['noQuoteEvidence'],
      message: '未報價證據必須屬於同一股票、日期遞增且不可重複。',
    });
  }
  if (snapshot.corporateActions.some((action) => (
    !isApprovedOfficialHttpsUrl(action.sourceUrl, OFFICIAL_HOSTS_BY_MARKET[snapshot.market])
  ))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['corporateActions'],
      message: '公司行動來源必須屬於對應市場的官方網域。',
    });
  }
  const barDates = new Set(snapshot.bars.map((bar) => bar.date));
  if (snapshot.noQuoteEvidence.some((evidence) => barDates.has(evidence.date))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['noQuoteEvidence'],
      message: '未報價證據不可與合法日 K 共用交易日。',
    });
  }
  if (snapshot.bars.length === 0 && snapshot.noQuoteEvidence.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '快照至少需要一根合法日 K 或一筆官方未報價證據。',
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
    noQuoteEvidence: value.noQuoteEvidence as readonly NoQuoteEvidence[],
    corporateActions: value.corporateActions as readonly CorporateAction[],
    sourceUrls: value.sourceUrls,
  };
}
