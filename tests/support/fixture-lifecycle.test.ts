import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtureSnapshot, prepareFixtureSnapshot } from '../e2e/fixture-lifecycle';

interface FixturePaths {
  root: string;
  publicDataDirectory: string;
  temporaryRoot: string;
  preexistingFile: string;
  generatedFile: string;
  generatedManifest: string;
}

interface PreparationFailurePaths {
  readonly root: string;
  readonly publicDataDirectory: string;
  readonly temporaryRoots: string[];
  readonly preexistingNestedFile?: string;
}

let activeFixture: FixturePaths | undefined;
let activePreparationFailure: PreparationFailurePaths | undefined;

function createFixture(): FixturePaths {
  const root = mkdtempSync(join(tmpdir(), 'candlestick-e2e-'));
  const publicDataDirectory = join(root, 'public', 'data');
  const temporaryRoot = join(root, 'temporary');
  const preexistingFile = join(publicDataDirectory, 'pre-existing.txt');
  const generatedFile = join(publicDataDirectory, 'stocks', '2330.fixture.json');
  const generatedManifest = join(publicDataDirectory, 'manifest.json');

  mkdirSync(dirname(generatedFile), { recursive: true });
  mkdirSync(join(temporaryRoot, 'site-data'), { recursive: true });
  writeFileSync(preexistingFile, '保留既有資料', 'utf8');
  writeFileSync(generatedFile, '本次產生的股票資料', 'utf8');
  writeFileSync(generatedManifest, JSON.stringify({
    symbols: [{ dataPath: 'data/stocks/2330.fixture.json' }],
  }), 'utf8');
  writeFileSync(join(temporaryRoot, 'site-data', 'manifest.json'), '暫存清冊', 'utf8');
  writeFileSync(join(publicDataDirectory, '.task-8-e2e-fixture.json'), JSON.stringify({
    schemaVersion: 1,
    owner: 'task-8-e2e',
    runId: 'unit-test',
    publicDataDirectoryCreated: false,
    publicFiles: ['manifest.json', 'stocks/2330.fixture.json'],
    publicDirectories: ['stocks'],
    temporaryRoot,
    temporaryFiles: ['site-data/manifest.json'],
    temporaryDirectories: ['site-data'],
  }), 'utf8');

  return {
    root,
    publicDataDirectory,
    temporaryRoot,
    preexistingFile,
    generatedFile,
    generatedManifest,
  };
}

function createPreparationFailurePaths(options: {
  readonly existingDataDirectory?: boolean;
  readonly existingNestedFile?: boolean;
} = {}): PreparationFailurePaths {
  const root = mkdtempSync(join(tmpdir(), 'candlestick-e2e-test-'));
  const publicDataDirectory = join(root, 'public', 'data');
  const preexistingNestedFile = join(publicDataDirectory, 'legacy', 'keep.txt');
  if (options.existingDataDirectory || options.existingNestedFile) {
    mkdirSync(publicDataDirectory, { recursive: true });
  }
  if (options.existingNestedFile) {
    mkdirSync(dirname(preexistingNestedFile), { recursive: true });
    writeFileSync(preexistingNestedFile, '使用者原有巢狀資料', 'utf8');
  }
  return {
    root,
    publicDataDirectory,
    temporaryRoots: [],
    preexistingNestedFile: options.existingNestedFile ? preexistingNestedFile : undefined,
  };
}

function createTrustedTemporaryRoot(paths: PreparationFailurePaths): string {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'candlestick-e2e-'));
  paths.temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}

function writeStockFixture(snapshotDirectory: string): void {
  const stockFile = join(snapshotDirectory, 'data', 'stocks', '2330.fixture.json');
  mkdirSync(dirname(stockFile), { recursive: true });
  writeFileSync(join(snapshotDirectory, 'manifest.json'), JSON.stringify({
    symbols: [{ dataPath: 'data/stocks/2330.fixture.json' }],
  }), 'utf8');
  writeFileSync(stockFile, '本次暫存股票資料', 'utf8');
}

function removeFileIfPresent(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function removeEmptyDirectoryIfPresent(path: string): void {
  if (existsSync(path)) {
    rmdirSync(path);
  }
}

function removeKnownTemporaryRoot(temporaryRoot: string): void {
  for (const path of [
    join(temporaryRoot, 'site-data', 'data', 'stocks', '2330.fixture.json'),
    join(temporaryRoot, 'site-data', 'partial.json'),
    join(temporaryRoot, 'site-data', 'manifest.json'),
  ]) {
    removeFileIfPresent(path);
  }
  for (const path of [
    join(temporaryRoot, 'site-data', 'data', 'stocks'),
    join(temporaryRoot, 'site-data', 'data'),
    join(temporaryRoot, 'site-data'),
    temporaryRoot,
  ]) {
    removeEmptyDirectoryIfPresent(path);
  }
}

function removePreparationFailurePaths(paths: PreparationFailurePaths): void {
  for (const temporaryRoot of paths.temporaryRoots) {
    removeKnownTemporaryRoot(temporaryRoot);
  }
  for (const path of [
    join(paths.publicDataDirectory, 'stocks', '2330.fixture.json'),
    join(paths.publicDataDirectory, 'manifest.json'),
    join(paths.publicDataDirectory, '.task-8-e2e-fixture.json'),
    paths.preexistingNestedFile,
  ]) {
    if (path) {
      removeFileIfPresent(path);
    }
  }
  for (const path of [
    join(paths.publicDataDirectory, 'stocks'),
    join(paths.publicDataDirectory, 'legacy'),
    paths.publicDataDirectory,
    dirname(paths.publicDataDirectory),
    paths.root,
  ]) {
    removeEmptyDirectoryIfPresent(path);
  }
}

afterEach(() => {
  cleanupFixtureSnapshot();
  if (!activeFixture) {
    if (activePreparationFailure) {
      try {
        cleanupFixtureSnapshot(activePreparationFailure.publicDataDirectory);
      } catch {
        // partial marker 可能不是完整 JSON；以下只移除測試明確建立的路徑。
      }
      removePreparationFailurePaths(activePreparationFailure);
      activePreparationFailure = undefined;
    }
    return;
  }
  cleanupFixtureSnapshot(activeFixture.publicDataDirectory);
  if (existsSync(activeFixture.preexistingFile)) {
    unlinkSync(activeFixture.preexistingFile);
  }
  for (const directory of [
    activeFixture.publicDataDirectory,
    dirname(activeFixture.publicDataDirectory),
    activeFixture.root,
  ]) {
    if (existsSync(directory)) {
      rmdirSync(directory);
    }
  }
  activeFixture = undefined;
});

describe('E2E fixture lifecycle', () => {
  it('保留測試執行前已存在的 public/data 檔案', () => {
    activeFixture = createFixture();

    cleanupFixtureSnapshot(activeFixture.publicDataDirectory);

    expect(existsSync(activeFixture.preexistingFile)).toBe(true);
  });

  it('只清除 marker 精確列出的 generated 檔案與空目錄', () => {
    activeFixture = createFixture();

    cleanupFixtureSnapshot(activeFixture.publicDataDirectory);

    expect(existsSync(activeFixture.generatedFile)).toBe(false);
    expect(existsSync(activeFixture.generatedManifest)).toBe(false);
    expect(existsSync(join(activeFixture.publicDataDirectory, '.task-8-e2e-fixture.json'))).toBe(false);
    expect(existsSync(join(activeFixture.publicDataDirectory, 'stocks'))).toBe(false);
    expect(existsSync(activeFixture.temporaryRoot)).toBe(false);
  });

  it('mkdtemp 失敗時不留下本輪 public/data 或 marker', () => {
    activePreparationFailure = createPreparationFailurePaths();
    let buildFixtureCalled = false;

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      createTemporaryRoot: () => {
        throw new Error('mkdtemp 強制失敗');
      },
      buildFixture: (snapshotDirectory: string) => {
        buildFixtureCalled = true;
        writeStockFixture(snapshotDirectory);
      },
    })).toThrow('mkdtemp 強制失敗');

    expect(buildFixtureCalled).toBe(false);
    expect(activePreparationFailure.temporaryRoots).toEqual([]);
    expect(existsSync(activePreparationFailure.publicDataDirectory)).toBe(false);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, '.task-8-e2e-fixture.json'))).toBe(false);
  });

  it('CLI 失敗時會清除本輪暫存快照與 public/data', () => {
    activePreparationFailure = createPreparationFailurePaths();

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      createTemporaryRoot: () => createTrustedTemporaryRoot(activePreparationFailure!),
      buildFixture: (snapshotDirectory: string) => {
        mkdirSync(snapshotDirectory, { recursive: true });
        writeFileSync(join(snapshotDirectory, 'partial.json'), 'CLI 失敗前暫存資料', 'utf8');
        throw new Error('CLI 強制失敗');
      },
    })).toThrow('CLI 強制失敗');

    expect(activePreparationFailure.temporaryRoots).toHaveLength(1);
    expect(existsSync(activePreparationFailure.temporaryRoots[0]!)).toBe(false);
    expect(existsSync(activePreparationFailure.publicDataDirectory)).toBe(false);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, '.task-8-e2e-fixture.json'))).toBe(false);
  });

  it('invalid manifest 時會清除本輪暫存快照與 public/data', () => {
    activePreparationFailure = createPreparationFailurePaths();

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      createTemporaryRoot: () => createTrustedTemporaryRoot(activePreparationFailure!),
      buildFixture: (snapshotDirectory: string) => {
        mkdirSync(snapshotDirectory, { recursive: true });
        writeFileSync(join(snapshotDirectory, 'manifest.json'), JSON.stringify({ symbols: '無效' }), 'utf8');
      },
    })).toThrow('E2E fixture manifest 缺少 symbols');

    expect(activePreparationFailure.temporaryRoots).toHaveLength(1);
    expect(existsSync(activePreparationFailure.temporaryRoots[0]!)).toBe(false);
    expect(existsSync(activePreparationFailure.publicDataDirectory)).toBe(false);
  });

  it('含股票目錄的 partial marker 失敗會清除 marker、stocks 與暫存快照', () => {
    activePreparationFailure = createPreparationFailurePaths();

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      createTemporaryRoot: () => createTrustedTemporaryRoot(activePreparationFailure!),
      buildFixture: writeStockFixture,
      writeMarker: (markerPath: string) => {
        writeFileSync(markerPath, '{"schemaVersion":', 'utf8');
        throw new Error('partial marker 強制失敗');
      },
    })).toThrow('partial marker 強制失敗');

    expect(existsSync(join(activePreparationFailure.publicDataDirectory, '.task-8-e2e-fixture.json'))).toBe(false);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, 'stocks'))).toBe(false);
    expect(existsSync(activePreparationFailure.publicDataDirectory)).toBe(false);
    expect(activePreparationFailure.temporaryRoots).toHaveLength(1);
    expect(existsSync(activePreparationFailure.temporaryRoots[0]!)).toBe(false);
  });

  it('既有空 public/data 的 partial marker 失敗只清除本輪 marker、stocks 與暫存快照', () => {
    activePreparationFailure = createPreparationFailurePaths({ existingDataDirectory: true });

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      createTemporaryRoot: () => createTrustedTemporaryRoot(activePreparationFailure!),
      buildFixture: writeStockFixture,
      writeMarker: (markerPath: string) => {
        writeFileSync(markerPath, '{"schemaVersion":', 'utf8');
        throw new Error('既有 data 的 partial marker 強制失敗');
      },
    })).toThrow('既有 data 的 partial marker 強制失敗');

    expect(existsSync(activePreparationFailure.publicDataDirectory)).toBe(true);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, '.task-8-e2e-fixture.json'))).toBe(false);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, 'stocks'))).toBe(false);
    expect(readdirSync(activePreparationFailure.publicDataDirectory)).toEqual([]);
    expect(activePreparationFailure.temporaryRoots).toHaveLength(1);
    expect(existsSync(activePreparationFailure.temporaryRoots[0]!)).toBe(false);
  });

  it('既有空 public/data 在前一輪 cleanup 後可再次準備 fixture', () => {
    activePreparationFailure = createPreparationFailurePaths({ existingDataDirectory: true });
    const options = {
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      createTemporaryRoot: () => createTrustedTemporaryRoot(activePreparationFailure!),
      buildFixture: writeStockFixture,
    };

    prepareFixtureSnapshot(options);
    cleanupFixtureSnapshot(activePreparationFailure.publicDataDirectory);

    expect(readdirSync(activePreparationFailure.publicDataDirectory)).toEqual([]);
    expect(() => prepareFixtureSnapshot(options)).not.toThrow();
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, '.task-8-e2e-fixture.json'))).toBe(true);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, 'manifest.json'))).toBe(true);
  });

  it('既有巢狀目錄與檔案時拒絕準備並完整保留它們', () => {
    activePreparationFailure = createPreparationFailurePaths({ existingNestedFile: true });

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      createTemporaryRoot: () => createTrustedTemporaryRoot(activePreparationFailure!),
      buildFixture: writeStockFixture,
    })).toThrow('public/data 已有非本次 E2E fixture 檔案');

    expect(activePreparationFailure.temporaryRoots).toEqual([]);
    expect(activePreparationFailure.preexistingNestedFile).toBeDefined();
    expect(readFileSync(activePreparationFailure.preexistingNestedFile!, 'utf8')).toBe('使用者原有巢狀資料');
    expect(existsSync(dirname(activePreparationFailure.preexistingNestedFile!))).toBe(true);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, '.task-8-e2e-fixture.json'))).toBe(false);
    expect(existsSync(join(activePreparationFailure.publicDataDirectory, 'stocks'))).toBe(false);
  });
});
