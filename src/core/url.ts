/** http:// 또는 https:// 주소인지. 앞뒤 공백은 허용하지 않는다 */
export function isHttpUrl(s: string): boolean {
  if (s !== s.trim() || !/^https?:\/\//i.test(s)) return false
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0
  } catch {
    return false
  }
}

/** 표에 짧게 보여 줄 도메인 (www. 제외). 주소가 아니면 원문 */
export function shortUrl(s: string): string {
  try {
    return new URL(s).hostname.replace(/^www\./, '')
  } catch {
    return s
  }
}
