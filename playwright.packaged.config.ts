import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// 설치 파일과 같은 포장된 앱(dist/win-unpacked, dist/linux-unpacked)으로 E2E 전체를 돌린다 (npm run test:packaged).
// asar 포장, 앱 경로, 작업자(Worker) 파일, PDF 보기 창처럼 개발 실행과 다를 수 있는 부분을 확인한다.
// OPB_E2E_EXE를 미리 정해 두면 그 실행 파일을 쓴다 (Fedora CI에서 rpm으로 설치한 앱).
process.env['OPB_E2E_EXE'] ??=
  process.platform === 'win32'
    ? join(__dirname, 'dist', 'win-unpacked', 'Open Perfboard.exe')
    : join(__dirname, 'dist', 'linux-unpacked', 'open-perfboard')

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: 'perf.spec.ts',
  timeout: 30_000,
  workers: 1,
  // CI에서는 실패한 테스트를 GitHub 주석으로도 남긴다 (Actions 로그는 로그인해야 보이지만 주석은 누구나 본다)
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  outputDir: 'test-results'
})
