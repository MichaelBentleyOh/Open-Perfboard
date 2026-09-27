// docs/ARCHITECTURE.md의 계층 규칙을 기계적으로 강제한다.
// 규칙을 바꿔야 한다면 문서와 이 테스트를 함께 고친다.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const re = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm
  return [...src.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4])
}

interface Rule {
  layer: string
  dir: string
  forbidden: RegExp
  reason: string
}

const RULES: Rule[] = [
  {
    layer: 'Domain Core',
    dir: 'src/core',
    forbidden: /^(react|react-dom|react-konva|konva|zustand|zundo|electron|node:|fs$|path$|@\/)/,
    reason: '코어는 순수 TS여야 한다 (UI, Electron, Node API 금지)'
  },
  {
    layer: 'Renderer',
    dir: 'src/renderer/src',
    forbidden: /^(electron|node:|fs$|path$)/,
    reason: '렌더러는 파일 시스템/Electron에 직접 접근하지 않고 window.api를 쓴다'
  },
  {
    layer: 'Main',
    dir: 'src/main',
    forbidden: /^(react|react-dom|react-konva|konva|zustand|@\/)/,
    reason: 'Main은 UI 코드에 의존하지 않는다'
  }
]

describe('아키텍처 계층 경계', () => {
  for (const rule of RULES) {
    it(`${rule.layer}: ${rule.reason}`, () => {
      const violations = sourceFiles(rule.dir).flatMap((file) =>
        importsOf(file)
          .filter((spec) => rule.forbidden.test(spec))
          .map((spec) => `${relative(ROOT, file)} → '${spec}'`)
      )
      expect(violations, violations.join('\n')).toEqual([])
    })
  }
})
