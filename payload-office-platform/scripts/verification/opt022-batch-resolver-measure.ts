/**
 * Sanitized, read-only reproduction of the OPT-022 local PostgreSQL batch
 * resolver measurement. Run from payload-office-platform/:
 *
 * node --env-file-if-exists=.env.local --import tsx \
 *   scripts/verification/opt022-batch-resolver-measure.ts
 *
 * The command loads DATABASE_URL only from the local environment; it neither
 * prints environment values nor performs writes.
 */
import { performance } from 'node:perf_hooks'

import { getPayload } from 'payload'

import config from '../../src/payload.config'
import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '../../src/domain/review/effective-supply'
import { createEffectiveSupplyPayloadPort } from '../../src/domain/review/effective-supply-payload-port'
import { resolveEffectiveSupplies } from '../../src/domain/review/effective-supply-snapshot'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function measure(): Promise<void> {
  const payload = await getPayload({ config })

  try {
    const queryPort = createEffectiveSupplyPayloadPort(payload)
    const asOf = new Date()
    const pausedIds = await getPausedListingIds(queryPort)
    const candidates = await payload.find({
      collection: 'listings',
      where: {
        ...getEffectiveSupplyWhere(asOf),
        ...(pausedIds.length > 0 ? { id: { not_in: pausedIds } } : {}),
      },
      depth: 2,
      limit: 500,
      pagination: false,
      overrideAccess: true,
    })

    let relationFindCalls = 0
    const measuredQueryPort: PayloadQueryPort = {
      find: async (params) => {
        if (params.collection === 'listing-merchant-relations') relationFindCalls += 1
        return queryPort.find(params)
      },
    }
    const candidateDocuments: Array<Record<string, unknown>> = []
    for (const candidate of candidates.docs) {
      if (!isRecord(candidate)) {
        throw new TypeError('OPT-022 measurement received an invalid listing document')
      }
      candidateDocuments.push(candidate)
    }
    const startedAt = performance.now()
    const results = await resolveEffectiveSupplies(
      measuredQueryPort,
      candidateDocuments,
      asOf,
    )
    const elapsedMs = performance.now() - startedAt

    console.log(JSON.stringify({
      candidates: candidates.docs.length,
      relationFindCalls,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      eligible: [...results.values()].filter((result) => result.eligible).length,
    }))
  } finally {
    await payload.db.destroy?.()
  }
}

measure()
  .catch(() => {
    // Do not serialize connection errors: drivers can include connection details.
    console.error('OPT-022 batch resolver measurement failed')
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
