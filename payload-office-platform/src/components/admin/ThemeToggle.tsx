'use client'

import { useEffect } from 'react'
import { useTheme } from '@payloadcms/ui'
import { IconMoonFill, IconSunFill } from '@arco-design/web-react/icon'

export default function ThemeToggle() {
  const { setTheme, theme } = useTheme()
  const isDark = theme === 'dark'
  const nextTheme = isDark ? 'light' : 'dark'
  const label = isDark ? '切换到浅色模式' : '切换到深色模式'

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (isDark) {
        document.body.setAttribute('arco-theme', 'dark')
        document.documentElement.setAttribute('arco-theme', 'dark')
      } else {
        document.body.removeAttribute('arco-theme')
        document.documentElement.removeAttribute('arco-theme')
      }
    }
  }, [isDark])

  return (
    <button
      aria-label={label}
      className="arco-admin-theme-toggle"
      onClick={() => setTheme(nextTheme)}
      title={label}
      type="button"
    >
      {isDark ? <IconSunFill aria-hidden /> : <IconMoonFill aria-hidden />}
      <span>{isDark ? '浅色' : '深色'}</span>
    </button>
  )
}
