/**
 * OPT-033 验收：平台管理员保存即发布（本地库，只动自己造的数据）
 *
 * 为什么走 Local API 而不是点后台：后台会话过期后无法代输密码，而这里能以
 * **真实 ADM 用户身份**发起一次真实保存，直接观察两轴与审计记录——比点界面
 * 更能证明「hook 在真实写入链路上生效」。
 *
 * 造的数据全部在 finally 里删掉，不留痕。
 *
 * 运行：node --env-file-if-exists=.env.local --import tsx scripts/verify-opt033.ts
 */

const out: string[] = []
const log = (s: string) => {
  out.push(s)
  console.log(s)
}

let ok = true
const check = (label: string, pass: boolean, detail = '') => {
  if (!pass) ok = false
  log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? '  → ' + detail : ''}`)
}

async function main() {
  const { getPayload } = await import('payload')
  const { default: config } = await import('../src/payload.config')
  const payload = await getPayload({ config })

  const created: Array<{ collection: string; id: number | string }> = []
  const track = (collection: string, id: number | string) => created.push({ collection, id })

  try {
    // ── 找角色与用户 ──
    const roles = await payload.find({ collection: 'roles', limit: 100, overrideAccess: true })
    const adm = roles.docs.find((r) => (r as { code?: string }).code === 'ADM')
    const nonAdm = roles.docs.find((r) => (r as { code?: string }).code === 'OPS')
    if (!adm || !nonAdm) throw new Error('本地库缺少内置角色 ADM / OPS，先跑 pnpm seed')

    const users = await payload.find({ collection: 'users', limit: 200, overrideAccess: true })
    const pick = (roleId: unknown) =>
      users.docs.find((u) => {
        const rs = (u as { roles?: unknown[] }).roles ?? []
        return rs.some((r) => (typeof r === 'object' ? (r as { id?: unknown }).id : r) === roleId)
      })
    const admUser = pick(adm.id)
    const opsUser = pick(nonAdm.id)
    if (!admUser) throw new Error('本地库没有 ADM 用户')
    log(`ADM 用户: #${admUser.id}  非 ADM 用户: ${opsUser ? '#' + opsUser.id : '(无，跳过负向用例)'}`)

    // ── 找一个可复用的楼盘 / 经纪人 / 商户 / 媒体，凑齐发布必填 ──
    const building = (await payload.find({ collection: 'buildings', limit: 1, overrideAccess: true })).docs[0]
    const broker = (await payload.find({ collection: 'brokers', limit: 1, overrideAccess: true })).docs[0]
    const merchant = (await payload.find({ collection: 'merchants', limit: 1, overrideAccess: true })).docs[0]
    const media = (await payload.find({ collection: 'media', limit: 3, overrideAccess: true })).docs
    if (!building || !broker || !merchant || media.length < 3) {
      throw new Error('本地库素材不足（楼盘/经纪人/商户/至少 3 张媒体），先跑 pnpm seed && pnpm seed:media')
    }

    const completeData = () => ({
      title: `OPT-033 验收房源 ${Date.now()}`,
      building: building.id as number,
      listingType: 'full-floor' as const,
      businessType: 'lease' as const,
      decorationStatus: 'furnished' as const,
      price: { amount: 4.8, currency: 'CNY', period: 'day', unit: 'sqm' },
      area: 1280,
      floor: '3F',
      minimumLeaseMonths: 12,
      paymentTerms: '押二付三',
      availableFrom: new Date().toISOString(),
      description: '验收用房源',
      contactBroker: broker.id as number,
      merchant: merchant.id as number,
      mediaItems: media.slice(0, 3).map((m, i) => ({
        resource: m.id as number,
        kind: 'image' as const,
        category: 'workspace' as const,
        alt: `验收图 ${i + 1}`,
      })),
    })

    // ── 用例 1：ADM 保存完整房源 → 自动上架 ──
    log('\n[1] ADM 保存完整房源')
    const l1 = await payload.create({
      collection: 'listings',
      data: completeData(),
      user: admUser as never,
      overrideAccess: true,
    })
    track('listings', l1.id)
    check('审核状态 = approved', l1.reviewStatus === 'approved', String(l1.reviewStatus))
    check('发布状态 = published', l1.publicationStatus === 'published', String(l1.publicationStatus))

    const rev = await payload.find({
      collection: 'listing-reviews',
      where: { listing: { equals: l1.id } },
      limit: 10,
      overrideAccess: true,
    })
    const ft = rev.docs.find((r) => (r as { decision?: string }).decision === 'fast_track')
    check('产生了 fast_track 审核记录', Boolean(ft))
    const reviewedBy = ft ? (ft as { reviewedBy?: unknown }).reviewedBy : undefined
    const reviewedById = typeof reviewedBy === 'object' && reviewedBy !== null ? (reviewedBy as { id?: unknown }).id : reviewedBy
    check('记录写了操作人（历史缺陷点）', reviewedById === admUser.id, `reviewedBy=${JSON.stringify(reviewedById)}`)
    check('taskStatus = resolved（不在审核队列挂着）', (ft as { taskStatus?: string } | undefined)?.taskStatus === 'resolved')

    const audits = await payload.find({
      collection: 'audit-logs',
      where: { action: { equals: 'listing.review_fast_track' } },
      limit: 5,
      sort: '-createdAt',
      overrideAccess: true,
    })
    check('写了 listing.review_fast_track 审计日志', audits.totalDocs > 0, `共 ${audits.totalDocs} 条`)

    // ── 用例 2：ADM 保存不完整房源 → 只存草稿 ──
    log('\n[2] ADM 保存图片不足的房源')
    const partial = completeData()
    partial.mediaItems = partial.mediaItems.slice(0, 1)
    const l2 = await payload.create({
      collection: 'listings',
      data: partial,
      user: admUser as never,
      overrideAccess: true,
    })
    track('listings', l2.id)
    check('审核状态仍为 not_submitted', l2.reviewStatus === 'not_submitted', String(l2.reviewStatus))
    check('发布状态仍为 draft（不产生前台 404 幽灵）', l2.publicationStatus === 'draft', String(l2.publicationStatus))
    const rev2 = await payload.find({
      collection: 'listing-reviews',
      where: { listing: { equals: l2.id } },
      limit: 5,
      overrideAccess: true,
    })
    check('没有产生审核记录', rev2.totalDocs === 0, `${rev2.totalDocs} 条`)

    // ── 用例 3：非 ADM 保存完整房源 → 不自动上架 ──
    if (opsUser) {
      log('\n[3] 非 ADM（OPS）保存完整房源')
      const l3 = await payload.create({
        collection: 'listings',
        data: completeData(),
        user: opsUser as never,
        overrideAccess: true,
      })
      track('listings', l3.id)
      check('审核状态仍为 not_submitted', l3.reviewStatus === 'not_submitted', String(l3.reviewStatus))
      check('发布状态仍为 draft', l3.publicationStatus === 'draft', String(l3.publicationStatus))
    }

    // ── 用例 4：已上架房源再保存不重复记账 ──
    log('\n[4] ADM 再次保存已上架房源')
    const before = (
      await payload.find({
        collection: 'listing-reviews',
        where: { listing: { equals: l1.id } },
        limit: 20,
        overrideAccess: true,
      })
    ).totalDocs
    await payload.update({
      collection: 'listings',
      id: l1.id,
      data: { floor: '5F' },
      user: admUser as never,
      overrideAccess: true,
    })
    const after = (
      await payload.find({
        collection: 'listing-reviews',
        where: { listing: { equals: l1.id } },
        limit: 20,
        overrideAccess: true,
      })
    ).totalDocs
    check('审核记录数不变（approved 不再触发 fast_track）', after === before, `${before} → ${after}`)
  } finally {
    for (const c of created.reverse()) {
      try {
        await (await import('payload')).getPayload({ config: (await import('../src/payload.config')).default })
        const p = await (await import('payload')).getPayload({
          config: (await import('../src/payload.config')).default,
        })
        await p.delete({ collection: c.collection as never, id: c.id, overrideAccess: true })
      } catch (e) {
        log(`  [清理失败] ${c.collection}#${c.id}: ${(e as Error).message}`)
      }
    }
    log('\n造的数据已清理')
  }

  log(`\n=== ${ok ? '全部通过' : '存在失败项'} ===`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
