import { describe, expect, it } from 'vitest';
import { marketManifestSchema, stockSnapshotSchema, toStockSnapshot } from './schema';

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
      reasonCodes: ['missing-adjustment-evidence'],
      warnings: ['公司行動缺少可重算的官方調整證據，已保留原始價格。'],
    },
  },
  adjustmentFactors: [],
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

  it('requires all raw timeframes and keeps missing adjustment evidence explicitly unavailable', () => {
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

  it('accepts an auditable adjusted series and rejects a factor that cannot be recomputed', () => {
    const adjustmentFactor = {
      effectiveDate: '2026-08-11',
      actionTypes: ['cash-dividend'],
      priceFactor: 0.995,
      volumeFactor: 1,
      stockDividendRatio: null,
      basis: 'official-distribution-formula',
      previousClose: 1000,
      referencePrice: 995,
      sourceUrls: [
        'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
        'https://www.twse.com.tw/rwd/zh/exRight/TWT49U',
      ],
      verifiedAt: '2026-08-11',
    };
    const adjustedAvailable = {
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        adjusted: {
          status: 'available',
          reasonCodes: [],
          warnings: [],
          timeframes: stockSnapshotFixture.priceModes.raw.timeframes,
        },
      },
      adjustmentFactors: [adjustmentFactor],
      sourceUrls: [
        ...stockSnapshotFixture.sourceUrls,
        'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
        'https://www.twse.com.tw/rwd/zh/exRight/TWT49U',
      ],
    };

    expect(stockSnapshotSchema.safeParse(adjustedAvailable).success).toBe(true);
    const parsed = stockSnapshotSchema.parse(adjustedAvailable);
    expect(toStockSnapshot(parsed).priceMode).toBe('adjusted');
    expect(stockSnapshotSchema.safeParse({
      ...adjustedAvailable,
      adjustmentFactors: [{ ...adjustmentFactor, priceFactor: 0.9 }],
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...adjustedAvailable,
      adjustmentFactors: [{ ...adjustmentFactor, stockDividendRatio: 0.1 }],
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...adjustedAvailable,
      adjustmentFactors: [{
        ...adjustmentFactor,
        sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL'],
      }],
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...adjustedAvailable,
      corporateActions: adjustedAvailable.corporateActions.map((action) => ({
        ...action,
        date: '2026-08-12',
      })),
      adjustmentFactors: [{ ...adjustmentFactor, effectiveDate: '2026-08-12' }],
    }).success).toBe(false);
    const historicalMonth = {
      ...completedBar('2018-08-31'),
      periodStart: '2018-08-01',
      periodEnd: '2018-08-31',
    };
    const historicalActionDate = '2018-08-06';
    const historicalRawTimeframes = {
      ...adjustedAvailable.priceModes.raw.timeframes,
      '1m': timeframe([historicalMonth, completedBar()]),
    };
    expect(stockSnapshotSchema.safeParse({
      ...adjustedAvailable,
      corporateActions: adjustedAvailable.corporateActions.map((action) => ({
        ...action,
        date: historicalActionDate,
      })),
      adjustmentFactors: [{ ...adjustmentFactor, effectiveDate: historicalActionDate }],
      priceModes: {
        raw: {
          ...adjustedAvailable.priceModes.raw,
          timeframes: historicalRawTimeframes,
        },
        adjusted: {
          ...adjustedAvailable.priceModes.adjusted,
          timeframes: historicalRawTimeframes,
        },
      },
    }).success).toBe(true);
    expect(stockSnapshotSchema.safeParse({
      ...adjustedAvailable,
      priceModes: {
        ...adjustedAvailable.priceModes,
        adjusted: {
          ...adjustedAvailable.priceModes.adjusted,
          timeframes: {
            ...adjustedAvailable.priceModes.adjusted.timeframes,
            '1d': timeframe([{ ...completedBar(), date: '2026-08-10', periodStart: '2026-08-10', periodEnd: '2026-08-10' }]),
          },
        },
      },
    }).success).toBe(false);
  });

  it('keeps adjusted prices available and identical when there are no corporate actions', () => {
    const withoutActions = {
      ...stockSnapshotFixture,
      corporateActions: [],
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        adjusted: {
          status: 'available',
          reasonCodes: [],
          warnings: [],
          timeframes: stockSnapshotFixture.priceModes.raw.timeframes,
        },
      },
    };

    expect(stockSnapshotSchema.safeParse(withoutActions).success).toBe(true);
    expect(stockSnapshotSchema.safeParse({
      ...withoutActions,
      priceModes: stockSnapshotFixture.priceModes,
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
