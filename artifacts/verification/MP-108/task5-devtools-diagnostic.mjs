#!/usr/bin/env node
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {DIR,ROOT,baseEnvironment,identity,redact} from './task5-local.mjs'
identity()
const evidence=JSON.parse(readFileSync(path.join(DIR,'local-devtools.json')))
const env={...baseEnvironment(),WECHAT_DEVTOOLS_CLI:'/Applications/wechatwebdevtools.app/Contents/MacOS/cli'}
const connect=process.argv[2]==='connect'
const script=connect ? `import assert from 'node:assert/strict';import automator from 'miniprogram-automator';import{createDevtoolsSmokeRunner}from'./scripts/devtools-smoke.mjs';try{await createDevtoolsSmokeRunner({includeDetail:true,automator:{launch:async()=>{const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:9420'});const info=await mp.callWxMethod('getAccountInfoSync');assert.equal(info.miniProgram.envVersion,'develop');console.log('CONFIRMED_ENV: develop');mp.on('exception',e=>console.error('RUNTIME_EXCEPTION: '+JSON.stringify(e)));return mp}}})();console.log('DIAGNOSTIC_SMOKE_PASS')}catch(e){console.error('DIAGNOSTIC_SMOKE_ERROR: '+e.message);process.exitCode=1}` : `import {runDevtoolsSmoke} from './scripts/devtools-smoke.mjs';try{await runDevtoolsSmoke();console.log('DIAGNOSTIC_SMOKE_PASS')}catch(e){console.error('DIAGNOSTIC_SMOKE_ERROR: '+e.message);process.exitCode=1}`
const start=new Date().toISOString()
const r=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:path.join(ROOT,'sbh-miniprogram'),env,encoding:'utf8',timeout:70000,maxBuffer:1024*1024})
const key=connect?'connectDiagnostic':'diagnostic'
evidence[key]={recordedAt:start,command:connect?'CLI auto 已显式打开本项目后，仅连接本机9420，先断言develop再运行原三页检查':'Node 调用原 runDevtoolsSmoke 只输出其原始异常消息（不改测试）',exitCode:r.status??1,output:redact(`${r.stdout??''}${r.stderr??''}`,env),cliReadOnlyChecks:'cli --help exit0；cli islogin exit0且login=true；原Launcher将CLI stdout设为ignore，所以常规失败消息缺失细节。CLI auto --project 当前小程序目录 --auto-port 9420 --trust-project exit0。'}
writeFileSync(path.join(DIR,'local-devtools.json'),JSON.stringify(evidence,null,2)+'\n');console.log(evidence[key].output);process.exitCode=r.status??1
