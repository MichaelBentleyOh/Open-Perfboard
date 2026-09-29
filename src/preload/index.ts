import { contextBridge, ipcRenderer } from 'electron'
import type { Attachment } from '../core/model'

export interface RecentFile {
  path: string
  exists: boolean
}
export interface RecoveryEntry {
  id: string
  filePath: string | null
  name: string
  savedAt: number
  size: number
}
/** 파일 연결·최근 파일로 연 파일. 읽지 못했으면 error */
/** 배선도 파일 내용: .opb는 문자열, 여러 배선도 묶음 .zip은 바이트 (030) */
export type ProjectContent = string | Uint8Array
export type OpenFilePayload = { path: string; content: ProjectContent } | { path: string; error: string }

// 렌더러에 노출하는 API. 채널을 추가하면 main/ipc.ts에도 핸들러를 추가한다.
const api = {
  platform: process.platform,
  library: {
    /** 부품 JSON 문자열 목록 */
    list: (): Promise<string[]> => ipcRenderer.invoke('library:list'),
    save: (id: string, content: string): Promise<void> => ipcRenderer.invoke('library:save', id, content),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('library:remove', id),
    /** 가져올 파일 고르기 (여러 개). 취소하면 빈 배열 */
    pickFiles: (): Promise<{ name: string; content: string }[]> => ipcRenderer.invoke('library:pick-files')
  },
  supplies: {
    /** 부속 부품 JSON 문자열 목록 (027) */
    list: (): Promise<string[]> => ipcRenderer.invoke('supplies:list'),
    save: (id: string, content: string): Promise<void> => ipcRenderer.invoke('supplies:save', id, content),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('supplies:remove', id)
  },
  project: {
    /** 열기 대화상자 + 읽기. 취소하면 null */
    open: (): Promise<{ path: string; content: ProjectContent } | null> => ipcRenderer.invoke('project:open'),
    /** path가 null이면 다른 이름으로 저장. 저장된 경로, 취소하면 null */
    /** content: 문자열 = .opb, 바이트 = .zip */
    save: (path: string | null, content: ProjectContent, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke('project:save', path, content, suggestedName)
  },
  libfile: {
    /** 부품함 파일(.opblib, .json 부품, .opb) 열기 대화상자 + 읽기. 취소하면 null (037a) */
    open: (): Promise<{ path: string; content: string } | null> => ipcRenderer.invoke('libfile:open'),
    /** .opblib 저장. path가 null(또는 열어서 허락받지 않은 경로)이면 저장 대화상자. 저장된 경로, 취소하면 null */
    save: (path: string | null, content: string, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke('libfile:save', path, content, suggestedName)
  },
  recent: {
    /** 최근 파일 (최근 것부터, 지금 있는지 포함) */
    list: (): Promise<RecentFile[]> => ipcRenderer.invoke('recent:list'),
    /** 목록에 있는 파일만 열 수 있다 */
    open: (path: string): Promise<OpenFilePayload> => ipcRenderer.invoke('recent:open', path),
    remove: (path: string): Promise<void> => ipcRenderer.invoke('recent:remove', path),
    clear: (): Promise<void> => ipcRenderer.invoke('recent:clear')
  },
  recovery: {
    /** 이번 실행의 복구 사본 쓰기 (원래 .opb는 건드리지 않음) */
    write: (content: string, filePath: string | null, name: string): Promise<void> =>
      ipcRenderer.invoke('recovery:write', content, filePath, name),
    /** 이번 실행의 사본 지우기 (저장했거나 변경이 없어졌을 때) */
    clear: (): Promise<void> => ipcRenderer.invoke('recovery:clear'),
    /** 지난 실행들이 남긴 사본 (비정상 종료) */
    list: (): Promise<RecoveryEntry[]> => ipcRenderer.invoke('recovery:list'),
    take: (id: string): Promise<{ meta: { filePath: string | null; name: string; savedAt: number }; content: string }> =>
      ipcRenderer.invoke('recovery:take', id),
    discard: (id: string): Promise<void> => ipcRenderer.invoke('recovery:discard', id)
  },
  export: {
    /** 저장 대화상자 + 쓰기. 저장된 경로, 취소하면 null */
    save: (kind: 'csv' | 'xlsx' | 'png' | 'opblib', suggestedName: string, data: string | Uint8Array): Promise<string | null> =>
      ipcRenderer.invoke('export:save', kind, suggestedName, data),
    /** 보고서 HTML을 PDF로 저장. 저장된 경로, 취소하면 null */
    pdf: (html: string, opts: { pageSize: 'A4' | 'A3'; landscape: boolean }, suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke('export:pdf', html, opts, suggestedName)
  },
  attachments: {
    /** 파일 고르기 → 첨부 폴더로 복사. 취소하면 빈 목록 */
    add: (): Promise<{ attachments: Attachment[]; problems: string[] }> => ipcRenderer.invoke('attachments:add'),
    /** 공유 파일에서 온 본문 저장 (해시가 id와 같아야 함) */
    put: (id: string, data: Uint8Array): Promise<void> => ipcRenderer.invoke('attachments:put', id, data),
    read: (id: string): Promise<Uint8Array> => ipcRenderer.invoke('attachments:read', id),
    /** 이 PC에 있는 첨부 id만 */
    exists: (ids: string[]): Promise<string[]> => ipcRenderer.invoke('attachments:exists', ids),
    /** 앱의 별도 창에서 열기 */
    open: (id: string, title: string): Promise<void> => ipcRenderer.invoke('attachments:open', id, title)
  },
  shell: {
    /** http/https 링크를 기본 브라우저로 연다 */
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url)
  },
  app: {
    /** 앱 버전, 자동 저장 간격 */
    config: (): Promise<{ version: string; autosaveMs: number }> => ipcRenderer.invoke('app:config'),
    /** 앱을 .opb 파일로 실행했으면 그 파일 (한 번만) */
    takeOpenFile: (): Promise<OpenFilePayload | null> => ipcRenderer.invoke('app:take-open-file'),
    /** 이미 실행 중일 때 .opb를 더블클릭하면 호출된다. 해제 함수를 돌려준다 */
    onOpenFile: (cb: (file: OpenFilePayload) => void): (() => void) => {
      const listener = (_e: unknown, file: OpenFilePayload) => cb(file)
      ipcRenderer.on('app:open-file', listener)
      return () => ipcRenderer.removeListener('app:open-file', listener)
    },
    setDirty: (dirty: boolean): void => ipcRenderer.send('app:set-dirty', dirty),
    /** 대화상자(열기·저장·닫기 확인) 언어 */
    setLocale: (locale: 'ko' | 'en'): void => ipcRenderer.send('app:set-locale', locale),
    closeNow: (): void => ipcRenderer.send('app:close-now'),
    /** 창 닫기 확인에서 "저장"을 고르면 호출된다. 해제 함수를 돌려준다 */
    onSaveAndClose: (cb: () => void): (() => void) => {
      const listener = () => cb()
      ipcRenderer.on('app:save-and-close', listener)
      return () => ipcRenderer.removeListener('app:save-and-close', listener)
    }
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
