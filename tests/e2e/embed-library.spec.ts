import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildTwoPartDiagram, getProject, launchApp, makeTempDir, makeUserDataDir, seedLibrary, stubDialogs } from './launch'

test('배선도에 라이브러리 전체 포함: 저장 → 다른 PC(빈 라이브러리)에서 열기 → 가져오기', async () => {
  const out = makeTempDir('opb-share-')
  const file = join(out, 'share.opb')

  // PC A: 라이브러리에 부품 2개(테스트 MCU, 안 쓰는 예비 릴레이). 배선도에는 MCU만 배치
  const pcA = makeUserDataDir()
  seedLibrary(pcA)
  seedLibrary(pcA, { id: 'spare-relay', name: '예비 릴레이', partNumber: 'RL-5V' })
  let { app, win } = await launchApp(pcA)
  try {
    await expect(win.getByTestId('part-list')).toContainText('예비 릴레이')
    await buildTwoPartDiagram(win)
    await stubDialogs(app, { save: file })
    await win.keyboard.press('Control+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    expect(raw.version).toBeGreaterThanOrEqual(3)
    expect(Object.keys(raw.parts)).toEqual(['test-mcu']) // 배치된 부품 사본
    expect(raw.library.map((p: { id: string }) => p.id)).toEqual(['spare-relay']) // 사본과 같은 MCU는 빼고 나머지 전체
  } finally {
    await app.close()
  }

  // PC B: 빈 라이브러리에서 열기 → 가져오기 대화상자에 2개(새 부품)
  const pcB = makeUserDataDir()
  ;({ app, win } = await launchApp(pcB))
  try {
    await expect(win.getByText('부품함이 비어 있습니다.')).toBeVisible()
    await stubDialogs(app, { open: file })
    await win.keyboard.press('Control+o')
    await expect(win.getByTestId('doc-name')).toHaveText('share')
    expect((await getProject(win)).instances).toHaveLength(2)
    const dialog = win.getByRole('dialog', { name: '부품 가져오기' })
    await expect(dialog).toContainText('내 부품함에 없는 부품이 있습니다')
    await expect(dialog.getByTestId('import-summary')).toContainText('새 부품 2')
    await win.screenshot({ path: 'test-results/embed-library-import.png' })
    await dialog.getByRole('button', { name: '가져오기 (2개)' }).click()
    await expect(win.getByRole('status')).toContainText('부품 2개를 가져왔습니다')
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    await expect(win.getByTestId('part-list')).toContainText('예비 릴레이')

    // 같은 파일을 다시 열면 이미 다 있으므로 묻지 않는다
    await win.keyboard.press('Control+o')
    await expect(win.getByTestId('doc-name')).toHaveText('share')
    await expect(win.getByRole('dialog', { name: '부품 가져오기' })).toHaveCount(0)

    // 문서는 열자마자 깨끗한 상태 (라이브러리를 가져와도 배선도는 바뀌지 않음)
    await expect(win.getByTestId('doc-name')).not.toContainText('*')
  } finally {
    await app.close()
  }
})
