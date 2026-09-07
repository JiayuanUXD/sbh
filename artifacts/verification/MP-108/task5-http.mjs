#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DIR, SHA, identity, baseEnvironment, run, redact } from './task5-local.mjs'
identity()
const result={status:'FAILED',candidateSha:SHA,recordedAt:new Date().toISOString(),database:'sbh_dev_mp108_prod',commands:[],initialDiagnostic:'首次未设 CI 导致 COS guard 503；按仓库 CI 本地离线例外添加 CI=1，未设置 COS 或修改守卫。初始日志保留。'}
try {
  const h=await fetch('http://127.0.0.1:3717/api/health'); result.health=await h.json(); assert.equal(h.status,200);assert.equal(result.health.status,'ok');assert.equal(result.health.version,SHA)
  run(process.execPath,['scripts/verify-mini-api.mjs','http://127.0.0.1:3717',path.join(DIR,'local-mini-api-probe.json')],baseEnvironment(),result.commands)
  result.probe=JSON.parse(readFileSync(path.join(DIR,'local-mini-api-probe.json')))
  const r=await fetch('http://127.0.0.1:3717/api/mini/v1/listings?city=shanghai&page=1');const body=await r.json()
  result.pagination=body.data.pagination;assert.equal(result.pagination.page,1);assert.equal(result.pagination.pageSize,24);assert(body.data.items.length<=24);assert.equal(result.pagination.totalPages,Math.ceil(result.pagination.totalDocs/24))
  result.paginationContract='源码 public-catalog/types.ts 固定 pageSize=24；初始补充探针误设2已纠正，仅重跑只读GET。'
  result.paginationRequestId=body.meta.requestId
  const logs=readFileSync(path.join(DIR,'local-server-http.log'),'utf8')
  result.correlatedRequestIds=['home','list','detail','invalidCity','invalidListing'].map(k=>result.probe[k].requestId)
  for(const id of result.correlatedRequestIds)assert(logs.includes(id),'request ID 未命中本轮 server 日志')
  result.status='PASS'
}catch(error){result.failure=redact(error.message);process.exitCode=1}
writeFileSync(path.join(DIR,'local-mini-api.json'),JSON.stringify(result,null,2)+'\n');console.log(`MINI HTTP ${result.status}${result.failure?' '+result.failure:''}`)
