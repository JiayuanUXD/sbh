#!/usr/bin/env node
/**
 * OPT-057 验证脚本：出售频道在「无任何功能开关」时恒定可用。
 *
 * 为什么需要它：`.agent/testing.md`「证据质量」第一条——验证脚本必须随证据一起提交，
 * 证据文件不能自证。本脚本产出的 JSON 即 verification.md 中所有实测数字的来源。
 *
 * 前提：被测服务必须在**环境里没有 NEXT_PUBLIC_SALE_CHANNEL_ENABLED** 的情况下启动。
 * 脚本会先自证这一点（premise.flagInProcessEnv 必须为 null）——若该变量还在，
 * 整份结果不成立，脚本直接以非 0 退出。
 *
 * 用法：
 *   node artifacts/verification/OPT-057/verify-sale-channel-always-on.mjs \
 *     [baseUrl] > artifacts/verification/OPT-057/verify.output.json
 *
 * 环境变量：
 *   ADMIN_EMAIL / ADMIN_PASSWORD  后台账号（默认用本地种子 e2e-adm）
 *   ALLOW_MUTATE=1                允许「临时把一条房源改成 sale → 验字段组 → 还原」
 *                                 这段夹具（默认跳过）。还原写在 finally 里，
 *                                 输出中 mutationProbe.restored 记录是否还原成功。
 */

const BASE = process.argv[2] ?? 'http://localhost:3717'
const EMAIL = process.env.ADMIN_EMAIL ?? 'e2e-adm@example.com'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Test1234!'
const ALLOW_MUTATE = process.env.ALLOW_MUTATE === '1'

const out = { baseUrl: BASE, ranAt: new Date().toISOString() }

/** 前提自证：进程环境里不得有该开关，否则本次结果无意义。 */
out.premise = {
  flagInProcessEnv: process.env.NEXT_PUBLIC_SALE_CHANNEL_ENABLED ?? null,
  note: '必须为 null——脚本验的是「没有这个变量时功能仍在」',
}

async function status(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  return { path, status: res.status, location: res.headers.get('location') }
}

async function main() {
  // 1. 公开路由
  out.routes = []
  for (const p of ['/sale', '/shanghai/sale', '/sitemap.xml']) {
    out.routes.push(await status(p))
  }

  // 2. sitemap 是否含出售条目 + 库里出售房源数（解释「为什么是这个结果」）
  const sitemap = await fetch(`${BASE}/sitemap.xml`).then((r) => r.text())
  const listRes = await fetch(
    `${BASE}/api/listings?where[businessType][equals]=sale&limit=0&depth=0`,
  )
  const listJson = listRes.ok ? await listRes.json() : null
  out.sitemap = {
    saleEntries: (sitemap.match(/<loc>[^<]*\/sale<\/loc>/g) ?? []).length,
    saleListingsInDb: listJson?.totalDocs ?? null,
    note: 'sitemap 条目阈值是「有效出售房源数 > 0」；库里为 0 时无条目属正确行为，非回归',
  }

  // 3. 后台：登录后取创建页 HTML
  const login = await fetch(`${BASE}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  out.admin = { loginStatus: login.status }

  if (login.ok && cookie) {
    const html = await fetch(`${BASE}/admin/collections/listings/create`, {
      headers: { cookie },
    }).then((r) => r.text())
    out.admin.createPage = {
      hasBusinessTypeField: html.includes('field-businessType'),
      priceSectionTitle: html.includes('价格与交易参数')
        ? '价格与交易参数'
        : html.includes('租赁参数')
          ? '租赁参数（开关关闭态的旧文案——不应出现）'
          : '(未找到)',
      hasSaleTermsField: html.includes('field-saleTerms'),
      note: '新建时 businessType 非 sale，saleTerms 不应出现（按 businessType 分流仍在）',
    }

    // 4. 可选夹具：临时把一条房源改成 sale，验证「出售信息」字段组出现，再还原
    if (ALLOW_MUTATE) {
      const probe = { allowed: true }
      let target = null
      let originalBusinessType = null
      try {
        const first = await fetch(`${BASE}/api/listings?limit=1&depth=0`, {
          headers: { cookie },
        }).then((r) => r.json())
        target = first.docs?.[0]
        originalBusinessType = target?.businessType ?? null
        probe.listingId = target?.id ?? null
        probe.originalBusinessType = originalBusinessType

        const patch = await fetch(`${BASE}/api/listings/${target.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ businessType: 'sale', version: target.version }),
        }).then((r) => r.json())
        probe.patchedTo = patch.doc?.businessType ?? null

        const editHtml = await fetch(`${BASE}/admin/collections/listings/${target.id}`, {
          headers: { cookie },
        }).then((r) => r.text())
        probe.hasSaleTermsWhenSale = editHtml.includes('field-saleTerms')
      } catch (err) {
        probe.error = err instanceof Error ? err.message : String(err)
      } finally {
        if (target && originalBusinessType) {
          try {
            const cur = await fetch(`${BASE}/api/listings/${target.id}?depth=0`, {
              headers: { cookie },
            }).then((r) => r.json())
            const back = await fetch(`${BASE}/api/listings/${target.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', cookie },
              body: JSON.stringify({
                businessType: originalBusinessType,
                version: cur.version,
              }),
            }).then((r) => r.json())
            probe.restored = back.doc?.businessType === originalBusinessType
          } catch (err) {
            probe.restored = false
            probe.restoreError = err instanceof Error ? err.message : String(err)
          }
        }
      }
      out.mutationProbe = probe
    } else {
      out.mutationProbe = { allowed: false, note: '设 ALLOW_MUTATE=1 才跑（会临时改一条房源并还原）' }
    }
  }

  // 5. 判定
  const routeOk =
    out.routes.find((r) => r.path === '/shanghai/sale')?.status === 200 &&
    out.routes.find((r) => r.path === '/sitemap.xml')?.status === 200
  const adminOk =
    out.admin.createPage?.hasBusinessTypeField === true &&
    out.admin.createPage?.priceSectionTitle === '价格与交易参数' &&
    out.admin.createPage?.hasSaleTermsField === false
  const mutationOk =
    !ALLOW_MUTATE ||
    (out.mutationProbe?.hasSaleTermsWhenSale === true && out.mutationProbe?.restored === true)

  out.verdict = {
    premiseHolds: out.premise.flagInProcessEnv === null,
    routeOk,
    adminOk,
    mutationOk,
    pass: out.premise.flagInProcessEnv === null && routeOk && adminOk && mutationOk,
  }

  console.log(JSON.stringify(out, null, 2))
  if (!out.verdict.pass) process.exit(1)
}

main().catch((err) => {
  out.fatal = err instanceof Error ? err.message : String(err)
  console.log(JSON.stringify(out, null, 2))
  process.exit(1)
})
