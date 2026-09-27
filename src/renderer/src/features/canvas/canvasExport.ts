// 캔버스 → PNG. CanvasView가 마운트되면 실제 구현을 등록한다.
type Exporter = () => Promise<string | null>

let exporter: Exporter | null = null

export function registerCanvasExporter(fn: Exporter | null): void {
  exporter = fn
}

/** 배선도 전체를 PNG data URL로. 캔버스가 없거나 비어 있으면 null */
export function exportCanvasPng(): Promise<string | null> {
  return exporter ? exporter() : Promise.resolve(null)
}
