// 번역 사전 검사: 소스의 모든 번역 원문이 영어 사전에 있고, 변수 이름이 같은지.
// t('…'), tr('…'), mt('…'), tNow('…'), msg('…'), 그리고 serialize.ts의 errors.push('…')를 찾는다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from '@core/i18n-en'
import { fill, translator } from '@core/i18n'

const ROOT = join(__dirname, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !e.name.startsWith('i18n-'))
    .map((e) => join(e.parentPath, e.name))
}

/** JS 문자열 리터럴의 이스케이프를 푼다 */
const unescape = (s: string) => s.replace(/\\(n|'|"|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c))

const CALL = /\b(?:t|tr|mt|tNow|msg|errors\.push)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g

function collectKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const file of ['src/core', 'src/main', 'src/renderer/src'].flatMap(sourceFiles)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(CALL)) {
      const key = unescape(m[2])
      if (/[가-힣]/.test(key)) keys.set(key, file.slice(ROOT.length + 1))
    }
  }
  return keys
}

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('번역 사전', () => {
  const keys = collectKeys()

  it('원문을 충분히 찾았다 (검사 자체가 동작하는지)', () => {
    expect(keys.size).toBeGreaterThan(200)
    expect(keys.has('저장')).toBe(true)
  })

  it('모든 원문에 영어 번역이 있다', () => {
    const missing = [...keys].filter(([k]) => !(k in EN)).map(([k, file]) => `${file}: ${JSON.stringify(k)}`)
    expect(missing).toEqual([])
  })

  it('번역문의 변수 이름이 원문과 같다', () => {
    const bad = Object.entries(EN)
      .filter(([k, v]) => JSON.stringify(vars(k)) !== JSON.stringify(vars(v)))
      .map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('영어 번역에는 한글이 남아 있지 않다', () => {
    expect(Object.entries(EN).filter(([, v]) => /[가-힣]/.test(v))).toEqual([])
  })

  it('쓰이지 않는 번역이 없다', () => {
    expect(Object.keys(EN).filter((k) => !keys.has(k))).toEqual([])
  })

  it('translator: 한국어는 원문, 영어는 사전, 사전에 없으면 원문', () => {
    const en = translator('en')
    expect(translator('ko')('저장')).toBe('저장')
    expect(en('저장')).toBe('Save')
    expect(en('사전에 없는 문장')).toBe('사전에 없는 문장')
    expect(en('전선 {n}개를 정리했습니다', { n: 3 })).toBe(fill(EN['전선 {n}개를 정리했습니다'], { n: 3 }))
    expect(fill('{a}와 {b}', { a: 1 })).toBe('1와 {b}')
  })
})
