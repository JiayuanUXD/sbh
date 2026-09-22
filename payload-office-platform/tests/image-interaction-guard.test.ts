// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ImageInteractionGuard } from '@/components/frontend/ImageInteractionGuard'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | null = null

async function mountGuard() {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(React.createElement(ImageInteractionGuard)))
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('ImageInteractionGuard', () => {
  it('拦截图片右键菜单，但保留页面其他区域的右键菜单', async () => {
    await mountGuard()
    const image = document.createElement('img')
    const text = document.createElement('div')
    document.body.append(image, text)

    const imageMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    const textMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    image.dispatchEvent(imageMenu)
    text.dispatchEvent(textMenu)

    expect(imageMenu.defaultPrevented).toBe(true)
    expect(textMenu.defaultPrevented).toBe(false)
  })

  it('阻止图片拖出页面，但不拦截其他元素的拖拽', async () => {
    await mountGuard()
    const image = document.createElement('img')
    const text = document.createElement('div')
    document.body.append(image, text)

    const imageDrag = new Event('dragstart', { bubbles: true, cancelable: true })
    const textDrag = new Event('dragstart', { bubbles: true, cancelable: true })
    image.dispatchEvent(imageDrag)
    text.dispatchEvent(textDrag)

    expect(imageDrag.defaultPrevented).toBe(true)
    expect(textDrag.defaultPrevented).toBe(false)
  })
})
