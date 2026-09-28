import { expect, test } from '@playwright/test'
import { dropPart, getProject, launchApp, makeUserDataDir, seedLibrary, setMode } from './launch'

test('부품 줄 맞추기: 위 맞추기 → 가로 같은 간격 → 실행 취소 1회씩', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    // 높이·간격이 제각각
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.2, box.y + box.height * 0.35)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.4, box.y + box.height * 0.6)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.8, box.y + box.height * 0.5)
    const ys = async () => (await getProject(win)).instances.map((i) => i.y)
    const xs = async () => (await getProject(win)).instances.map((i) => i.x)
    const before = await getProject(win)

    await setMode(win, 'select')
    await win.getByTestId('diagram-canvas').click({ position: { x: 5, y: 5 } })
    await win.keyboard.press('Control+a')
    const props = win.getByTestId('props-multi')
    await expect(props).toContainText('부품 3개')

    // 1. 위 맞추기: 같은 부품이라 중심 y가 모두 같아진다
    await props.getByRole('button', { name: '위 맞추기' }).click()
    await expect.poll(async () => new Set(await ys()).size).toBe(1)
    expect(Math.min(...(await ys()))).toBeCloseTo(Math.min(...before.instances.map((i) => i.y)), 3)

    // 2. 가로 같은 간격: 양 끝은 그대로, 가운데가 한가운데로
    await props.getByRole('button', { name: '가로 같은 간격' }).click()
    await expect.poll(async () => {
      const [a, b, c] = await xs()
      return Math.abs(b - a - (c - b))
    }).toBeLessThan(0.01)
    const [a, , c] = await xs()
    expect(a).toBeCloseTo(before.instances[0].x, 3)
    expect(c).toBeCloseTo(before.instances[2].x, 3)
    await win.screenshot({ path: 'test-results/align.png' })

    // 3. 실행 취소 두 번이면 처음 자리
    await win.keyboard.press('Control+z')
    await expect.poll(async () => new Set(await ys()).size).toBe(1)
    await win.keyboard.press('Control+z')
    await expect.poll(xs).toEqual(before.instances.map((i) => i.x))
    expect(await ys()).toEqual(before.instances.map((i) => i.y))

  } finally {
    await app.close()
  }
})
