# 小程序首页搜索控件视觉修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复首页搜索按钮中放大镜圆环与手柄断裂的问题，并把搜索条改为完整胶囊、提交按钮改为正圆，同时保持现有搜索行为、可访问性和触控尺寸不变。

**Architecture:** 继续使用现有 WXML 中的三层 CSS 图形结构，不引入图片、字体图标或新组件。通过首页合同测试固定胶囊圆角和 32rpx 坐标系内的放大镜几何，再重跑 MP-109 双视口开发者工具证据，保证视觉修复没有破坏现有抽屉交互。

**Tech Stack:** 原生微信小程序 WXML/WXSS、TypeScript、Vitest、miniprogram-automator、微信开发者工具 CLI、Node.js 22、pnpm。

## Global Constraints

- 仅修改首页搜索控件的视觉样式，不修改搜索文案、导航、API、DTO、列表页搜索或抽屉业务逻辑。
- 使用测试驱动流程：先写会失败的合同测试，确认 RED 后再修改 WXSS，最后确认 GREEN。
- 不手改 MP-109 JSON 或截图；必须由验收 runner 重新生成。桌面开发者工具无法证明软键盘避让时，保留 `inquiryKeyboard` 未通过和聚合 `incomplete`，不得制造全绿。
- 不部署、不上传体验版、不提审、不合并 `master`、不执行数据库写入或迁移。
- 只用显式路径暂存；不得提交 `.planning/` 或用户无关文件。

---

### Task 1: 修复并验证首页搜索控件

**Files:**
- Modify: `sbh-miniprogram/tests/home-page-contract.test.ts`
- Modify: `sbh-miniprogram/miniprogram/pages/home/index.wxss`
- Regenerate: `artifacts/verification/MP-109/sheet-acceptance-small.json`
- Regenerate: `artifacts/verification/MP-109/sheet-acceptance-large.json`
- Regenerate: `artifacts/verification/MP-109/sheet-acceptance-report.json`
- Regenerate: `artifacts/verification/MP-109/sheet-screenshots/small/*.png`
- Regenerate: `artifacts/verification/MP-109/sheet-screenshots/large/*.png`
- Modify: `artifacts/verification/MP-109/README.md`
- Modify: `specs/work-items/MP-109-miniprogram-closure-and-sheet-plan.md`

**Interfaces:** 无运行时接口或数据契约变化；只新增静态 WXSS 合同。

- [ ] **Step 1: 新增会失败的首页搜索视觉合同**

先在 `readPageFile` 后新增只读取单个 CSS 规则块的辅助函数：

```ts
function readStyleRule(styles: string, className: string): string {
  return new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? ''
}
```

再在“单城市阶段”测试之后新增：

```ts
  it('搜索条为胶囊、提交按钮为正圆，CSS 放大镜在统一坐标系中连续', () => {
    const styles = readPageFile('index.wxss')
    const search = readStyleRule(styles, 'home-search')
    const submit = readStyleRule(styles, 'home-search__submit')
    const iconWrap = readStyleRule(styles, 'home-search__icon-wrap')
    const iconCircle = readStyleRule(styles, 'home-search__icon-circle')
    const iconHandle = readStyleRule(styles, 'home-search__icon-handle')

    expect(search).toMatch(/border-radius:\s*999rpx;/)
    expect(submit).toMatch(/width:\s*80rpx;/)
    expect(submit).toMatch(/height:\s*80rpx;/)
    expect(submit).toMatch(/border-radius:\s*999rpx;/)
    expect(iconWrap).toMatch(/position:\s*relative;/)
    expect(iconWrap).toMatch(/width:\s*32rpx;/)
    expect(iconWrap).toMatch(/height:\s*32rpx;/)
    expect(iconCircle).toMatch(/box-sizing:\s*border-box;/)
    expect(iconCircle).toMatch(/position:\s*absolute;/)
    expect(iconCircle).toMatch(/left:\s*2rpx;/)
    expect(iconCircle).toMatch(/top:\s*2rpx;/)
    expect(iconCircle).toMatch(/width:\s*22rpx;/)
    expect(iconCircle).toMatch(/height:\s*22rpx;/)
    expect(iconCircle).toMatch(/border:\s*4rpx solid #ffffff;/)
    expect(iconHandle).toMatch(/left:\s*20rpx;/)
    expect(iconHandle).toMatch(/top:\s*18rpx;/)
    expect(iconHandle).toMatch(/width:\s*12rpx;/)
    expect(iconHandle).toMatch(/height:\s*4rpx;/)
    expect(iconHandle).toMatch(/transform:\s*rotate\(45deg\);/)
    expect(iconHandle).toMatch(/transform-origin:\s*left center;/)
    expect(iconHandle).not.toMatch(/(?:right|bottom):\s*0;/)
  })
```

- [ ] **Step 2: 运行聚焦测试并确认 RED**

在 `sbh-miniprogram/` 执行：

```sh
npx --yes --package=node@22 -c 'pnpm exec vitest run tests/home-page-contract.test.ts'
```

预期：新测试因搜索条、按钮仍使用 `12rpx` 圆角，圆环缺少绝对定位且手柄仍使用 `right/bottom` 而失败；其他既有合同保持通过。

- [ ] **Step 3: 用最小 WXSS 修改实现批准的 A 方案**

在 `sbh-miniprogram/miniprogram/pages/home/index.wxss` 修改以下声明：

```css
.home-search {
  /* 保留其余声明 */
  border-radius: 999rpx;
}

.home-search__submit {
  /* 保留其余声明 */
  border-radius: 999rpx;
}

.home-search__icon-circle {
  box-sizing: border-box;
  position: absolute;
  left: 2rpx;
  top: 2rpx;
  width: 22rpx;
  height: 22rpx;
  border: 4rpx solid #ffffff;
  border-radius: 50%;
}

.home-search__icon-handle {
  position: absolute;
  left: 20rpx;
  top: 18rpx;
  width: 12rpx;
  height: 4rpx;
  background: #ffffff;
  border-radius: 2rpx;
  transform: rotate(45deg);
  transform-origin: left center;
}
```

这组坐标让手柄旋转原点落在 `(20, 20)`，距圆心 `(13, 13)` 约 `9.90rpx`，与外半径 `11rpx` 的圆环右下边缘重叠；旋转后的最远端仍位于 32rpx 包裹框内，避免设备像素取整后出现断裂或裁切。原计划的 `top: 22rpx` 在 375/430 两档实测仍有间隙，故按真实视觉证据修正；合同转绿后仍必须检查两档截图。

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

```sh
npx --yes --package=node@22 -c 'pnpm exec vitest run tests/home-page-contract.test.ts'
```

预期：首页页面合同全部通过。

- [ ] **Step 5: 运行小程序完整静态验证**

```sh
npx --yes --package=node@22 -c 'pnpm test && pnpm typecheck && pnpm project:check'
```

预期：测试、类型检查和项目检查全部以 0 退出。

- [ ] **Step 6: 重生成 MP-109 双视口证据**

依次执行：

```sh
MP109_VIEWPORT_PROFILE=small WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npx --yes --package=node@22 -c 'node scripts/mp109-sheet-acceptance-runner.mjs'
MP109_VIEWPORT_PROFILE=large WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npx --yes --package=node@22 -c 'node scripts/mp109-sheet-acceptance-runner.mjs'
```

预期：runner 因桌面软键盘无法审计而非零退出，但 small/large 各保持 9/10，仅 `inquiryKeyboard` 失败；两档报告具有同一个新源码指纹，聚合状态为 `incomplete`。检查两档 `home-inquiry-open.png`，确认背景中的搜索条为胶囊、蓝色按钮为正圆、白色放大镜无断裂。

- [ ] **Step 7: 同步证据索引中的新指纹**

从 `artifacts/verification/MP-109/sheet-acceptance-report.json` 读取新指纹，将 `artifacts/verification/MP-109/README.md` 与 `specs/work-items/MP-109-miniprogram-closure-and-sheet-plan.md` 中的旧指纹替换为该值；保留 9/10、键盘未通过、聚合 `incomplete` 和环境边界原文，除非 runner 的真实结果发生变化。

- [ ] **Step 8: 最终回归、差异审查、提交并推送功能分支**

重新执行：

```sh
npx --yes --package=node@22 -c 'pnpm test && pnpm typecheck && pnpm project:check'
git status --short --branch
git diff --check
git diff -- sbh-miniprogram/tests/home-page-contract.test.ts sbh-miniprogram/miniprogram/pages/home/index.wxss artifacts/verification/MP-109 specs/work-items/MP-109-miniprogram-closure-and-sheet-plan.md
```

确认只有计划内文件和未跟踪 `.planning/` 后，显式暂存实现、证据与文档，提交：

```sh
git commit -m "fix(miniprogram): 修复首页搜索图标与圆角"
git push origin feat/miniprogram-mvp-59f9
```

最后确认本地 `HEAD` 与 `origin/feat/miniprogram-mvp-59f9` 一致；不创建 PR、不部署。
