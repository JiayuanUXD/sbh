import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type PayloadRequest,
  type Where,
} from "payload";

import { withAudit } from "@/domain/audit/with-audit";
import { SKIP_SUPPLY_CACHE_INVALIDATION } from "@/domain/public-catalog/supply-cache-hook";
import { listingReportPauseWhere } from "@/domain/review/effective-supply";
import { buildEffectiveSnapshot } from "@/domain/review/effective-supply-snapshot";
import { isListingEffectivelySupplied } from "@/domain/review/effective-supply";
import { assertTransactionIntact } from "@/domain/shared/transaction-safety";
import {
  isPublicBuilding,
  isPublicBuildingLike,
} from "@/domain/supply/public-building";
import { invalidateSupplyImportCache } from "@/domain/supply-import/cache-invalidation";

export type PublishPhase = "buildings" | "listings";
export const SOURCE_PUBLISH_LIMIT = 100;
const CONCURRENCY = 4;
const BUDGET_MS = 20_000;

export function sourcePublishWhere(phase: PublishPhase, afterId = 0): Where {
  return {
    and: [
      { "dataSource.source": { equals: "huizuxuanzhi" } },
      { deletedAt: { exists: false } },
      { id: { greater_than: afterId } },
      ...(phase === "buildings"
        ? [
            { status: { equals: "draft" } },
            { operationalStatus: { equals: "active" } },
          ]
        : [
            { publicationStatus: { equals: "draft" } },
            { reviewStatus: { equals: "not_submitted" } },
            { supplyVisibilityHold: { equals: "normal" } },
          ]),
    ],
  };
}

export async function pendingSourceSync(req: PayloadRequest): Promise<boolean> {
  const result = await req.payload.count({
    collection: "source-sync-batches",
    where: {
      source: { equals: "huizuxuanzhi" },
      status: { not_equals: "completed" },
    },
    overrideAccess: false,
    req,
  });
  return result.totalDocs > 0;
}

export async function sourcePublishCounts(req: PayloadRequest) {
  const buildings = await req.payload.count({
    collection: "buildings",
    where: sourcePublishWhere("buildings"),
    overrideAccess: false,
    req,
  });
  const listings = await req.payload.count({
    collection: "listings",
    where: sourcePublishWhere("listings"),
    overrideAccess: false,
    req,
  });
  return { buildings: buildings.totalDocs, listings: listings.totalDocs };
}

export async function publishSourceSlice(
  req: PayloadRequest,
  phase: PublishPhase,
  afterId: number,
) {
  const startedAt = Date.now();
  const candidates = await req.payload.find({
    collection: phase,
    where: sourcePublishWhere(phase, afterId),
    sort: "id",
    depth: 0,
    limit: SOURCE_PUBLISH_LIMIT,
    overrideAccess: false,
    req,
  });
  let cursor = afterId;
  let processed = 0;
  let published = 0;
  let skipped = 0;
  const errors: { id: number; message: string }[] = [];
  for (let offset = 0; offset < candidates.docs.length; offset += CONCURRENCY) {
    if (processed > 0 && Date.now() - startedAt >= BUDGET_MS) break;
    const group = candidates.docs.slice(offset, offset + CONCURRENCY);
    const outcomes = await Promise.all(
      group.map(async (candidate) => {
        // 每个对象独立事务与快捷审核标记，单条失败不能污染后续对象。
        let itemReq: PayloadRequest | undefined;
        let ownsTransaction = false;
        let itemPublished = false;
        try {
          itemReq = await createLocalReq(
            {
              user: req.user ?? undefined,
              context: { [SKIP_SUPPLY_CACHE_INVALIDATION]: true },
            },
            req.payload,
          );
          ownsTransaction = await initTransaction(itemReq);
          if (!ownsTransaction) throw new Error("无法建立发布事务");
          const transactionID = itemReq.transactionID;
          const current = await req.payload.find({
            collection: phase,
            where: {
              and: [
                sourcePublishWhere(phase),
                { id: { equals: candidate.id } },
              ],
            },
            limit: 1,
            depth: 2,
            ...(phase === "listings"
              ? {
                  select: { version: true, building: true, merchant: true },
                  populate: {
                    buildings: {
                      status: true,
                      operationalStatus: true,
                      deletedAt: true,
                      city: true,
                      district: true,
                    },
                    locations: { status: true },
                    merchants: {
                      status: true,
                      qualificationStatus: true,
                      qualificationExpiresAt: true,
                      serviceCities: true,
                    },
                  },
                }
              : {}),
            overrideAccess: false,
            req: itemReq,
          });
          const doc = current.docs[0];
          if (!doc) {
            if (ownsTransaction) await commitTransaction(itemReq);
            return { id: candidate.id, published: false, skipped: true };
          } else if (phase === "buildings") {
            const building = doc as import("@/payload-types").Building;
            if (!isPublicBuildingLike({ ...building, status: "published" }))
              throw new Error("楼盘城市或行政区未启用");
            await withAudit({
              req: itemReq,
              action: "building.update",
              object: {
                collection: "buildings",
                objectId: building.id,
                objectVersion: building.version ?? 1,
              },
              before: building as unknown as Record<string, unknown>,
              reason: "发布汇租选址采集楼盘",
              fn: async () => {
                const updated = await req.payload.update({
                  collection: "buildings",
                  id: building.id,
                  data: { status: "published", version: building.version ?? 1 },
                  depth: 0,
                  overrideAccess: false,
                  req: itemReq,
                });
                return {
                  ok: true,
                  data: updated,
                  after: updated as unknown as Record<string, unknown>,
                  changedFields: ["status"],
                };
              },
            });
            itemPublished = true;
          } else {
            const listing = doc as import("@/payload-types").Listing;
            const building =
              typeof listing.building === "object" ? listing.building : null;
            if (!isPublicBuilding(building))
              throw new Error("关联楼盘尚未公开或所属位置未启用");
            const supply = isListingEffectivelySupplied(
              buildEffectiveSnapshot(
                listing as unknown as Record<string, unknown>,
              ),
              new Date(),
            );
            if (!supply.eligible)
              throw new Error(
                `供给商户不符合公开条件：${supply.reasons.join("、")}`,
              );
            const reports = await req.payload.count({
              collection: "listing-reports",
              where: {
                ...listingReportPauseWhere(),
                targetListing: { equals: listing.id },
              },
              overrideAccess: false,
              req: itemReq,
            });
            if (reports.totalDocs > 0) throw new Error("房源存在有效举报暂停");
            const updated = await req.payload.update({
              collection: "listings",
              id: listing.id,
              data: { version: listing.version ?? 1 },
              depth: 0,
              overrideAccess: false,
              req: itemReq,
            });
            if (
              updated.publicationStatus !== "published" ||
              updated.reviewStatus !== "approved"
            )
              throw new Error("管理员审核发布未完成");
            itemPublished = true;
          }
          assertTransactionIntact(
            itemReq,
            transactionID,
            "source-sync-publish",
          );
          if (ownsTransaction) await commitTransaction(itemReq);
          return { id: candidate.id, published: itemPublished, skipped: false };
        } catch (error) {
          if (ownsTransaction && itemReq) await killTransaction(itemReq);
          return {
            id: candidate.id,
            published: false,
            skipped: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    // 等当前有序组全部完成后才推进游标，避免跳过并发中尚未完成的对象。
    for (const outcome of outcomes) {
      processed++;
      cursor = outcome.id;
      if (outcome.published) published++;
      if (outcome.skipped) skipped++;
      if ("message" in outcome && outcome.message !== undefined)
        errors.push({ id: outcome.id, message: outcome.message });
    }
  }
  const done = processed === candidates.docs.length && !candidates.hasNextPage;
  // 阶段结束才失效一次（OPT-111）。原来每段（≤100 条）只要发布一条就按全城市类目
  // 兜底清一次，5.7 万条房源一轮约 570 次，前台缓存在整个发布期间几乎一直是冷的。
  // 不论本段是否发布都清：前面的段可能已发布。进行中新发布的房源靠 300s TTL 出现
  // （用户已确认的 D2；新增可见性晚到是良性的）；中途停止同样由 TTL 兜底。
  // 「下架必须立即不可见」不受影响：回滚端点仍立即失效。
  if (done)
    await invalidateSupplyImportCache(req.payload, req, [], "source_sync");
  return {
    cursor,
    processed,
    published,
    skipped,
    errors,
    done,
  };
}
