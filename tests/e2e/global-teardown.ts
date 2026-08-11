import { cleanupFixtureSnapshot } from './fixture-lifecycle';

/** Playwright 即使有測試失敗也會呼叫 globalTeardown。 */
export default async function globalTeardown(): Promise<void> {
  cleanupFixtureSnapshot();
}
