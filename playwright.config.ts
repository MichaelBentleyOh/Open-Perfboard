import { defineConfig } from '@playwright/test'

// Electron E2E. 실행 전 `electron-vite build`로 out/을 만들어야 한다 (npm run test:e2e).
export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: 'perf.spec.ts', // 성능 측정은 npm run perf:e2e
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results'
})
