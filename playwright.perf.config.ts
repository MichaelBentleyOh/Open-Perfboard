import { defineConfig } from '@playwright/test'

// 큰 배선도 성능 측정 (npm run perf:e2e). 일반 E2E에서는 빠진다.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'perf.spec.ts',
  timeout: 20 * 60_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results'
})
