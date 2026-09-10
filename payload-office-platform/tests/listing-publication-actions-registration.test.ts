import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf8')

/**
 * 动作条是 beforeDocumentControls 服务端组件：注册漏了不会报错，页面只是没有按钮
 * （OPT-053「菜单渲染正常、点进去没有」同类事故）；importMap 漏重生成则 /admin 整站白屏。
 * 两条都是静默失效，所以钉在源码上。
 */
describe('ListingPublicationActions 注册', () => {
  it('Listings.ts 在 beforeDocumentControls 里注册了动作条，且排在 FormModifiedBridge 之前', () => {
    const src = read('src/collections/Listings.ts')
    const block = /beforeDocumentControls:\s*\[([\s\S]*?)\]/.exec(src)?.[1] ?? ''
    const actions = block.indexOf("'/components/admin/ListingPublicationActions'")
    const bridge = block.indexOf("'/components/admin/unsaved-changes/FormModifiedBridge'")
    expect(actions).toBeGreaterThanOrEqual(0)
    expect(bridge).toBeGreaterThan(actions)
  })

  // 钉到完整键名而不是组件名子串：`ListingPublicationActionsClient` /
  // `ListingPublicationActionModal` 里都含「ListingPublicationActions」，
  // 松断言会在服务端组件那一条丢了、只剩客户端子组件时照样绿。
  it('importMap.js 已注册动作条服务端组件的 #default 入口（否则 /admin 白屏）', () => {
    const map = read('src/app/(payload)/admin/importMap.js')
    expect(map).toContain('"/components/admin/ListingPublicationActions#default"')
  })
})
