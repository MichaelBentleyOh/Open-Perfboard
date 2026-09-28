// 이 PC의 앱 설정 (배선도 파일과 무관, 실행 취소 대상 아님). localStorage에 기억한다.
import { create } from 'zustand'

const KEY = 'opb.settings'

interface Settings {
  /** 배선도(.opb)를 저장할 때 첨부 파일 본문도 넣을지 (기본 끔: 파일이 커지므로) */
  embedAttachments: boolean
  /** 왼쪽 부품함을 접었는지 (접으면 배선도가 그만큼 넓어진다) */
  leftCollapsed: boolean
  /** 오른쪽 선택 항목 창을 접었는지 */
  rightCollapsed: boolean
}

const DEFAULTS: Settings = { embedAttachments: false, leftCollapsed: false, rightCollapsed: false }

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return {
      embedAttachments: raw.embedAttachments === true,
      leftCollapsed: raw.leftCollapsed === true,
      rightCollapsed: raw.rightCollapsed === true
    }
  } catch {
    return DEFAULTS
  }
}

interface SettingsState extends Settings {
  setEmbedAttachments: (on: boolean) => void
  setLeftCollapsed: (on: boolean) => void
  setRightCollapsed: (on: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const save = () => {
    try {
      const { embedAttachments, leftCollapsed, rightCollapsed } = get()
      localStorage.setItem(KEY, JSON.stringify({ embedAttachments, leftCollapsed, rightCollapsed }))
    } catch {
      // 저장하지 못해도 이번 실행 동안은 동작한다
    }
  }
  return {
    ...load(),
    setEmbedAttachments: (embedAttachments) => {
      set({ embedAttachments })
      save()
    },
    setLeftCollapsed: (leftCollapsed) => {
      set({ leftCollapsed })
      save()
    },
    setRightCollapsed: (rightCollapsed) => {
      set({ rightCollapsed })
      save()
    }
  }
})
