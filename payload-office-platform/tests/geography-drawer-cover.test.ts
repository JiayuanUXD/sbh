import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(
  'src/components/admin/geography/GeographyListViewClient.tsx',
  'utf8',
)

const LIST_VIEW_SRC = readFileSync(
  'src/components/admin/geography/GeographyListView.tsx',
  'utf8',
)

describe('商圈抽屉的封面字段（OPT-062）', () => {
  it('封面区块按模块能力标记渲染，不是 type 硬编码', () => {
    expect(SRC).toContain('supportsCover')
    // 硬编码 type 会让「哪些模块有封面」散落两处（终审 F：三种引号都要拦，
    // 不能只拦单引号字面量——换成模板串就绕过了）
    expect(SRC).not.toMatch(/===\s*['"`]business_area['"`]/)
  })

  it('保存时 PATCH body 带 coverImage', () => {
    expect(SRC).toMatch(/coverImage:/)
  })

  it('乐观锁 version 仍在 PATCH body 里（加字段不能把它挤掉）', () => {
    expect(SRC).toContain('version: detail.version')
  })

  it('用的是 CoverPickerModal，没有在抽屉里另写一套上传', () => {
    expect(SRC).toContain('CoverPickerModal')
    // 上传逻辑应当只在弹层里有一份（终审 F：同时拦单引号/双引号/反引号字面量）
    expect(SRC).not.toMatch(/['"`]\/api\/media['"`]/)
  })

  it('ClientModule 白名单显式收录 supportsCover（否则永远是 undefined）', () => {
    expect(SRC).toMatch(/type ClientModule = \{[\s\S]*?supportsCover\?:\s*boolean[\s\S]*?\}/)
  })

  it('服务端组装传给客户端的 module 时把 supportsCover 带上（本计划头号接缝）', () => {
    // 这一跳没有它，geoModule.supportsCover 就到不了客户端组件，
    // 封面区块会因为 module.supportsCover 恒 undefined 而永远不渲染，
    // 且 Task 2 / Task 4 的单测各自都是绿的（两头都测了，唯独这一跳没人测）。
    expect(LIST_VIEW_SRC).toMatch(/supportsCover:\s*geoModule\.supportsCover/)
  })
})
