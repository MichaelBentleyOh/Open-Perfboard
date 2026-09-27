import { CommitInput } from '@/components/CommitInput'
import { tidyWiring } from '@/app/editCommands'
import { AWG_MAX, AWG_MIN, type PartDef, type PartInstance } from '@core/model'
import { buildNetlist } from '@core/netlist'
import { endInstanceId, endJunctionId } from '@core/ends'
import { replacePartDef } from '@core/ops'
import { parseAmount } from '@core/money'
import { isHttpUrl, shortUrl } from '@core/url'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'
import { WIRE_COLORS, useUiStore } from '@/stores/uiStore'
import { t as tNow, useT } from '@/i18n'
import { AttachmentList } from '@/features/attachments/AttachmentList'

const store = useProjectStore.getState
const notify = (m: string) => useUiStore.getState().notify(m)
const clear = () => useUiStore.getState().clearSelection()

function ExternalLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      title={url}
      onClick={(e) => {
        e.preventDefault()
        window.api.shell.openExternal(url)
      }}
    >
      {shortUrl(url)} ↗
    </a>
  )
}

/** 라벨 + 입력칸 한 줄 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** 숫자 칸: 비우면 undefined, 잘못된 값이면 알림 후 되돌림 */
function NumberInput({
  label,
  value,
  onCommit,
  placeholder
}: {
  label: string
  value?: number
  onCommit: (v: number | undefined) => void
  placeholder?: string
}) {
  return (
    <CommitInput
      aria-label={label}
      inputMode="decimal"
      placeholder={placeholder ?? '-'}
      value={value === undefined ? '' : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
      onCommit={(text) => {
        const n = parseAmount(text)
        if (Number.isNaN(n)) {
          notify(tNow('0 이상의 숫자를 입력하세요'))
          return false
        }
        onCommit(n)
      }}
    />
  )
}

/** 프로젝트 사본과 라이브러리 정의가 다른지 */
const differs = (a: PartDef, b: PartDef) => JSON.stringify(a) !== JSON.stringify(b)

/** 선택한 것의 스펙을 보고 고치는 창 */
export function PropertiesPanel() {
  const t = useT()
  const selection = useUiStore((s) => s.selection)
  const project = useProjectStore((s) => s.project)

  // 실행 취소 등으로 사라진 대상은 무시한다
  const instances = selection.instances.filter((id) => project.instances.some((i) => i.id === id))
  const wires = selection.wires.filter((id) => project.wires.some((w) => w.id === id))
  const junctions = selection.junctions.filter((id) => project.junctions?.some((j) => j.id === id))
  const count = instances.length + wires.length + junctions.length

  if (count > 1) return <MultiProps instances={instances} wires={wires} junctions={junctions} />
  if (instances.length === 1) {
    const inst = project.instances.find((i) => i.id === instances[0])!
    if (project.parts[inst.partId]) return <PartProps inst={inst} />
  }
  if (junctions.length === 1) return <JunctionProps id={junctions[0]} />
  if (wires.length === 1) return <WireProps id={wires[0]} />

  return (
    <div className="props">
      <h2>{t('선택 항목')}</h2>
      <p className="empty">{t('캔버스에서 부품이나 전선을 누르면 여기서 스펙을 보고 고칠 수 있습니다.')}</p>
    </div>
  )
}

// ---------------------------------------------------------------- 여러 개

function MultiProps({ instances, wires, junctions }: { instances: string[]; wires: string[]; junctions: string[] }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  return (
    <div className="props" data-testid="props-multi">
      <h2>{t('여러 개 선택')}</h2>
      <p className="multi-summary">
        {t('부품 {parts}개 · 전선 {wires}개', { parts: instances.length, wires: wires.length })}
        {junctions.length > 0 && ` · ${t('접속점 {n}개', { n: junctions.length })}`}
      </p>
      {instances.length > 0 && <TransformButtons ids={instances} />}
      {wires.length > 0 && (
        <div className="field">
          <span>{t('전선 색')}</span>
          <ColorPicker
            value={commonValue(wires.map((id) => project.wires.find((w) => w.id === id)!.color))}
            onChange={(color) => store().updateWires(wires, { color })}
          />
        </div>
      )}
      {wires.length > 0 && <button onClick={tidyWiring}>{t('⌁ 배선 정리')}</button>}
      <button
        className="danger"
        onClick={() => {
          store().removeItems({ instances, wires, junctions })
          clear()
        }}
      >
        {t('모두 삭제 (Delete)')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- 부품: 참조명 + 스펙(이 배선도의 사본)

function PartProps({ inst }: { inst: PartInstance }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const libraryParts = useLibraryStore((s) => s.parts)
  const part = project.parts[inst.partId]
  const wireCount = project.wires.filter((w) => endInstanceId(w.from) === inst.id || endInstanceId(w.to) === inst.id).length
  const users = project.instances.filter((i) => i.partId === part.id).map((i) => i.refDes)
  const lib = libraryParts.find((p) => p.id === part.id)
  const spec = (patch: Parameters<ReturnType<typeof store>['updatePartDef']>[1]) => store().updatePartDef(part.id, patch)

  const revert = () => {
    if (!lib) return
    const lost = replacePartDef(project, lib).removedWires
    if (lost > 0 && !window.confirm(t('부품함에서 없어진 핀에 연결된 전선 {n}개가 삭제됩니다.\n계속할까요?', { n: lost }))) return
    store().refreshPart(lib)
    notify(t('부품함 값으로 되돌렸습니다'))
  }
  const saveToLibrary = async () => {
    try {
      await useLibraryStore.getState().save(part)
      notify(t('부품함에 저장했습니다'))
    } catch (e) {
      window.alert(`${t('저장하지 못했습니다.')}\n${(e as Error).message}`)
    }
  }

  return (
    <div className="props" data-testid="props-instance">
      <h2>{t('부품')}</h2>
      <Field label={t('참조명')}>
        <CommitInput
          aria-label={t('참조명')}
          value={inst.refDes}
          onCommit={(v) => {
            if (!v.trim()) return false // 빈 참조명은 거부 → 이전 값으로
            store().updateInstance(inst.id, { refDes: v.trim() })
          }}
        />
      </Field>

      <h3 className="props-section">
        {t('스펙')}
        {users.length > 1 && <small> · {users.join(', ')}</small>}
      </h3>
      <Field label={t('이름')}>
        <CommitInput
          aria-label={t('이름')}
          value={part.name}
          onCommit={(v) => {
            if (!v.trim()) {
              notify(t('이름을 입력하세요'))
              return false
            }
            spec({ name: v })
          }}
        />
      </Field>
      <Field label={t('품번')}>
        <CommitInput aria-label={t('품번')} value={part.partNumber ?? ''} onCommit={(v) => spec({ partNumber: v })} />
      </Field>
      <Field label={t('제조사')}>
        <CommitInput aria-label={t('제조사')} value={part.manufacturer ?? ''} onCommit={(v) => spec({ manufacturer: v })} />
      </Field>
      <Field label={t('기본 단가')}>
        <NumberInput label={t('기본 단가')} value={part.unitPrice} onCommit={(v) => spec({ unitPrice: v })} />
      </Field>
      <Field label={t('구매 링크')}>
        <CommitInput
          aria-label={t('구매 링크')}
          placeholder="https://..."
          value={part.purchaseUrl ?? ''}
          onCommit={(v) => {
            if (v.trim() && !isHttpUrl(v.trim())) {
              notify(t('구매 링크는 http:// 또는 https://로 시작해야 합니다'))
              return false
            }
            spec({ purchaseUrl: v })
          }}
        />
      </Field>
      {part.purchaseUrl && isHttpUrl(part.purchaseUrl) && (
        <p className="field-link">
          <ExternalLink url={part.purchaseUrl} />
        </p>
      )}
      <Field label={t('메모')}>
        <CommitInput aria-label={t('메모')} value={part.memo ?? ''} onCommit={(v) => spec({ memo: v })} />
      </Field>
      {part.attachments?.length ? (
        <>
          <h3 className="props-section">{t('첨부')}</h3>
          <AttachmentList items={part.attachments} />
        </>
      ) : null}
      <dl className="info">
        <dt>{t('핀 / 연결')}</dt>
        <dd>{t('{pins}개 / 전선 {wires}개', { pins: part.pins.length, wires: wireCount })}</dd>
        <dt>{t('회전')}</dt>
        <dd>
          {inst.rotation}°{inst.flipped && ` · ${t('반전')}`}
        </dd>
      </dl>

      <TransformButtons ids={[inst.id]} />

      {!lib ? (
        <button onClick={saveToLibrary}>{t('부품함에 추가')}</button>
      ) : (
        differs(lib, part) && (
          <div className="callout" data-testid="library-differs">
            <p>{t('부품함과 다릅니다')}</p>
            <div className="button-stack">
              <button onClick={saveToLibrary}>{t('부품함에도 저장')}</button>
              <button onClick={revert}>{t('부품함 값으로 되돌리기')}</button>
            </div>
          </div>
        )
      )}
      <button
        className="danger"
        onClick={() => {
          store().removeItems({ instances: [inst.id], wires: [] })
          clear()
        }}
      >
        {t('부품 삭제 (Delete)')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- 접속점

function JunctionProps({ id }: { id: string }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const j = project.junctions!.find((x) => x.id === id)!
  const attached = buildNetlist({ ...project, wires: project.wires.filter((w) => endJunctionId(w.from) === j.id || endJunctionId(w.to) === j.id) })
  return (
    <div className="props" data-testid="props-junction">
      <h2>{t('접속점 {label}', { label: j.label })}</h2>
      <ul className="junction-wires">
        {attached.map((r) => (
          <li key={r.wireId}>
            <span className="swatch" style={{ background: r.color }} /> {r.from.label === j.label ? r.to.label : r.from.label}
          </li>
        ))}
      </ul>
      <button
        className="danger"
        onClick={() => {
          store().removeItems({ instances: [], wires: [], junctions: [j.id] })
          clear()
        }}
      >
        {t('접속점 삭제 (연결된 전선 {n}개도 함께)', { n: attached.length })}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- 전선: 규격·길이·색·라벨·모양

const AWG_OPTIONS = Array.from({ length: AWG_MAX - AWG_MIN + 1 }, (_, i) => AWG_MAX - i)

function WireProps({ id }: { id: string }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const wire = project.wires.find((w) => w.id === id)!
  const row = buildNetlist({ ...project, wires: [wire] })[0]
  if (!row) return null
  const update = (patch: Parameters<ReturnType<typeof store>['updateWires']>[1]) => store().updateWires([wire.id], patch)
  return (
    <div className="props" data-testid="props-wire">
      <h2>{t('전선')}</h2>
      <p className="wire-ends">
        {row.from.label}
        {row.from.signal && <small> {row.from.signal}</small>}
        <br />↔ {row.to.label}
        {row.to.signal && <small> {row.to.signal}</small>}
      </p>

      <h3 className="props-section">{t('스펙')}</h3>
      <Field label={t('규격(AWG)')}>
        <select
          aria-label={t('규격(AWG)')}
          value={wire.awg ?? ''}
          onChange={(e) => update({ awg: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">-</option>
          {AWG_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a} AWG
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('길이(mm)')}>
        <NumberInput label={t('길이(mm)')} value={wire.length} onCommit={(v) => update({ length: v })} />
      </Field>
      <div className="field">
        <span>{t('색상')}</span>
        <ColorPicker value={wire.color} onChange={(color) => update({ color })} />
      </div>
      <Field label={t('라벨')}>
        <CommitInput aria-label={t('전선 라벨')} value={wire.label ?? ''} placeholder="+12V" onCommit={(v) => update({ label: v.trim() || undefined })} />
      </Field>

      <h3 className="props-section">{t('표시')}</h3>
      <div className="field">
        <span>{t('모양')}</span>
        <div className="choice-row">
          <button className={wire.orthogonal ? 'toggle active' : 'toggle'} aria-pressed={!!wire.orthogonal} onClick={() => update({ orthogonal: true })}>
            {t('┐ 직각')}
          </button>
          <button className={!wire.orthogonal ? 'toggle active' : 'toggle'} aria-pressed={!wire.orthogonal} onClick={() => update({ orthogonal: false })}>
            {t('╱ 직선')}
          </button>
        </div>
      </div>
      <Field label={t('표시 굵기')}>
        <select aria-label={t('표시 굵기')} value={wire.width} onChange={(e) => update({ width: Number(e.target.value) })}>
          {[1, 2, 3, 4, 6].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span>{t('꺾임점')}</span>
        <div className="choice-row">
          <span data-testid="bend-count">{t('{n}개', { n: wire.points?.length ?? 0 })}</span>
          {(wire.points?.length ?? 0) > 0 && (
            <button className="small" onClick={() => update({ points: [] })}>
              {t('모두 지우기')}
            </button>
          )}
        </div>
      </div>
      <button onClick={tidyWiring}>{t('⌁ 배선 정리')}</button>
      <button
        className="danger"
        onClick={() => {
          store().removeItems({ instances: [], wires: [wire.id] })
          clear()
        }}
      >
        {t('전선 삭제 (Delete)')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- 공용

/** 회전·반전 버튼 (부품 하나 또는 여러 개) */
function TransformButtons({ ids }: { ids: string[] }) {
  const t = useT()
  return (
    <div className="button-grid">
      <button title={t('반시계 90° (Shift+R)')} onClick={() => store().rotateInstances(ids, -90)}>
        ↺ 90°
      </button>
      <button title={t('시계 90° (R)')} onClick={() => store().rotateInstances(ids, 90)}>
        ↻ 90°
      </button>
      <button title={t('좌우 반전 (F)')} onClick={() => store().flipInstances(ids, 'horizontal')}>
        {t('⇋ 좌우 반전')}
      </button>
      <button title={t('상하 반전 (Shift+F)')} onClick={() => store().flipInstances(ids, 'vertical')}>
        {t('⇅ 상하 반전')}
      </button>
    </div>
  )
}

/** 모두 같으면 그 값, 섞여 있으면 빈 문자열 (어떤 색도 선택 표시 안 함) */
const commonValue = (values: string[]) => (values.every((v) => v === values[0]) ? values[0] : '')

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const t = useT()
  return (
    <div className="color-picker" role="radiogroup" aria-label={t('전선 색')}>
      {WIRE_COLORS.map((c) => (
        <button
          key={c.value}
          role="radio"
          aria-checked={c.value === value}
          aria-label={t(c.name)}
          title={t(c.name)}
          className={c.value === value ? 'swatch-btn active' : 'swatch-btn'}
          style={{ background: c.value }}
          onClick={() => onChange(c.value)}
        />
      ))}
    </div>
  )
}
