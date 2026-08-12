import { describe, expect, it } from 'vitest';
import { marketManifestSchema, stockSnapshotSchema } from './schema';

const marketManifestFixture = {
  schemaVersion: 1,
  snapshotVersion: 4,
  sourceCommit: 'a'.repeat(40),
  snapshotHash: 'b'.repeat(64),
  generatedAt: '2026-08-11T18:00:00+08:00',
  calendar: {
    sourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
    validThrough: '2026-12-31',
    holidayDates: ['2026-01-01', '2026-07-10'],
    emergencyClosureEvidence: {
      schemaVersion: 1,
      closures: [{
        date: '2026-07-10',
        markets: ['TWSE', 'TPEx'],
        reason: '臺灣證券交易所集中交易市場因天然災害全日休市。',
        sourceUrls: [
          'https://eoc.gov.taipei/News/Detail/909',
          'https://www.tpex.org.tw/storage/eb_data/11205/11200591671.html',
          'https://www.twse.com.tw/en/clearing/suspended.html',
        ],
      }],
    },
  },
  suspensionEvidence: { schemaVersion: 1, intervals: [] },
  markets: {
    TWSE: {
      cutoffDate: '2026-08-11', expectedCutoffDate: '2026-08-11', freshness: 'fresh',
      calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
      calendarValidThrough: '2026-12-31', tradingSessions: ['2026-08-10', '2026-08-11'],
    },
    TPEx: {
      cutoffDate: '2026-08-11', expectedCutoffDate: '2026-08-11', freshness: 'fresh',
      calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
      calendarValidThrough: '2026-12-31', tradingSessions: ['2026-08-10', '2026-08-11'],
    },
  },
  symbols: [{
    code: '2330', name: '台積電', market: 'TWSE', securityType: 'common-stock',
    dataPath: 'data/stocks/2330.fixture.json', digest: 'c'.repeat(64), size: 512,
    firstDate: '2026-02-25', lastDate: '2026-08-11', barCount: 120, noQuoteCount: 0,
    listingDate: '1994-09-05', availableSessions: 120, shortHistoryReason: null,
  }],
};

function completedBar(date = '2026-08-11') {
  return {
    date,
    periodStart: date,
    periodEnd: date,
    completed: true,
    evidenceStatus: 'complete',
    missingSessionDates: [] as string[],
    open: 1000,
    high: 1015,
    low: 995,
    close: 1010,
    volumeShares: 21_345_678,
    transactionCount: 12_345,
    sourcePrecision: 0.01,
    comparisonUnit: 5,
    priceUnit: 'TWD',
  };
}

function timeframe(completedBars = [completedBar()], formingBar: object | null = null) {
  return { completedBars, formingBar };
}

const stockSnapshotFixture = {
  schemaVersion: 1,
  snapshotVersion: 4,
  code: '2330',
  name: '台積電',
  market: 'TWSE',
  securityType: 'common-stock',
  currency: 'TWD',
  priceUnit: 'TWD',
  listingDate: '1994-09-05',
  availableSessions: 1,
  shortHistoryReason: 'listing-history',
  comparisonUnitPolicy: {
    version: 1,
    effectiveFrom: '2026-08-11',
    sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
  },
  priceModes: {
    raw: {
      status: 'available',
      reasonCodes: [],
      warnings: [],
      timeframes: {
        '1d': timeframe(),
        '1w': timeframe(),
        '1m': timeframe(),
      },
    },
    adjusted: {
      status: 'unavailable',
      reasonCodes: ['adjustment-series-not-built'],
      warnings: ['尚未建立可稽核的向後還原價格序列。'],
    },
  },
  noQuoteEvidence: [],
  corporateActions: [{
    date: '2026-08-11',
    type: 'cash-dividend',
    affectsPriceContinuity: true,
    sourceUrl: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
    verifiedAt: '2026-08-11',
  }],
  sourceUrls: [
    'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
  ],
};

describe('market snapshot v4 schemas', () => {
  it('accepts the versioned manifest and all raw day/week/month series', () => {
    expect(marketManifestSchema.safeParse(marketManifestFixture).success).toBe(true);
    expect(stockSnapshotSchema.safeParse(stockSnapshotFixture).success).toBe(true);
  });

  it('rejects v3 manifest and stock contracts instead of mixing them with v4', () => {
    expect(marketManifestSchema.safeParse({ ...marketManifestFixture, snapshotVersion: 3 }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({ ...stockSnapshotFixture, snapshotVersion: 3 }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...stockSnapshotFixture,
      priceMode: 'raw',
      bars: [completedBar()],
    }).success).toBe(false);
  });

  it('requires all raw timeframes and keeps adjusted prices explicitly unavailable', () => {
    expect(stockSnapshotSchema.safeParse({
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        raw: {
          ...stockSnapshotFixture.priceModes.raw,
          timeframes: {
            '1d': timeframe(),
            '1w': timeframe(),
          },
        },
      },
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        adjusted: {
          ...stockSnapshotFixture.priceModes.adjusted,
          reasonCodes: ['other-reason'],
        },
      },
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        adjusted: {
          ...stockSnapshotFixture.priceModes.adjusted,
          warnings: ['adjustment series has not been built'],
        },
      },
    }).success).toBe(false);
  });

  it('accepts a weekly forming bar but does not allow it to masquerade as a completed daily bar', () => {
    const formingWeek = {
      ...completedBar('2026-08-12'),
      periodStart: '2026-08-10',
      periodEnd: '2026-08-14',
      completed: false,
    };
    const withFormingWeek = {
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        raw: {
          ...stockSnapshotFixture.priceModes.raw,
          timeframes: {
            ...stockSnapshotFixture.priceModes.raw.timeframes,
            '1w': timeframe([completedBar('2026-08-08')], formingWeek),
          },
        },
      },
    };

    expect(stockSnapshotSchema.safeParse(withFormingWeek).success).toBe(true);
    expect(stockSnapshotSchema.safeParse({
      ...withFormingWeek,
      priceModes: {
        ...withFormingWeek.priceModes,
        raw: {
          ...withFormingWeek.priceModes.raw,
          timeframes: {
            ...withFormingWeek.priceModes.raw.timeframes,
            '1d': timeframe([completedBar()], formingWeek),
          },
        },
      },
    }).success).toBe(false);
  });

  it('requires period metadata and evidence state to agree', () => {
    const incompleteWeek = {
      ...completedBar('2026-08-11'),
      periodStart: '2026-08-10',
      evidenceStatus: 'incomplete',
      missingSessionDates: ['2026-08-10'],
    };
    expect(stockSnapshotSchema.safeParse({
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        raw: {
          ...stockSnapshotFixture.priceModes.raw,
          timeframes: {
            ...stockSnapshotFixture.priceModes.raw.timeframes,
            '1w': timeframe([incompleteWeek]),
          },
        },
      },
    }).success).toBe(true);
    expect(stockSnapshotSchema.safeParse({
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        raw: {
          ...stockSnapshotFixture.priceModes.raw,
          timeframes: {
            ...stockSnapshotFixture.priceModes.raw.timeframes,
            '1w': timeframe([{
              ...incompleteWeek,
              missingSessionDates: [],
            }]),
          },
        },
      },
    }).success).toBe(false);
  });

  it('keeps hostile official URLs, weekend sessions, and duplicate observations fail closed', () => {
    const hostileCalendarUrl = 'https://www.twse.com.tw@evil.example/holiday';
    expect(marketManifestSchema.safeParse({
      ...marketManifestFixture,
      calendar: { ...marketManifestFixture.calendar, sourceUrl: hostileCalendarUrl },
      markets: {
        TWSE: { ...marketManifestFixture.markets.TWSE, calendarSourceUrl: hostileCalendarUrl },
        TPEx: { ...marketManifestFixture.markets.TPEx, calendarSourceUrl: hostileCalendarUrl },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...marketManifestFixture,
      markets: {
        TWSE: { ...marketManifestFixture.markets.TWSE, tradingSessions: ['2026-08-08', '2026-08-11'] },
        TPEx: { ...marketManifestFixture.markets.TPEx, tradingSessions: ['2026-08-10', '2026-08-11'] },
      },
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...stockSnapshotFixture,
      noQuoteEvidence: [{
        market: 'TWSE', code: '2330', date: '2026-08-11', reason: 'official-no-quote',
        sourceUrl: stockSnapshotFixture.sourceUrls[0],
      }],
      availableSessions: 2,
    }).success).toBe(false);
  });
});
