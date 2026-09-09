# C 端全站横向滚动缺陷 —— 修复与验证

分支 `fix/root-scroll-clip-2b40`。缺陷是既有问题，非某次改动引入。

## 根因

全站五处 `width: 100vw` 全幅出血（`.hm-home` / `.ls-page` / `.dt-page` /
`.rc-page` / `.landing-hero`）都要从 `.site-main`（`max-width: 1440` +
`padding-inline: 24`）里破出来。`100vw` **含**经典滚动条宽度，而
`documentElement.clientWidth` 不含；配合 `margin-inline: calc(50% - 50vw)`
居中后，出血盒每侧探出半条滚动条（实测 7.67px），右侧那半条就是可拖动的 8px。

原有的 `body { overflow-x: clip }` **不生效**：body 的 overflow 只有在根元素为
`visible` 时才会被提升到视口，而提升之后 body 自己按 `visible` 用（等于没裁），
被提升上去的 `clip` 又不消除视口的可滚动性。

### 四组对照（视口 1920 / clientWidth 1905，`documentElement.scrollLeft` 置 9999 后读回）

| html overflow-x | body overflow-x | maxScrollLeft | docScrollWidth |
| --------------- | --------------- | ------------- | -------------- |
| visible         | clip            | **8**         | 1913           |
| clip            | visible         | **8**         | 1913           |
| hidden          | clip            | 0             | 1905           |
| **clip**        | **clip**        | **0**         | **1905**       |

结论：两条**都要在**。根元素那条负责阻止「提升」，真正做裁剪的是 body 那条。
根元素用 `clip` 不用 `hidden`——`hidden` 会把另一轴的 `visible` 连带升成 `auto`、
让根元素变成滚动容器，吸顶的 `.site-header` / `.dt-bar` 当场失效。

## 改了什么

- `styles.css`：给 `html` 补 `overflow-x: clip`（body 那条**保留**），并把上述
  实测与理由写进注释。
- `home.css` / `list.css` / `detail.css` / `recruit.css`：四处交叉引用原本写的是
  「body 已有 overflow-x: clip」并带已漂移的行号，改为指向这一对规则。
- 新增 `tests/frontend-horizontal-bleed-overflow.test.ts` 守卫。

## 验证：5 个出血页 × 4 档视口

`maxScrollLeft` = `documentElement.scrollLeft` 置 9999 后读回（0 即不能再横向拖动）。
`bandFull` = 出血带左边缘 ≤ 0 且右边缘 ≥ clientWidth（满宽）。

| 页面 | 出血壳 | 375 | 768 | 1440 | 1920 |
| --- | --- | --- | --- | --- | --- |
| `/shanghai` | `.hm-home` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/shanghai/listings` | `.ls-page` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/shanghai/listings/changning-hongqiao-serviced` | `.dt-page` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/city-partner` | `.rc-page` | 0 / full | 0 / full | 0 / full | 0 / full |
| `/entrust` | `.landing-hero` | 0 / full | 0 / full | 0 / full | 0 / full |

修复前同样的测法在 768 / 1440 / 1920 三档均为 **8**（375 走覆盖式滚动条，
滚动条宽 0，本就不复现——这也是用户报告里"有 15px 滚动条"的前提）。

出血带几何在修复前后**逐像素相同**（例：1440 下 `.hm-home` left -7.67 /
right 1432.33 / width 1440）。本次只消除可滚动性，不动任何参照系。

## 功能回归（1440，楼盘详情页 `/shanghai/buildings/changning-hongqiao`）

| 项 | 结果 |
| --- | --- |
| 纵向滚动 | 正常（`scrollTop` 置 1200 生效） |
| `.site-header` 吸顶 | `position: sticky`，滚动后 `top: 0` |
| `.dt-bar` 吸附条 | `position: sticky`，left -7.67 / right 1432.33，仍横贯视口 |
| 锚点导航（`#supply`） | 点击后滚动位置改变 |
| `documentElement` 横向 | `maxScrollLeft: 0` |

## 一条量到的、**未**修的既有偏差

出血页的内容容器与页眉容器并非严格同宽：页眉/页脚的 `100%` 是 body 内宽
（不含滚动条），出血页的是 `100vw`（含）。1440 下：

    .hm-container       1344    @ left 40.33
    .site-header__inner 1328.67 @ left 48

中心重合，边缘差 7.67px。这在修复前后**完全一致**，不是本次引入；`list.css`
文件头「四者的 100% 统一为视口」这句因此是不完全成立的，已在该注释里如实补记。
要消这 7.67px 得连 `.site-main` 的宽度上限一起动（见下），不在本次范围内。

### 若要继续收敛（已验证可行，但会改动版面，留给决策）

把 `.site-main` 对出血页取消限宽，出血壳改为 `width: auto` 填满 body：

```css
.site-main:has(> .hm-home, > .ls-page, > .dt-page, > .rc-page) { max-width: none; padding-inline: 0 }
.hm-home { width: auto; margin-inline: 0 }
```

1440 实测：`maxScrollLeft` 0（不靠裁剪，溢出直接不存在）、出血带 0..1424.67 满宽、
`.hm-container` 变成 1328.67 @ left 48，与页眉页脚**逐像素相同**。

代价与风险：
- 出血页内容左右各外移 7.67px（版面可见变化，需产品确认）。
- 依赖 `:has()`（本机 Chromium `CSS.supports` 为 true）。
- 选择器清单脆弱：`ComingSoonCityView` 的结构是 `.site-main > .city-coming-soon > .rc-page`，
  `:has(> .rc-page)` 命中不了，得额外列 `.city-coming-soon`。
- `.landing-hero` 覆盖不到——它与需要限宽的兄弟 `.section` 同级，
  取消父级限宽会把那些兄弟一起放开，所以那一处仍要靠这对 clip 兜。

## 为什么现有 E2E 没能发现

`tests/e2e/detail-pages.spec.ts` 早就在 1440 / 1920 断言
`documentElement.scrollWidth <= clientWidth`，却从没红过：**headless Chromium 的
滚动条宽度是 0**（实测 viewport 1440 下 `innerWidth 1440 / clientWidth 1440 /
scrollbarWidth 0`）。滚动条不占布局，`100vw` 就恒等于 `clientWidth`，那条断言在
这一类缺陷上结构性地不可能失败。所以新增的是**文本守卫**；要补行为守卫，
得让 E2E 以带经典滚动条的方式跑，那是另一件事。
