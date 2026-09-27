// 배선 정리 작업자 (Web Worker). 화면이 멈추지 않도록 경로 찾기를 따로 돌린다.
import { routeAll } from '@core/route'
import type { RouteJob } from '@core/ops'
import type { RouteWorkerMessage } from './routeService'

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<RouteJob>) => void) | null
  postMessage: (m: RouteWorkerMessage) => void
}

/** 진행률은 이 간격(ms)보다 자주 보내지 않는다 */
const PROGRESS_INTERVAL = 100

ctx.onmessage = (e) => {
  const { requests, obstacles, fixed, avoid } = e.data
  let last = 0
  const routes = routeAll(requests, obstacles, fixed, avoid, {}, (done, total) => {
    const now = performance.now()
    if (now - last < PROGRESS_INTERVAL) return
    last = now
    ctx.postMessage({ type: 'progress', done, total })
  })
  ctx.postMessage({ type: 'done', routes })
}
