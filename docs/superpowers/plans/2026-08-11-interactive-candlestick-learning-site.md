# Interactive Candlestick Learning Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a beginner-friendly interactive GitHub Pages site that preserves the twenty-chapter candlestick guide, tracks a five-stage learning journey, renders thirty-two explainable Pattern Cards, and compares a supported Taiwan stock’s latest daily data with seventeen deterministic candlestick patterns.

**Architecture:** VitePress renders the existing Markdown from the repository root and mounts focused Vue components for learning progress, Pattern Cards, stock lookup, SVG charts, and analysis results. A framework-independent TypeScript domain layer owns the versioned card registry, normalized candlestick features, rule families, scoring, result contract, local progress, and browser-side snapshot validation. Python standard-library tools bootstrap and increment official TWSE/TPEx daily snapshots; one reusable GitHub Actions deployment flow atomically verifies a source commit, market snapshot, static build, and Pages deployment.

**Tech Stack:** Node.js 22, npm, VitePress 1.6.4, Vue 3.5.41, Vite 5.4.21, TypeScript 5.9.3, Vitest 3.2.4, Zod 4.4.3, Playwright 1.62.1, axe-core 4.12.1, ESLint 9.39.5, Python 3.13+ standard library, `unittest`, SVG, GitHub Actions, GitHub Pages.

## Global Constraints

- Work directly on `main`; the user explicitly declined a separate worktree for implementation.
- Use natural Taiwan Traditional Chinese for interface text, documentation, fixtures, and explanatory comments; preserve UTF-8.
- Keep the existing twenty chapters and four appendix URLs valid.
- The site compares rules and never emits a future price line, target price, buy/sell recommendation, direction probability, AI confidence, or guaranteed outcome.
- Support TWSE-listed and TPEx-mainboard common stocks only; exclude ETF, ETN, warrants, emerging stocks, futures, options, and cryptoassets.
- Use raw after-hours daily OHLCV; retain 120 trading sessions and analyze the latest 60 by default.
- The browser never calls TWSE or TPEx directly and never contains private API keys.
- `PatternCardDefinition` is the single card source for UI and matcher; Appendix A renders that same registry.
- The card registry contains exactly 32 canonical IDs and exactly 17 `mvp` cards.
- Required rule weight totals 50, context totals 30, supporting totals 20, invalidating rules carry zero weight and reject the candidate.
- Show zero to three candidates; never pad results below a card’s calibrated threshold.
- Keep `no-clear-pattern`, `insufficient-evidence`, and `unavailable` as distinct result states.
- Use a custom accessible SVG candlestick chart; do not add a third-party trading chart package.
- Learning progress remains in versioned `localStorage`, supports JSON export/import, and has no login or tracking.
- Meet WCAG 2.2 AA; axe `critical` and `serious` findings are release blockers.
- Keep daily market artifacts out of Git; only fixtures and small source metadata may be committed.
- Preserve all existing Python tests and generated-glossary checks.
- Use Conventional Commits, narrow staging, and push only after the complete release gate passes.

---

## Locked File Map

| Path | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Exact frontend dependencies and verification scripts |
| `tsconfig.json`, `vite.config.ts`, `eslint.config.mjs` | TypeScript, Vitest, Vue, and lint configuration |
| `.vitepress/config.mts` | Root-based VitePress source, exclusions, base path, nav, sidebar, and metadata |
| `.vitepress/theme/index.ts`, `.vitepress/theme/styles.css` | Vue component registration and warm-coach visual system |
| `index.md` | Coach-style homepage |
| `learning-path.md` | Five-stage learning map route |
| `pattern-cards.md` | Interactive Pattern Card catalog route |
| `analyzer.md` | Stock code analysis route and disclaimer |
| `src/domain/learning/` | Five-stage definitions, progress schema, quiz scoring, export/import |
| `src/domain/patterns/` | Card registry, illustrations, normalized features, rule families, matcher, fixtures |
| `src/domain/market-data/` | Browser snapshot Zod schemas, same-origin loader, freshness calculation |
| `src/components/` | Learning, card, chart, stock lookup, and result Vue components |
| `tools/market_sources.py` | Official endpoint adapters, parsing, classification, calendar and action normalization |
| `tools/market_snapshot.py` | Snapshot merge, validation, hashing, packaging, and CLI orchestration |
| `tests/fixtures/market_snapshot/` | Small deterministic official-shaped TWSE/TPEx fixtures |
| `tests/test_market_sources.py`, `tests/test_market_snapshot.py` | Python data contract tests |
| `tests/e2e/` | Main-flow, keyboard, reduced-motion, responsive, and axe tests |
| `.github/workflows/verify.yml` | Reusable offline verification gate |
| `.github/workflows/deploy-pages.yml` | Atomic source + snapshot + Pages deployment workflow |
| `.github/workflows/update-market-data.yml` | 17:30/20:30 Asia/Taipei scheduler calling the reusable deployment |
| `README.md` | Public usage, sources, limitations, local commands, deployment status |

---

### Task 1: VitePress Foundation and Verification Toolchain

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `eslint.config.mjs`
- Create: `env.d.ts`
- Create: `.vitepress/config.mts`
- Create: `.vitepress/theme/index.ts`
- Create: `.vitepress/theme/styles.css`
- Create: `src/domain/site/navigation.ts`
- Create: `src/domain/site/navigation.test.ts`
- Create: `index.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `SITE_BASE = '/taiwan-stock-candlestick-guide/'`
- Produces: `MAIN_NAV: readonly NavItem[]`
- Produces scripts: `dev`, `build`, `typecheck`, `lint`, `test:unit`, `test:unit:coverage`, `test:e2e`, `verify`
- Consumes: existing `chapters/*.md`, `assets/figures/*.svg`

- [ ] **Step 1: Add a failing navigation contract test**

```ts
// src/domain/site/navigation.test.ts
import { describe, expect, it } from 'vitest';
import { MAIN_NAV, SITE_BASE } from './navigation';

describe('site navigation', () => {
  it('keeps the GitHub Pages base and six approved destinations', () => {
    expect(SITE_BASE).toBe('/taiwan-stock-candlestick-guide/');
    expect(MAIN_NAV.map((item) => item.text)).toEqual([
      '開始學習', '學習地圖', '完整章節', '型態卡', '股票型態比對', '附錄速查',
    ]);
  });
});
```

- [ ] **Step 2: Create the exact package and compiler configuration**

```json
{
  "name": "taiwan-stock-candlestick-guide",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev . --host 0.0.0.0",
    "build": "vitepress build .",
    "typecheck": "vue-tsc --noEmit",
    "lint": "eslint .",
    "test:unit": "vitest run",
    "test:unit:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "verify": "npm run lint && npm run typecheck && npm run test:unit && npm run build"
  }
}
```

Install the exact versions in the following commands and commit the generated lockfile.

```powershell
npm install --save-exact vitepress@1.6.4 vue@3.5.41 zod@4.4.3
npm install --save-dev --save-exact vite@5.4.21 @vitejs/plugin-vue@5.2.4 typescript@5.9.3 vue-tsc@3.3.9 vitest@3.2.4 @vitest/coverage-v8@3.2.4 @vue/test-utils@2.4.11 happy-dom@20.11.2 playwright@1.62.1 @playwright/test@1.62.1 @axe-core/playwright@4.12.1 eslint@9.39.5 eslint-plugin-vue@10.10.0 typescript-eslint@8.67.0 globals@17.9.0 @types/node@22.20.1
```

- [ ] **Step 3: Run the focused test and confirm the missing module failure**

Run: `npm run test:unit -- src/domain/site/navigation.test.ts`

Expected: FAIL because `navigation.ts` does not exist.

- [ ] **Step 4: Implement navigation and VitePress configuration**

```ts
// src/domain/site/navigation.ts
export const SITE_BASE = '/taiwan-stock-candlestick-guide/' as const;

export interface NavItem { text: string; link: string }

export const MAIN_NAV: readonly NavItem[] = [
  { text: '開始學習', link: '/' },
  { text: '學習地圖', link: '/learning-path' },
  { text: '完整章節', link: '/chapters/01-what-candlesticks-can-and-cannot-answer' },
  { text: '型態卡', link: '/pattern-cards' },
  { text: '股票型態比對', link: '/analyzer' },
  { text: '附錄速查', link: '/chapters/appendix-a-pattern-reference' },
];
```

Configure VitePress with `base: SITE_BASE`, Traditional Chinese metadata, local search, last-updated labels, and `srcExclude` entries for `README.md`, `CONTEXT.md`, `docs/**`, `tests/**`, `.superpowers/**`, and tool-only Markdown fixtures.

- [ ] **Step 5: Implement the warm-coach theme and homepage shell**

Use semantic landmarks, a skip link, visible focus, red/green plus non-color candle encodings, `prefers-reduced-motion`, responsive spacing, and no horizontal scroll at 320 CSS pixels. The homepage links to the learning path and analyzer without loading market data.

- [ ] **Step 6: Verify the foundation**

Run:

```powershell
npm run lint
npm run typecheck
npm run test:unit -- src/domain/site/navigation.test.ts
npm run build
python -m unittest discover -s tests
```

Expected: all commands pass; existing chapter routes render under the repository base path.

- [ ] **Step 7: Commit Task 1**

```powershell
git add package.json package-lock.json tsconfig.json vite.config.ts eslint.config.mjs env.d.ts .vitepress src/domain/site index.md .gitignore
git commit -m "feat(site): add VitePress learning foundation"
```

---

### Task 2: Five-Stage Learning Progress and Quizzes

**Files:**
- Create: `src/domain/learning/stages.ts`
- Create: `src/domain/learning/progress.ts`
- Create: `src/domain/learning/progress.test.ts`
- Create: `src/domain/learning/quizzes.ts`
- Create: `src/domain/learning/quizzes.test.ts`
- Create: `src/components/LearningHome.vue`
- Create: `src/components/LearningMap.vue`
- Create: `src/components/StageQuiz.vue`
- Create: `src/components/StageQuiz.test.ts`
- Create: `src/components/LearningMap.test.ts`
- Create: `src/components/LearningProgressProvider.vue`
- Create: `learning-path.md`
- Modify: `.vitepress/theme/index.ts`
- Modify: `index.md`

**Interfaces:**
- Produces: `LEARNING_STAGES: readonly LearningStage[]`
- Produces: `loadProgress(storage): LearningProgressV1`
- Produces: `saveProgress(storage, progress): void`
- Produces: `exportProgress(progress): string`
- Produces: `importProgress(json): LearningProgressV1`
- Produces: `scoreStageQuiz(stageId, answers): QuizResult`

- [ ] **Step 1: Write failing progress and quiz tests**

```ts
it('passes a stage with four of five answers and never locks chapters', () => {
  const result = scoreStageQuiz('stage-1', ['b', 'a', 'c', 'd', 'a']);
  expect(result.correctCount).toBe(4);
  expect(result.passed).toBe(true);
  expect(LEARNING_STAGES.flatMap((stage) => stage.chapters)).toHaveLength(20);
});

it('rejects an unknown or future progress schema', () => {
  expect(() => importProgress('{"schemaVersion":99}')).toThrow('不支援的學習進度版本');
});
```

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `npm run test:unit -- src/domain/learning`

Expected: FAIL because learning modules do not exist.

- [ ] **Step 3: Implement the versioned learning domain**

```ts
export interface LearningProgressV1 {
  schemaVersion: 1;
  completedChapterIds: string[];
  passedStageIds: string[];
  quizAttempts: Record<string, number>;
  updatedAt: string;
}

export const PROGRESS_STORAGE_KEY = 'tw-candlestick-guide:progress:v1';
export const PASSING_QUESTION_COUNT = 4;
```

Define the approved chapter grouping `1–4`, `5–8`, `9–12`, `13–18`, and `19–20`. All links remain available regardless of progress.

- [ ] **Step 4: Add five Traditional Chinese quizzes**

Each stage has exactly five multiple-choice questions, one correct answer, a concise explanation, and no price-direction question. Validate unique IDs and exact question counts in tests.

- [ ] **Step 5: Implement accessible progress and quiz components**

Use real buttons, fieldsets, legends, `aria-live` for results, a retry button with no attempt limit, and explicit export/import error messages. Import validates a 256 KiB size limit before JSON parsing.

- [ ] **Step 6: Verify Task 2**

Run:

```powershell
npm run test:unit -- src/domain/learning src/components
npm run typecheck
npm run build
```

Expected: five stages cover all twenty unique chapters; 4/5 passes; export/import round-trips.

- [ ] **Step 7: Commit Task 2**

```powershell
git add src/domain/learning src/components/LearningHome.vue src/components/LearningMap.vue src/components/LearningMap.test.ts src/components/StageQuiz.vue src/components/StageQuiz.test.ts src/components/LearningProgressProvider.vue learning-path.md index.md .vitepress/theme/index.ts
git commit -m "feat(learning): add five-stage progress journey"
```

---

### Task 3: Canonical 32-Card Pattern Catalog

**Files:**
- Create: `src/domain/patterns/types.ts`
- Create: `src/domain/patterns/catalog.ts`
- Create: `src/domain/patterns/catalog.test.ts`
- Create: `src/domain/patterns/illustrations.ts`
- Create: `src/components/PatternGlyph.vue`
- Create: `src/components/PatternCard.vue`
- Create: `src/components/PatternCard.test.ts`
- Create: `src/components/PatternCatalog.vue`
- Create: `pattern-cards.md`
- Modify: `chapters/appendix-a-pattern-reference.md`
- Modify: `.vitepress/theme/index.ts`

**Interfaces:**
- Produces: `PATTERN_CARDS: readonly PatternCardDefinition[]`
- Produces: `getPatternCard(id: PatternCardId): PatternCardDefinition`
- Produces: `PATTERN_ILLUSTRATIONS: Readonly<Record<PatternCardId, PatternIllustration>>`
- Produces canonical support values: `mvp`, `catalog-only`, `guardrail`

- [ ] **Step 1: Write failing registry invariants**

```ts
it('contains 32 unique cards and 17 matcher cards', () => {
  expect(PATTERN_CARDS).toHaveLength(32);
  expect(new Set(PATTERN_CARDS.map((card) => card.id)).size).toBe(32);
  expect(PATTERN_CARDS.filter((card) => card.matchSupport === 'mvp')).toHaveLength(17);
  expect(PATTERN_CARDS.every((card) => card.sourceRow.length > 0)).toBe(true);
});
```

- [ ] **Step 2: Run the test and confirm the missing catalog failure**

Run: `npm run test:unit -- src/domain/patterns/catalog.test.ts`

- [ ] **Step 3: Implement the complete typed catalog**

```ts
export interface PatternCardDefinition {
  id: PatternCardId;
  slug: string;
  nameZhTw: string;
  nameEn: string;
  aliases: readonly string[];
  category: PatternCategory;
  matchSupport: MatchSupport;
  sourceRow: string;
  oneSentenceMeaning: string;
  observableDefinition: string;
  background: readonly string[];
  commonMisreads: readonly string[];
  invalidationGuidance: readonly string[];
  lessonLinks: readonly string[];
  matcher?: PatternMatcherDefinition;
}

export interface PatternMatcherDefinition {
  ruleFamilyId: RuleFamilyId;
  minimumBars: number;
  minimumScore: number;
  rules: readonly PatternRuleBinding[];
}

export interface PatternRuleBinding {
  ruleId: string;
  group: 'required' | 'context' | 'supporting' | 'invalidating';
  weight: number;
  parameters: Readonly<Record<string, number | string | boolean>>;
  teachingLabel: string;
}
```

Populate every canonical ID from the approved spec. Split the five directional pairs, omit `measured-move` as a card, and preserve it as ordinary Appendix A teaching content.

- [ ] **Step 4: Add lightweight SVG illustration primitives**

Define candlestick, trend-line, zone, and volume-bar primitives as data. Each of the 32 cards has an illustration record and Traditional Chinese alternative text; no card depends on color alone.

- [ ] **Step 5: Implement the accessible card catalog**

Cards use a button-controlled front/back state, expose `aria-expanded`, preserve focus, honor reduced motion, and provide category/support filters. `catalog-only` and `guardrail` cards visibly state that they do not participate in first-release matching.

- [ ] **Step 6: Make Appendix A render the canonical catalog**

Keep the existing Appendix A route, introduction, source limitations, and the measured-move explanation. Replace duplicate card rows with `<PatternCatalog mode="reference" />` so UI and matcher cannot drift from a second table.

- [ ] **Step 7: Verify and commit Task 3**

Run:

```powershell
npm run test:unit -- src/domain/patterns/catalog.test.ts src/components/PatternCard.test.ts
npm run typecheck
python tools\validate_book.py
npm run build
```

Commit:

```powershell
git add src/domain/patterns src/components/PatternGlyph.vue src/components/PatternCard.vue src/components/PatternCard.test.ts src/components/PatternCatalog.vue pattern-cards.md chapters/appendix-a-pattern-reference.md .vitepress/theme/index.ts
git commit -m "feat(patterns): add canonical teaching card catalog"
```

---

### Task 4: Explainable 17-Pattern Matching Engine

**Files:**
- Create: `src/domain/patterns/features.ts`
- Create: `src/domain/patterns/features.test.ts`
- Create: `src/domain/patterns/rule-families/single-candle.ts`
- Create: `src/domain/patterns/rule-families/multi-candle.ts`
- Create: `src/domain/patterns/rule-registry.ts`
- Create: `src/domain/patterns/matcher.ts`
- Create: `src/domain/patterns/matcher.test.ts`
- Create: `src/domain/patterns/test-cases.ts`
- Create: `src/domain/market-data/types.ts`
- Modify: `src/domain/patterns/catalog.ts`

**Interfaces:**
- Produces: `extractCandlestickFeatures(bars, actions): CandlestickFeatures`
- Produces: `RULE_FAMILIES: Readonly<Record<RuleFamilyId, RuleFamilyDefinition>>`
- Produces: `analyzePatterns(snapshot, options?): AnalysisResult`
- Produces: shared `OhlcvBar`, `CorporateAction`, `StockSnapshot`, `AnalysisContext`, and `AnalysisResult` types
- Consumes: `PATTERN_CARDS`, `OhlcvBar`, `CorporateAction`

- [ ] **Step 1: Write failing feature formula tests**

```ts
it('computes body, wick, close location, and comparison-unit floor', () => {
  const feature = candleFeature({
    date: '2026-08-10', open: 100, high: 106, low: 95, close: 102,
    volumeShares: 1000, sourcePrecision: 0.01, comparisonUnit: 0.5,
  });
  expect(feature).toMatchObject({
    bodyLow: 100, bodyHigh: 102, bodySize: 2, effectiveBodySize: 2,
    upperWick: 4, lowerWick: 5,
  });
  expect(feature.closeLocation).toBeCloseTo(7 / 11);
});
```

Define the shared market-data interfaces in `src/domain/market-data/types.ts` before implementing features. Task 5 emits this JSON contract and Task 6 validates it with Zod; neither task may introduce a second property naming scheme.

- [ ] **Step 2: Implement normalized features without look-ahead**

Implement the approved formulas, prior-20 body quartiles, prior-20 volume median, ATR-14, k=1 confirmed swings, prior-20 zones, and company-action intersection. Tests must prove the target candle is excluded from comparison windows.

- [ ] **Step 3: Write parameterized failing rule cases**

For each MVP card provide at least five positive, five boundary/near-miss, and five negative windows in `test-cases.ts`. Mark at least one-third of each card’s cases `holdout: true`; matcher code cannot import test-case labels.

```ts
it.each(MVP_CASES)('$cardId $caseId', ({ cardId, bars, expected }) => {
  const result = analyzePatterns(makeSnapshot(bars));
  expect(resultFor(result, cardId)).toBe(expected);
});
```

- [ ] **Step 4: Implement single-candle rule families**

Implement `relative-body-size`, `doji`, `single-candle-wick-geometry`, `near-marubozu`, and `candle-descriptors` using only configured parameters and normalized features.

- [ ] **Step 5: Implement multi-candle rule families**

Implement `engulfing-body`, `harami-body`, `midpoint-penetration`, `three-candle-star`, and `three-candle-sequence`. Gap-sensitive required rules return `unavailable` when a price-continuity action intersects their window.

- [ ] **Step 6: Implement scoring and the discriminated result**

```ts
export type AnalysisResult =
  | { status: 'matched'; context: AnalysisContext; matches: PatternMatchResult[] }
  | { status: 'no-clear-pattern'; context: AnalysisContext; matches: [] }
  | { status: 'insufficient-evidence'; context: AnalysisContext; reasonCodes: string[] }
  | { status: 'unavailable'; reason: UnavailableReason; message: string };
```

Reject required failures and invalidations, do not renormalize unavailable optional weights, round to the nearest five, label scores at 80+, apply each 60–75 card threshold, sort deterministically, and return at most three matches.

- [ ] **Step 7: Verify coverage and commit Task 4**

Run:

```powershell
npm run test:unit:coverage -- src/domain/patterns
npm run typecheck
npm run lint
```

Expected: all 255+ labeled windows pass, every rule/invalidating branch is executed, and overall covered TypeScript statements/branches remain at least 85%.

Commit:

```powershell
git add src/domain/patterns src/domain/market-data/types.ts
git commit -m "feat(matcher): add explainable candlestick rule engine"
```

---

### Task 5: Official TWSE/TPEx Snapshot Pipeline

**Files:**
- Create: `tools/market_sources.py`
- Create: `tools/market_snapshot.py`
- Create: `tests/test_market_sources.py`
- Create: `tests/test_market_snapshot.py`
- Create: `tests/fixtures/market_snapshot/twse-daily.json`
- Create: `tests/fixtures/market_snapshot/tpex-daily.json`
- Create: `tests/fixtures/market_snapshot/twse-companies.json`
- Create: `tests/fixtures/market_snapshot/tpex-companies.json`
- Create: `tests/fixtures/market_snapshot/twse-actions.json`
- Create: `tests/fixtures/market_snapshot/tpex-actions.json`
- Create: `tests/fixtures/market_snapshot/holiday-calendar.json`
- Create: `data/company-action-overrides.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `fetch_twse_daily(date) -> tuple[DailyQuote, ...]`
- Produces: `fetch_tpex_daily(date) -> tuple[DailyQuote, ...]`
- Produces: `fetch_supported_symbols() -> tuple[SupportedSymbol, ...]`
- Produces: `fetch_corporate_actions() -> tuple[CorporateAction, ...]`
- Produces: `build_snapshot(previous, sessions, output) -> SnapshotManifest`
- Produces CLI modes: `bootstrap`, `update`, `fixture`, `validate`, `pack`

- [ ] **Step 1: Write failing official-shaped parser tests**

```python
def test_twse_and_tpex_daily_rows_normalize_to_share_volume(self):
    twse = parse_twse_daily(load_fixture("twse-daily.json"))
    tpex = parse_tpex_daily(load_fixture("tpex-daily.json"))
    self.assertEqual("2330", twse[0].code)
    self.assertEqual("6488", tpex[0].code)
    self.assertGreater(twse[0].volume_shares, 0)
    self.assertGreater(tpex[0].volume_shares, 0)
```

- [ ] **Step 2: Implement source adapters and strict UTF-8 parsing**

Use these official sources:

- Current TWSE: `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`
- Historical TWSE: `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX`
- TWSE companies: `https://openapi.twse.com.tw/v1/opendata/t187ap03_L`
- TWSE actions: `https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL`
- Current TPEx: `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes`
- Historical TPEx: `https://www.tpex.org.tw/www/zh-tw/afterTrading/otc`
- TPEx companies: `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O`
- TPEx actions: `https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost`
- Calendar: `https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule`

Reuse the existing safe official-host redirect and TLS fallback patterns from `tools/market_data.py`; never allow redirects to a non-official host.

- [ ] **Step 3: Implement common-stock classification and price units**

Intersect daily quotes with company master codes rather than trusting code shape. Compute `comparisonUnit` as the maximum of source precision and the official tick size applicable to the bar’s OHLC values. Keep version, effective date, and official source URL in every stock snapshot.

- [ ] **Step 4: Implement snapshot merge and validation**

```python
@dataclass(frozen=True)
class SnapshotManifest:
    schema_version: int
    source_commit: str
    snapshot_hash: str
    generated_at: str
    markets: dict[str, MarketCutoff]
    symbols: tuple[StockIndexEntry, ...]
```

Validate date order, OHLC relationships, non-negative volume, prior-date regression, missing-symbol evidence, 98% coverage, 1% count reduction, corporate-action provenance, and market cutoff consistency. A failed validation must leave the output directory untouched.

- [ ] **Step 5: Implement deterministic packaging**

Write content-hashed `data/stocks/<code>.<hash>.json`, `manifest.json`, `provenance.json`, a sorted deterministic `snapshot.tar.gz`, and `SHA256SUMS`. Use a temporary sibling directory and an atomic rename only after every file validates.

- [ ] **Step 6: Implement bootstrap, incremental update, and fixture CLI tests**

Bootstrap walks 120 official trading sessions with request throttling, cache resume, and bounded retries. Update reads the previous archive, appends only a new session, and becomes a no-op for the same cutoff. Fixture mode performs no network calls and creates a two-stock snapshot for frontend tests.

- [ ] **Step 7: Verify and commit Task 5**

Run:

```powershell
python -m unittest tests.test_market_sources tests.test_market_snapshot
python tools\market_snapshot.py fixture --fixtures tests\fixtures\market_snapshot --output .cache\site-data --source-commit fixture
python tools\market_snapshot.py validate --snapshot .cache\site-data
python -m unittest discover -s tests
```

Commit:

```powershell
git add tools/market_sources.py tools/market_snapshot.py tests/test_market_sources.py tests/test_market_snapshot.py tests/fixtures/market_snapshot data/company-action-overrides.json .gitignore
git commit -m "feat(data): add official market snapshot pipeline"
```

---

### Task 6: Browser Data Client, SVG Chart, and Guided Analyzer

**Files:**
- Create: `src/domain/market-data/schema.ts`
- Create: `src/domain/market-data/schema.test.ts`
- Create: `src/domain/market-data/client.ts`
- Create: `src/domain/market-data/client.test.ts`
- Create: `src/domain/market-data/freshness.ts`
- Create: `src/domain/market-data/freshness.test.ts`
- Create: `src/components/StockCodeSearch.vue`
- Create: `src/components/CandlestickChart.vue`
- Create: `src/components/CandlestickChart.test.ts`
- Create: `src/components/AnalysisResultPanel.vue`
- Create: `src/components/StockAnalyzer.vue`
- Create: `src/components/StockAnalyzer.test.ts`
- Create: `analyzer.md`
- Modify: `.vitepress/theme/index.ts`

**Interfaces:**
- Produces: `marketManifestSchema`, `stockSnapshotSchema`
- Produces: `loadManifest(base): Promise<MarketDataManifest>`
- Produces: `loadStockSnapshot(manifest, code): Promise<StockSnapshot>`
- Produces: `computeFreshness(calendar, cutoff, now): Freshness`
- Consumes: `analyzePatterns(snapshot): AnalysisResult`

- [ ] **Step 1: Write failing schema, freshness, and input tests**

```ts
it('normalizes full-width digits and only uses manifest paths', async () => {
  expect(normalizeStockCode(' ２３３０ ')).toBe('2330');
  const snapshot = await loadStockSnapshot(manifestFixture, '2330', fetchFixture);
  expect(snapshot.code).toBe('2330');
  expect(fetchFixture).toHaveBeenCalledWith('/taiwan-stock-candlestick-guide/data/stocks/2330.fixture.json');
});

it('marks two missed sessions stale without using file generation time', () => {
  expect(computeFreshness(calendarFixture, '2026-08-06', new Date('2026-08-10T10:00:00+08:00'))).toBe('stale');
});
```

- [ ] **Step 2: Implement strict same-origin loading**

Validate manifest and stock JSON with Zod. Resolve a stock only by exact manifest entry; never concatenate raw input into a path. Map not-found, unsupported, network, and Schema failures to distinct Traditional Chinese messages.

- [ ] **Step 3: Implement the accessible SVG chart**

Render 60 bars and volume with viewBox scaling, candle group labels, keyboard left/right navigation, visible selected-candle focus, a live OHLCV summary, corporate-action markers, and an expandable semantic data table. Use arrow and hollow/solid cues in addition to color.

- [ ] **Step 4: Implement guided result rendering**

Display data source, cutoff, timeframe, analysis range, freshness, evaluated card count, warnings, zero-to-three candidates, met/not-met/unavailable conditions, invalidation, and lesson links. `no-clear-pattern`, `insufficient-evidence`, and `unavailable` each have unique headings and actions.

- [ ] **Step 5: Implement the analyzer page**

Search first, confirm code/name/market, load only that stock file, chart it, then run the matcher. The fixed disclaimer appears above results. Stale data uses the exact phrase `截至 YYYY-MM-DD 的型態` and never says `目前型態`.

- [ ] **Step 6: Verify and commit Task 6**

Run:

```powershell
npm run test:unit -- src/domain/market-data src/components/CandlestickChart.test.ts src/components/StockAnalyzer.test.ts
npm run typecheck
npm run lint
npm run build
```

Commit:

```powershell
git add src/domain/market-data src/components/StockCodeSearch.vue src/components/CandlestickChart.vue src/components/CandlestickChart.test.ts src/components/AnalysisResultPanel.vue src/components/StockAnalyzer.vue src/components/StockAnalyzer.test.ts analyzer.md .vitepress/theme/index.ts
git commit -m "feat(analyzer): add guided stock pattern comparison"
```

---

### Task 7: Atomic GitHub Actions and Pages Delivery

**Files:**
- Create: `.github/workflows/verify.yml`
- Create: `.github/workflows/deploy-pages.yml`
- Create: `.github/workflows/update-market-data.yml`
- Create: `tests/test_github_workflows.py`
- Modify: `README.md`

**Interfaces:**
- Produces reusable workflow input: `source_sha: string`
- Produces manual rollback input: `rollback_artifact_id: string`
- Produces artifact: `market-snapshot-<cutoff>-<short-source-sha>`
- Consumes: `snapshot.tar.gz`, `manifest.json`, `provenance.json`, `SHA256SUMS`

- [ ] **Step 1: Write failing workflow contract tests**

```python
def test_deploy_workflow_pins_source_snapshot_and_pages_artifact(self):
    text = (ROOT / ".github/workflows/deploy-pages.yml").read_text(encoding="utf-8")
    self.assertIn("source_sha", text)
    self.assertIn("SHA256SUMS", text)
    self.assertIn("actions/deploy-pages@", text)
    self.assertIn("concurrency:", text)
```

- [ ] **Step 2: Implement reusable offline verification**

`verify.yml` runs on pull requests and `workflow_call`, checks out the exact SHA, sets up Python 3.13 and Node 22 with npm cache, then runs Python tests, glossary check, `npm ci`, lint, typecheck, unit coverage, and VitePress build.

- [ ] **Step 3: Implement the atomic deployment workflow**

`deploy-pages.yml` handles `push` to main, `workflow_call`, and manual rollback. It verifies the source SHA, downloads and checks the previous snapshot or bootstraps one, validates `SHA256SUMS`, updates official data, uploads the 30-day snapshot artifact, copies only verified data into the site build, uploads one Pages artifact, and deploys after every prior job succeeds.

- [ ] **Step 4: Implement the idempotent market scheduler**

Use UTC cron values equivalent to Asia/Taipei 17:30 and 20:30 on weekdays. Resolve `refs/heads/main` once, pass that immutable SHA into the reusable deploy workflow, and let same-date data exit successfully without deploying.

- [ ] **Step 5: Pin official Actions and limit permissions**

Resolve current commit SHAs for `actions/checkout`, `actions/setup-python`, `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`, `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`. Default to `contents: read`; grant `pages: write` and `id-token: write` only to the deployment job.

- [ ] **Step 6: Verify and commit Task 7**

Run:

```powershell
python -m unittest tests.test_github_workflows
python -m unittest discover -s tests
npm run verify
```

Commit:

```powershell
git add .github/workflows tests/test_github_workflows.py README.md
git commit -m "ci(pages): add atomic market data deployment"
```

---

### Task 8: Browser, Keyboard, Accessibility, and Responsive Release Gates

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/learning.spec.ts`
- Create: `tests/e2e/pattern-cards.spec.ts`
- Create: `tests/e2e/analyzer.spec.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/responsive.spec.ts`
- Create: `tests/a11y-allowlist.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: fixture snapshot produced by `tools/market_snapshot.py fixture`
- Produces: deterministic browser verification for desktop, mobile, keyboard, reduced motion, 200% zoom, and axe

- [ ] **Step 1: Configure Playwright against the production preview**

Generate fixture data before the web server starts, run `vitepress build .`, serve `.vitepress/dist`, and test Chromium plus a mobile viewport. Avoid live API calls by serving committed official-shaped fixtures through the generated snapshot.

- [ ] **Step 2: Test the learning journey**

Verify chapter links remain open, four correct answers pass, retry is unlimited, refresh preserves progress, and export/clear/import restores the same completed chapters.

- [ ] **Step 3: Test cards and analyzer behavior**

Verify keyboard card flipping, filter announcements, valid `2330`, full-width code normalization, chart focus movement, Top 3 maximum, no-clear-pattern, insufficient-evidence, unsupported ETF, stale wording, and corporate-action rule suppression.

- [ ] **Step 4: Add axe and manual-gate scaffolding**

Fail on every axe `critical` or `serious` result. Keep `tests/a11y-allowlist.json` as an empty array unless a reviewed exception contains rule ID, route, reason, owner, and expiration date.

- [ ] **Step 5: Test responsive and reduced-motion behavior**

At 320×800 and 390×844, assert no document-level horizontal overflow, controls remain visible, charts expose the data-table alternative, and card transitions are disabled under reduced motion. Test the main flow at 200% browser zoom.

- [ ] **Step 6: Run all automated release gates**

```powershell
npx playwright install chromium
npm run verify
npm run test:e2e
python tools\validate_book.py
python tools\render_glossary.py --source CONTEXT.md --output chapters\appendix-d-glossary.md --check
python -m unittest discover -s tests
git diff --check
```

- [ ] **Step 7: Commit Task 8**

```powershell
git add playwright.config.ts tests/e2e tests/a11y-allowlist.json package.json package-lock.json
git commit -m "test(site): add accessible browser release gates"
```

---

### Task 9: Live Snapshot, Public Pages Verification, and Final Delivery

**Files:**
- Modify: `README.md`
- Modify only if evidence requires: workflow, source adapter, or frontend files from Tasks 1–8

**Interfaces:**
- Consumes: approved workflows and official read-only APIs
- Produces: pushed `main`, successful Pages deployment, and verified public site

- [ ] **Step 1: Run a read-only live source smoke test**

Fetch TWSE/TPEx current daily, company master, corporate action, and calendar endpoints. Validate response contracts and confirm the browser site still uses only same-origin static data.

- [ ] **Step 2: Build a full 120-session snapshot locally or in Actions**

Use the ignored `.cache/` directory, request throttling, and resume support. Validate all common-stock files, provenance, manifest hashes, date coverage, and snapshot archive before allowing deployment.

- [ ] **Step 3: Perform the manual accessibility matrix**

On Windows, verify the homepage, Pattern Cards, and analyzer with NVDA + Firefox and Narrator + Edge: landmarks, form labels, flip state, chart summary, live result status, and error focus. Record only actionable findings in existing tests or code; do not create a separate completion report.

- [ ] **Step 4: Update README with verified commands and limitations**

Document local preview, fixture generation, full verification, official sources, 120/60-day behavior, supported securities, no-prediction disclaimer, Pages URL, and rollback workflow. Do not claim deployment success before the public checks pass.

- [ ] **Step 5: Run the complete local gate on the final tree**

```powershell
npm ci
npm run verify
npm run test:e2e
python -m unittest discover -s tests
python tools\validate_book.py
python tools\render_glossary.py --source CONTEXT.md --output chapters\appendix-d-glossary.md --check
git diff --check
git status --short --branch
```

- [ ] **Step 6: Review and commit only remaining final fixes**

```powershell
git diff
git add README.md
git diff --cached
git commit -m "docs(readme): document interactive site release"
```

Skip this commit if README was already complete and no final files changed.

- [ ] **Step 7: Push `main` and monitor the workflow**

```powershell
git push origin main
gh run list --branch main --limit 10
```

Wait for verification and Pages deployment to finish. A failed gate must be diagnosed and fixed before continuing; do not bypass it.

- [ ] **Step 8: Verify the public site**

Confirm HTTP 200, page title, canonical base path, chapter navigation, pattern cards, fixture-independent stock lookup, current cutoff display, and analyzer result behavior at:

```text
https://eric861129.github.io/taiwan-stock-candlestick-guide/
```

- [ ] **Step 9: Final repository check**

Confirm `main` equals `origin/main`, the worktree is clean, no market snapshot was committed, and no temporary worktree remains.
