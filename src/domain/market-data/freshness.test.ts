import { describe, expect, it } from 'vitest';
import { computeFreshness, mostConservativeFreshness } from './freshness';

const calendarFixture = {
  tradingSessions: ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11'],
  validThrough: '2026-08-31',
};

describe('market data freshness', () => {
  it('uses the previous Taiwan trading session before the 17:30 cutoff', () => {
    expect(computeFreshness(calendarFixture, '2026-08-07', new Date('2026-08-10T10:00:00+08:00'))).toBe('fresh');
    expect(computeFreshness(calendarFixture, '2026-08-06', new Date('2026-08-10T10:00:00+08:00'))).toBe('one-session-behind');
  });

  it('marks two missed sessions stale without using file generation time', () => {
    expect(computeFreshness(calendarFixture, '2026-08-05', new Date('2026-08-10T10:00:00+08:00'))).toBe('stale');
  });

  it('returns unknown when the Taiwan market calendar does not cover today', () => {
    expect(computeFreshness({ ...calendarFixture, validThrough: '2026-08-07' }, '2026-08-07', new Date('2026-08-10T18:00:00+08:00'))).toBe('unknown');
  });

  it('does not let a locally recomputed fresh result weaken signed stale market evidence', () => {
    expect(mostConservativeFreshness('stale', 'fresh')).toBe('stale');
    expect(mostConservativeFreshness('fresh', 'one-session-behind')).toBe('one-session-behind');
    expect(mostConservativeFreshness('unknown', 'stale')).toBe('stale');
    expect(mostConservativeFreshness('fresh', 'unknown')).toBe('unknown');
  });
});
