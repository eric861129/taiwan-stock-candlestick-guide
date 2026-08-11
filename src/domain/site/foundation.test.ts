import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('VitePress foundation assets', () => {
  it('keeps the configured logo in the public asset tree', () => {
    expect(existsSync(resolve(process.cwd(), 'public/logo.svg'))).toBe(true);
  });
});
