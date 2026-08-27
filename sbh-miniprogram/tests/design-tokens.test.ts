import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const miniprogramRoot = resolve(projectRoot, 'miniprogram')
const componentNames = ['sbh-button', 'sbh-card', 'sbh-skeleton', 'sbh-state'] as const

function read(relativePath: string): string {
  return readFileSync(resolve(miniprogramRoot, relativePath), 'utf8')
}

function section(source: string, name: string): string {
  const match = source.match(
    new RegExp(`/\\* === ${name} === \\*/([\\s\\S]*?)(?=/\\* === |$)`),
  )

  if (!match?.[1]) {
    throw new Error(`缺少 ${name} token 分层`)
  }

  return match[1]
}

function declarations(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/(--sbh-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1] ?? '',
      match[2]?.trim() ?? '',
    ]),
  )
}

function references(source: string): string[] {
  return [...source.matchAll(/var\((--sbh-[a-z0-9-]+)\)/g)].map((match) => match[1] ?? '')
}

describe('三层设计 token', () => {
  const source = read('styles/tokens.wxss')
  const primitives = declarations(section(source, 'PRIMITIVE'))
  const semantics = declarations(section(source, 'SEMANTIC'))
  const components = declarations(section(source, 'COMPONENT'))
  const allTokens = new Map([...primitives, ...semantics, ...components])

  it('primitive 只保存无业务语义的原始刻度与设计色值', () => {
    const expected = new Map([
      ['--sbh-color-gray-50', '#f2f2f4'],
      ['--sbh-color-white', '#fff'],
      ['--sbh-color-gray-950', '#1d1d1f'],
      ['--sbh-color-gray-700', '#6e6e73'],
      ['--sbh-color-gray-600', '#86868b'],
      ['--sbh-color-gray-200', '#e5e5e7'],
      ['--sbh-color-blue-600', '#0071e3'],
      ['--sbh-space-10', '20rpx'],
      ['--sbh-space-12', '24rpx'],
      ['--sbh-space-14', '28rpx'],
      ['--sbh-radius-3', '6rpx'],
      ['--sbh-radius-6', '12rpx'],
      ['--sbh-radius-8', '16rpx'],
      ['--sbh-size-44', '88rpx'],
    ])

    for (const [token, value] of expected) {
      expect(primitives.get(token), token).toBe(value)
    }

    const primitiveName = /^--sbh-(?:color-(?:white|transparent|gray-\d+|blue-\d+)|space-\d+|radius-\d+|size-\d+|border-width-\d+|font-size-\d+|font-weight-\d+|line-height-\d+|opacity-\d+|duration-\d+|scale-\d+)$/
    expect([...primitives.keys()].every((name) => primitiveName.test(name))).toBe(true)
    expect([...primitives.values()].every((value) => references(value).length === 0)).toBe(true)
  })

  it('严格锁定完成稿字号，并补齐后续页面所需刻度', () => {
    expect(primitives.get('--sbh-font-size-10')).toBe('20rpx')
    expect(primitives.get('--sbh-font-size-11')).toBe('22rpx')
    expect(primitives.get('--sbh-font-size-12')).toBe('24rpx')
    expect(primitives.get('--sbh-font-size-13')).toBe('26rpx')
    expect(primitives.get('--sbh-font-size-15')).toBe('30rpx')
    expect(primitives.get('--sbh-font-size-17')).toBe('34rpx')
    expect(primitives.get('--sbh-font-size-19')).toBe('38rpx')
    expect(primitives.get('--sbh-font-size-23')).toBe('46rpx')
    expect(primitives.get('--sbh-font-size-26')).toBe('52rpx')
    expect(semantics.get('--sbh-type-tag-size')).toBe('var(--sbh-font-size-10)')
    expect(semantics.get('--sbh-type-auxiliary-size')).toBe('var(--sbh-font-size-12)')
    expect(semantics.get('--sbh-type-metadata-size')).toBe('var(--sbh-font-size-13)')
    expect(semantics.get('--sbh-type-body-size')).toBe('var(--sbh-font-size-13)')
    expect(semantics.get('--sbh-type-card-title-size')).toBe('var(--sbh-font-size-17)')
    expect(semantics.get('--sbh-type-hero-size')).toBe('var(--sbh-font-size-23)')
    expect(components.get('--sbh-button-status-suffix-font-size')).toBe('var(--sbh-type-auxiliary-size)')
    expect(components.get('--sbh-state-marker-font-size')).toBe('var(--sbh-type-metadata-size)')
    expect(read('pages/foundation/index.wxss')).toMatch(/\.foundation-retry-feedback\s*\{[\s\S]*?font-size:\s*var\(--sbh-type-metadata-size\);/)
  })

  it('semantic 只能引用 primitive，component 只能引用 semantic', () => {
    for (const value of semantics.values()) {
      const refs = references(value)
      expect(refs).toHaveLength(1)
      expect(primitives.has(refs[0] ?? '')).toBe(true)
    }

    for (const value of components.values()) {
      const refs = references(value)
      expect(refs).toHaveLength(1)
      expect(semantics.has(refs[0] ?? '')).toBe(true)
    }
  })

  it('每个 var 引用都有声明，组件 WXSS 不能绕过自己的 component token', () => {
    const stylePaths = [
      'app.wxss',
      'pages/foundation/index.wxss',
      ...componentNames.map((name) => `components/${name}/index.wxss`),
    ]

    for (const path of stylePaths) {
      for (const reference of references(read(path))) {
        expect(allTokens.has(reference), `${path} 引用了未声明的 ${reference}`).toBe(true)
      }
    }

    for (const name of componentNames) {
      const componentStyle = read(`components/${name}/index.wxss`)
      expect(componentStyle).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(componentStyle).not.toMatch(/(?:padding|margin|height|min-height|max-height|width|min-width|max-width|border-width|border-radius|font-size|line-height)\s*:[^;]*(?:\b0\b|\d+(?:rpx|px|rem|em)\b)/)
      for (const reference of references(componentStyle)) {
        const prefix = `--sbh-${name.replace('sbh-', '')}-`
        expect(reference.startsWith(prefix), `${name} 绕过 component token: ${reference}`).toBe(true)
        expect(components.has(reference), `${name} 引用了未声明的 component token: ${reference}`).toBe(true)
      }
    }
  })

  it('四个组件的字号、间距、边框和尺寸均有 component token', () => {
    const requiredTokens = [
      '--sbh-button-min-height',
      '--sbh-button-padding-x',
      '--sbh-button-padding-y',
      '--sbh-button-border-width',
      '--sbh-button-radius',
      '--sbh-button-font-size',
      '--sbh-button-status-font-size',
      '--sbh-button-pressed-scale',
      '--sbh-button-pressed-duration',
      '--sbh-card-radius',
      '--sbh-card-padding',
      '--sbh-card-font-size',
      '--sbh-skeleton-radius',
      '--sbh-skeleton-media-height',
      '--sbh-skeleton-row-height',
      '--sbh-skeleton-row-gap',
      '--sbh-skeleton-duration',
      '--sbh-state-padding-y',
      '--sbh-state-padding-x',
      '--sbh-state-title-font-size',
      '--sbh-state-description-font-size',
      '--sbh-state-action-min-height',
      '--sbh-state-action-padding-x',
      '--sbh-state-action-border-width',
      '--sbh-state-action-background',
      '--sbh-state-action-pressed-background',
      '--sbh-state-action-pressed-scale',
      '--sbh-state-action-pressed-duration',
    ]

    for (const token of requiredTokens) {
      expect(components.has(token), `缺少 ${token}`).toBe(true)
    }
  })

  it('按钮声明受控 hover，骨架仅使用 opacity 动画', () => {
    const buttonMarkup = read('components/sbh-button/index.wxml')
    const buttonStyle = read('components/sbh-button/index.wxss')
    const skeletonStyle = read('components/sbh-skeleton/index.wxss')

    expect(buttonMarkup).toContain("hover-class=\"{{disabled || loading ? 'none' : 'sbh-button--pressed'}}\"")
    expect(buttonMarkup).toContain('hover-stay-time="70"')
    expect(buttonMarkup).toContain('aria-role="button"')
    expect(buttonMarkup).not.toMatch(/\srole=/)
    expect(buttonStyle).toContain('transform: scale(var(--sbh-button-pressed-scale));')
    expect(buttonStyle).toMatch(/\.sbh-button--primary\.sbh-button--pressed\s*\{[\s\S]*?background:\s*var\(--sbh-button-primary-pressed-background\);/)
    expect(skeletonStyle).toMatch(/@keyframes\s+sbh-skeleton-pulse/)
    expect(skeletonStyle).toMatch(/opacity:/)
    expect(skeletonStyle).not.toMatch(/rotate|transform/i)
  })

  it('重试操作声明受控 hover，并完全通过 state component token 表达 pressed', () => {
    const stateMarkup = read('components/sbh-state/index.wxml')
    const stateStyle = read('components/sbh-state/index.wxss')

    expect(stateMarkup).toContain('hover-class="sbh-state__action--pressed"')
    expect(stateMarkup).toContain('hover-stay-time="70"')
    expect(stateStyle).toMatch(/\.sbh-state__action\s*\{[\s\S]*?transition:\s*background var\(--sbh-state-action-pressed-duration\) ease, transform var\(--sbh-state-action-pressed-duration\) ease;/)
    expect(stateStyle).toMatch(/\.sbh-state__action--pressed\s*\{[\s\S]*?background:\s*var\(--sbh-state-action-pressed-background\);[\s\S]*?transform:\s*scale\(var\(--sbh-state-action-pressed-scale\)\);/)
  })

  it('Foundation 使用普通包装类，完整展示状态并绑定可见重试反馈', () => {
    const appStyle = read('app.wxss')
    const pageJson = JSON.parse(read('pages/foundation/index.json')) as {
      usingComponents?: Record<string, string>
    }
    const pageMarkup = read('pages/foundation/index.wxml')
    const pageStyle = read('pages/foundation/index.wxss')
    const pageScript = read('pages/foundation/index.ts')
    const stateMarkup = read('components/sbh-state/index.wxml')

    expect(appStyle).toContain('@import "./styles/tokens.wxss";')
    expect(pageMarkup).toContain('id="foundation-ready"')
    expect(pageMarkup).toContain('<sbh-button variant="secondary">次要操作</sbh-button>')
    expect(pageMarkup).toContain('<sbh-button loading>提交中</sbh-button>')
    expect(pageMarkup).toContain('<sbh-button disabled>暂不可用</sbh-button>')
    expect(pageMarkup).toContain('<sbh-skeleton rows="5"')
    expect(pageMarkup).toContain('kind="loading"')
    expect(pageMarkup).toContain('kind="empty"')
    expect(pageMarkup).toContain('kind="error"')
    expect(pageMarkup).toContain('bindretry="handleRetry"')
    expect(pageMarkup).toContain('{{retryCount}}')
    expect(pageMarkup).toContain('{{retryStatus}}')
    expect(pageScript).toContain('handleRetry()')
    expect(pageStyle).not.toMatch(/(^|,|\n)\s*sbh-[a-z-]+/)
    expect(pageStyle).not.toMatch(/\.foundation-[a-z-]+\s+[.#a-z]/)
    expect(pageStyle).toContain('.foundation-card')
    expect(pageStyle).toContain('.foundation-button')
    expect(stateMarkup).toContain('aria-role="button"')
    expect(stateMarkup).toContain('aria-label="{{actionLabel}}"')
    expect(stateMarkup).not.toMatch(/\srole=/)
    expect(pageJson.usingComponents).toEqual({
      'sbh-button': '/components/sbh-button/index',
      'sbh-card': '/components/sbh-card/index',
      'sbh-skeleton': '/components/sbh-skeleton/index',
      'sbh-state': '/components/sbh-state/index',
    })
  })
})
