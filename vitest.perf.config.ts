import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 성능 측정 (npm run perf). 일반 테스트와 따로 돈다.
export default defineConfig({
  resolve: {
    alias: { '@core': resolve(__dirname, 'src/core') }
  },
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node'
  }
})
