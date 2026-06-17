import { useState, useEffect, useRef } from 'react'
import { fmtInt, fmtDecimal } from '../../lib/format'

interface NumInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string | number
  onChange: (raw: string) => void  // raw 숫자 string (쉼표 없음) emit
  decimal?: boolean
}

export function NumInput({ value, onChange, decimal = false, onBlur, ...rest }: NumInputProps) {
  const fmt = decimal ? fmtDecimal : fmtInt
  const rawStr = value == null ? '' : String(value)

  const [display, setDisplay] = useState(() => fmt(rawStr))
  const prevRaw = useRef(rawStr)

  useEffect(() => {
    if (prevRaw.current !== rawStr) {
      prevRaw.current = rawStr
      if (display.replace(/,/g, '') !== rawStr) {
        setDisplay(rawStr === '' || rawStr === '0' ? '' : fmt(rawStr))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawStr])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target.value
    const raw = input.replace(/,/g, '')

    if (decimal) {
      if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return
    } else {
      if (raw !== '' && !/^\d*$/.test(raw)) return
    }

    // 소수점 입력 중 trailing dot 보존
    if (decimal && raw.endsWith('.')) {
      const intPart = raw.slice(0, -1)
      const n = parseInt(intPart, 10)
      setDisplay((intPart === '' || isNaN(n) ? '' : n.toLocaleString('ko-KR')) + '.')
    } else {
      setDisplay(raw === '' ? '' : fmt(raw))
    }

    onChange(raw)
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={display}
      onChange={handleChange}
      onBlur={e => {
        if (display.endsWith('.')) setDisplay(display.slice(0, -1))
        onBlur?.(e)
      }}
    />
  )
}
