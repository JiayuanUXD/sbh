# 浏览器走查证据：出售单价房源的总价列

- 日期：2026-09-10
- 分支：`fix/sale-unit-price-total-a71c`
- 环境：worktree `E:\wt-total`，`next dev` :3721，本地默认 `postgres` 库（已跑完
  `pnpm exec payload migrate`，最后一条 `20260909_164334_opt_083_detail_spec_visibility`）
- 取证方式：Browser pane 载入页面后读 DOM `innerText`。**截图在本机 pane 里恒为空白**
  （viewport emulation 下不合成帧；同时 pane 自身 `innerWidth` 为 0，不放大就渲染
  不出桌面版表格），因此以 DOM 文本为准，不是「没验」。

## 起因：生产实证

`https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/shanghai/buildings/shangheshangwuyuan`
（curl 取 SSR HTML）出售组表格，面积与单价俱全，总价列全是「—」：

| 面积 ㎡ | 单价 元/㎡ | 总价 万元 |
|---|---|---|
| 618.42 | 10,000 | — |
| 624.39 | 16,000 | — |
| 990.76 | 20,000 | — |
| 644.9 | — | — |

第四行本身没有价格，那个「—」是对的；前三行是缺陷。

## 本地夹具

本地库原本**一条出售房源都没有**（价格组合只有 lease 的 day/sqm、month/seat、
month/suite、month/sqm），无法直接复现。临时把两条房源改成出售单价口径：

| id | 原 | 临时改为 |
|---|---|---|
| 30 `test`（2000 ㎡） | lease / month / sqm / 2 | sale / one-time / sqm / 20000 |
| 8 `静安 · 整层办公 850㎡`（850 ㎡） | lease / day / sqm / 11 | sale / one-time / sqm / 10000 |

**走查结束后已按上表原值改回**，本地夹具无残留。

## 对照实验

同一个 dev server、同一份数据，只切换 `supply-summary.ts` 一个文件
（`git stash push` 后确认 `grep` 命中数为 0，对照组真的是未修复状态）。

页面：`/shanghai/buildings/west-nanjing-premium-center?group=sale`（viewport 1440×900）

**对照组（未修复）**

```
房源  面积 ㎡  单价 元/㎡  总价 万元  装修
test                2,000   20,000   —   简装
静安 · 整层办公 850㎡  850    10,000   —   简装
```

**实验组（已修复）**

```
房源  面积 ㎡  单价 元/㎡  总价 万元  装修
test                2,000   20,000   4,000   简装
静安 · 整层办公 850㎡  850    10,000     850   简装
```

验算：20,000 × 2,000 = 40,000,000 元 → 4,000 万元；10,000 × 850 = 8,500,000 元 → 850 万元。

## 房源详情页决策卡（同一函数的第二个调用点）

`/shanghai/listings/jingan-center-fullfloor` 修复后：

```
售价 10000 元/㎡
总价 850 万元 · 850 ㎡
```

修复前该行没有「总价」段。

## 单测反向验证

`git stash` 掉源码修复后跑 `pnpm vitest run tests/supply-summary.test.ts`：新增的
两条正向用例 FAIL（2 failed | 21 passed），恢复后全绿——用例不是空转。
