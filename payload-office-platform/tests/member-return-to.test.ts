import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '@/domain/member/return-to'

describe('safeReturnTo', () => {
  it('只接受站内路径', () => {
    expect(safeReturnTo('/listings?type=coworking')).toBe('/listings?type=coworking')
    expect(safeReturnTo('//evil.example')).toBe('/account')
    expect(safeReturnTo('/\\evil')).toBe('/account')
    expect(safeReturnTo('/\\/evil.example')).toBe('/account')
    expect(safeReturnTo('/\t/evil.com')).toBe('/account')
    expect(safeReturnTo('/\r/evil.com')).toBe('/account')
    expect(safeReturnTo('/\n/evil.com')).toBe('/account')
    expect(safeReturnTo('/account/\t/evil.com')).toBe('/account')
    expect(safeReturnTo('https://evil.example')).toBe('/account')
    expect(safeReturnTo('javascript:alert(1)')).toBe('/account')
    expect(safeReturnTo(undefined)).toBe('/account')
    expect(safeReturnTo('/x', '/')).toBe('/x')
    expect(safeReturnTo(null, '/')).toBe('/')
  })
})
