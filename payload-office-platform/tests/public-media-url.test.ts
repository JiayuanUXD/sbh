import { describe, expect, it } from 'vitest'
import { normalizePublicMediaUrl } from '@/domain/public-catalog'

describe('normalizePublicMediaUrl', () => {
  it('允许同源单斜杠绝对路径与 http/https URL', () => {
    expect(normalizePublicMediaUrl('/media/office.jpg')).toBe('/media/office.jpg')
    expect(normalizePublicMediaUrl('https://cdn.example.com/office.jpg')).toBe('https://cdn.example.com/office.jpg')
    expect(normalizePublicMediaUrl('http://cdn.example.com/office.jpg')).toBe('http://cdn.example.com/office.jpg')
  })

  it.each([
    '//cdn.example.com/office.jpg',
    'https://user:pass@cdn.example.com/office.jpg',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,xxx',
    'file:///tmp/office.jpg',
    '/\\evil.example.com/office.jpg',
    'not a URL',
  ])('拒绝不安全或格式错误的媒体 URL：%s', (url) => {
    expect(normalizePublicMediaUrl(url)).toBeNull()
  })
})
