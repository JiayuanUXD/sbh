/**
 * 精选区域级联框「搜索模式挡住前台不可见节点」验收脚本（OPT-093 追加，2026-09-12）。
 *
 * 在真实 Chromium 里用**真实鼠标事件**走一遍（JS `el.click()` 触发不了 Arco 列表项，
 * 见 memory payload-arco-custom-field-traps），每一步的 DOM 读数写进 result.json，
 * 深浅两套主题各截一张搜索面板展开态。脚本不点「保存」，不改库。
 *
 * 用法（dev server 已起、本地库已 migrate 到最新）：
 *   node artifacts/verification/OPT-093/cascade-search/probe.mjs http://localhost:3731
 *
 * 判据（任一不满足即 exit 1）：
 *   1. 搜「徐汇」：不可见行（漕河泾开发区 / 徐家汇#800）复选框 disabled、带 aria-disabled 壳；
 *      可见行（徐家汇#10）复选框可用。
 *   2. 真实点击不可见行的文字 → 无 tag、复选框未勾、「保存」仍 disabled（表单未置脏）。
 *   3. 真实点击不可见行的 li 空白区（绕过 stopPropagation 走到 onChange）→ 同上。
 *   4. 真实点击可见行 → tag 出现、「保存」可点；输入框里的关键词保留（retainInputValueWhileSelect）。
 *   5. 搜「上海」：不可见行政区「浦东新区」不可勾，其下可见商圈「陆家嘴」可勾。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = process.env.APP_DIR ?? path.resolve(HERE, '../../../../payload-office-platform')
const { chromium } = createRequire(pathToFileURL(path.join(APP_DIR, 'package.json')))('@playwright/test')

const ORIGIN = process.argv[2] ?? 'http://localhost:3731'
const OUT = HERE
mkdirSync(OUT, { recursive: true })

const FIXTURE = { email: 'e2e-adm@example.com', password: 'Test1234!' } // scripts/seed.ts 公开夹具
const PROFILE_URL = `${ORIGIN}/admin/collections/city-site-profiles/1`
const ROW = '.arco-cascader-list-search-item'

const result = { origin: ORIGIN, at: new Date().toISOString(), steps: [], failures: [] }
const check = (name, ok, detail) => {
  result.steps.push({ name, ok, detail })
  if (!ok) result.failures.push(name)
  console.log(`${ok ? '✓' : '✗'} ${name}`, detail ?? '')
}

async function login(context) {
  const res = await context.request.post(`${ORIGIN}/api/users/login`, { data: FIXTURE })
  if (!res.ok()) throw new Error(`login ${res.status()}`)
}

async function openField(page) {
  await page.goto(PROFILE_URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '首页内容' }).click()
  const field = page.locator('.location-cascade-field')
  await field.waitFor()
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' })
  await field.scrollIntoViewIfNeeded()
  return field
}

async function typeKeyword(page, field, keyword) {
  await field.locator('.arco-cascader').click()
  const input = field.locator('.arco-cascader input')
  await input.fill('')
  await input.type(keyword)
  await page.locator(ROW).first().waitFor()
  await waitPopupPositioned(page)
  return input
}

const readRows = (page) =>
  page.$$eval(ROW, (lis) =>
    lis.map((li) => ({
      text: li.textContent?.trim() ?? '',
      liAriaDisabled: li.getAttribute('aria-disabled'),
      blockedWrap: !!li.querySelector('.location-cascade-field__search-blocked[aria-disabled="true"]'),
      checkboxDisabled: li.querySelector('input[type="checkbox"]')?.disabled ?? null,
      checked: li.querySelector('input[type="checkbox"]')?.checked ?? null,
    })),
  )

const readForm = (page) =>
  page.evaluate(() => {
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '保存')
    const pop = document.querySelector('.arco-cascader-popup')
    return {
      saveDisabled: save?.disabled ?? null,
      tags: [...document.querySelectorAll('.location-cascade-field .arco-tag')].map((t) => t.textContent?.trim()),
      input: document.querySelector('.location-cascade-field input')?.value ?? null,
      popupOpen: !!pop && getComputedStyle(pop.parentElement).display !== 'none',
      popupTop: pop?.parentElement?.style.top ?? null,
    }
  })

/**
 * 等 Arco Trigger 把弹层定位完并进场结束：没定位时弹层贴在文档 (0,0)；进场动画期间
 * 壳层是 `pointer-events: none`，此时点击会穿透到弹层底下的元素（实测打到了下方
 * 「类型卡片覆盖」里的 react-select 输入框），Cascader 失焦、弹层关闭、关键词被清空——
 * 看起来像「点了不可见行把面板点没了」，其实是探针自己点歪了。
 */
const waitPopupPositioned = (page) =>
  page.waitForFunction(() => {
    const wrap = document.querySelector('.arco-cascader-popup')?.parentElement
    return !!wrap && /px/.test(wrap.style.top ?? '') && wrap.style.pointerEvents === 'auto'
  })

const rowByText = (page, text) => page.locator(ROW, { hasText: text })

async function run(theme) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addCookies([{ name: 'payload-theme', value: theme, url: ORIGIN }])
  await login(context)
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  const field = await openField(page)
  const before = await readForm(page)
  check(`[${theme}] 起点：无 tag、保存 disabled`, before.tags.length === 0 && before.saveDisabled === true, before)

  await typeKeyword(page, field, '徐汇')
  const rows = await readRows(page)
  const hidden = rows.find((r) => r.text.includes('漕河泾开发区'))
  const hidden2 = rows.find((r) => r.text.includes('徐家汇 （前台不可见）'))
  const visible = rows.find((r) => r.text === '上海 / 徐汇 / 徐家汇')
  check(`[${theme}] 搜「徐汇」：不可见行复选框 disabled + aria-disabled 壳`,
    !!hidden && hidden.checkboxDisabled === true && hidden.blockedWrap && !!hidden2 && hidden2.checkboxDisabled === true && hidden2.blockedWrap,
    { hidden, hidden2 })
  check(`[${theme}] 搜「徐汇」：可见行复选框可用`, !!visible && visible.checkboxDisabled === false && !visible.blockedWrap, visible)
  await page.screenshot({ path: path.join(OUT, `search-xuhui-${theme}.png`), fullPage: false })

  // 2. 点不可见行的文字（stopPropagation 路径）
  // force：Playwright 会因 aria-disabled 拒点，而「点了也不生效」正是要验的
  await rowByText(page, '漕河泾开发区').locator('.arco-checkbox-text').click({ force: true })
  await page.waitForTimeout(300)
  let form = await readForm(page)
  let rowsNow = await readRows(page)
  check(`[${theme}] 点不可见行文字：无 tag、未勾、保存仍 disabled`,
    form.tags.length === 0 && form.saveDisabled === true && rowsNow.every((r) => r.checked === false), form)

  // 3. 点不可见行的 li 右侧空白（绕过 stopPropagation，走 Arco onChange → reconcile 兜底）
  const li = rowByText(page, '漕河泾开发区')
  const box = await li.boundingBox()
  await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2)
  await page.waitForTimeout(300)
  form = await readForm(page)
  rowsNow = await readRows(page)
  check(`[${theme}] 点不可见行 li 空白：无 tag、未勾、保存仍 disabled`,
    form.tags.length === 0 && form.saveDisabled === true && rowsNow.every((r) => r.checked === false), form)

  // 4. 点可见行
  await rowByText(page, '上海 / 徐汇 / 徐家汇').first().locator('.arco-checkbox-text').click()
  await page.waitForTimeout(300)
  form = await readForm(page)
  check(`[${theme}] 点可见行：tag 出现、保存可点、关键词保留`,
    form.tags.length === 1 && form.tags[0] === '上海 / 徐汇 / 徐家汇' && form.saveDisabled === false && form.input === '徐汇', form)

  // 5. 搜「上海」：不可见行政区 vs 其下可见商圈
  await page.keyboard.press('Escape')
  await page.reload({ waitUntil: 'networkidle' })
  const field2 = await openField(page)
  await typeKeyword(page, field2, '上海')
  const rows2 = await readRows(page)
  const pudong = rows2.find((r) => r.text === '上海 / 浦东新区 （前台不可见）')
  const lujiazui = rows2.find((r) => r.text.endsWith('/ 陆家嘴'))
  check(`[${theme}] 搜「上海」：浦东新区不可勾、其下陆家嘴可勾`,
    !!pudong && pudong.checkboxDisabled === true && !!lujiazui && lujiazui.checkboxDisabled === false, { pudong, lujiazui })

  check(`[${theme}] 无新增控制台错误（媒体 500 为本地无 COS 既有现象，已排除）`,
    errors.filter((e) => !/media\/file|500 \(Internal Server Error\)/.test(e)).length === 0, errors)

  await browser.close()
}

for (const theme of (process.env.THEMES ?? 'dark,light').split(',')) await run(theme)
writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2))
console.log(result.failures.length ? `FAILED: ${result.failures.join('; ')}` : 'ALL PASS')
process.exit(result.failures.length ? 1 : 0)
