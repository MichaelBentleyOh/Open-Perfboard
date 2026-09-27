import { useEffect, useState } from 'react'

type Props = {
  value: string
  /** false를 돌려주면 거부로 보고 입력 전 값으로 되돌린다 */
  onCommit: (v: string) => void | boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>

/**
 * 입력이 끝났을 때(포커스 이탈, Enter)만 값을 반영한다 → 글자마다 실행 취소 이력이 쌓이지 않는다.
 * Esc는 입력 전 값으로 되돌린다. onCommit이 false를 돌려주면(잘못된 값) 역시 되돌린다.
 */
export function CommitInput({ value, onCommit, ...rest }: Props) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    if (text !== value && onCommit(text) === false) setText(value)
  }
  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(value)
      }}
    />
  )
}
