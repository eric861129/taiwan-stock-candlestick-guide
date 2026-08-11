import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtureSnapshot } from '../e2e/fixture-lifecycle';

interface FixturePaths {
  root: string;
  publicDataDirectory: string;
  temporaryRoot: string;
  preexistingFile: string;
  generatedFile: string;
  generatedManifest: string;
}

let activeFixture: FixturePaths | undefined;

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

afterEach(() => {
  if (!activeFixture) {
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
});
