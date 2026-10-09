import { describe, expect, it } from 'vitest'

import { markImageFailed } from '../miniprogram/utils/image-failure-state.js'

describe('图片失败身份投影', () => {
  it('只标记当前图片身份，不污染其他图片且不修改旧快照', () => {
    const before = { gallery: true }
    const after = markImageFailed(before, 'listing:office-a')

    expect(after).toEqual({ gallery: true, 'listing:office-a': true })
    expect(before).toEqual({ gallery: true })
  })

  it('拒绝空身份，避免所有图片共用一个错误键', () => {
    expect(markImageFailed({}, '')).toEqual({})
    expect(markImageFailed({}, '   ')).toEqual({})
  })
})
