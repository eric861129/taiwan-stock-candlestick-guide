import { SITE_BASE } from '../site/navigation';
import type { Freshness, StockSnapshot, UnavailableReason } from './types';
import {
  marketManifestSchema,
  stockSnapshotSchema,
  toStockSnapshot,
  type MarketDataManifest,
} from './schema';

/** 可在測試或瀏覽器中提供的最小 fetch 回應介面。 */
export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** 僅允許以同站台相對路徑讀取靜態快照的 fetch 介面。 */
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
    return Promise.reject(new MarketDataError('load-error', '此瀏覽器無法載入盤後資料。'));
  }
  return globalThis.fetch(input);
}

function safeBasePath(base: string): string {
  const normalized = base.trim();
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(normalized)) {
    throw new MarketDataError('schema-error', '資料載入設定不是同站台路徑，已停止查詢。');
  }
  return normalized;
}

function sameOriginDataPath(base: string, relativePath: string): string {
  const safeBase = safeBasePath(base);
  if (!/^data\/(?:manifest\.json|stocks\/[A-Za-z0-9._-]+\.json)$/.test(relativePath)) {
    throw new MarketDataError('schema-error', '資料索引指定了不安全的檔案路徑。');
  }
  return `${safeBase}${relativePath}`;
}

function messageFor(reason: UnavailableReason): string {
  switch (reason) {
    case 'not-found':
      return '找不到這個股票代碼。請確認代碼後重新查詢。';
    case 'unsupported-security':
      return '此證券不是第一版支援的上市或上櫃普通股。';
    case 'load-error':
      return '無法載入盤後資料。請稍後重新查詢。';
    default:
      return '資料格式或完整性驗證失敗，沒有執行型態比對。';
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

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new MarketDataError('schema-error', '此瀏覽器無法驗證資料完整性，已停止型態比對。');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(fetcher: FetchLike, path: string): Promise<{ value: unknown; text: string }> {
  let response: FetchResponse;
  try {
    response = await fetcher(path);
  } catch (error) {
    throw asMarketDataError(error, 'load-error');
  }
  if (!response.ok) {
    throw new MarketDataError('load-error', `無法載入盤後資料（HTTP ${response.status}）。請稍後重新查詢。`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw asMarketDataError(error, 'load-error');
  }
  try {
    return { value: JSON.parse(text) as unknown, text };
  } catch {
    throw new MarketDataError('schema-error', '資料不是有效的 UTF-8 JSON，沒有執行型態比對。');
  }
}

async function assertManifestHash(value: unknown, expectedHash: string): Promise<void> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketDataError('schema-error', messageFor('schema-error'));
  }
  const withoutHash = { ...(value as Record<string, unknown>) };
  delete withoutHash.snapshotHash;
  const calculated = await sha256Hex(`${canonicalJson(withoutHash)}\n`);
  if (calculated !== expectedHash) {
    throw new MarketDataError('schema-error', '市場索引完整性驗證失敗，沒有執行型態比對。');
  }
}

function safeStockPath(entry: MarketDataManifest['symbols'][number]): string {
  const matches = DATA_PATH_PATTERN.exec(entry.dataPath);
  if (!matches || matches[1] !== entry.code || !SHA256_PATTERN.test(entry.digest)) {
    throw new MarketDataError('schema-error', '資料索引指定了不安全的股票檔案，已停止查詢。');
  }
  return entry.dataPath;
}

/** 將全形數字與前後空白正規化；非股票代碼格式回傳 null。 */
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

/** 載入並驗證固定 GitHub Pages base 下的市場索引，不接受任意 URL。 */
export async function loadManifest(
  base: string = SITE_BASE,
  fetcher: FetchLike = defaultFetch,
): Promise<MarketDataManifest> {
  const { value } = await readJson(fetcher, sameOriginDataPath(base, 'data/manifest.json'));
  const parsed = marketManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new MarketDataError('schema-error', messageFor('schema-error'));
  }
  await assertManifestHash(value, parsed.data.snapshotHash);
  return parsed.data;
}

/**
 * 只從 manifest 的完全相符普通股索引讀取一個內容雜湊快照。
 * 使用者輸入永遠不會被拼接成 URL，也不會直接請求 TWSE 或 TPEx。
 */
export async function loadStockSnapshot(
  manifest: MarketDataManifest,
  input: unknown,
  fetcher: FetchLike = defaultFetch,
  base: string = SITE_BASE,
): Promise<StockSnapshot> {
  const code = normalizeStockCode(input);
  if (!code) {
    throw new MarketDataError('not-found', '請輸入支援股票清冊中的 4 至 6 位普通股代碼。');
  }
  const entry = manifest.symbols.find((symbol) => symbol.code === code);
  if (!entry) {
    throw new MarketDataError('not-found', messageFor('not-found'));
  }
  if (entry.securityType !== 'common-stock') {
    throw new MarketDataError('unsupported-security', messageFor('unsupported-security'));
  }

  const path = sameOriginDataPath(base, safeStockPath(entry));
  const { value, text } = await readJson(fetcher, path);
  let actualDigest: string;
  try {
    actualDigest = await sha256Hex(text);
  } catch (error) {
    throw asMarketDataError(error, 'schema-error');
  }
  if (actualDigest !== entry.digest) {
    throw new MarketDataError('schema-error', '股票資料完整性驗證失敗，沒有執行型態比對。');
  }
  if (new TextEncoder().encode(text).byteLength !== entry.size) {
    throw new MarketDataError('schema-error', '股票資料大小驗證失敗，沒有執行型態比對。');
  }

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
    throw new MarketDataError('schema-error', '股票索引與資料內容不一致，沒有執行型態比對。');
  }
  return toStockSnapshot(parsed.data);
}

/** 將 manifest 的市場截止資料轉換為 matcher 可使用的新鮮度型別。 */
export function manifestFreshness(manifest: MarketDataManifest, market: MarketDataManifest['symbols'][number]['market']): Freshness {
  return manifest.markets[market].freshness;
}
