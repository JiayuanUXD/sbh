import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('地理自定义 Admin View 框架合同', () => {
  it('共享模板使用 Payload 官方 DefaultTemplate', () => {
    const template = source('src/components/admin/geography/GeographyAdminTemplate.tsx')
    expect(template).toContain("from '@payloadcms/next/templates'")
    expect(template).toContain('<DefaultTemplate')
  })

  it.each([
    'GeographyListView.tsx',
    'GeographyCityDetail.tsx',
    'GeographyCreateView.tsx',
  ])('%s 使用共享后台模板', (file) => {
    const view = source(`src/components/admin/geography/${file}`)
    expect(view).toContain('GeographyAdminTemplate')
  })
})
