import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { mergeFieldAriaDescribedBy } from '@/components/frontend/ui/Field'
import { Field, Input } from '@/components/frontend/ui'

describe('mergeFieldAriaDescribedBy', () => {
  it('preserves a child description while adding field hint and error descriptions once', () => {
    expect(mergeFieldAriaDescribedBy('entrust-policy-note', 'entrust-phone-hint', 'entrust-phone-error'))
      .toBe('entrust-policy-note entrust-phone-hint entrust-phone-error')
  })

  it('splits whitespace-delimited child IDs and removes every duplicate ID', () => {
    expect(mergeFieldAriaDescribedBy(' child-note  child-note ', 'field-hint', 'field-hint field-error'))
      .toBe('child-note field-hint field-error')
  })

  it('renders the child, hint, and error descriptions onto the cloned control', () => {
    const markup = renderToStaticMarkup(Field({
      label: '手机号',
      id: 'contact-phone',
      hint: '格式提示',
      error: '格式错误',
      children: React.createElement(Input, { 'aria-describedby': 'privacy-note' }),
    }))

    expect(markup).toContain('aria-describedby="privacy-note contact-phone-hint contact-phone-error"')
    expect(markup).toContain('id="contact-phone-hint"')
    expect(markup).toContain('id="contact-phone-error"')
  })
})
