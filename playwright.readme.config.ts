import { defineConfig } from '@playwright/test'

// README 스크린샷·동작 GIF (npm run screenshots). 테스트가 아니라 그림을 만드는 스크립트다.
export default defineConfig({
  testDir: 'scripts/readme',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results'
})
