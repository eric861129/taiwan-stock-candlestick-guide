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
  root: string;
  publicDataDirectory: string;
  temporaryParent: string;
  preexistingFile?: string;
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

function createPreparationFailurePaths(withPreexistingFile = false): PreparationFailurePaths {
  const root = mkdtempSync(join(tmpdir(), 'candlestick-e2e-'));
  const publicDataDirectory = join(root, 'public', 'data');
  const temporaryParent = join(root, 'temporary');
  mkdirSync(temporaryParent, { recursive: true });
  const preexistingFile = join(publicDataDirectory, 'pre-existing.txt');
  if (withPreexistingFile) {
    mkdirSync(publicDataDirectory, { recursive: true });
    writeFileSync(preexistingFile, '使用者原有資料', 'utf8');
  }
  return {
    root,
    publicDataDirectory,
    temporaryParent,
    preexistingFile: withPreexistingFile ? preexistingFile : undefined,
  };
}

function removePreparationFailurePaths(paths: PreparationFailurePaths): void {
  if (paths.preexistingFile && existsSync(paths.preexistingFile)) {
    unlinkSync(paths.preexistingFile);
  }
  if (existsSync(paths.publicDataDirectory)) {
    rmdirSync(paths.publicDataDirectory);
  }
  const publicDirectory = dirname(paths.publicDataDirectory);
  if (existsSync(publicDirectory)) {
    rmdirSync(publicDirectory);
  }
  if (existsSync(paths.temporaryParent)) {
    rmdirSync(paths.temporaryParent);
  }
  if (existsSync(paths.root)) {
    rmdirSync(paths.root);
  }
}

afterEach(() => {
  cleanupFixtureSnapshot();
  if (!activeFixture) {
    if (activePreparationFailure) {
      cleanupFixtureSnapshot(activePreparationFailure.publicDataDirectory);
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

  it('marker 前 fixture 強制失敗時會清除本次 public/data 與暫存快照', () => {
    activePreparationFailure = createPreparationFailurePaths();

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      temporaryParent: activePreparationFailure.temporaryParent,
      buildFixture: (snapshotDirectory: string) => {
        mkdirSync(snapshotDirectory, { recursive: true });
        writeFileSync(join(snapshotDirectory, 'partial.json'), '本次暫存資料', 'utf8');
        throw new Error('marker 前強制失敗');
      },
    })).toThrow('marker 前強制失敗');

    expect(existsSync(activePreparationFailure.publicDataDirectory)).toBe(false);
    expect(readdirSync(activePreparationFailure.temporaryParent)).toEqual([]);
  });

  it('marker 前失敗不會刪除既有 public/data 檔案', () => {
    activePreparationFailure = createPreparationFailurePaths(true);

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      temporaryParent: activePreparationFailure.temporaryParent,
      buildFixture: () => {
        throw new Error('不應執行 fixture 建立');
      },
    })).toThrow('public/data 已有非本次 E2E fixture 檔案');

    expect(activePreparationFailure.preexistingFile).toBeDefined();
    expect(readFileSync(activePreparationFailure.preexistingFile!, 'utf8')).toBe('使用者原有資料');
    expect(readdirSync(activePreparationFailure.temporaryParent)).toEqual([]);
  });

  it('marker 寫入失敗時會移除本次 partial marker、public/data 與暫存快照', () => {
    activePreparationFailure = createPreparationFailurePaths();

    expect(() => prepareFixtureSnapshot({
      publicDataDirectory: activePreparationFailure.publicDataDirectory,
      temporaryParent: activePreparationFailure.temporaryParent,
      buildFixture: (snapshotDirectory: string) => {
        mkdirSync(snapshotDirectory, { recursive: true });
        writeFileSync(join(snapshotDirectory, 'manifest.json'), JSON.stringify({ symbols: [] }), 'utf8');
      },
      writeMarker: (markerPath: string) => {
        writeFileSync(markerPath, 'partial marker', 'utf8');
        throw new Error('marker 寫入強制失敗');
      },
    })).toThrow('marker 寫入強制失敗');

    expect(existsSync(activePreparationFailure.publicDataDirectory)).toBe(false);
    expect(readdirSync(activePreparationFailure.temporaryParent)).toEqual([]);
  });
});
