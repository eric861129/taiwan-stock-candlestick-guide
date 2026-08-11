/// <reference types="vite/client" />

/** VitePress 的 Markdown 頁面可作為 Vue 元件匯入。 */
declare module '*.md' {
  import type { Component } from 'vue';

  const component: Component;
  export default component;
}
