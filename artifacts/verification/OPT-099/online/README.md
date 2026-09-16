# OPT-099 线上验收

时间：2026-09-16 · 生产 `https://shangban.cc` · master `d403a9a`（PR #195）· Deploy run `#35107943825` completed/success

取证：本地 Playwright（Chromium 1440×900）打生产站。脚本与合并前走查同一份逻辑，
判据也同一份——**合并前记录的「修复前」数字就是这份脚本在同一站点上量出来的**，可直接对照。

## 0 线上跑的是不是新版

不信 CI 绿灯，直接拉线上 CSS / JS 找本次新增的规则：

| 新增物 | 线上 |
|---|---|
| `--sf-card-shadow-bleed-block` token | ✅ |
| `.site-nav__group[data-nav-suppressed]` 规则 | ✅ |
| `.ls-toolbar__sortlabel` 规则已删 | ✅ |
| `.ls-toolbar__sortgroup` 规则 | ✅ |
| `SiteNav` bundle 含 `data-nav-suppressed` 与 `.detail>0` 闸门 | ✅ |

（`.sf-media img{position:absolute}` 那条文本匹配没对上——lightningcss 压缩后声明顺序 / 选择器写法与源码不同，
正则写死了。下面 ④ 的布局实测是它生效的权威证据，不靠这条文本匹配。）

## ④ 卡片等高 —— 8 种 → 1 种

`/shanghai/listings` 同一页 24 张卡（真实封面，原始比例 7 种：1.33 / 1.34 / 1.35 / 1.48 / 1.50 / 1.53 / 1.99）：

| | 合并前（`28dfecd`） | **上线后（`d403a9a`）** |
|---|---|---|
| 媒体盒比例 | 8 种 | **1 种（1.600）** |
| 媒体盒高 | 202.5 … 243（8 种） | **202.5** |
| 卡片高 | 329.3 / 356.3 两档 | **315.8** |

截图 `04-listings-online-1440.png`：首张卡正是用户最初截图里那张「财富金融广场 江景独栋」，
现在与同行三张等高、价格同基线。

## ① hover 投影

首页 `.hm-rail__track`：`padding-block` **6px / 30px**，hover 投影外沿与裁切边余量 **0 / 0**，`fullyInside: true`
（合并前：4/12，余量 −2 / −18）。

首页两条轨道的供给卡媒体盒：**1.600 / 250px**（合并前 3:2 / 266.7——整齐地错着）。截图 `01-home-rail-online-1440.png`。

## ② 排序文案

`/shanghai/listings` 工具条右侧 `textContent` = `"推荐最新"`，无 `.ls-toolbar__sortlabel` 节点，
排序分组 `aria-label="排序"` 在。

## ⑤ 商圈级联（线上真实数据，共 2181 套）

| 步骤 | URL | 商圈候选 | chips | 位置行选项数 |
|---|---|---|---|---|
| 未选区 | `/shanghai/listings` | 整行不渲染 | — | 9 |
| 选「黄浦区」 | `?district=huangpu` | 淮海中路 34 · 打浦桥 1 · 外滩 2 · 老西门 1 · 人民广场 3 · 豫园 1 · 新天地 1 | 位置：黄浦区 | 9 |
| 选「淮海中路」 | `?district=huangpu&businessArea=huaihaizhonglu` | 同上 | 位置：黄浦区、**商圈：淮海中路** | **9**（走查抓到的「塌成 1 个」缺陷已修） |
| 切「静安区」 | `?district=jingan`（链接 href 本身就不带 businessArea） | 天目西路 4 · 静安寺 2 · 新客站 1 · 南京西路 11 · 彭浦 1 | 位置：静安区 | 9 |

结果集：2181 → 44（黄浦）→ 34（淮海中路）→ 19（静安）。截图 `05-business-area-online-1440.png`。

## ③ 二级导航

线上 bundle 已含抑制逻辑（见 0）。**交互本身没有在线上重测**：headless Playwright 复现不出
「客户端导航后指针仍停在原处」这个前提（见合并前证据 README），而 Browser pane 对生产站会拦掉样式表、
量不出 visibility。行为已在合并前用真实浏览器窗口对本地构建验过（`:hover` 仍命中、菜单仍收起、
键盘路径不抑制），线上 CSS / JS 与那份构建同源。

## 顺带核实

`https://shangban.cc/listings?district=changning` → 307 → `/shanghai/listings?district=changning`
（PR #193 的修复已在线上生效，query 不再丢）。
