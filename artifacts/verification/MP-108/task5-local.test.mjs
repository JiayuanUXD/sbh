import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertDatabase, assertUpgradeState, assertFreshAbsent } from './task5-local.mjs'

const valid = ['postgres:', '//liujiayuan@127.0.0.1:5432/sbh_dev_mp108_prod'].join('')
for (const [label, value] of [
  ['远端主机', valid.replace('127.0.0.1', 'remote.invalid')],
  ['错误数据库', valid.replace('mp108_prod', 'shared')],
  ['密码', valid.replace('liujiayuan@', 'liujiayuan:secret@')],
  ['查询参数', `${valid}?sslmode=disable`],
]) test(`数据库守卫拒绝${label}`, () => assert.throws(() => assertDatabase(value, 'sbh_dev_mp108_prod')))
test('升级前置拒绝非80条迁移', () => assert.throws(() => assertUpgradeState({ count: 81, last: '20260906_064958_opt_073_featured_district_count', assetTable: null })))
test('升级前置拒绝已存在资产表', () => assert.throws(() => assertUpgradeState({ count: 80, last: '20260906_064958_opt_073_featured_district_count', assetTable: 'mini_user_assets' })))
test('升级前置拒绝错误末项', () => assert.throws(() => assertUpgradeState({ count: 80, last: 'wrong', assetTable: null })))
test('fresh库已存在必须拒绝创建', () => assert.throws(() => assertFreshAbsent(['sbh_dev_mp108_fresh'])))
