import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // VitePress 自帶 Vue plugin；Vitest 需在單元測試模式額外啟用 SFC 編譯。
  plugins: process.env.VITEST ? [vue()] : [],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
