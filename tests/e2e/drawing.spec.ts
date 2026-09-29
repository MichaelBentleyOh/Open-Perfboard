import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, makeUserDataDir, nextFrame } from './launch'

/** 그림판 가운데 기준으로 (dx, dy)만큼 떨어진 화면 좌표 */
async function boardPoint(win: Page, dx: number, dy: number) {
  const box = (await win.getByTestId('drawing-canvas').boundingBox())!
  return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy }
}
async function drag(win: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2)
  await win.mouse.move(b.x, b.y)
  await win.mouse.up()
  await nextFrame(win)
}
const shapeCount = (win: Page) => win.locator('.drawing-props .hint')

test('부품 그림판: 상자·원·선·글 그리기 → 색 → 실행 취소 → 핀 → 저장하면 사진과 원본 → 다시 열어 고치기, 부속 부품도', async () => {
  const userData = makeUserDataDir()
  const { app, win } = await launchApp(userData, { home: true })
  try {
    await win.locator('.home').getByRole('button', { name: /부품 만들기/ }).click()
    await win.getByRole('button', { name: '＋ 새 부품' }).click()
    const editor = win.getByRole('region', { name: '부품 편집' })
    await expect(editor.getByRole('tab', { name: '✏ 그림' })).toHaveAttribute('aria-selected', 'true')
    const tools = editor.getByRole('toolbar', { name: '그리기 도구' })
    await expect(shapeCount(win)).toContainText('도형 0개')

    // 상자: 끌어서
    await tools.getByRole('button', { name: '상자', exact: true }).click()
    await drag(win, await boardPoint(win, -120, -80), await boardPoint(win, -20, 0))
    // 원: 클릭만 → 기본 크기
    await tools.getByRole('button', { name: '원', exact: true }).click()
    const c = await boardPoint(win, 30, -60)
    await win.mouse.click(c.x, c.y)
    // 선: 끌어서 직선
    await tools.getByRole('button', { name: '선', exact: true }).click()
    await drag(win, await boardPoint(win, -120, 40), await boardPoint(win, 100, 40))
    // 글상자: 누르면 글 칸으로
    await tools.getByRole('button', { name: '글상자', exact: true }).click()
    const tp = await boardPoint(win, -110, 60)
    await win.mouse.click(tp.x, tp.y)
    const text = editor.getByLabel('글상자 내용')
    await expect(text).toBeFocused()
    await text.fill('모터 드라이버')
    await win.screenshot({ path: 'test-results/drawing.png' })

    // 빈 곳을 눌러 선택 해제 → 도형 4개
    const empty = await boardPoint(win, 0, 200)
    await win.mouse.click(empty.x, empty.y)
    await expect(shapeCount(win)).toContainText('도형 4개')

    // 실행 취소 / 다시 실행 (글 바꾸기 1 + 글상자 1 → 두 번 되돌리면 3개)
    await tools.getByRole('button', { name: '실행 취소' }).click()
    await tools.getByRole('button', { name: '실행 취소' }).click()
    await expect(shapeCount(win)).toContainText('도형 3개')
    await tools.getByRole('button', { name: '다시 실행' }).click()
    await tools.getByRole('button', { name: '다시 실행' }).click()
    await expect(shapeCount(win)).toContainText('도형 4개')

    // 상자를 눌러 고르고 채우기 색 바꾸기, 키보드로 옮기기
    const r = await boardPoint(win, -70, -40)
    await win.mouse.click(r.x, r.y)
    const props = editor.getByRole('complementary', { name: '도형 속성' })
    await expect(props.getByRole('heading', { name: '상자' })).toBeVisible()
    await props.getByLabel('채우기').fill('#ff0000')
    await win.keyboard.press('Shift+ArrowRight')

    // 이름 → 핀 탭(사진으로 구움) → 핀 하나 → 저장
    await editor.getByPlaceholder('제어 보드 CB-100').fill('그린 부품')
    await editor.getByRole('tab', { name: '● 핀' }).click()
    const canvas = editor.getByTestId('pin-canvas')
    await expect(canvas.locator('canvas').first()).toBeVisible()
    const box = (await canvas.boundingBox())!
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(editor.getByLabel('핀 번호')).toHaveCount(1)
    await editor.getByRole('button', { name: '저장' }).click()
    await expect(win.getByTestId('studio-part-list').locator('.part-item.selected')).toContainText('그린 부품')

    const libDir = join(userData, 'library')
    const file = readdirSync(libDir).find((n) => n.endsWith('.json'))!
    const saved = JSON.parse(readFileSync(join(libDir, file), 'utf8'))
    expect(saved.image.data).toMatch(/^data:image\/png;base64,/)
    expect([saved.image.width, saved.image.height]).toEqual([400, 300])
    expect(saved.drawing.shapes.map((s: { type: string }) => s.type)).toEqual(['rect', 'ellipse', 'line', 'text'])
    expect(saved.drawing.shapes[0]).toMatchObject({ fill: '#ff0000' })
    expect(saved.drawing.shapes[3]).toMatchObject({ text: '모터 드라이버' })
    const rectX = saved.drawing.shapes[0].x

    // 다시 열면 그림 탭에서 도형 그대로 → 옮기고 저장하면 원본이 바뀐다
    await expect(editor.getByRole('tab', { name: '✏ 그림' })).toHaveAttribute('aria-selected', 'true')
    await win.mouse.click(empty.x, empty.y)
    await expect(shapeCount(win)).toContainText('도형 4개')
    await win.mouse.click(r.x, r.y)
    await win.keyboard.press('Shift+ArrowLeft')
    await win.keyboard.press('Shift+ArrowLeft')
    await editor.getByRole('button', { name: '저장' }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(libDir, file), 'utf8')).drawing.shapes[0].x).toBe(rectX - 20)

    // 부속 부품도 같은 그림판 → 저장하면 사진이 생긴다
    await win.getByRole('tab', { name: /부속 부품/ }).click()
    await win.getByRole('button', { name: '＋ 새 부속 부품' }).click()
    const supplyEditor = win.getByRole('region', { name: '부속 부품 편집' })
    await supplyEditor.getByPlaceholder('예: XH 4P 하우징').fill('그린 하우징')
    await supplyEditor.getByRole('toolbar', { name: '그리기 도구' }).getByRole('button', { name: '상자', exact: true }).click()
    await drag(win, await boardPoint(win, -40, -30), await boardPoint(win, 40, 30))
    await win.screenshot({ path: 'test-results/drawing-supply.png' })
    await supplyEditor.getByRole('button', { name: '저장' }).click()
    await expect(win.getByTestId('studio-supply-list')).toContainText('그린 하우징')
    const supplyDir = join(libDir, 'supplies')
    const s = JSON.parse(readFileSync(join(supplyDir, readdirSync(supplyDir)[0]!), 'utf8'))
    expect(s.image.data).toMatch(/^data:image\/png;base64,/)
    expect(s.drawing.shapes).toHaveLength(1)
  } finally {
    await app.close()
  }
})
