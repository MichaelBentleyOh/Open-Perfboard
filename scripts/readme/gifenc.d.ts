// gifenc에는 타입 선언이 없어 쓰는 부분만 적는다
declare module 'gifenc' {
  export type Palette = number[][]
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number }): void
    finish(): void
    bytes(): Uint8Array
  }
}
