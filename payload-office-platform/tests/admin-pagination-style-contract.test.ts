import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const customStyles = readFileSync(
  resolve(process.cwd(), 'src', 'app', '(payload)', 'custom.scss'),
  'utf8',
)

describe('admin pagination menu style contract', () => {
  it('restores spacing removed by the PerPage button reset', () => {
    expect(customStyles).toMatch(
      /\.popup__content\s+\.popup-button-list__button\.per-page__button\s*\{[^}]*padding-block:\s*calc\(2px \+ var\(--popup-button-list-gap\) \/ 2\);[^}]*padding-inline:\s*var\(--list-button-padding\);[^}]*line-height:\s*var\(--base\);/s,
    )
  })
})
