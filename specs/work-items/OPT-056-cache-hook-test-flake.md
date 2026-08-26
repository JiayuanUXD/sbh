# Task Packet：OPT-056 `supply-public-cache-hook` 在满负载下 5 秒超时，五次中两次

> 状态：**已确认，未修复**
> 创建日期：2026-08-26
> 来源：OPT-053 实施期间反复撞到，一度拦下 `git push`（pre-push 跑全套单测）
> 编号说明：OPT-055 是缺省 access 一族，故取 056

---

## 1. 一句话

`tests/supply-public-cache-hook.test.ts` 里的
「Listings 挂了 afterChange / afterDelete 失效 hook」
在**整套单测并行跑**时会撞 vitest 默认的 5 秒超时；**单独跑只要 2.27 秒**。

## 2. 证据

失败形态固定：

```
FAIL tests/supply-public-cache-hook.test.ts > 失效 hook 的 collection 接线
     > Listings 挂了 afterChange / afterDelete 失效 hook
Error: Test timed out in 5000ms.
 ❯ tests/supply-public-cache-hook.test.ts:213:3
    214|     const { Listings } = await import('@/collections/Listings')
```

卡在 `await import('@/collections/Listings')` 这一行——**动态导入本身超时**，
不是断言失败。该用例实测耗时 7934ms（满负载）vs 2270ms（单独跑）。

2026-08-26 当天的命中率：**五次全量运行中两次失败**，其中一次拦下了 `git push`
（`.githooks/pre-push` 涉及应用目录时跑 `typecheck` + `test`）。

## 3. 为什么现在才成为问题

`Listings.ts` 的导入图很大（collection 配置 → domain → payload 类型链）。
OPT-041 批量导入等一批代码合入后整个 suite 变重，冷导入从"偶尔擦边 5 秒"
变成"约一半概率超"。

**不是新缺陷，是既有脆弱点被压过了阈值。**

## 4. 影响

- **拦人**：pre-push 是全员闸门，随机失败会让人开始怀疑闸门本身，
  进而滋生「重跑一次就好」甚至 `SKIP_PREPUSH=1` 的习惯——那才是真正的代价。
- **污染 CI 判断**：`quality` job 红一次，下一个人要花时间确认「是不是我的改动」。

## 5. 修法（按优先级）

### 5.1 先量出来，别直接调大超时

调超时是把症状盖住。先确认耗时到底花在哪：

```bash
pnpm vitest run tests/supply-public-cache-hook.test.ts --reporter=verbose
```

对比单独跑与全量跑的该用例耗时，确认是**冷导入**而非别的。

### 5.2 候选修法

| 方案 | 代价 | 备注 |
|---|---|---|
| 给该 `it` 显式 timeout（如 20s） | 最小 | 治标。但对「验静态接线」的用例来说，超时本来就不该是判据 |
| 改为静态 `import` | 小 | 需确认该文件顶层 import `@/collections/Listings` 不会引发副作用（payload.config 链）——**这是本方案唯一的风险点，要实测** |
| 该文件单独 `poolOptions` 或 `isolate: false` | 中 | 影响面大，不建议为一个用例改全局配置 |

倾向 **静态 import**：这个用例验的是「hook 有没有挂上」，是纯静态事实，
本就不需要在测试运行时动态加载。

### 5.3 顺带看一眼同族用例

`tests/` 下其它用 `await import('@/collections/...')` 的用例是否有同样风险。
只修一个而留着同型写法，下次会从另一个文件复发。

## 6. 验证

修完**连续跑三次全量单测**，三次都绿才算数——这个缺陷的本质是概率性的，
跑一次通过不能证明任何事。

```bash
for i in 1 2 3; do pnpm test || echo "第 $i 次失败"; done
```
