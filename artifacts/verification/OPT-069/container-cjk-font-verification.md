# OPT-069 生产容器中文字体：验收证据

日期：2026-09-05 · 验收对象：`payload-office-platform/Dockerfile` runner 阶段的字体安装
（提交 `6a6fbd5`）与 `src/domain/media/watermark.ts` 的 `WATERMARK_FONT_FAMILY`。

## 0. 先说清楚这份证据不是什么

brief 要求跑的是：

```
docker build -t sbh-watermark-check .
docker run --rm sbh-watermark-check fc-list :lang=zh
```

**本次仍未跑成这两条命令**——验收环境（Windows agent 沙箱）没有 Docker、没有 WSL、
没有 podman / nerdctl，`docker` 与 `wsl` 在 bash 与 PowerShell 下均为 command not found，
`C:\Program Files\Docker` 不存在。这一条从「静态分析」升级为「等价环境实测」，
但**没有升级为「容器内实测」**。下面每条结论都标注了它的取证方式，别当成容器里跑出来的。

替代取证路径有两条，都是真实测量而非推断：

1. **直接走 Docker Registry v2 API 把 `node:22-slim` 的镜像层拉下来解包**，
   在真实的镜像文件系统里查字体与 fontconfig。
2. **用 Debian 官方 `.deb` 里的真实字体二进制**，配合 `FONTCONFIG_FILE`
   把本机 sharp 的字体环境**收窄成容器等价**，跑真实的 `buildTiledOverlay` 烘图。

## 1. 基础镜像里到底有没有字体（实测：镜像层解包）

`node:22-slim` linux/amd64，manifest digest
`sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`，
5 层共 76.2 MiB，解包后 **7369 个文件条目**，逐项统计：

| 查什么 | 命中数 |
|---|---|
| `*.ttf` / `*.ttc` / `*.otf` / `*.pfb` / `*.pcf` / `*.woff*` | **0** |
| `usr/share/fonts/**` | **0** |
| `bin/fc-*`（`fc-list` / `fc-cache` 等） | **0** |
| 任何含 `fontconfig` 的路径 | **0** |

镜像自报 `/etc/debian_version` = `12.15`（bookworm），apt 源只启用 `main`。

**结论**：brief 里那条 `fc-list :lang=zh` 在**修复前的镜像里根本不会返回空**——
它会 `fc-list: not found`，因为 `fontconfig` 包压根没装。整份 Dockerfile 在 `6a6fbd5`
之前没有任何一行 `apt-get`，所以最终 runner 镜像的字体状况完全等于基础镜像的字体状况。

## 2. sharp 是怎么找字体的（实测：读 so/dll 里的常量）

sharp 0.34.4 的 Linux 产物 `@img/sharp-libvips-linux-x64` 只有**一个** `.so`
（`lib/libvips-cpp.so.8.17.2`）——librsvg / pango / fontconfig / freetype 全部静态链接进去了。
在这个二进制里能查到写死的路径常量：

```
/etc/fonts        /etc/fonts/conf.d
/usr/share/fonts  /usr/local/share/fonts
/usr/share/fontconfig/conf.avail
/var/cache/fontconfig
FONTCONFIG_FILE  FONTCONFIG_PATH  FONTCONFIG_SYSROOT
```

两个推论，都对选型有直接影响：

- **库层面的 fontconfig 是自带的**，不需要 apt 装 `libfontconfig1` 才能渲染；
  但 **`fc-list` 这个 CLI 是 `fontconfig` 包提供的**，装字体不一定会把它带进来。
- fontconfig 的 sysconfdir 是 `/etc/fonts`。装了字体但没有 `/etc/fonts/fonts.conf` 时，
  fontconfig 会退到内置 fallback（只扫 `/usr/share/fonts`，且**没有任何别名规则**）。
  这一点决定了「只装 `fonts-noto-cjk`」是有坑的——见 §4。

Windows 端的 `libvips-42.dll` 同样含 `FONTCONFIG_FILE` 等常量，说明本机 sharp 也走 fontconfig，
这正是 §5 那个受控实验能成立的前提。

## 3. 字体族名与字形覆盖（实测：解析 name / OS/2 / cmap 表）

直接解析 Debian 包里的字体二进制，不靠包描述转述：

**`fonts-wqy-zenhei` → `wqy-zenhei.ttc`（3 个 face）**

| family | subfamily | usWeightClass | bold 位 | 商 | 办 | 荟 |
|---|---|---|---|---|---|---|
| `WenQuanYi Zen Hei` | Regular | 500 | false | OK | OK | OK |
| `WenQuanYi Zen Hei Mono` | Regular | 500 | false | OK | OK | OK |
| `WenQuanYi Zen Hei Sharp` | Regular | 500 | false | OK | OK | OK |

**`fonts-noto-cjk` → `NotoSansCJK-Regular.ttc`（10 个 face，节选）**

| family | subfamily | usWeightClass | 商 | 办 | 荟 |
|---|---|---|---|---|---|
| `Noto Sans CJK SC` | Regular | 400 | OK | OK | OK |
| `Noto Sans CJK TC/JP/KR/HK` | Regular | 400 | OK | OK | OK |

两条值得记下来的事实：

- `6a6fbd5` 声称 `WenQuanYi Zen Hei` 是该包注册的族名——**核实无误**，且覆盖「商办荟」。
- **WQY Zen Hei 没有 Bold 字面**（三个 face 全是 weight=500 / bold=false），
  而 `buildTiledOverlay` / `buildBadgeOverlay` 出的 SVG 要的是 `font-weight="700"`。
  这一度让我判断「笔画会比 Windows 上验收过的效果细」——**这个判断是错的**，
  原因见 §5 的对照组纪律。

## 4. 体积（实测：Debian 包索引 + 依赖闭包，减去基础镜像已有的 88 个包）

按 `apt-get install --no-install-recommends` 的语义解依赖闭包（`a | b` 取第一候选），
再扣掉 `node:22-slim` 的 `/var/lib/dpkg/status` 里已有的包：

| 方案 | 新增包 | 下载 | **安装后占用** | 真 Bold | 带来 `fc-list` |
|---|---|---|---|---|---|
| **`fonts-wqy-zenhei`（现方案）** | 9 | 10.2 MiB | **23.0 MiB** | 否（靠合成） | **是** |
| `fonts-noto-cjk` 单装 | 1 | 53.9 MiB | 88.9 MiB | 是 | **否** |
| `fonts-noto-cjk` + `fontconfig` | 9 | 57.0 MiB | 95.9 MiB | 是 | 是 |
| `fonts-wqy-microhei` + `fontconfig` | 9 | 4.6 MiB | 12.0 MiB | 否 | 是 |

`fonts-wqy-zenhei` 那 23.0 MiB 的构成：字体本体 16.0 + `fonts-dejavu-core` 2.9 +
`libfreetype6` 0.9 + `libbrotli1` 0.8 + `fontconfig` 0.6 + `libfontconfig1` 0.6 +
`fontconfig-config` 0.5 + `libpng16-16` 0.4 + `libexpat1` 0.4。

两处要订正的说法：

1. `6a6fbd5` 的提交信息与 Dockerfile 注释写「fonts-wqy-zenhei（~15MB）」——
   **实际是 23.0 MiB**。差的 7 MiB 是 `Depends: fontconfig` 拉进来的整条链
   （fontconfig → fontconfig-config → fonts-dejavu-core，以及 freetype/png/expat/brotli）。
   同一处把 Noto 记成「~55-60MB」，那是 **.deb 下载体积**；装进镜像是 **88.9 MiB**。
2. 这条依赖链不全是成本，也是收益：**正因为 `fonts-wqy-zenhei` 依赖 `fontconfig`**，
   修复后的镜像里 `/etc/fonts/fonts.conf` 与 `fc-list` 都存在，brief 那条验收命令
   从此真的能跑。反过来 `fonts-noto-cjk` **没有任何 Depends**，单装它既没有
   `/etc/fonts`（fontconfig 退到无别名的 fallback），也没有 `fc-list`——
   「装了 Noto 结果 `fc-list` 仍然 not found」会是个很费解的现场。

## 5. 渲染实测（等价环境，非容器内）

### 实验装置

- 渲染函数：OPT-069 分支上**真实的** `buildTiledOverlay`，只对产出的 SVG
  字符串替换 `font-family`，几何 / 字号 / 描边 / 密度全部保持实现原样。
- 画布 1200×800，底色纯灰 `rgb(96,104,112)`，`density: 4`，其余取 `DEFAULT_WATERMARK_CONFIG.tiled`。
- 字体环境用 `FONTCONFIG_FILE` 完全接管，杜绝本机 Windows 字体参与。
- 客观判据：统计偏离底色超过 18 的像素占比（`ink%`）；同时导出图片肉眼核对。

### 对照组纪律：我第一版对照组是错的

第一轮我只给了一个极简 `fonts.conf`（单个 `<dir>` + `<cachedir>`），
测出 WQY 的 `ink` 是 **5.074%**，明显低于 Noto 的 7.756%，据此写下了
「WQY 没有 Bold，笔画会偏细」的结论。

**这个结论是环境不等价造成的假象。** 真实容器里 `fontconfig-config` 会往
`/etc/fonts/conf.d` 铺 19 个默认启用的软链，其中 **`90-synthetic.conf` 就是合成粗体**
（另有 `fonts-wqy-zenhei` 自带的 `25-`/`64-wqy-zenhei.conf`）；我的极简配置一个都没加载，
等于人为关掉了合成粗体。补齐成完整的 Debian `/etc/fonts`（21 项 conf.d + DejaVu 一并就位）
之后，同一组字体测出来是 **7.881%**。

下表只列**环境已补齐**的那一轮：

| 组 | 字体环境 | 字体栈首项 | ink% | 肉眼 |
|---|---|---|---|---|
| **A** | 无任何字体、无 `/etc/fonts`（= 修复前的生产） | Noto Sans CJK SC | **0.199%** | **三个空心方框 □□□** |
| **D1** | 完整 `/etc/fonts` + DejaVu + WQY Zen Hei | WenQuanYi Zen Hei | **7.881%** | 商办荟清晰、笔画饱满 |
| **D2** | 同 D1 | Noto Sans CJK SC（原栈） | **7.881%** | 与 D1 **字节完全相同** |
| **D3** | 完整 `/etc/fonts` + DejaVu + NotoSansCJK R+B | Noto Sans CJK SC | 7.756% | 商办荟清晰、笔画饱满 |

图片证据：

- `font-A-no-fonts-tofu.png` / `-crop.png`——修复前的样子，方框。
- `font-D1-wqy-zenhei.png` / `-crop.png`——现方案，中文正常。
- `font-D3-noto-cjk.png` / `-crop.png`——Noto 对照。

### 结论

1. **故障是真的，且已复现**：没有字体时「商办荟」渲染成 □□□，sharp 不报错、图照出。
   这是修复前生产会拿到的结果。
2. **`fonts-wqy-zenhei` 的修复有效**：中文清晰可读，不是方框也不是空白。
3. **合成粗体补齐了 WQY 缺 Bold 字面的缺口**：D1（7.881%）与 D3 真 Bold（7.756%）
   基本持平，肉眼看不出「WQY 更细」。§3 里那个担心在完整环境下不成立。

## 6. 一个反直觉的发现：`watermark.ts` 的字体栈改动是空操作

`6a6fbd5` 同时把 `WenQuanYi Zen Hei` 加到了 `WATERMARK_FONT_FAMILY` 栈首，理由写的是
「否则装了也白装」，`media-watermark-font-guard.test.ts` 也据此加了断言，
注释称原栈会「找不到第一项 → 跳到下一项 → 下一项也不存在 → 照样方框」。

**D1 与 D2 的输出字节完全相同（`cmp` 无差异），证明这个说法不成立。** 原因是
fontconfig 的匹配语义不是「命中或失败」，而是**永远返回当前字体集里的最佳匹配**：
请求 `Noto Sans CJK SC` 而容器里只有 WQY 时，它照样会落到 WQY 上，
再叠加 pango 的逐字回退（DejaVu 无 CJK 字形 → 回退到 WQY）。

原始命令与输出（两次渲染只差 `font-family` 一个字符串，其余入参、画布、配置全同）：

```
$ FONTCONFIG_FILE=sim-wqy.conf node --experimental-strip-types render.mts \
    D1-sim-wqy-newstack  'WenQuanYi Zen Hei, Noto Sans CJK SC, Microsoft YaHei, SimHei, sans-serif'
  ink=7.881%  (75654 px)

$ FONTCONFIG_FILE=sim-wqy.conf node --experimental-strip-types render.mts \
    D2-sim-wqy-origstack 'Noto Sans CJK SC, Microsoft YaHei, SimHei, sans-serif'
  ink=7.881%  (75654 px)

$ cmp out/D1-sim-wqy-newstack.png out/D2-sim-wqy-origstack.png ; echo $?
0

$ md5sum out/D1-sim-wqy-newstack.png out/D2-sim-wqy-origstack.png
80647b7663985519995e09eddf7b945b *out/D1-sim-wqy-newstack.png
80647b7663985519995e09eddf7b945b *out/D2-sim-wqy-origstack.png
```

早一轮**未加载 conf.d** 的极简环境（§5 里那个不等价的对照组）下，同一对比也是
逐字节相同（两者 md5 均为 `5632b682021035f9b65d3f0078c6b38b`）——
即这个结论不依赖合成粗体是否启用，两种字体环境下都成立。

这**不代表那处改动有害**——把实际安装的族名写在栈首是有价值的意图声明，
守卫测试也确实能在有人删掉 Dockerfile 那行时变红。但它的**理由**是错的：
字体栈的顺序在这里不是承重结构。留着这条错误理由的风险是，
以后有人据此以为「换字体包必须同步改字体栈否则线上变方框」，
从而在真正该动的地方（Dockerfile）之外做无谓的耦合改动。

建议：保留断言，把 `watermark.ts` 顶部注释与该测试里「否则照样方框」的措辞
改成「让代码与镜像里实际装的包互为对照，便于排查」之类的准确表述。
本次未代改——`watermark.ts` 是本任务的免动区，且该文件正被另一会话编辑。

## 7. 未覆盖的风险（诚实列出）

- **`apt-get` 在腾讯云镜像构建环境里能不能连通 `deb.debian.org`，本次没有验证。**
  这行 `RUN` 是在云端构建阶段执行的，如果那边出网受限或很慢，会直接让构建失败
  ——而这是一个只在真正发一次版时才会暴露的风险。下一次 `deploy.yml` 跑通即可消解。
- **容器内的 `fc-list :lang=zh` 仍未实跑。** 按 §1/§4 的证据它应当输出
  `wqy-zenhei.ttc` 的三个 face，但这是推断。等有 Docker 的机器时，
  `scripts/verify-container-cjk-font.sh` 一条命令可以跑完整套。
- 本次全部渲染在 **Windows 的 sharp 0.34.4** 上完成。字体环境已收窄成容器等价，
  但栅格化后端仍是 win32 构建；像素级不等于 Linux 产物。

## 8. 复现方式

有 Docker 的机器上：

```bash
cd payload-office-platform && bash scripts/verify-container-cjk-font.sh
```

无 Docker 时本次用的取证脚本留在会话 scratchpad（`imgcheck/`），
核心是三步：registry API 拉层解包 → 解析 `.deb` 里的字体表 →
`FONTCONFIG_FILE` 收窄字体环境后跑真实的 `buildTiledOverlay`。
