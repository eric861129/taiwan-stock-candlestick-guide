import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('VitePress foundation assets', () => {
  it('keeps the configured logo in the public asset tree', () => {
    expect(existsSync(resolve(process.cwd(), 'public/logo.svg'))).toBe(true);
  });

  it('declares the shipped logo as the site favicon under the project base', () => {
    const config = readFileSync(resolve(process.cwd(), '.vitepress/config.mts'), 'utf8');

    expect(config).toContain(
      "['link', { rel: 'icon', type: 'image/svg+xml', href: `${SITE_BASE}logo.svg` }]",
    );
  });
});
