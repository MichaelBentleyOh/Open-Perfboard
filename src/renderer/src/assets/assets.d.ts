// Vite가 그림 파일 import를 주소(작으면 data URL) 문자열로 바꾼다
declare module '*.svg' {
  const url: string
  export default url
}
