import { SITE_BASE } from '../site/navigation';
import type { Freshness, PriceMode, StockSnapshot, Timeframe, UnavailableReason } from './types';
import {
  marketManifestSchema,
  stockSnapshotSchema,
  toStockSnapshot,
  type MarketDataManifest,
} from './schema';

/** 僅允許以同站台相對路徑讀取靜態快照的 fetch 介面。 */
export interface FetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 供 UI 注入測試或瀏覽器 fetch 的最小介面。 */
export type FetchLike = (input: string) => Promise<FetchResponse>;

/** 供 UI 顯示的資料載入失敗；reason 與 matcher 的 unavailable 契約保持一致。 */
export class MarketDataError extends Error {
  constructor(
    public readonly reason: UnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

const DATA_PATH_PATTERN = /^data\/stocks\/([0-9]{4,6})\.([A-Za-z0-9_-]{1,128})\.json$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function defaultFetch(input: string): Promise<FetchResponse> {
  if (typeof globalThis.fetch !== 'function') {
    return Promise.reject(new MarketDataError('load-error', '此環境無法使用瀏覽器資料載入功能。'));
  }
  return globalThis.fetch(input);
}

function safeBasePath(base: string): string {
  const normalized = base.trim();
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(normalized)) {
    throw new MarketDataError('schema-error', '網站基底路徑不是安全的同源相對路徑。');
  }
  return normalized;
}

function sameOriginDataPath(base: string, relativePath: string): string {
  const safeBase = safeBasePath(base);
  if (!/^data\/(?:manifest\.json|stocks\/[A-Za-z0-9._-]+\.json)$/.test(relativePath)) {
    throw new MarketDataError('schema-error', '僅允許讀取已發布的快照資料檔。');
  }
  return `${safeBase}${relativePath}`;
}

function messageFor(reason: UnavailableReason): string {
  switch (reason) {
    case 'not-found':
      return '找不到這個股票代碼。請確認代碼後重新查詢。';
    case 'unsupported-security':
      return '此證券不是第一版支援的普通股。';
    case 'load-error':
      return '無法載入盤後資料。請稍後重新查詢。';
    default:
      return '資料格式或完整性驗證失敗，已停止型態比對。';
  }
}

function asMarketDataError(error: unknown, fallback: UnavailableReason): MarketDataError {
  if (error instanceof MarketDataError) {
    return error;
  }
  return new MarketDataError(fallback, messageFor(fallback));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new MarketDataError('schema-error', '此瀏覽器無法驗證資料完整性，已停止型態比對。');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readResponseBytes(fetcher: FetchLike, path: string): Promise<Uint8Array> {
  let response: FetchResponse;
  try {
    response = await fetcher(path);
  } catch (error) {
    throw asMarketDataError(error, 'load-error');
  }
  if (!response.ok) {
    throw new MarketDataError('load-error', `無法載入盤後資料（HTTP ${response.status}）。請稍後重新查詢。`);
  }

  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw asMarketDataError(error, 'load-error');
  }
}

function parseUtf8Json(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new MarketDataError('schema-error', '資料不是有效的 UTF-8 JSON，已停止型態比對。');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MarketDataError('schema-error', '資料不是有效的 UTF-8 JSON，已停止型態比對。');
  }
}

async function assertManifestHash(value: unknown, expectedHash: string): Promise<void> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketDataError('schema-error', messageFor('schema-error'));
  }
  const withoutHash = { ...(value as Record<string, unknown>) };
  delete withoutHash.snapshotHash;
  const calculated = await sha256Hex(utf8Bytes(`${canonicalJson(withoutHash)}\n`));
  if (calculated !== expectedHash) {
    throw new MarketDataError('schema-error', '快照清冊雜湊不符，已停止型態比對。');
  }
}

function safeStockPath(entry: MarketDataManifest['symbols'][number]): string {
  const matches = DATA_PATH_PATTERN.exec(entry.dataPath);
  if (!matches || matches[1] !== entry.code || !SHA256_PATTERN.test(entry.digest)) {
    throw new MarketDataError('schema-error', '股票資料路徑或雜湊索引不安全，已停止型態比對。');
  }
  return entry.dataPath;
}

function assertStockMatchesIndex(
  entry: MarketDataManifest['symbols'][number],
  snapshot: ReturnType<typeof stockSnapshotSchema.parse>,
): void {
  const dailyCompletedBars = snapshot.priceModes.raw.timeframes['1d'].completedBars;
  const firstDate = dailyCompletedBars[0]?.date ?? null;
  const lastDate = dailyCompletedBars.at(-1)?.date ?? null;
  if (
    firstDate !== entry.firstDate
    || lastDate !== entry.lastDate
    || dailyCompletedBars.length !== entry.barCount
    || snapshot.noQuoteEvidence.length !== entry.noQuoteCount
    || snapshot.listingDate !== entry.listingDate
    || snapshot.availableSessions !== entry.availableSessions
    || snapshot.availableSessions !== dailyCompletedBars.length + snapshot.noQuoteEvidence.length
    || snapshot.shortHistoryReason !== entry.shortHistoryReason
  ) {
    throw new MarketDataError('schema-error', '股票資料與清冊的日期、筆數或歷史可用性欄位不一致。');
  }
}

function intervalIncludesDate(
  interval: MarketDataManifest['suspensionEvidence']['intervals'][number],
  tradingDate: string,
): boolean {
  return tradingDate >= interval.startDate
    && (interval.endDateExclusive === null || tradingDate < interval.endDateExclusive);
}

function assertStockMatchesMarketSessions(
  manifest: MarketDataManifest,
  snapshot: ReturnType<typeof stockSnapshotSchema.parse>,
): void {
  const tradingSessions = manifest.markets[snapshot.market].tradingSessions;
  const tradingSessionSet = new Set(tradingSessions);
  const dailyCompletedBars = snapshot.priceModes.raw.timeframes['1d'].completedBars;
  const observations = [
    ...dailyCompletedBars.map((bar) => bar.date),
    ...snapshot.noQuoteEvidence.map((evidence) => evidence.date),
  ];
  const observationCounts = new Map<string, number>();
  for (const observationDate of observations) {
    observationCounts.set(observationDate, (observationCounts.get(observationDate) ?? 0) + 1);
  }
  if (
    [...observationCounts.values()].some((count) => count !== 1)
    || [...observationCounts.keys()].some((tradingDate) => (
      tradingDate < snapshot.listingDate || !tradingSessionSet.has(tradingDate)
    ))
  ) {
    throw new MarketDataError('schema-error', '股票觀測資料必須各自對應上市後的一個 manifest 交易日。');
  }

  const expectedSessions = tradingSessions.filter((tradingDate) => tradingDate >= snapshot.listingDate);
  if (
    expectedSessions.length !== observationCounts.size
    || expectedSessions.some((tradingDate) => !observationCounts.has(tradingDate))
  ) {
    throw new MarketDataError('schema-error', '上市後的每個 manifest 交易日必須恰有一筆 K 線或官方無報價證據。');
  }
}

function assertStockMatchesSuspensionEvidence(
  manifest: MarketDataManifest,
  snapshot: ReturnType<typeof stockSnapshotSchema.parse>,
): void {
  const intervals = manifest.suspensionEvidence.intervals.filter((interval) => (
    interval.market === snapshot.market && interval.code === snapshot.code
  ));
  const barDates = new Set(snapshot.priceModes.raw.timeframes['1d'].completedBars.map((bar) => bar.date));
  const evidenceByDate = new Map(snapshot.noQuoteEvidence.map((evidence) => [evidence.date, evidence]));

  for (const evidence of snapshot.noQuoteEvidence) {
    const matching = intervals.filter((interval) => intervalIncludesDate(interval, evidence.date));
    if (!snapshot.sourceUrls.includes(evidence.sourceUrl)) {
      throw new MarketDataError('schema-error', '未報價或停牌證據缺少股票快照中的官方來源。');
    }
    if (evidence.reason === 'official-suspension') {
      if (matching.length !== 1 || !matching[0]!.sourceUrls.includes(evidence.sourceUrl)) {
        throw new MarketDataError('schema-error', '股票停牌證據與 manifest 官方公告區間不一致。');
      }
    } else if (matching.length > 0) {
      throw new MarketDataError('schema-error', '公告停止買賣日不可標示為一般未報價。');
    }
  }

  for (const tradingDate of manifest.markets[snapshot.market].tradingSessions) {
    if (tradingDate < snapshot.listingDate) {
      continue;
    }
    const matching = intervals.filter((interval) => intervalIncludesDate(interval, tradingDate));
    if (matching.length === 0) {
      continue;
    }
    const evidence = evidenceByDate.get(tradingDate);
    if (
      matching.length !== 1
      || barDates.has(tradingDate)
      || evidence?.reason !== 'official-suspension'
      || !matching[0]!.sourceUrls.includes(evidence.sourceUrl)
    ) {
      throw new MarketDataError('schema-error', '官方停止買賣區間沒有完整對應的合法 K 線或停牌證據。');
    }
  }
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function calendarBounds(timeframe: Exclude<Timeframe, '1d'>, barDate: string): readonly [string, string] {
  const parsed = parseIsoDate(barDate);
  if (timeframe === '1w') {
    const monday = addUtcDays(parsed, -((parsed.getUTCDay() + 6) % 7));
    return [formatIsoDate(monday), formatIsoDate(addUtcDays(monday, 6))];
  }
  const first = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
  const last = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0));
  return [formatIsoDate(first), formatIsoDate(last)];
}

function officialPeriodSessions(
  manifest: MarketDataManifest,
  timeframe: Exclude<Timeframe, '1d'>,
  barDate: string,
  listingDate: string,
): readonly string[] {
  const [calendarStart, calendarEnd] = calendarBounds(timeframe, barDate);
  const effectiveStart = calendarStart > listingDate ? calendarStart : listingDate;
  const calendarCoverageStart = `${manifest.calendar.holidayDates[0]!.slice(0, 4)}-01-01`;
  if (effectiveStart < calendarCoverageStart || calendarEnd > manifest.calendar.validThrough) {
    throw new MarketDataError('schema-error', '週期 K 線超出官方交易日曆可驗證範圍。');
  }

  const holidays = new Set(manifest.calendar.holidayDates);
  const sessions: string[] = [];
  for (
    let candidate = parseIsoDate(effectiveStart);
    formatIsoDate(candidate) <= calendarEnd;
    candidate = addUtcDays(candidate, 1)
  ) {
    const date = formatIsoDate(candidate);
    const weekday = candidate.getUTCDay();
    if (weekday >= 1 && weekday <= 5 && !holidays.has(date)) {
      sessions.push(date);
    }
  }
  if (sessions.length === 0) {
    throw new MarketDataError('schema-error', '週期 K 線找不到對應的官方交易日。');
  }
  return sessions;
}

function assertAggregateBar(
  manifest: MarketDataManifest,
  snapshot: ReturnType<typeof stockSnapshotSchema.parse>,
  dailyBars: ReturnType<typeof stockSnapshotSchema.parse>['priceModes']['raw']['timeframes']['1d']['completedBars'],
  timeframe: Exclude<Timeframe, '1d'>,
  bar: ReturnType<typeof stockSnapshotSchema.parse>['priceModes']['raw']['timeframes']['1w']['completedBars'][number],
): void {
  const expectedSessions = officialPeriodSessions(manifest, timeframe, bar.date, snapshot.listingDate);
  const market = manifest.markets[snapshot.market];
  if (bar.periodStart !== expectedSessions[0] || bar.periodEnd !== expectedSessions.at(-1)) {
    throw new MarketDataError('schema-error', '週期 K 線沒有涵蓋完整的官方自然期間。');
  }
  if (!expectedSessions.includes(bar.date)) {
    throw new MarketDataError('schema-error', '週期 K 線日期不是該期間的官方交易日。');
  }
  const expectedCompleted = expectedSessions.every((session) => session <= market.cutoffDate);
  if (bar.completed !== expectedCompleted) {
    throw new MarketDataError('schema-error', '週期 K 線的完成狀態與官方交易日曆不一致。');
  }

  const firstRetainedDailyDate = dailyBars[0]?.date;
  if (!firstRetainedDailyDate || bar.periodEnd < firstRetainedDailyDate) {
    return;
  }

  const observedExpectedSessions = expectedSessions.filter((session) => session <= market.cutoffDate);
  const marketSessions = new Set(market.tradingSessions);
  if (observedExpectedSessions.some((session) => !marketSessions.has(session))) {
    throw new MarketDataError('schema-error', '週期 K 線的官方交易日與 manifest 不一致。');
  }
  const constituents = dailyBars.filter((daily) => (
    daily.date >= bar.periodStart && daily.date <= bar.periodEnd
  ));
  if (constituents.length === 0) {
    throw new MarketDataError('schema-error', '週期 K 線缺少可稽核的日 K 組成資料。');
  }
  const missingSessionDates = snapshot.noQuoteEvidence
    .map((evidence) => evidence.date)
    .filter((date) => date >= bar.periodStart && date <= bar.periodEnd && date <= market.cutoffDate)
    .sort();
  if (
    bar.missingSessionDates.length !== missingSessionDates.length
    || bar.missingSessionDates.some((date, index) => date !== missingSessionDates[index])
  ) {
    throw new MarketDataError('schema-error', '週期 K 線沒有正確彙整官方未報價證據。');
  }

  const transactionCounts = constituents
    .map((daily) => daily.transactionCount)
    .filter((count): count is number => count !== undefined);
  const aggregateMismatch = (
    !almostEqual(bar.open, constituents[0]!.open)
    || !almostEqual(bar.high, Math.max(...constituents.map((daily) => daily.high)))
    || !almostEqual(bar.low, Math.min(...constituents.map((daily) => daily.low)))
    || !almostEqual(bar.close, constituents.at(-1)!.close)
    || !almostEqual(bar.volumeShares, constituents.reduce((sum, daily) => sum + daily.volumeShares, 0))
    || bar.date !== constituents.at(-1)!.date
    || (transactionCounts.length > 0
      ? bar.transactionCount !== transactionCounts.reduce((sum, count) => sum + count, 0)
      : bar.transactionCount !== undefined)
  );
  if (aggregateMismatch) {
    throw new MarketDataError('schema-error', '週期 K 線的 OHLCV 聚合結果不一致。');
  }
}

function assertStockTimeframeAggregates(
  manifest: MarketDataManifest,
  snapshot: ReturnType<typeof stockSnapshotSchema.parse>,
): void {
  for (const priceMode of ['raw', 'adjusted'] as const) {
    const mode = snapshot.priceModes[priceMode];
    if (mode.status !== 'available') {
      continue;
    }
    const dailyBars = mode.timeframes['1d'].completedBars;
    for (const timeframe of ['1w', '1m'] as const) {
      const series = mode.timeframes[timeframe];
      for (const bar of [
        ...series.completedBars,
        ...(series.formingBar ? [series.formingBar] : []),
      ]) {
        assertAggregateBar(manifest, snapshot, dailyBars, timeframe, bar);
      }
    }
  }
}

/** 歷史公司行動與調整因子必須落在已發布範圍內的官方交易日。 */
function assertAdjustmentEvidenceSessions(
  manifest: MarketDataManifest,
  snapshot: ReturnType<typeof stockSnapshotSchema.parse>,
): void {
  const publishedBars = Object.values(snapshot.priceModes.raw.timeframes).flatMap((series) => [
    ...series.completedBars,
    ...(series.formingBar ? [series.formingBar] : []),
  ]);
  const publishedHistoryStart = [
    ...publishedBars.map((bar) => bar.periodStart),
    ...snapshot.noQuoteEvidence.map((evidence) => evidence.date),
  ].sort()[0];
  const publishedHistoryEnd = manifest.markets[snapshot.market].cutoffDate;
  const calendarCoverageStart = `${manifest.calendar.holidayDates[0]!.slice(0, 4)}-01-01`;
  const holidays = new Set(manifest.calendar.holidayDates);
  const evidenceDates = [
    ...snapshot.corporateActions.map((action) => action.date),
    ...snapshot.adjustmentFactors.map((factor) => factor.effectiveDate),
  ];
  const hasInvalidDate = publishedHistoryStart === undefined || evidenceDates.some((value) => {
    const weekday = parseIsoDate(value).getUTCDay();
    return value < snapshot.listingDate
      || value < publishedHistoryStart
      || value < calendarCoverageStart
      || value > publishedHistoryEnd
      || weekday === 0
      || weekday === 6
      || holidays.has(value);
  });
  if (hasInvalidDate) {
    throw new MarketDataError('schema-error', '公司行動或調整因子日期不是已發布範圍內的官方交易日。');
  }
}

function almostEqual(actual: number, expected: number): boolean {
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-10);
  return Math.abs(actual - expected) <= tolerance;
}

/** 瀏覽器再次用公開因子重算日 K，避免雜湊正確但內容語意錯置的還原序列進入 matcher。 */
function assertAdjustedDailySeries(snapshot: ReturnType<typeof stockSnapshotSchema.parse>): void {
  const adjusted = snapshot.priceModes.adjusted;
  if (adjusted.status !== 'available') {
    return;
  }
  const rawBars = snapshot.priceModes.raw.timeframes['1d'].completedBars;
  const adjustedBars = adjusted.timeframes['1d'].completedBars;
  if (rawBars.length !== adjustedBars.length) {
    throw new MarketDataError('schema-error', '向後還原日 K 與官方原始日 K 筆數不一致。');
  }
  for (const [index, raw] of rawBars.entries()) {
    const adjustedBar = adjustedBars[index];
    if (!adjustedBar) {
      throw new MarketDataError('schema-error', '向後還原日 K 缺少對應的官方原始日 K。');
    }
    const laterFactors = snapshot.adjustmentFactors.filter((factor) => raw.date < factor.effectiveDate);
    const priceFactor = laterFactors.reduce((product, factor) => product * factor.priceFactor, 1);
    const volumeFactor = laterFactors.reduce((product, factor) => product * factor.volumeFactor, 1);
    if (
      !almostEqual(adjustedBar.open, raw.open * priceFactor)
      || !almostEqual(adjustedBar.high, raw.high * priceFactor)
      || !almostEqual(adjustedBar.low, raw.low * priceFactor)
      || !almostEqual(adjustedBar.close, raw.close * priceFactor)
      || !almostEqual(adjustedBar.volumeShares, raw.volumeShares * volumeFactor)
      || adjustedBar.transactionCount !== raw.transactionCount
    ) {
      throw new MarketDataError('schema-error', '向後還原日 K 無法由官方原始日 K 與公開調整因子重算。');
    }
  }
}

/** 將全形數字與空白正規化後，只接受 4 至 6 碼股票代碼。 */
export function normalizeStockCode(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const normalized = input
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim();
  return /^[0-9]{4,6}$/.test(normalized) ? normalized : null;
}

/**
 * 從已驗證的多時間週期快照選取一組圖表與 matcher 共用的 K 棒。
 * 形成中 K 棒會保留在 bars 供圖表呈現，但 matcher 會依 completed/evidenceStatus 排除。
 */
export function selectStockTimeframe(snapshot: StockSnapshot, timeframe: Timeframe): StockSnapshot {
  const mode = snapshot.priceModes?.[snapshot.priceMode];
  if (!mode || mode.status !== 'available') {
    throw new MarketDataError('schema-error', '目前價格模式的多時間週期資料不可用，已停止型態比對。');
  }
  const series = mode.timeframes[timeframe];
  if (!series) {
    throw new MarketDataError('schema-error', '指定時間週期不在已驗證的股票快照中。');
  }

  return {
    ...snapshot,
    timeframe,
    bars: [
      ...series.completedBars,
      ...(series.formingBar ? [series.formingBar] : []),
    ],
  };
}

/**
 * 在相同時間週期下切換官方原始或向後還原價格，確保圖表與 matcher 共用同一組 K 棒。
 */
export function selectStockPriceMode(snapshot: StockSnapshot, priceMode: PriceMode): StockSnapshot {
  const mode = snapshot.priceModes?.[priceMode];
  if (!mode || mode.status !== 'available') {
    const warning = mode?.warnings[0];
    throw new MarketDataError(
      'schema-error',
      warning ?? '指定價格模式缺少可稽核資料，已停止型態比對。',
    );
  }
  const timeframe = snapshot.timeframe ?? '1d';
  const series = mode.timeframes[timeframe];
  return {
    ...snapshot,
    priceMode,
    timeframe,
    bars: [
      ...series.completedBars,
      ...(series.formingBar ? [series.formingBar] : []),
    ],
  };
}

/** 讀取 manifest 前先收斂到 GitHub Pages base 下的同源安全 URL。 */
export async function loadManifest(
  base: string = SITE_BASE,
  fetcher: FetchLike = defaultFetch,
): Promise<MarketDataManifest> {
  const bytes = await readResponseBytes(fetcher, sameOriginDataPath(base, 'data/manifest.json'));
  const value = parseUtf8Json(bytes);
  const parsed = marketManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new MarketDataError('schema-error', messageFor('schema-error'));
  }
  await assertManifestHash(value, parsed.data.snapshotHash);
  return parsed.data;
}

/**
 * 只從 manifest 已列出的安全資料路徑讀取一檔股票快照。
 * 不會依使用者輸入直接組合外部 URL，也不會直接呼叫 TWSE 或 TPEx。
 */
export async function loadStockSnapshot(
  manifest: MarketDataManifest,
  input: unknown,
  fetcher: FetchLike = defaultFetch,
  base: string = SITE_BASE,
): Promise<StockSnapshot> {
  const code = normalizeStockCode(input);
  if (!code) {
    throw new MarketDataError('not-found', '輸入的股票代碼格式不正確，請輸入 4 至 6 碼數字代碼。');
  }
  const entry = manifest.symbols.find((symbol) => symbol.code === code);
  if (!entry) {
    throw new MarketDataError('not-found', messageFor('not-found'));
  }
  if (entry.securityType !== 'common-stock') {
    throw new MarketDataError('unsupported-security', messageFor('unsupported-security'));
  }

  const path = sameOriginDataPath(base, safeStockPath(entry));
  const bytes = await readResponseBytes(fetcher, path);
  let actualDigest: string;
  try {
    actualDigest = await sha256Hex(bytes);
  } catch (error) {
    throw asMarketDataError(error, 'schema-error');
  }
  if (actualDigest !== entry.digest) {
    throw new MarketDataError('schema-error', '股票資料雜湊不符，已停止型態比對。');
  }
  if (bytes.byteLength !== entry.size) {
    throw new MarketDataError('schema-error', '股票資料大小不符，已停止型態比對。');
  }

  const value = parseUtf8Json(bytes);
  const parsed = stockSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new MarketDataError('schema-error', messageFor('schema-error'));
  }
  if (
    parsed.data.code !== entry.code
    || parsed.data.market !== entry.market
    || parsed.data.name !== entry.name
    || parsed.data.securityType !== entry.securityType
  ) {
    throw new MarketDataError('schema-error', '股票資料與清冊索引不一致，已停止型態比對。');
  }
  assertStockMatchesIndex(entry, parsed.data);
  assertStockMatchesMarketSessions(manifest, parsed.data);
  assertStockMatchesSuspensionEvidence(manifest, parsed.data);
  assertAdjustmentEvidenceSessions(manifest, parsed.data);
  assertAdjustedDailySeries(parsed.data);
  assertStockTimeframeAggregates(manifest, parsed.data);
  return toStockSnapshot(parsed.data);
}

/** 取用 manifest 已由發布端標示的新鮮度，供不需重新計算時顯示。 */
export function manifestFreshness(manifest: MarketDataManifest, market: MarketDataManifest['symbols'][number]['market']): Freshness {
  return manifest.markets[market].freshness;
}
