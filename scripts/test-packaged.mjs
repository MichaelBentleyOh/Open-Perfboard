// npm run test:packaged: 지금 운영체제의 설치 파일을 만들고, 포장된 앱으로 E2E 전체를 돌린다.
// Windows → dist:win (win-unpacked), Linux → dist:linux (linux-unpacked). 경로는 playwright.packaged.config.ts가 고른다.
// --skip-dist: 이미 만든 dist로 테스트만 (CI에서 빌드와 테스트를 나눌 때)
import { spawnSync } from 'node:child_process'

const run = (script) => {
  const r = spawnSync(script, { stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!process.argv.includes('--skip-dist')) run(process.platform === 'win32' ? 'npm run dist:win' : 'npm run dist:linux')
run('npx playwright test -c playwright.packaged.config.ts')
