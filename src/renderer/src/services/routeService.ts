// 배선 정리를 작업자(Web Worker)에서 돌린다. 전선이 많아도 화면이 멈추지 않고, 진행률과 취소를 제공한다.
import type { Point } from '@core/geometry'
import type { RouteJob } from '@core/ops'

export type RouteWorkerMessage = { type: 'progress'; done: number; total: number } | { type: 'done'; routes: Record<string, Point[]> }

export class RouteCancelled extends Error {}

export interface RouteRun {
  /** 전선 id → 경로. 취소하면 RouteCancelled로 실패한다 */
  result: Promise<Record<string, Point[]>>
  cancel: () => void
}

export function runRouteJob(job: RouteJob, onProgress: (done: number, total: number) => void): RouteRun {
  const worker = new Worker(new URL('./route.worker.ts', import.meta.url), { type: 'module' })
  let settle: { resolve: (r: Record<string, Point[]>) => void; reject: (e: Error) => void } | undefined
  const result = new Promise<Record<string, Point[]>>((resolve, reject) => (settle = { resolve, reject }))
  const finish = () => {
    worker.terminate()
    settle = undefined
  }
  worker.onmessage = (e: MessageEvent<RouteWorkerMessage>) => {
    if (e.data.type === 'progress') onProgress(e.data.done, e.data.total)
    else {
      settle?.resolve(e.data.routes)
      finish()
    }
  }
  worker.onerror = (e) => {
    settle?.reject(new Error(e.message))
    finish()
  }
  worker.postMessage(job)
  return {
    result,
    cancel: () => {
      settle?.reject(new RouteCancelled())
      finish()
    }
  }
}
