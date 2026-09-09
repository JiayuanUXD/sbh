# C 端全站横向滚动缺陷 —— 修复与验证

分支 `fix/root-scroll-clip-2b40`。缺陷是既有问题，非某次改动引入。

## 证据怎么来的（本报告不自证）

本目录所有数字来自 `payload-office-platform/scripts/verify-horizontal-bleed-overflow.mjs`，
原始输出为同目录 `probe.output.json`。复跑：

```bash
pnpm dev                                               # 另开终端
node scripts/verify-horizontal-bleed-overflow.mjs      # 退出码 0 = 全部通过
```

**探针必须关掉 `--hide-scrollbars`。** Playwright headless 默认带这个参数，滚动条
宽度为 0，`100vw` 恒等于 `clientWidth`，缺陷**不复现**。脚本用
`chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })` 恢复 15px 经典滚动条，
并在滚动条宽度为 0 时直接判失败——避免「环境不对却报通过」。

每个路由在测量前先断言 HTTP 200 + 该路由特有的选择器，确保量的是真渲染出来的页面
（`.agent/testing.md` 证据质量第 2 条）。

> 订正：本报告早期版本写的是 7.67 / 40.33 / 1328.67 / 1432.33，那批数字取自带缩放的
> 浏览器面板（dpr 非 1，落在三分位上）。探针在 dpr=1 下给出的是 7.5 / 40.5 / 1329 /
> 1432.5——半条滚动条恰好 15 ÷ 2 = 7.5。以 `probe.output.json` 为准。

## 根因

全站五处 `width: 100vw` 全幅出血（`.hm-home` / `.ls-page` / `.dt-page` /
`.rc-page` / `.landing-hero`）都要从 `.site-main`（`max-width: 1440` +
`padding-inline: 24`）里破出来。`100vw` **含**经典滚动条宽度，而
`documentElement.clientWidth` 不含；配合 `margin-inline: calc(50% - 50vw)`
居中后，出血盒每侧探出半条滚动条（7.5px），右侧那半条就是可拖动的 8px。

原有的 `body { overflow-x: clip }` **不生效**：body 的 overflow 只有在根元素为
`visible` 时才会被提升到视口，而提升之后 body 自己按 `visible` 用（等于没裁），
被提升上去的 `clip` 又不消除视口的可滚动性。

### 四组对照（首页 1440，`documentElement.scrollLeft` 置 9999 后读回）

对应 `probe.output.json` 的 `mechanism` 段，每次运行当场重算。

| html overflow-x | body overflow-x | maxScrollLeft | docScrollWidth |
| --------------- | --------------- | ------------- | -------------- |
| visible         | clip            | **8**         | 1433           |
| clip            | visible         | **8**         | 1433           |
| **clip**        | **clip**        | **0**         | **1425**       |
| hidden          | clip            | 0             | 1425           |

第一行就是修复前的线上状态，探针每次都会把它重算出来——**这也是本次修复的
「改前」对照组**：不需要 checkout 旧代码就能看到 8px 复现。

结论：两条**都要在**。根元素那条负责阻止「提升」，真正做裁剪的是 body 那条。
根元素用 `clip` 不用 `hidden`——`hidden` 会把另一轴的 `visible` 连带升成 `auto`、
让根元素变成滚动容器，吸顶的 `.site-header` / `.dt-bar` 当场失效。

## 改了什么

- `styles.css`：给 `html` 补 `overflow-x: clip`（body 那条**保留**），并把上述
  实测与理由写进注释。
- `home.css` / `list.css` / `detail.css` / `recruit.css`：四处交叉引用原本写的是
  「body 已有 overflow-x: clip」并带已漂移的行号，改为指向这一对规则。
- 新增 `tests/frontend-horizontal-bleed-overflow.test.ts`（文本守卫，进 pre-push 闸门）
  与 `scripts/verify-horizontal-bleed-overflow.mjs`（行为探针，按需运行）。

## 验证：5 个出血页 × 4 档视口

`maxScrollLeft` = `documentElement.scrollLeft` 置 9999 后读回（0 即不能再横向拖动）。
`full` = 出血带左边缘 ≤ 0 且右边缘 ≥ clientWidth。四档滚动条宽度均为 15。

| 页面 | 出血壳 | 375 | 768 | 1440 | 1920 |
| --- | --- | --- | --- | --- | --- |
| `/shanghai` | `.hm-home` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/shanghai/listings` | `.ls-page` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/shanghai/listings/changning-hongqiao-serviced` | `.dt-page` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/city-partner` | `.rc-page` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/entrust` | `.landing-hero` | 0 / full | 0 / full | 0 / full | 0 / full |

**四档都复现、也都修好了。** 判据是滚动条占不占布局宽度，不是视口大小：经典滚动条
（桌面窗口，含 375px 宽的窄窗口）恒复现；覆盖式滚动条（真机与浏览器的移动端模拟）
宽 0，`100vw` 恰好等于 `clientWidth`，本就不复现。

> 订正：早期版本称「375 走覆盖式滚动条本就不复现」。那只对**移动端模拟**成立；
> 375px 宽的桌面窗口是经典滚动条，探针实测该档 `scrollbarWidth: 15`，同样复现。

出血带几何在修复前后**逐像素相同**（1440 下 `.hm-home` left -7.5 / right 1432.5 /
width 1440）。本次只消除可滚动性，不动任何参照系。

`uncontainedOverflowCount` 在 1440 下仍是 16（出血壳及其 section），这是**预期**：
盒子照旧探出，只是被这对 clip 裁掉、不再贡献可滚动性。该字段用于发现**新增**的
溢出源，不是失败判据。

## 功能回归（首页 1440，`probe.output.json` 的 `sticky` 段）

| 项 | 结果 |
| --- | --- |
| 纵向滚动 | 正常（`scrollTop` 置 800 生效） |
| `.site-header` 吸顶 | 滚动 800 后 `getBoundingClientRect().top === 0` |
| `documentElement` 横向 | `maxScrollLeft: 0` |

## 一条量到的、**未**修的既有偏差

出血页的内容容器与页眉容器并非严格同宽：页眉/页脚的 `100%` 是 body 内宽
（不含滚动条），出血页的是 `100vw`（含）。1440 下：

    .hm-container / .ls-container / .dt-container   1344 @ left 40.5
    .site-header__inner                             1329 @ left 48

中心重合，边缘差 7.5px。这在修复前后**完全一致**，不是本次引入；`list.css`
文件头「四者的 100% 统一为视口」这句因此是不完全成立的，已在该注释里如实补记。
要消这 7.5px 得连 `.site-main` 的宽度上限一起动（见下），不在本次范围内。

（`.rc-page` 的容器是 1024 @ left 200.5，因为招募页 `--rc-w` 有意是 1024 而非
`--container-max`，见 `recruit.css` 文件头；不属于本条偏差。）

### 若要继续收敛（已验证可行，但会改动版面，留给决策）

把 `.site-main` 对出血页取消限宽，出血壳改为 `width: auto` 填满 body：

```css
.site-main:has(> .hm-home, > .ls-page, > .dt-page, > .rc-page) { max-width: none; padding-inline: 0 }
.hm-home { width: auto; margin-inline: 0 }
```

1440 实测：`maxScrollLeft` 0（不靠裁剪，溢出直接不存在）、出血带满宽、
`.hm-container` 变成 1329 @ left 48，与页眉页脚**逐像素相同**。

代价与风险：
- 出血页内容左右各外移 7.5px（版面可见变化，需产品确认）。
- 依赖 `:has()`（本机 Chromium `CSS.supports('selector(:has(> div))')` 为 true）。
- 选择器清单脆弱：`ComingSoonCityView` 的结构是 `.site-main > .city-coming-soon > .rc-page`，
  `:has(> .rc-page)` 命中不了，得额外列 `.city-coming-soon`。
- `.landing-hero` 覆盖不到——它与需要限宽的兄弟 `.section` 同级，
  取消父级限宽会把那些兄弟一起放开，所以那一处仍要靠这对 clip 兜。

## 为什么现有 E2E 没能发现

`tests/e2e/detail-pages.spec.ts` 早就在 1440 / 1920 断言
`documentElement.scrollWidth <= clientWidth`，却从没红过：**Playwright headless 默认
带 `--hide-scrollbars`**，滚动条宽度为 0（实测 viewport 1440 下
`innerWidth 1440 / clientWidth 1440 / scrollbarWidth 0`），`100vw` 恒等于
`clientWidth`，那条断言在这一类缺陷上不可能失败。

这是**默认配置**的限制，不是 headless 的固有限制——`ignoreDefaultArgs` 关掉该参数
即可如实复现，本目录的探针就是这么做的。要把守卫也搬进 CI E2E，需要给相关 spec
单独配一个「经典滚动条」的 project，那是另一件事；在那之前分工是：
探针（需 dev server，按需跑）+ 文本守卫（进 pre-push 闸门，零依赖）。
