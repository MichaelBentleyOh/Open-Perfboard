// 이 PC의 앱 설정 (배선도 파일과 무관, 실행 취소 대상 아님). localStorage에 기억한다.
import { create } from 'zustand'

const KEY = 'opb.settings'

interface Settings {
  /** 배선도(.opb)를 저장할 때 첨부 파일 본문도 넣을지 (기본 끔: 파일이 커지므로) */
  embedAttachments: boolean
}

const DEFAULTS: Settings = { embedAttachments: false }

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return { embedAttachments: raw.embedAttachments === true }
  } catch {
    return DEFAULTS
  }
}

interface SettingsState extends Settings {
  setEmbedAttachments: (on: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  setEmbedAttachments: (embedAttachments) => {
    set({ embedAttachments })
    try {
      localStorage.setItem(KEY, JSON.stringify({ embedAttachments: get().embedAttachments }))
    } catch {
      // 저장하지 못해도 이번 실행 동안은 동작한다
    }
  }
}))
