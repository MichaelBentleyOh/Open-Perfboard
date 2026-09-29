import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { PartDef } from '../../src/core/model'
import { launchApp, makeUserDataDir, nextFrame, seedLibrary } from './launch'

type Saved = PartDef & { symbol: NonNullable<PartDef['symbol']> }

test('회로도 기호: 기본 기호 → 핀 끌기(격자) → 전기 종류 → 저장 → 핀 지우면 기호에서도, 새 핀은 놓지 않은 핀', async () => {
  const userData = makeUserDataDir()
  // 핀 4개: VCC, GND, SDA, SCL
  seedLibrary(userData, {
    id: 'imu',
    name: 'IMU',
    pins: [
      { id: 'p1', number: '1', signal: 'VCC', connectorId: 'j1', x: 0.2, y: 0.5 },
      { id: 'p2', number: '2', signal: 'GND', connectorId: 'j1', x: 0.4, y: 0.5 },
      { id: 'p3', number: '3', signal: 'SDA', connectorId: 'j1', x: 0.6, y: 0.5 },
      { id: 'p4', number: '4', signal: 'SCL', connectorId: 'j1', x: 0.8, y: 0.5 }
    ]
  })
  const libFile = () => {
    const dir = join(userData, 'library')
    return join(dir, readdirSync(dir).find((n) => n.startsWith('imu'))!)
  }
  const saved = (): Saved => JSON.parse(readFileSync(libFile(), 'utf8'))
  const { app, win } = await launchApp(userData, { home: true })
  try {
    await win.locator('.home').getByRole('button', { name: /부품 만들기/ }).click()
    await win.getByTestId('studio-part-list').getByText('IMU').click()
    const editor = win.getByRole('region', { name: '부품 편집' })
    await editor.getByRole('tab', { name: '⎍ 기호' }).click()
    const props = editor.getByRole('complementary', { name: '도형 속성' })
    await expect(props.getByRole('heading', { name: '기호', exact: true })).toBeVisible()
    await expect(props.getByText('모든 핀을 기호에 놓았습니다.')).toBeVisible()
    await nextFrame(win)
    await win.screenshot({ path: 'test-results/symbol.png' })

    // 기호 핀 끝점의 화면 좌표 (기호 핀 순서: 왼쪽 SDA, 오른쪽 SCL, 위 VCC, 아래 GND)
    const pinPoints = () =>
      win.evaluate(() => {
        type Node = { find: (s: string) => Node[]; findOne: (s: string) => Node; absolutePosition: () => { x: number; y: number }; container: () => HTMLElement }
        const stages = (window as unknown as { Konva: { stages: Node[] } }).Konva.stages
        const stage = stages.find((s) => s.container().closest('[data-testid="drawing-canvas"]'))!
        const rect = stage.container().getBoundingClientRect()
        return stage.find('.symbol-pin').map((g) => {
          const c = g.findOne('Circle').absolutePosition()
          return { x: rect.left + c.x, y: rect.top + c.y }
        })
      })
    // SDA(왼쪽 첫 핀)를 누르면 핀 속성
    const before = (await pinPoints())[0]
    await win.mouse.click(before!.x + 4, before!.y)
    await expect(props.getByRole('heading', { name: /기호 핀 J1\.3/ })).toBeVisible()
    await props.getByLabel('전기 종류').selectOption('bidirectional')

    // 끌어서 오른쪽 아래로 → 격자에 맞춰 옮겨지고 쪽은 그대로(왼쪽 밖)
    await win.mouse.move(before!.x + 4, before!.y)
    await win.mouse.down()
    await win.mouse.move(before!.x + 4, before!.y + 30)
    await win.mouse.move(before!.x + 4, before!.y + 47)
    await win.mouse.up()
    await nextFrame(win)

    await editor.getByRole('button', { name: '저장' }).click()
    await expect.poll(() => saved().symbol?.pins.length).toBe(4)
    const s = saved()
    const sda = s.symbol.pins.find((p) => p.pinId === 'p3')!
    expect(sda.side).toBe('left')
    expect(sda.x % 10).toBe(0)
    expect(sda.y % 10).toBe(0)
    const auto = s.symbol.pins.find((p) => p.pinId === 'p4')!
    expect(sda.y).not.toBe(auto.y)
    expect(s.symbol.pins.find((p) => p.pinId === 'p1')!.side).toBe('top')
    expect(s.symbol.pins.find((p) => p.pinId === 'p2')!.side).toBe('bottom')
    expect(s.pins.find((p) => p.id === 'p3')!.electrical).toBe('bidirectional')

    // 핀 탭에서 SCL을 지우면 기호에서도, 새 핀을 찍으면 "놓지 않은 핀"에
    await editor.getByRole('tab', { name: '● 핀' }).click()
    const table = editor.getByTestId('pin-table')
    await table.getByRole('row').filter({ has: win.locator('input[value="4"]') }).getByRole('button', { name: '핀 삭제' }).click()
    const canvas = editor.getByTestId('pin-canvas')
    const box = (await canvas.boundingBox())!
    await win.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3)
    await expect(table.getByLabel('핀 번호')).toHaveCount(4)
    await editor.getByRole('tab', { name: '⎍ 기호' }).click()
    await expect(props.getByRole('heading', { name: '놓지 않은 핀 (1)' })).toBeVisible()
    await props.getByRole('list', { name: '놓지 않은 핀' }).getByRole('button').click()
    await expect(props.getByText('모든 핀을 기호에 놓았습니다.')).toHaveCount(0) // 새 핀을 고른 상태 → 핀 속성
    await expect(props.getByRole('heading', { name: /기호 핀/ })).toBeVisible()
    await editor.getByRole('button', { name: '저장' }).click()
    await expect.poll(() => saved().symbol.pins.map((p) => p.pinId).includes('p4')).toBe(false)
    expect(saved().symbol.pins).toHaveLength(4)
  } finally {
    await app.close()
  }
})
