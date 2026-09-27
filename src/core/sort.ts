// localeCompare에 옵션을 주면 부를 때마다 비교기를 새로 만든다 → 하나를 만들어 다시 쓴다
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })

/** 사람이 기대하는 순서로 비교한다 (U2 < U10, 핀 2 < 핀 10) */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b)
