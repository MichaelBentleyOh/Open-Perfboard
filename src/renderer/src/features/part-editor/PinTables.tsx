import { nanoid } from 'nanoid'
import { PIN_ELECTRICALS, type Connector, type Pin, type PinElectrical, type Supply } from '@core/model'
import { addConnector, removeConnector, removePin, updateConnector, updatePin } from '@core/part'
import { PIN_ELECTRICAL_LABEL } from '@core/symbol'
import { connectorColor } from './connectorColor'
import type { PinEdit } from './PinWorkspace'
import { useT } from '@/i18n'

interface Props {
  pins: Pin[]
  connectors: Connector[]
  onChange: (edit: PinEdit) => void
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  /** 새로 찍는 핀이 들어갈 커넥터 ('' = 없음) */
  activeConnectorId: string
  onActiveConnector: (id: string) => void
  /** 커넥터 종류(소문자) → 짝 하우징 (027) */
  housings: ReadonlyMap<string, Supply>
}

/** 커넥터 표 + 핀 표. 부품 편집기와 부속 부품 편집기가 같이 쓴다 */
export function PinTables({ pins, connectors, onChange, selectedPinId, onSelectPin, activeConnectorId, onActiveConnector, housings }: Props) {
  const t = useT()
  return (
    <>
      <h3>
        {t('커넥터')}
        <button className="small" onClick={() => onChange((d) => addConnector(d, { id: nanoid() }))}>
          {t('＋ 커넥터')}
        </button>
      </h3>
      {connectors.length === 0 ? (
        <p className="empty">{t('커넥터 없이 핀만 써도 됩니다.')}</p>
      ) : (
        <table className="grid-table">
          <thead>
            <tr>
              <th />
              <th>{t('이름')}</th>
              <th>{t('종류')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {connectors.map((c) => {
              const mate = c.type.trim() ? housings.get(c.type.trim().toLowerCase()) : undefined
              return (
                <tr key={c.id}>
                  <td className="connector-color">
                    {/* 핀 색: 눌러서 고른다. 고른 색이 있으면 ↺로 기본 색(순서대로)에 돌아간다 */}
                    <input
                      type="color"
                      className="swatch-input"
                      aria-label={t('커넥터 색')}
                      title={t('커넥터 색')}
                      value={connectorColor(connectors, c.id)}
                      onChange={(e) => onChange((d) => updateConnector(d, c.id, { color: e.target.value }))}
                    />
                    {c.color && (
                      <button
                        className="icon small"
                        title={t('기본 색으로')}
                        aria-label={t('기본 색으로')}
                        onClick={() => onChange((d) => updateConnector(d, c.id, { color: null }))}
                      >
                        ↺
                      </button>
                    )}
                  </td>
                  <td>
                    <input value={c.name} onChange={(e) => onChange((d) => updateConnector(d, c.id, { name: e.target.value }))} />
                  </td>
                  <td>
                    <input
                      aria-label={t('커넥터 종류')}
                      list="connector-type-options"
                      value={c.type}
                      placeholder="JST-XH 4P"
                      onChange={(e) => onChange((d) => updateConnector(d, c.id, { type: e.target.value }))}
                    />
                    {c.type.trim() && (
                      <small className={mate ? 'mate ok' : 'mate'} data-testid="connector-mate">
                        {mate ? t('짝: {name}', { name: mate.name }) : t('짝 하우징 미지정')}
                      </small>
                    )}
                  </td>
                  <td>
                    <button
                      className="icon"
                      title={t('커넥터 삭제')}
                      aria-label={t('커넥터 삭제')}
                      onClick={() => {
                        onChange((d) => removeConnector(d, c.id))
                        if (activeConnectorId === c.id) onActiveConnector('')
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <datalist id="connector-type-options">
        {[...housings.values()].map((h) => (
          <option key={h.id} value={h.connectorType} label={h.name} />
        ))}
      </datalist>

      <h3>{t('핀 ({n})', { n: pins.length })}</h3>
      {connectors.length > 0 && (
        <label className="field">
          <span>{t('새 핀의 커넥터')}</span>
          <select value={activeConnectorId} onChange={(e) => onActiveConnector(e.target.value)}>
            <option value="">{t('(없음)')}</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {pins.length === 0 ? (
        <p className="empty">{t('사진을 클릭해 핀을 찍으세요.')}</p>
      ) : (
        <table className="grid-table" data-testid="pin-table">
          <thead>
            <tr>
              <th>{t('번호')}</th>
              <th>{t('신호')}</th>
              <th>{t('커넥터')}</th>
              <th>{t('전기 종류')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pins.map((p) => (
              <tr key={p.id} className={p.id === selectedPinId ? 'selected' : ''} onClick={() => onSelectPin(p.id)}>
                <td>
                  <input
                    className="narrow"
                    aria-label={t('핀 번호')}
                    value={p.number}
                    onChange={(e) => onChange((d) => updatePin(d, p.id, { number: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    aria-label={t('신호')}
                    value={p.signal ?? ''}
                    placeholder="SDA"
                    onChange={(e) => onChange((d) => updatePin(d, p.id, { signal: e.target.value }))}
                  />
                </td>
                <td>
                  <select value={p.connectorId ?? ''} onChange={(e) => onChange((d) => updatePin(d, p.id, { connectorId: e.target.value || null }))}>
                    <option value="">-</option>
                    {connectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={t('전기 종류')}
                    title={t('KiCad 핀 종류·시뮬레이션에 쓰입니다')}
                    value={p.electrical ?? 'passive'}
                    onChange={(e) => onChange((d) => updatePin(d, p.id, { electrical: e.target.value as PinElectrical }))}
                  >
                    {PIN_ELECTRICALS.map((k) => (
                      <option key={k} value={k}>
                        {t(PIN_ELECTRICAL_LABEL[k])}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="icon"
                    title={t('핀 삭제')}
                    aria-label={t('핀 삭제')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onChange((d) => removePin(d, p.id))
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
