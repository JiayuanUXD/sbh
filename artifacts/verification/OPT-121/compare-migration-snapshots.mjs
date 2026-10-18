import assert from 'node:assert/strict'
import fs from 'node:fs'

const base = new URL('../../../payload-office-platform/src/migrations/', import.meta.url)
const before = JSON.parse(fs.readFileSync(new URL('20261015_115450_opt_115_building_type_options_expand.json', base), 'utf8'))
const after = JSON.parse(fs.readFileSync(new URL('20261017_160929_opt_121_building_grade_options_expand.json', base), 'utf8'))
const changes = []
function walk(left, right, path) {
  if (JSON.stringify(left) === JSON.stringify(right)) return
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], path ? `${path}.${key}` : key)
  } else changes.push({ path, before: left, after: right })
}
walk(before, after, '')
assert.deepEqual(changes.map(change => change.path).sort(), ['enums.public.enum_buildings_grade.values', 'id'])
fs.writeFileSync(new URL('./migration-snapshot-diff.json', import.meta.url), JSON.stringify(changes, null, 2) + '\n')
console.log(JSON.stringify(changes, null, 2))
