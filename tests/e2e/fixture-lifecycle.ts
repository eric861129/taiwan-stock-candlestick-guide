import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicDataDirectory = resolve(repositoryRoot, 'public/data');
const markerFilename = '.task-8-e2e-fixture.json';
const fixtureSourceCommit = 'fixture';
const fixtureOwner = 'task-8-e2e';

interface FixtureMarker {
  readonly schemaVersion: 1;
  readonly owner: typeof fixtureOwner;
  readonly runId: string;
  readonly publicDataDirectoryCreated: boolean;
  readonly publicFiles: readonly string[];
  readonly publicDirectories: readonly string[];
  readonly temporaryRoot: string;
  readonly temporaryFiles: readonly string[];
  readonly temporaryDirectories: readonly string[];
}

interface OwnedTree {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !isAbsolute(value)
    && !value.includes('\\')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function resolveOwnedPath(root: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`E2E fixture 路徑不安全：${String(relativePath)}。`);
  }
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, ...relativePath.split('/'));
  if (!resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`E2E fixture 路徑超出擁有範圍：${relativePath}。`);
  }
  return resolvedPath;
}

function listOwnedTree(root: string): OwnedTree {
  const files: string[] = [];
  const directories: string[] = [];
  const visit = (directory: string, relativeDirectory = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isFile()) {
        files.push(relativePath);
        continue;
      }
      if (!entry.isDirectory()) {
        throw new Error(`E2E fixture 不接受非一般檔案或目錄：${absolutePath}。`);
      }
      directories.push(relativePath);
      visit(absolutePath, relativePath);
    }
  };
  visit(root);
  return { files, directories };
}

function removeKnownFile(root: string, relativePath: string): void {
  const target = resolveOwnedPath(root, relativePath);
  if (!existsSync(target)) {
    return;
  }
  if (!lstatSync(target).isFile()) {
    throw new Error(`拒絕刪除非一般檔案的 E2E fixture 路徑：${target}。`);
  }
  unlinkSync(target);
}

function removeEmptyDirectories(root: string, directories: readonly string[]): void {
  const sorted = [...directories].sort((left, right) => {
    const depthDifference = right.split('/').length - left.split('/').length;
    return depthDifference || right.localeCompare(left);
  });
  for (const relativePath of sorted) {
    const target = resolveOwnedPath(root, relativePath);
    if (!existsSync(target)) {
      continue;
    }
    if (!lstatSync(target).isDirectory()) {
      throw new Error(`拒絕刪除非目錄的 E2E fixture 路徑：${target}。`);
    }
    try {
      rmdirSync(target);
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

function removeOwnedTree(root: string, tree: OwnedTree, removeRoot: boolean): void {
  for (const relativePath of tree.files) {
    removeKnownFile(root, relativePath);
  }
  removeEmptyDirectories(root, tree.directories);
  if (removeRoot && existsSync(root)) {
    try {
      rmdirSync(root);
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

function readStockPathsFromManifest(manifestPath: string): readonly string[] {
  const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('E2E fixture manifest 必須是 JSON 物件。');
  }
  const symbols = (value as { symbols?: unknown }).symbols;
  if (!Array.isArray(symbols)) {
    throw new Error('E2E fixture manifest 缺少 symbols。');
  }
  const paths = symbols.map((symbol) => {
    if (symbol === null || typeof symbol !== 'object' || Array.isArray(symbol)) {
      throw new Error('E2E fixture manifest 的 symbols 項目無效。');
    }
    const dataPath = (symbol as { dataPath?: unknown }).dataPath;
    if (typeof dataPath !== 'string' || !/^data\/stocks\/[A-Za-z0-9._-]+\.json$/.test(dataPath)) {
      throw new Error('E2E fixture manifest 包含不安全的股票資料路徑。');
    }
    return dataPath.slice('data/'.length);
  });
  if (new Set(paths).size !== paths.length) {
    throw new Error('E2E fixture manifest 有重複的股票資料路徑。');
  }
  return paths;
}

function assertStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every(isSafeRelativePath) || new Set(value).size !== value.length) {
    throw new Error(`E2E fixture marker 的 ${field} 無效。`);
  }
  return value;
}

function readMarker(dataDirectory: string): FixtureMarker | null {
  const markerPath = join(dataDirectory, markerFilename);
  if (!existsSync(markerPath)) {
    return null;
  }
  const raw = JSON.parse(readFileSync(markerPath, 'utf8')) as unknown;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('E2E fixture marker 必須是 JSON 物件。');
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || candidate.owner !== fixtureOwner || typeof candidate.runId !== 'string' || !candidate.runId) {
    throw new Error('E2E fixture marker 不屬於目前的 E2E lifecycle。');
  }
  if (typeof candidate.publicDataDirectoryCreated !== 'boolean' || typeof candidate.temporaryRoot !== 'string') {
    throw new Error('E2E fixture marker 的必要欄位無效。');
  }
  const temporaryRoot = resolve(candidate.temporaryRoot);
  const temporaryBase = resolve(tmpdir());
  if (
    !temporaryRoot.startsWith(`${temporaryBase}${sep}`)
    || !temporaryRoot.startsWith(`${temporaryBase}${sep}candlestick-e2e-`)
  ) {
    throw new Error('E2E fixture marker 的暫存目錄不在本次允許範圍。');
  }
  return {
    schemaVersion: 1,
    owner: fixtureOwner,
    runId: candidate.runId,
    publicDataDirectoryCreated: candidate.publicDataDirectoryCreated,
    publicFiles: assertStringArray(candidate.publicFiles, 'publicFiles'),
    publicDirectories: assertStringArray(candidate.publicDirectories, 'publicDirectories'),
    temporaryRoot,
    temporaryFiles: assertStringArray(candidate.temporaryFiles, 'temporaryFiles'),
    temporaryDirectories: assertStringArray(candidate.temporaryDirectories, 'temporaryDirectories'),
  };
}

function assertManifestMatchesMarker(dataDirectory: string, marker: FixtureMarker): void {
  const manifestPath = join(dataDirectory, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return;
  }
  const manifestFiles = readStockPathsFromManifest(manifestPath);
  const markerFiles = marker.publicFiles.filter((path) => path !== 'manifest.json');
  if (
    manifestFiles.length !== markerFiles.length
    || manifestFiles.some((path) => !markerFiles.includes(path))
  ) {
    throw new Error('E2E fixture marker 與 manifest 的股票檔案清單不一致。');
  }
}

function ensureDataDirectoryIsAvailable(): boolean {
  cleanupFixtureSnapshot();
  if (existsSync(publicDataDirectory)) {
    if (readdirSync(publicDataDirectory).length > 0) {
      throw new Error('public/data 已有非本次 E2E fixture 檔案；拒絕覆寫。');
    }
    return false;
  }
  mkdirSync(publicDataDirectory, { recursive: true });
  return true;
}

function ensurePublicDirectory(relativeDirectory: string, createdDirectories: string[]): void {
  const target = resolveOwnedPath(publicDataDirectory, relativeDirectory);
  if (existsSync(target)) {
    return;
  }
  mkdirSync(target, { recursive: true });
  createdDirectories.push(relativeDirectory);
}

/**
 * 建立本次 Playwright run 專屬 fixture；marker 與 manifest 會列出所有可清理檔案。
 */
export function prepareFixtureSnapshot(): void {
  let temporaryRoot: string | undefined;
  let temporaryTree: OwnedTree | undefined;
  try {
    const publicDataDirectoryCreated = ensureDataDirectoryIsAvailable();
    temporaryRoot = mkdtempSync(join(tmpdir(), 'candlestick-e2e-'));
    const fixtureSnapshotDirectory = join(temporaryRoot, 'site-data');
    execFileSync(
      'python',
      [
        'tools/market_snapshot.py',
        'fixture',
        '--fixtures',
        'tests/fixtures/market_snapshot',
        '--output',
        fixtureSnapshotDirectory,
        '--source-commit',
        fixtureSourceCommit,
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    temporaryTree = listOwnedTree(temporaryRoot);
    const stockFiles = readStockPathsFromManifest(join(fixtureSnapshotDirectory, 'manifest.json'));
    const publicDirectories: string[] = [];
    for (const stockFile of stockFiles) {
      const stockDirectory = relative(publicDataDirectory, dirname(resolveOwnedPath(publicDataDirectory, stockFile))).replaceAll('\\', '/');
      ensurePublicDirectory(stockDirectory, publicDirectories);
    }
    const marker: FixtureMarker = {
      schemaVersion: 1,
      owner: fixtureOwner,
      runId: randomUUID(),
      publicDataDirectoryCreated,
      publicFiles: ['manifest.json', ...stockFiles],
      publicDirectories,
      temporaryRoot,
      temporaryFiles: temporaryTree.files,
      temporaryDirectories: temporaryTree.directories,
    };
    writeFileSync(join(publicDataDirectory, markerFilename), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    copyFileSync(join(fixtureSnapshotDirectory, 'manifest.json'), join(publicDataDirectory, 'manifest.json'));
    for (const stockFile of stockFiles) {
      copyFileSync(
        resolveOwnedPath(join(fixtureSnapshotDirectory, 'data'), stockFile),
        resolveOwnedPath(publicDataDirectory, stockFile),
      );
    }
  } catch (error) {
    try {
      cleanupFixtureSnapshot();
      if (temporaryRoot && temporaryTree && existsSync(temporaryRoot)) {
        removeOwnedTree(temporaryRoot, temporaryTree, true);
      } else if (temporaryRoot && existsSync(temporaryRoot)) {
        removeOwnedTree(temporaryRoot, listOwnedTree(temporaryRoot), true);
      }
    } catch {
      // 保留原始建立失敗原因；全域 teardown 仍會再次嘗試 marker 清理。
    }
    throw error;
  }
}

/**
 * 只依 marker 與 manifest 的精確清單移除本次 E2E fixture；未知檔案與非空目錄一律保留。
 */
export function cleanupFixtureSnapshot(dataDirectory: string = publicDataDirectory): void {
  const marker = readMarker(dataDirectory);
  if (!marker) {
    return;
  }
  assertManifestMatchesMarker(dataDirectory, marker);
  for (const relativePath of marker.publicFiles) {
    removeKnownFile(dataDirectory, relativePath);
  }
  removeKnownFile(dataDirectory, markerFilename);
  removeEmptyDirectories(dataDirectory, marker.publicDirectories);
  if (marker.publicDataDirectoryCreated && existsSync(dataDirectory)) {
    try {
      rmdirSync(dataDirectory);
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        throw error;
      }
    }
  }
  removeOwnedTree(marker.temporaryRoot, {
    files: marker.temporaryFiles,
    directories: marker.temporaryDirectories,
  }, true);
}
