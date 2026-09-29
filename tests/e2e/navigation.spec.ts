import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { launchApp, makeTempDir, makeUserDataDir } from './launch'

// 보안: 앱 창은 앱 페이지만 띄운다. HTML 파일을 끌어다 놓는 것처럼 다른 주소로 가려 해도 넘어가지 않아야
// 그 페이지가 window.api(파일 읽기·쓰기)를 얻지 못한다
test('앱 창은 다른 페이지로 넘어가지 않는다 (window.api 보호)', async () => {
  const other = join(makeTempDir('opb-nav-'), 'other.html')
  writeFileSync(other, '<h1>other</h1>')
  const { app, win } = await launchApp(makeUserDataDir())
  try {
    const before = win.url()
    await win.evaluate((url) => {
      window.location.href = url
    }, pathToFileURL(other).href)
    await win.waitForTimeout(800)
    expect(win.url()).toBe(before)
    expect(await win.evaluate(() => document.querySelector('h1')?.textContent ?? null)).not.toBe('other')
    expect(await win.evaluate(() => typeof (window as unknown as { api?: { recent?: { list?: unknown } } }).api?.recent?.list)).toBe('function')
  } finally {
    await app.close()
  }
})
