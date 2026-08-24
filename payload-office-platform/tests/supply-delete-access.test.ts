import { describe, expect, it } from 'vitest'

import { Buildings } from '@/collections/Buildings'
import { Listings } from '@/collections/Listings'
import { OPERATION_CODES } from '@/domain/auth/permission-codes'

/**
 * `Listings` / `Buildings` 的删除权限（OPT-051）。
 *
 * ## 修的是什么
 *
 * 这两个集合的 `access` 里**只有 `read`**，`delete` 缺省 → Payload 默认
 * 「任何登录用户都能删」。而其余十个集合都显式收了口——供给侧最核心的这两个
 * 反倒是例外。
 *
 * 三点让它比看起来更危险：
 *   1. `trash: true` 只影响后台按钮语义，**不影响 `access.delete` 的判定**；
 *   2. 本项目 `payload.delete` 恒为硬删（`trash` 参数只是查询过滤器）；
 *   3. 这个库上已经真实发生过一次房源硬删。
 *
 * ## 断言的是行为，不是配置长什么样
 *
 * 反面写法是 `expect(Listings.access.delete).toBeDefined()`——那只能证明「有个函数」，
 * 证明不了它真的拦人。这里直接**调用**那个 access 函数，喂不同权限的用户，验返回值。
 *
 * （同一条教训见 OPT-045 §10.5.3。）
 */

/** 构造一个带指定 operationPermissions 的 access 调用参数。 */
function argsFor(codes: string[] | null) {
  return {
    req: {
      // getPermissionContext → buildPermissionContext 的 loadRoles 会调
      // req.payload.find 去补齐「只给了 id」的角色。这里角色已展开成完整文档，
      // 走不到那条路径，但 payload 仍要存在——缺了会在构造阶段就抛。
      payload: { find: async () => ({ docs: [] }) },
      user:
        codes === null
          ? null
          : {
              id: 1,
              collection: 'users',
              // ⚠️ user.status 必须是 'active'——buildPermissionContext 的**第一件事**
              // 就是 `if (user.status !== 'active') return null`。漏了它，ctx 恒为 null，
              // 于是所有「拒绝」用例照样绿——**绿的原因却是判定压根没跑**。
              // 这正是一组会永远通过的假测试，本文件初版差点就这么写成了。
              status: 'active',
              // 三处容易写错、且写错了只会「静默拒绝」而不报错：
              //   1. 字段是 `roles`（复数、数组），不是 `role`；
              //   2. 角色必须 status:'active'，否则整条被 continue 跳过；
              //   3. operationPermissions 是**裸字符串数组**，包成 { code } 对象
              //      会被 parsePermissionArray 静默过滤掉。
              // 本测试初版三条全踩了，表现都是「有权限也拒绝」。
              roles: [
                {
                  id: 1,
                  code: 'TEST',
                  status: 'active',
                  dataScope: 'global',
                  operationPermissions: codes,
                  menuPermissions: [],
                  fieldPermissions: [],
                },
              ],
            },
    },
  } as never
}

const CASES = [
  { name: 'Listings', collection: Listings, code: 'listing:delete' },
  { name: 'Buildings', collection: Buildings, code: 'building:delete' },
] as const

describe.each(CASES)('$name 的删除权限', ({ collection, code }) => {
  it('未登录 → 拒绝', async () => {
    const fn = collection.access?.delete
    expect(fn, 'access.delete 没配 —— 缺省即「任何登录用户可删」').toBeTypeOf('function')
    await expect(Promise.resolve(fn!(argsFor(null)))).resolves.toBe(false)
  })

  it('登录但没有对应权限码 → 拒绝（这是本工作项的核心）', async () => {
    const fn = collection.access!.delete!
    await expect(Promise.resolve(fn(argsFor(['listing:review', 'report:read'])))).resolves.toBe(false)
  })

  it(`持有 ${'`'}${code}${'`'} → 放行`, async () => {
    const fn = collection.access!.delete!
    await expect(Promise.resolve(fn(argsFor([code])))).resolves.toBe(true)
  })

  it('通配符 * （ADM）→ 放行', async () => {
    const fn = collection.access!.delete!
    await expect(Promise.resolve(fn(argsFor(['*'])))).resolves.toBe(true)
  })

  it('另一个集合的删除码不能越权', async () => {
    const other = code === 'listing:delete' ? 'building:delete' : 'listing:delete'
    const fn = collection.access!.delete!
    await expect(Promise.resolve(fn(argsFor([other])))).resolves.toBe(false)
  })

  it('read 仍对匿名开放（不能因为收口 delete 把公开站点也关了）', async () => {
    const readFn = collection.access?.read
    expect(readFn).toBeTypeOf('function')
    expect(readFn!(argsFor(null))).toBe(true)
  })
})

describe('权限码本身', () => {
  it('listing:delete / building:delete 必须在权限码表里', () => {
    // 这两个码此前**定义了但从未被消费、也从未授予任何角色**，是一对死代码。
    // 接上之后要保证它们不被顺手删掉——删掉会让 createCollectionAccess
    // 拿到一个永远无人持有的码，等于把删除彻底焊死，且没有任何提示。
    expect(OPERATION_CODES).toContain('listing:delete')
    expect(OPERATION_CODES).toContain('building:delete')
  })
})
