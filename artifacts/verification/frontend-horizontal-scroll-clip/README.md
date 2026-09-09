# C 端全站横向滚动缺陷 + 7.5px 参照系错位 —— 修复与验证

分支 `fix/root-scroll-clip-2b40`。两处都是既有问题，非某次改动引入。

## 证据怎么来的（本报告不自证）

所有数字来自 `payload-office-platform/scripts/verify-horizontal-bleed-overflow.mjs`，
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
> 浏览器面板（dpr 非 1）。探针在 dpr=1 下给出 7.5 / 40.5 / 1329 / 1432.5——半条滚动条
> 恰好 15 ÷ 2 = 7.5。以 `probe.output.json` 为准。

## 缺陷一：全站可横向拖 8px

五处 `width: 100vw` 全幅出血都要从 `.site-main`（`max-width: 1440` +
`padding-inline: 24`）里破出来。`100vw` **含**经典滚动条宽度而
`documentElement.clientWidth` 不含；配合 `margin-inline: calc(50% - 50vw)` 居中后，
出血盒每侧探出半条滚动条（7.5px），右侧那半条就是可拖动的 8px。

原有的 `body { overflow-x: clip }` **不生效**：body 的 overflow 只有在根元素为
`visible` 时才会被提升到视口，而提升之后 body 自己按 `visible` 用（等于没裁），
被提升上去的 `clip` 又不消除视口的可滚动性。

### 四组对照（`/entrust` @1440，`documentElement.scrollLeft` 置 9999 后读回）

对应 `probe.output.json` 的 `mechanism` 段，每次运行当场重算。

| html overflow-x | body overflow-x | maxScrollLeft |
| --------------- | --------------- | ------------- |
| visible         | clip            | **8**         |
| clip            | visible         | **8**         |
| **clip**        | **clip**        | **0**         |
| hidden          | clip            | 0             |

第一行就是修复前的线上状态——**不必 checkout 旧代码即可复现缺陷本身**。

结论：两条**都要在**。根元素那条负责阻止「提升」，真正做裁剪的是 body 那条。
根元素用 `clip` 不用 `hidden`——`hidden` 会把另一轴的 `visible` 连带升成 `auto`、
让根元素变成滚动容器，吸顶的 `.site-header` / `.dt-bar` 当场失效。

> 对照必须在 `/entrust` 上做：四个出血壳页已按缺陷二收口，`width: auto` 后根本不
> 溢出，在那里切 overflow-x 四组恒为 0，什么也证明不了。探针在第一行读到 0 时会
> 直接判失败，防止对照组悄悄失效还报通过。

## 缺陷二：出血页内容与页眉差 7.5px

出血壳内的容器是 `min(--w, 100% - --gut*2)`，那个 `100%` 是出血壳宽度＝`100vw`
（含滚动条）；而页眉 `.site-header__inner` / 页脚的 `100%` 是 body 内宽（不含）。
两套参照系差半条滚动条。1440 下：

    .hm-container       1344 @ left 40.5
    .site-header__inner 1329 @ left 48

中心重合，边缘差 7.5px——`list.css` 文件头「四者的 100% 统一为视口」因此只统一了
出血页彼此，没跟页眉统一。

**收口办法是不再从限宽里破出来**：出血页的 `.site-main` 直接取消限宽，壳用默认的
`width: auto` 填满 body 内宽，与页眉共用同一个 `100%`。副产品是这四页的横向溢出
**不复存在**，而不是被裁掉。

```css
@supports selector(:has(*)) {
  .site-main:has(> .hm-home), .site-main:has(> .ls-page),
  .site-main:has(> .dt-page), .site-main:has(> .rc-page),
  .site-main:has(> .city-coming-soon) { max-width: none; padding-inline: 0 }

  .site-main > .hm-home, .site-main > .ls-page, .site-main > .dt-page,
  .site-main > .rc-page, .site-main > .city-coming-soon > .rc-page {
    width: auto; margin-inline: 0;
  }
}
```

三个易错点，都是「页面看着正常、只有量几何才看得出来」：

- **`.city-coming-soon` 必须单列**：城市路由是 `.site-main > .city-coming-soon > .rc-page`，
  `:has(> .rc-page)` 命中不了（已实测 DOM 结构确认）。
- **复位必须写成 `.site-main > .hm-home`（0,2,0）**：`styles.css` 在 layout.tsx 里
  **先于** home/list/detail/recruit 导入，裸 `.hm-home`（0,1,0）会被壳文件的
  `width: 100vw` 盖掉。
- **各壳文件的 `100vw` 保留作回退**：不支持 `:has()` 的浏览器（Firefox <121 /
  Safari <15.4 / Chrome <105）走原路径，行为与收口前一致。宁可在那些浏览器上差
  7.5px，也不能让整幅背景带塌回 1440、两侧露出灰边。

`.landing-hero` **不走这条路**：`/entrust`、`/publish` 的 `.site-main` 里它与三个需要
限宽的兄弟并列（实测 5 个直接子元素：`script` + `.landing-hero` + 两个 `.section` +
`.bottom-cta-anchor`），取消父级限宽会把兄弟一起放开。它继续用 `100vw` + 那对 clip
兜住——**这就是那对 clip 仍不能删的原因**。探针里 `landing@1440` 的
`siteMainMaxWidth` 仍是 `1440px`，四个壳页是 `none`，可据此核对。

## 验证：6 个路由 × 4 档视口

四档滚动条宽度均为 15。`maxScrollLeft` 全为 0，出血带全部覆盖可视宽度。

**容器与页眉逐像素相同**（探针把这条作为失败判据，`alignsWithHeader` 的三个路由）：

| 视口 | `.hm-/.ls-/.dt-container` | `.site-header__inner` |
| --- | --- | --- |
| 375  | 328 @ left 16     | 328 @ left 16     |
| 768  | 689 @ left 32     | 689 @ left 32     |
| 1440 | 1329 @ left 48    | 1329 @ left 48    |
| 1920 | 1440 @ left 232.5 | 1440 @ left 232.5 |

收口前同样测点在 375 / 768 / 1440 三档均差 `left -7.5 / width 15`（1920 档本就没差，
两侧都被 `--container-max` 夹住）。已用「临时停用 `@supports` 分支」实测复现这 9 条
失败，确认守卫不是空的。

两个有意的例外：`/city-partner`、`/hangzhou` 的 `--rc-w` 是 1024（552+72+400 的推导值，
见 `recruit.css` 文件头），与页眉本就不同宽，只要求居中一致；`/entrust` 仍是 100vw 出血。

### 浏览器实测（1440，DOM 取证）

页面有滚动进场动效，截图不可靠，故用几何与计算样式取证：

| 项 | 结果 |
| --- | --- |
| 首页 9 条背景带（hero / section / band） | 全部 `0 .. 1424.67` 满宽，`opacity: 1`，底色正常 |
| 页眉 logo 左边缘 vs 首页首个 h2 左边缘 | 均为 48，**差 0** |
| 楼盘详情 `.dt-bar` | `sticky`，`0 .. 1425` 横贯视口，`top: 44`（紧贴页眉下沿） |
| `.dt-bar` 内层 vs `.site-header__inner` | 均为 1329 @ left 48，**逐像素相同** |
| 纵向滚动 / 吸顶 | 正常；滚动 800 后页眉 `top: 0` |

`.dt-bar` 那两行值得单独记：detail.css 一直写着「毛玻璃与底线要横贯视口、与正上方的
`.site-header` 对齐」，而收口前内层是 1344 @ 40.5、跟页眉差 7.5px——**那句话原本只是
近似成立，现在才是字面成立**。

## 为什么现有 E2E 没能发现

`tests/e2e/detail-pages.spec.ts` 早就在 1440 / 1920 断言
`documentElement.scrollWidth <= clientWidth`，却从没红过：**Playwright headless 默认
带 `--hide-scrollbars`**，滚动条宽度为 0，`100vw` 恒等于 `clientWidth`，那条断言在
这一类缺陷上不可能失败。

这是**默认配置**的限制，不是 headless 的固有限制——`ignoreDefaultArgs` 关掉即可如实
复现。要把守卫搬进 CI E2E，需要给相关 spec 单独配一个「经典滚动条」project，那是
另一件事；在那之前分工是：探针（需 dev server，按需跑）+ 文本守卫
`tests/frontend-horizontal-bleed-overflow.test.ts`（进 pre-push 闸门，零依赖）。
