import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// 설치 파일과 같은 포장된 앱(dist/win-unpacked)으로 E2E 전체를 돌린다 (npm run test:packaged).
// asar 포장, 앱 경로, 작업자(Worker) 파일, PDF 보기 창처럼 개발 실행과 다를 수 있는 부분을 확인한다.
process.env['OPB_E2E_EXE'] = join(__dirname, 'dist', 'win-unpacked', 'Open Perfboard.exe')

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: 'perf.spec.ts',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results'
})
