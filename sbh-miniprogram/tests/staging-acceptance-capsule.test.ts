import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { constants as fsConstants, promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type CapsulePhase =
  | 'prepared'
  | 'clean_start_proven'
  | 'first_write_dispatched'
  | 'lead_observed'
  | 'retry_write_dispatched'
  | 'idempotency_verified'
  | 'cleanup_dispatched'
  | 'cleanup_confirmed'

type Capsule = Readonly<{
  schemaVersion: 1
  phase: CapsulePhase
  runId: string
  submissionRequestId: string
  listingSlug: string
  fixtureNamespace: string
  origin: string
  expectedGitCommitSha: string
  expectedDeploymentRevision: string
  expectedDbFingerprint: string
  recoveryReceipt: string | null
  leadId: string | null
}>

type PreparedIdentity = Omit<Capsule, 'schemaVersion' | 'phase' | 'recoveryReceipt' | 'leadId'>

type CapsuleLease = Readonly<{
  readActive: () => Promise<Capsule | null>
  createPrepared: (identity: PreparedIdentity) => Promise<Capsule>
  transition: (
    nextPhase: CapsulePhase,
    patch?: Readonly<Record<string, unknown>>,
  ) => Promise<Capsule>
  removeConfirmed: () => Promise<void>
  release: () => Promise<void>
}>

type CapsuleStore = Readonly<{
  acquire: (mode: 'normal' | 'recovery') => Promise<CapsuleLease>
}>

type CapsuleModule = Readonly<{
  ACTIVE_CAPSULE_FILE_NAME: string
  RUNNER_LOCK_FILE_NAME: string
  DEFAULT_CAPSULE_ROOT: string
  CAPSULE_PHASES: readonly CapsulePhase[]
  parseAcceptanceCapsule: (input: string | Uint8Array) => Capsule
  serializeAcceptanceCapsule: (capsule: Capsule) => string
  transitionAcceptanceCapsule: (
    capsule: Capsule,
    mode: 'normal' | 'recovery',
    nextPhase: CapsulePhase,
    patch?: Readonly<Record<string, unknown>>,
  ) => Capsule
  createCapsuleStore: (options?: Readonly<{
    rootDir?: string
    processAlive?: (pid: number) => boolean | Promise<boolean>
    currentUid?: number
    fileSystem?: unknown
  }>) => CapsuleStore
}>

const capsuleModule = await import('../scripts/staging-acceptance-capsule.mjs' as never) as CapsuleModule
const {
  ACTIVE_CAPSULE_FILE_NAME,
  RUNNER_LOCK_FILE_NAME,
  DEFAULT_CAPSULE_ROOT,
  CAPSULE_PHASES,
  parseAcceptanceCapsule,
  serializeAcceptanceCapsule,
  transitionAcceptanceCapsule,
  createCapsuleStore,
} = capsuleModule

const RUN_ID = '550e8400-e29b-41d4-a716-446655440000'
const SUBMISSION_ID = '650e8400-e29b-41d4-a716-446655440000'
const ORIGIN = 'https://sbhmini-305971-11-1253925058.sh.run.tcloudbase.com'
const RECEIPT_BODY = Buffer.from(JSON.stringify({
  version: 1,
  purpose: 'acceptance-recovery-fence',
  runId: RUN_ID,
  submissionRequestId: SUBMISSION_ID,
})).toString('base64url')
const RECEIPT = `${RECEIPT_BODY}.${Buffer.alloc(32, 7).toString('base64url')}`

function namespace(runId = RUN_ID) {
  return `mp-e2e-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`
}

function validCapsule(override: Partial<Capsule> = {}): Capsule {
  return {
    schemaVersion: 1,
    phase: 'retry_write_dispatched',
    runId: RUN_ID,
    submissionRequestId: SUBMISSION_ID,
    listingSlug: 'jing-an-tower',
    fixtureNamespace: namespace(),
    origin: ORIGIN,
    expectedGitCommitSha: 'a'.repeat(40),
    expectedDeploymentRevision: 'sbhmini-004',
    expectedDbFingerprint: 'b'.repeat(64),
    recoveryReceipt: RECEIPT,
    leadId: 'n:42',
    ...override,
  }
}

function preparedIdentity(): PreparedIdentity {
  const {
    schemaVersion: _schemaVersion,
    phase: _phase,
    recoveryReceipt: _recoveryReceipt,
    leadId: _leadId,
    ...identity
  } = validCapsule()
  return identity
}

function capsuleAt(phase: CapsulePhase): Capsule {
  if (phase === 'prepared') {
    return validCapsule({ phase, recoveryReceipt: null, leadId: null })
  }
  if (phase === 'clean_start_proven' || phase === 'first_write_dispatched') {
    return validCapsule({ phase, leadId: null })
  }
  if (phase === 'cleanup_confirmed') {
    return validCapsule({ phase })
  }
  return validCapsule({ phase })
}

function wrongKeyOrderCapsuleJson() {
  const { phase, schemaVersion, ...rest } = validCapsule()
  return JSON.stringify({ phase, schemaVersion, ...rest })
}

const tempParents: string[] = []

async function tempRoot() {
  const parent = await fs.mkdtemp(join(tmpdir(), 'sbh-capsule-test-'))
  tempParents.push(parent)
  return { parent, rootDir: join(parent, 'acceptance-recovery') }
}

async function createPrivateRoot(rootDir: string) {
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 })
  await fs.chmod(rootDir, 0o700)
}

async function writeSecureFile(path: string, content: string) {
  await fs.writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await fs.chmod(path, 0o600)
}

function staleLock(pid = 2_000_000_000) {
  return JSON.stringify({
    schemaVersion: 1,
    pid,
    ownerToken: 'c'.repeat(64),
    mode: 'normal',
  })
}

function startRecoveryChild(rootDir: string) {
  const moduleUrl = new URL('../scripts/staging-acceptance-capsule.mjs', import.meta.url).href
  const source = `
    const { createCapsuleStore } = await import(${JSON.stringify(moduleUrl)});
    const waitForController = () => new Promise((resolve, reject) => {
      const cleanup = () => {
        process.stdin.off('data', onData);
        process.stdin.off('end', onEnd);
        process.stdin.off('error', onError);
      };
      const onData = (chunk) => { cleanup(); resolve(String(chunk).trim()); };
      const onEnd = () => { cleanup(); reject(new Error('controller_closed')); };
      const onError = () => { cleanup(); reject(new Error('controller_failed')); };
      process.stdin.once('data', onData);
      process.stdin.once('end', onEnd);
      process.stdin.once('error', onError);
    });
    process.stdout.write('ready\\n');
    try {
      if (await waitForController() !== 'start') throw new Error('controller_protocol');
      const lease = await createCapsuleStore({ rootDir: process.argv[1] }).acquire('recovery');
      process.stdout.write('acquired\\n');
      if (await waitForController() !== 'release') throw new Error('controller_protocol');
      await lease.release();
      process.stdout.write('released\\n');
    } catch (error) {
      process.stdout.write('rejected:' + (error instanceof Error ? error.message : 'unknown') + '\\n');
    } finally {
      process.stdin.destroy();
    }
  `
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source, rootDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let terminalError: Error | null = null
  type OutputWaiter = {
    fragments: readonly string[]
    resolve: (fragment: string) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
  const outputWaiters = new Set<OutputWaiter>()
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  const matchingFragment = (fragments: readonly string[]) => fragments.find((fragment) => stdout.includes(fragment))
  const flushOutputWaiters = () => {
    for (const waiter of outputWaiters) {
      const fragment = matchingFragment(waiter.fragments)
      if (fragment === undefined) continue
      outputWaiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.resolve(fragment)
    }
  }
  const rejectOutputWaiters = (error: Error) => {
    for (const waiter of outputWaiters) {
      outputWaiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
    flushOutputWaiters()
  })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  child.stdin.on('error', () => {
    // A concurrent child can close its controller pipe immediately after rejecting.
  })
  const closed = new Promise<{
    stdout: string
    stderr: string
    status: number | null
    spawnError: boolean
  }>((resolveChild) => {
    let settled = false
    const finish = (status: number | null, spawnError: boolean) => {
      if (settled) return
      settled = true
      terminalError = new Error(spawnError
        ? 'recovery child failed to start'
        : 'recovery child closed before expected output')
      flushOutputWaiters()
      rejectOutputWaiters(terminalError)
      resolveChild({ stdout, stderr, status, spawnError })
    }
    child.once('error', () => {
      destroyChildPipes(child)
      try {
        child.unref()
      } catch {
        // The waiter below still receives the fixed spawn failure.
      }
      finish(null, true)
    })
    child.once('close', (status) => finish(status, false))
  })
  const waitForAnyOutput = (fragments: readonly string[], timeoutMs = 5_000) => {
    const fragment = matchingFragment(fragments)
    if (fragment !== undefined) return Promise.resolve(fragment)
    if (terminalError !== null) return Promise.reject(terminalError)
    return new Promise<string>((resolveOutput, rejectOutput) => {
      let waiter!: OutputWaiter
      const timer = setTimeout(() => {
        outputWaiters.delete(waiter)
        rejectOutput(new Error('recovery child output timeout'))
      }, timeoutMs)
      waiter = { fragments, resolve: resolveOutput, reject: rejectOutput, timer }
      outputWaiters.add(waiter)
      flushOutputWaiters()
      if (terminalError !== null && outputWaiters.delete(waiter)) {
        clearTimeout(timer)
        rejectOutput(terminalError)
      }
    })
  }
  const waitForOutput = async (fragment: string, timeoutMs = 5_000) => {
    await waitForAnyOutput([fragment], timeoutMs)
  }
  const send = (signal: 'start' | 'release') => {
    if (!child.stdin.writable || child.stdin.destroyed) return false
    child.stdin.write(`${signal}\n`)
    return true
  }
  return {
    child,
    closed,
    waitForOutput,
    waitForAnyOutput,
    send,
    hasOutput: (fragment: string) => stdout.includes(fragment),
  }
}

type RecoveryChild = ReturnType<typeof startRecoveryChild>
type RecoveryChildResult = Awaited<RecoveryChild['closed']>
type BoundedPromiseOutcome<T> =
  | Readonly<{ settled: true; result: T }>
  | Readonly<{ settled: false }>

async function waitForPromiseWithin<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<BoundedPromiseOutcome<T>>((resolveOutcome) => {
    let settled = false
    const finish = (value: BoundedPromiseOutcome<T>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveOutcome(value)
    }
    const timer = setTimeout(() => finish({ settled: false }), timeoutMs)
    void promise.then(
      (result) => finish({ settled: true, result }),
      () => finish({ settled: false }),
    )
  })
}

async function waitForRecoveryChildClose(contender: RecoveryChild, timeoutMs: number) {
  return waitForPromiseWithin(contender.closed, timeoutMs)
}

async function waitForRecoveryChildren(contenders: readonly RecoveryChild[], timeoutMs: number) {
  const outcomes = await Promise.all(contenders.map((contender) =>
    waitForRecoveryChildClose(contender, timeoutMs)))
  if (!outcomes.every((outcome) => outcome.settled)) {
    throw new Error('recovery child close timeout')
  }
  return outcomes.map((outcome) => {
    if (!outcome.settled) throw new Error('recovery child close timeout')
    return outcome.result
  })
}

function destroyChildPipes(child: ChildProcess) {
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    try {
      stream?.destroy()
    } catch {
      // Test cleanup stays best-effort; a fixed failure is emitted after the second deadline.
    }
  }
}

async function terminateChildProcess(
  child: ChildProcess,
  closed: Promise<unknown>,
  options: Readonly<{ closeTimeoutMs?: number; killTimeoutMs?: number }> = {},
) {
  const closeTimeoutMs = options.closeTimeoutMs ?? 1_000
  const killTimeoutMs = options.killTimeoutMs ?? 500
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  } catch {
    // The bounded fallback below still destroys and unreferences every local handle.
  }
  if ((await waitForPromiseWithin(closed, closeTimeoutMs)).settled) return

  destroyChildPipes(child)
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  } catch {
    // The outward failure remains fixed.
  }
  try {
    child.unref()
  } catch {
    // The second deadline below still yields a fixed cleanup failure.
  }
  if (!(await waitForPromiseWithin(closed, killTimeoutMs)).settled) {
    throw new Error('test child cleanup failed')
  }
}

async function cleanupRecoveryChildren(
  contenders: readonly RecoveryChild[],
  options: Readonly<{ closeTimeoutMs?: number; killTimeoutMs?: number }> = {},
) {
  const closeTimeoutMs = options.closeTimeoutMs ?? 1_000
  const killTimeoutMs = options.killTimeoutMs ?? 500
  const releaseWatchers = contenders.map((contender) =>
    contender.waitForAnyOutput(['acquired\n', 'rejected:'], closeTimeoutMs).then((decision) => {
      if (decision === 'acquired\n' && !contender.hasOutput('released\n')) {
        contender.send('release')
      }
    }, () => undefined))

  const closedBeforeKill = await Promise.all(contenders.map((contender) =>
    waitForRecoveryChildClose(contender, closeTimeoutMs)))
  for (const [index, contender] of contenders.entries()) {
    if (closedBeforeKill[index]?.settled) continue
    try {
      if (contender.child.exitCode === null && contender.child.signalCode === null) {
        contender.child.kill('SIGKILL')
      }
    } catch {
      // Pipe destruction and unref below still guarantee the test runner can converge.
    }
    destroyChildPipes(contender.child)
  }

  const closedAfterKill = await Promise.all(contenders.map((contender, index) =>
    closedBeforeKill[index]?.settled
      ? Promise.resolve(closedBeforeKill[index])
      : waitForRecoveryChildClose(contender, killTimeoutMs)))
  await Promise.allSettled(releaseWatchers)
  if (!closedAfterKill.every((outcome) => outcome.settled)) {
    for (const [index, contender] of contenders.entries()) {
      if (closedAfterKill[index]?.settled) continue
      try {
        contender.child.unref()
      } catch {
        // The outward test-harness error stays fixed.
      }
    }
    throw new Error('recovery child cleanup failed')
  }
}

afterEach(async () => {
  const pending = tempParents.splice(0)
  await Promise.all(pending.map((path) => fs.rm(path, { recursive: true, force: true })))
})

describe('staging acceptance capsule schema', () => {
  it('锁定八个 phase，包含幂等验证 checkpoint', () => {
    expect(CAPSULE_PHASES).toEqual([
      'prepared',
      'clean_start_proven',
      'first_write_dispatched',
      'lead_observed',
      'retry_write_dispatched',
      'idempotency_verified',
      'cleanup_dispatched',
      'cleanup_confirmed',
    ])
  })

  it('以固定键顺序序列化，并无损解析 canonical capsule', () => {
    const capsule = validCapsule()
    const serialized = serializeAcceptanceCapsule(capsule)

    expect(serialized).toBe(JSON.stringify(capsule))
    expect(parseAcceptanceCapsule(serialized)).toEqual(capsule)
    expect(Object.isFrozen(parseAcceptanceCapsule(serialized))).toBe(true)
  })

  it.each([
    ['BOM', `\uFEFF${JSON.stringify(validCapsule())}`],
    ['leading whitespace', ` ${JSON.stringify(validCapsule())}`],
    ['trailing newline', `${JSON.stringify(validCapsule())}\n`],
    ['duplicate key', JSON.stringify(validCapsule()).replace('"phase":', '"phase":"prepared","phase":')],
    ['extra key', JSON.stringify({ ...validCapsule(), secret: 'must-not-be-stored' })],
    ['wrong key order', wrongKeyOrderCapsuleJson()],
  ])('拒绝非 canonical JSON：%s', (_label, input) => {
    expect(() => parseAcceptanceCapsule(input)).toThrow('staging acceptance capsule schema_invalid')
  })

  it('拒绝非法 UTF-8 与超限文件，且错误不回显内容', () => {
    const invalidUtf8 = Uint8Array.from([0xc3, 0x28])
    expect(() => parseAcceptanceCapsule(invalidUtf8)).toThrow('staging acceptance capsule schema_invalid')

    const secret = 'do-not-echo-this-secret'
    try {
      parseAcceptanceCapsule(`{"${secret}":"${'x'.repeat(9_000)}"}`)
      throw new Error('expected parser failure')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('staging acceptance capsule schema_invalid')
      expect((error as Error).message).not.toContain(secret)
    }
  })

  it.each([
    ['schema version', { schemaVersion: 2 }],
    ['unknown phase', { phase: 'done' }],
    ['run UUID', { runId: RUN_ID.toUpperCase() }],
    ['submission UUID', { submissionRequestId: '550e8400-e29b-11d4-a716-446655440000' }],
    ['listing slug', { listingSlug: '../jing-an-tower' }],
    ['namespace mismatch', { fixtureNamespace: 'mp-e2e-0000000000000000' }],
    ['origin', { origin: `${ORIGIN}/` }],
    ['Git SHA', { expectedGitCommitSha: 'A'.repeat(40) }],
    ['revision', { expectedDeploymentRevision: 'bad revision' }],
    ['fingerprint', { expectedDbFingerprint: 'b'.repeat(63) }],
    ['receipt padding', { recoveryReceipt: `${RECEIPT}=` }],
    ['receipt third segment', { recoveryReceipt: `${RECEIPT}.extra` }],
    ['receipt short body', { recoveryReceipt: `${Buffer.from('{}').toString('base64url')}.${Buffer.alloc(32).toString('base64url')}` }],
    ['receipt wrong signature bytes', { recoveryReceipt: `${RECEIPT_BODY}.${Buffer.alloc(31).toString('base64url')}` }],
    ['lead zero', { leadId: 'n:0' }],
    ['lead noncanonical number', { leadId: 'n:042' }],
    ['lead invalid encoded string', { leadId: 's:=' }],
  ])('拒绝非法 canonical 字段：%s', (_label, override) => {
    expect(() => serializeAcceptanceCapsule(validCapsule(override as Partial<Capsule>)))
      .toThrow('staging acceptance capsule schema_invalid')
  })

  it.each([
    ['prepared receipt', { phase: 'prepared', recoveryReceipt: RECEIPT, leadId: null }],
    ['prepared lead', { phase: 'prepared', recoveryReceipt: null, leadId: 'n:42' }],
    ['clean start missing receipt', { phase: 'clean_start_proven', recoveryReceipt: null, leadId: null }],
    ['first dispatch observed lead too early', { phase: 'first_write_dispatched', leadId: 'n:42' }],
    ['lead observed missing lead', { phase: 'lead_observed', leadId: null }],
    ['retry missing lead', { phase: 'retry_write_dispatched', leadId: null }],
    ['idempotency missing lead', { phase: 'idempotency_verified', leadId: null }],
    ['cleanup dispatch missing lead', { phase: 'cleanup_dispatched', leadId: null }],
  ])('拒绝 phase/receipt/Lead 不变量：%s', (_label, override) => {
    expect(() => serializeAcceptanceCapsule(validCapsule(override as Partial<Capsule>)))
      .toThrow('staging acceptance capsule schema_invalid')
  })

  it('只允许 prepared recovery shortcut 形成 receipt=null 的 terminal capsule', () => {
    const terminal = validCapsule({
      phase: 'cleanup_confirmed',
      recoveryReceipt: null,
      leadId: null,
    })

    expect(parseAcceptanceCapsule(serializeAcceptanceCapsule(terminal))).toEqual(terminal)
  })

  it('接受 canonical string Lead ID，并拒绝含空白或控制字符的编码值', () => {
    const stringLead = `s:${Buffer.from('lead_业务-42').toString('base64url')}`
    expect(parseAcceptanceCapsule(serializeAcceptanceCapsule(validCapsule({ leadId: stringLead }))).leadId)
      .toBe(stringLead)

    for (const value of [' lead', 'line\nbreak', '']) {
      const leadId = `s:${Buffer.from(value).toString('base64url')}`
      expect(() => serializeAcceptanceCapsule(validCapsule({ leadId })))
        .toThrow('staging acceptance capsule schema_invalid')
    }
  })
})

describe('staging acceptance capsule transitions', () => {
  it('只允许 normal 主链，并在必需 checkpoint 写入 receipt 与 Lead ID', () => {
    const prepared = capsuleAt('prepared')
    const clean = transitionAcceptanceCapsule(
      prepared,
      'normal',
      'clean_start_proven',
      { recoveryReceipt: RECEIPT },
    )
    const first = transitionAcceptanceCapsule(clean, 'normal', 'first_write_dispatched')
    const observed = transitionAcceptanceCapsule(first, 'normal', 'lead_observed', { leadId: 'n:42' })
    const retry = transitionAcceptanceCapsule(observed, 'normal', 'retry_write_dispatched')
    const idempotent = transitionAcceptanceCapsule(retry, 'normal', 'idempotency_verified')
    const cleanup = transitionAcceptanceCapsule(idempotent, 'normal', 'cleanup_dispatched')
    const confirmed = transitionAcceptanceCapsule(cleanup, 'normal', 'cleanup_confirmed')

    expect([
      prepared.phase,
      clean.phase,
      first.phase,
      observed.phase,
      retry.phase,
      idempotent.phase,
      cleanup.phase,
      confirmed.phase,
    ]).toEqual(CAPSULE_PHASES)
    expect(clean.recoveryReceipt).toBe(RECEIPT)
    expect(observed.leadId).toBe('n:42')
    expect(Object.isFrozen(confirmed)).toBe(true)
  })

  it.each([
    ['skip', capsuleAt('prepared'), 'first_write_dispatched'],
    ['backward', capsuleAt('retry_write_dispatched'), 'lead_observed'],
    ['same', capsuleAt('lead_observed'), 'lead_observed'],
    ['normal terminal shortcut', capsuleAt('first_write_dispatched'), 'cleanup_confirmed'],
  ])('拒绝非法 normal transition：%s', (_label, current, next) => {
    expect(() => transitionAcceptanceCapsule(current, 'normal', next as CapsulePhase))
      .toThrow('staging acceptance capsule transition_invalid')
  })

  it('拒绝遗漏或过早写入 checkpoint 字段', () => {
    expect(() => transitionAcceptanceCapsule(
      capsuleAt('prepared'),
      'normal',
      'clean_start_proven',
    )).toThrow('staging acceptance capsule transition_invalid')

    expect(() => transitionAcceptanceCapsule(
      capsuleAt('first_write_dispatched'),
      'normal',
      'lead_observed',
    )).toThrow('staging acceptance capsule transition_invalid')

    expect(() => transitionAcceptanceCapsule(
      capsuleAt('clean_start_proven'),
      'normal',
      'first_write_dispatched',
      { leadId: 'n:42' },
    )).toThrow('staging acceptance capsule transition_invalid')
  })

  it('禁止 identity、receipt 或已观察 Lead ID 被改写', () => {
    expect(() => transitionAcceptanceCapsule(
      capsuleAt('clean_start_proven'),
      'normal',
      'first_write_dispatched',
      { origin: 'https://attacker.example.com' },
    )).toThrow('staging acceptance capsule transition_invalid')

    expect(() => transitionAcceptanceCapsule(
      capsuleAt('clean_start_proven'),
      'normal',
      'first_write_dispatched',
      { recoveryReceipt: `${RECEIPT_BODY}.${Buffer.alloc(32, 8).toString('base64url')}` },
    )).toThrow('staging acceptance capsule transition_invalid')

    expect(() => transitionAcceptanceCapsule(
      capsuleAt('lead_observed'),
      'normal',
      'retry_write_dispatched',
      { leadId: 'n:43' },
    )).toThrow('staging acceptance capsule transition_invalid')
  })

  it.each(CAPSULE_PHASES.slice(0, -1))(
    'recovery 只允许 %s 到 terminal shortcut 并保持 durable identity',
    (phase) => {
      const current = capsuleAt(phase)
      const terminal = transitionAcceptanceCapsule(current, 'recovery', 'cleanup_confirmed')
      expect(terminal).toEqual({ ...current, phase: 'cleanup_confirmed' })
    },
  )

  it('prepared recovery shortcut 保持 recoveryReceipt=null 且 leadId=null', () => {
    const terminal = transitionAcceptanceCapsule(
      capsuleAt('prepared'),
      'recovery',
      'cleanup_confirmed',
    )
    expect(terminal.recoveryReceipt).toBeNull()
    expect(terminal.leadId).toBeNull()
  })

  it('recovery 不能改 identity、补写 receipt/lead 或离开 terminal', () => {
    expect(() => transitionAcceptanceCapsule(
      capsuleAt('first_write_dispatched'),
      'recovery',
      'cleanup_confirmed',
      { leadId: 'n:42' },
    )).toThrow('staging acceptance capsule transition_invalid')

    expect(() => transitionAcceptanceCapsule(
      capsuleAt('prepared'),
      'recovery',
      'clean_start_proven',
    )).toThrow('staging acceptance capsule transition_invalid')

    expect(() => transitionAcceptanceCapsule(
      capsuleAt('cleanup_confirmed'),
      'recovery',
      'cleanup_confirmed',
    )).toThrow('staging acceptance capsule transition_invalid')
  })
})

describe('staging acceptance capsule filesystem store', () => {
  it('使用用户私有默认目录，并以 0700/0600 创建 root、lock 与 active capsule', async () => {
    expect(DEFAULT_CAPSULE_ROOT).toBe(join(
      homedir(),
      'Library',
      'Application Support',
      'SBH',
      'acceptance-recovery',
    ))

    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')
    expect((await fs.stat(rootDir)).mode & 0o777).toBe(0o700)
    expect((await fs.stat(join(rootDir, RUNNER_LOCK_FILE_NAME))).mode & 0o777).toBe(0o600)
    expect(await lease.readActive()).toBeNull()

    const prepared = await lease.createPrepared(preparedIdentity())
    expect(prepared).toEqual(capsuleAt('prepared'))
    expect((await fs.stat(join(rootDir, ACTIVE_CAPSULE_FILE_NAME))).mode & 0o777).toBe(0o600)
    expect(await lease.readActive()).toEqual(prepared)

    await lease.release()
    await expect(fs.stat(join(rootDir, RUNNER_LOCK_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.stat(join(rootDir, ACTIVE_CAPSULE_FILE_NAME))).toBeDefined()
  })

  it('normal 遇到 unresolved capsule 时在取得 lease 前阻断并清理自己的 lock', async () => {
    const { rootDir } = await tempRoot()
    const first = await createCapsuleStore({ rootDir }).acquire('normal')
    await first.createPrepared(preparedIdentity())
    await first.release()

    await expect(createCapsuleStore({ rootDir }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule unresolved')
    await expect(fs.stat(join(rootDir, RUNNER_LOCK_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['phase', () => ({ ...preparedIdentity(), phase: 'prepared' })],
    ['schemaVersion', () => ({ ...preparedIdentity(), schemaVersion: 1 })],
    ['recoveryReceipt', () => ({ ...preparedIdentity(), recoveryReceipt: null })],
    ['leadId', () => ({ ...preparedIdentity(), leadId: null })],
    ['secret', () => ({ ...preparedIdentity(), secret: 'must-not-persist' })],
    ['symbol', () => {
      const identity = { ...preparedIdentity() } as Record<PropertyKey, unknown>
      identity[Symbol('secret')] = 'must-not-persist'
      return identity
    }],
    ['missing field', () => {
      const { runId: _runId, ...identity } = preparedIdentity()
      return identity
    }],
    ['inherited extra field', () => Object.assign(
      Object.create({ inheritedSecret: 'must-not-be-ignored' }) as Record<string, unknown>,
      preparedIdentity(),
    )],
    ['inherited required field', () => {
      const { runId, ...ownIdentity } = preparedIdentity()
      return Object.assign(Object.create({ runId }) as Record<string, unknown>, ownIdentity)
    }],
  ])('createPrepared 拒绝非 exact own-key runtime identity：%s', async (_label, makeIdentity) => {
    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')

    await expect(lease.createPrepared(makeIdentity() as PreparedIdentity))
      .rejects.toThrow('staging acceptance capsule identity_invalid')
    expect(await lease.readActive()).toBeNull()
    await expect(fs.stat(join(rootDir, ACTIVE_CAPSULE_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
    await lease.release()
  })

  it.each([
    ['throwing getter', 'getter-secret', () => {
      const identity = { ...preparedIdentity() }
      Object.defineProperty(identity, 'runId', {
        configurable: true,
        enumerable: true,
        get() { throw new Error('getter-secret') },
      })
      return identity
    }],
    ['ownKeys Proxy', 'ownkeys-secret', () => new Proxy(preparedIdentity(), {
      ownKeys() { throw new Error('ownkeys-secret') },
    })],
    ['descriptor Proxy', 'descriptor-secret', () => new Proxy(preparedIdentity(), {
      getOwnPropertyDescriptor() { throw new Error('descriptor-secret') },
    })],
    ['prototype Proxy', 'prototype-secret', () => new Proxy(preparedIdentity(), {
      getPrototypeOf() { throw new Error('prototype-secret') },
    })],
  ])('createPrepared 将 identity getter/Proxy 异常归一化且不落 active：%s', async (
    _label,
    secret,
    makeIdentity,
  ) => {
    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')

    try {
      await lease.createPrepared(makeIdentity() as PreparedIdentity)
      throw new Error('expected identity rejection')
    } catch (error) {
      expect((error as Error).message).toBe('staging acceptance capsule identity_invalid')
      expect((error as Error).message).not.toContain(secret)
    }
    expect(await lease.readActive()).toBeNull()
    await expect(fs.stat(join(rootDir, ACTIVE_CAPSULE_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
    await lease.release()
  })

  it('recovery 可读取 unresolved capsule、只走 terminal shortcut，并仅删除 confirmed capsule', async () => {
    const { rootDir } = await tempRoot()
    const normal = await createCapsuleStore({ rootDir }).acquire('normal')
    await normal.createPrepared(preparedIdentity())
    await expect(normal.removeConfirmed())
      .rejects.toThrow('staging acceptance capsule remove_not_confirmed')
    await normal.release()

    const recovery = await createCapsuleStore({ rootDir }).acquire('recovery')
    expect(await recovery.readActive()).toEqual(capsuleAt('prepared'))
    await recovery.transition('cleanup_confirmed')
    await recovery.removeConfirmed()
    expect(await recovery.readActive()).toBeNull()
    await recovery.release()

    await expect(fs.stat(join(rootDir, ACTIVE_CAPSULE_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('lease transition 复用严格状态机，且 release 后所有操作 fail closed', async () => {
    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    await lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT })
    await lease.transition('first_write_dispatched')
    const observed = await lease.transition('lead_observed', { leadId: 'n:42' })
    expect(observed.leadId).toBe('n:42')
    await expect(lease.transition('cleanup_confirmed'))
      .rejects.toThrow('staging acceptance capsule transition_invalid')

    await lease.release()
    await lease.release()
    await expect(lease.readActive()).rejects.toThrow('staging acceptance capsule lease_released')
    await expect(lease.createPrepared(preparedIdentity()))
      .rejects.toThrow('staging acceptance capsule lease_released')
  })

  it('忽略同目录 orphan temp，不能把它误判为 active capsule', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    await writeSecureFile(join(rootDir, '.active.json.tmp-orphan'), '{incomplete')

    const lease = await createCapsuleStore({ rootDir }).acquire('normal')
    expect(await lease.readActive()).toBeNull()
    await lease.release()
    expect(await fs.readFile(join(rootDir, '.active.json.tmp-orphan'), 'utf8')).toBe('{incomplete')
  })

  it('真实 filesystem trace 证明 temp 独占写、file fsync、rename、dir fsync 的顺序', async () => {
    const { rootDir } = await tempRoot()
    const events: Array<{ operation: string; path: string; flags?: number }> = []
    const tracedFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'open') {
          return async (path: string, flags: number, mode?: number) => {
            events.push({ operation: 'open', path: String(path), flags })
            const handle = await target.open(path, flags, mode)
            return new Proxy(handle, {
              get(handleTarget, handleProperty) {
                if (handleProperty === 'sync') {
                  return async () => {
                    events.push({ operation: 'sync', path: String(path) })
                    return handleTarget.sync()
                  }
                }
                const value = Reflect.get(handleTarget, handleProperty, handleTarget)
                return typeof value === 'function' ? value.bind(handleTarget) : value
              },
            })
          }
        }
        if (property === 'rename') {
          return async (from: string, to: string) => {
            events.push({ operation: 'rename', path: `${from}->${to}` })
            return target.rename(from, to)
          }
        }
        if (property === 'unlink') {
          return async (path: string) => {
            events.push({ operation: 'unlink', path: String(path) })
            return target.unlink(path)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const lease = await createCapsuleStore({ rootDir, fileSystem: tracedFileSystem }).acquire('normal')
    events.length = 0

    await lease.createPrepared(preparedIdentity())

    const tempOpenIndex = events.findIndex((event) =>
      event.operation === 'open' && basename(event.path).startsWith(`.${ACTIVE_CAPSULE_FILE_NAME}.tmp-`))
    const tempSyncIndex = events.findIndex((event) =>
      event.operation === 'sync' && basename(event.path).startsWith(`.${ACTIVE_CAPSULE_FILE_NAME}.tmp-`))
    const renameIndex = events.findIndex((event) =>
      event.operation === 'rename' && event.path.endsWith(`->${join(rootDir, ACTIVE_CAPSULE_FILE_NAME)}`))
    const directorySyncIndex = events.findIndex((event, index) =>
      index > renameIndex && event.operation === 'sync' && event.path === rootDir)

    expect(tempOpenIndex).toBeGreaterThanOrEqual(0)
    expect((events[tempOpenIndex].flags ?? 0) & fsConstants.O_EXCL).toBe(fsConstants.O_EXCL)
    expect((events[tempOpenIndex].flags ?? 0) & fsConstants.O_NOFOLLOW).toBe(fsConstants.O_NOFOLLOW)
    expect(tempSyncIndex).toBeGreaterThan(tempOpenIndex)
    expect(renameIndex).toBeGreaterThan(tempSyncIndex)
    expect(directorySyncIndex).toBeGreaterThan(renameIndex)

    await lease.release()
  })

  it('rename 失败时保留旧 capsule、清理 temp，且错误不泄漏系统细节', async () => {
    const { rootDir } = await tempRoot()
    let rejectActiveRename = false
    const failingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (from: string, to: string) => {
            if (rejectActiveRename && to === join(rootDir, ACTIVE_CAPSULE_FILE_NAME)) {
              throw new Error(`secret EIO at ${from}`)
            }
            return target.rename(from, to)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const lease = await createCapsuleStore({ rootDir, fileSystem: failingFileSystem }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    rejectActiveRename = true

    await expect(lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT }))
      .rejects.toThrow('staging acceptance capsule io_failed')
    expect(await lease.readActive()).toEqual(capsuleAt('prepared'))
    expect((await fs.readdir(rootDir)).filter((name) => name.includes('.tmp-'))).toEqual([])
    await lease.release()
  })

  it('temp rename 完成后若目标 inode 被并发替换则 fail closed', async () => {
    const { rootDir } = await tempRoot()
    const activePath = join(rootDir, ACTIVE_CAPSULE_FILE_NAME)
    let swapAfterRename = false
    const swappingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (from: string, to: string) => {
            await target.rename(from, to)
            if (swapAfterRename && to === activePath) {
              const replacement = join(rootDir, '.concurrent-replacement')
              const content = await target.readFile(to)
              await target.writeFile(replacement, content, { flag: 'wx', mode: 0o600 })
              await target.chmod(replacement, 0o600)
              await target.rename(replacement, to)
            }
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const lease = await createCapsuleStore({ rootDir, fileSystem: swappingFileSystem }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    swapAfterRename = true

    await expect(lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT }))
      .rejects.toThrow('staging acceptance capsule file_identity_changed')
    await expect(lease.release()).resolves.toBeUndefined()
  })

  it('unlink active 后 fsync 目录，且 inode 改变时拒绝删除', async () => {
    const { rootDir } = await tempRoot()
    const events: string[] = []
    const tracedFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'open') {
          return async (path: string, flags: number, mode?: number) => {
            const handle = await target.open(path, flags, mode)
            return new Proxy(handle, {
              get(handleTarget, handleProperty) {
                if (handleProperty === 'sync') {
                  return async () => {
                    events.push(`sync:${path}`)
                    return handleTarget.sync()
                  }
                }
                const value = Reflect.get(handleTarget, handleProperty, handleTarget)
                return typeof value === 'function' ? value.bind(handleTarget) : value
              },
            })
          }
        }
        if (property === 'unlink') {
          return async (path: string) => {
            events.push(`unlink:${path}`)
            return target.unlink(path)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const lease = await createCapsuleStore({ rootDir, fileSystem: tracedFileSystem }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    await lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT })
    await lease.transition('first_write_dispatched')
    await lease.transition('lead_observed', { leadId: 'n:42' })
    await lease.transition('retry_write_dispatched')
    await lease.transition('idempotency_verified')
    await lease.transition('cleanup_dispatched')
    await lease.transition('cleanup_confirmed')
    events.length = 0
    await lease.removeConfirmed()
    expect(events.indexOf(`unlink:${join(rootDir, ACTIVE_CAPSULE_FILE_NAME)}`)).toBeGreaterThanOrEqual(0)
    expect(events.indexOf(`sync:${rootDir}`)).toBeGreaterThan(
      events.indexOf(`unlink:${join(rootDir, ACTIVE_CAPSULE_FILE_NAME)}`),
    )
    await lease.release()
  })
})

describe('staging acceptance capsule lock and race handling', () => {
  it('lock 使用随机 owner token，活跃 PID 阻断第二个执行者', async () => {
    const { rootDir } = await tempRoot()
    const first = await createCapsuleStore({ rootDir }).acquire('normal')
    const firstLock = JSON.parse(await fs.readFile(join(rootDir, RUNNER_LOCK_FILE_NAME), 'utf8')) as {
      ownerToken: string
      pid: number
    }
    expect(firstLock.pid).toBe(process.pid)
    expect(firstLock.ownerToken).toMatch(/^[0-9a-f]{64}$/)

    await expect(createCapsuleStore({ rootDir }).acquire('recovery'))
      .rejects.toThrow('staging acceptance capsule lock_active')
    await first.release()

    const second = await createCapsuleStore({ rootDir }).acquire('normal')
    const secondLock = JSON.parse(await fs.readFile(join(rootDir, RUNNER_LOCK_FILE_NAME), 'utf8')) as {
      ownerToken: string
    }
    expect(secondLock.ownerToken).toMatch(/^[0-9a-f]{64}$/)
    expect(secondLock.ownerToken).not.toBe(firstLock.ownerToken)
    await second.release()
  })

  it('normal 不接管 stale lock；recovery 仅在 PID 不存在时原子接管', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    await writeSecureFile(join(rootDir, RUNNER_LOCK_FILE_NAME), staleLock())
    const processAlive = (pid: number) => pid === process.pid

    await expect(createCapsuleStore({ rootDir, processAlive }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule lock_stale_recovery_required')
    expect(JSON.parse(await fs.readFile(join(rootDir, RUNNER_LOCK_FILE_NAME), 'utf8')).ownerToken)
      .toBe('c'.repeat(64))

    const recovery = await createCapsuleStore({ rootDir, processAlive }).acquire('recovery')
    const replacement = JSON.parse(await fs.readFile(join(rootDir, RUNNER_LOCK_FILE_NAME), 'utf8')) as {
      pid: number
      ownerToken: string
      mode: string
    }
    expect(replacement.pid).toBe(process.pid)
    expect(replacement.mode).toBe('recovery')
    expect(replacement.ownerToken).not.toBe('c'.repeat(64))
    await recovery.release()
  })

  it('两个 recovery 并发接管时只能一个成功', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    await writeSecureFile(join(rootDir, RUNNER_LOCK_FILE_NAME), staleLock())
    const processAlive = (pid: number) => pid === process.pid
    const contenders = [
      createCapsuleStore({ rootDir, processAlive }),
      createCapsuleStore({ rootDir, processAlive }),
    ]

    const outcomes = await Promise.allSettled(contenders.map((store) => store.acquire('recovery')))
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    const winner = outcomes.find((outcome): outcome is PromiseFulfilledResult<CapsuleLease> =>
      outcome.status === 'fulfilled')
    await winner?.value.release()
  })

  it('两个独立进程并发 recovery 时也只能一个持有 lock', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    await writeSecureFile(join(rootDir, RUNNER_LOCK_FILE_NAME), staleLock())

    const contenders = [startRecoveryChild(rootDir), startRecoveryChild(rootDir)]
    try {
      await Promise.all(contenders.map((contender) => contender.waitForOutput('ready\n')))
      const closeRaceWaits = contenders.map((contender) =>
        contender.waitForOutput('output-that-never-exists', 60_000).then(
          () => 'unexpected-output',
          (error: unknown) => error instanceof Error ? error.message : 'unknown-error',
        ))
      expect(contenders.map((contender) => contender.send('start'))).toEqual([true, true])

      const decisions = await Promise.all(contenders.map((contender) =>
        contender.waitForAnyOutput(['acquired\n', 'rejected:'])))
      expect(decisions.filter((decision) => decision === 'acquired\n')).toHaveLength(1)
      expect(decisions.filter((decision) => decision === 'rejected:')).toHaveLength(1)

      const winnerIndex = decisions.findIndex((decision) => decision === 'acquired\n')
      const loserIndex = decisions.findIndex((decision) => decision === 'rejected:')
      expect(contenders[winnerIndex]?.send('release')).toBe(true)
      const results = await waitForRecoveryChildren(contenders, 2_000)

      expect(results.every((result) =>
        result.status === 0 && !result.spawnError && result.stderr === '')).toBe(true)
      expect(results[winnerIndex]?.stdout).toBe('ready\nacquired\nreleased\n')
      expect(results[loserIndex]?.stdout)
        .toMatch(/^ready\nrejected:staging acceptance capsule (?:lock_active|lock_contention)\n$/)
      expect(await Promise.all(closeRaceWaits)).toEqual([
        'recovery child closed before expected output',
        'recovery child closed before expected output',
      ])
    } finally {
      await cleanupRecoveryChildren(contenders)
    }
  }, 10_000)

  it('子进程 SIGKILL 后仍不 close 时有界销毁管道并固定失败', async () => {
    const neverClosed = new Promise<{
      stdout: string
      stderr: string
      status: number | null
      spawnError: boolean
    }>(() => undefined)
    const destroyed: string[] = []
    let killCalls = 0
    let unrefCalls = 0
    const fakeContender = {
      child: {
        exitCode: null,
        signalCode: null,
        kill: () => { killCalls += 1; return true },
        unref: () => { unrefCalls += 1 },
        stdin: { destroy: () => { destroyed.push('stdin') } },
        stdout: { destroy: () => { destroyed.push('stdout') } },
        stderr: { destroy: () => { destroyed.push('stderr') } },
      },
      closed: neverClosed,
      waitForAnyOutput: async () => 'rejected:',
      hasOutput: () => false,
      send: () => false,
    } as unknown as ReturnType<typeof startRecoveryChild>
    await expect(waitForRecoveryChildren([fakeContender], 10))
      .rejects.toThrow('recovery child close timeout')
    const cleanupWithDeadlines = cleanupRecoveryChildren as unknown as (
      contenders: readonly ReturnType<typeof startRecoveryChild>[],
      options: Readonly<{ closeTimeoutMs: number; killTimeoutMs: number }>,
    ) => Promise<void>
    const cleanup = cleanupWithDeadlines([fakeContender], {
      closeTimeoutMs: 10,
      killTimeoutMs: 10,
    })

    const outcome = await new Promise<{ status: 'rejected'; message: string } | { status: 'timeout' }>((resolve) => {
      let settled = false
      const finish = (result: { status: 'rejected'; message: string } | { status: 'timeout' }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => finish({ status: 'timeout' }), 200)
      void cleanup.then(
        () => finish({ status: 'rejected', message: 'unexpected success' }),
        (error: unknown) => finish({
          status: 'rejected',
          message: error instanceof Error ? error.message : 'unknown error',
        }),
      )
    })

    expect(outcome).toEqual({
      status: 'rejected',
      message: 'recovery child cleanup failed',
    })
    expect(killCalls).toBe(1)
    expect(unrefCalls).toBe(1)
    expect(destroyed).toEqual(['stdin', 'stdout', 'stderr'])
  })

  it('持锁进程被 SIGKILL 后，下一次显式 recovery 可接管完整 stale lock', async () => {
    const { rootDir } = await tempRoot()
    const moduleUrl = new URL('../scripts/staging-acceptance-capsule.mjs', import.meta.url).href
    const source = `
      const { createCapsuleStore } = await import(${JSON.stringify(moduleUrl)});
      await createCapsuleStore({ rootDir: process.argv[1] }).acquire('normal');
      process.stdout.write('locked\\n');
      setInterval(() => {}, 1_000);
    `
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source, rootDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const childClosed = new Promise<void>((resolveClosed) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolveClosed()
      }
      child.once('error', () => {
        destroyChildPipes(child)
        try {
          child.unref()
        } catch {
          // terminateChildProcess still owns the bounded fallback.
        }
        finish()
      })
      child.once('close', finish)
    })
    child.stdout.setEncoding('utf8')
    const locked = new Promise<void>((resolveLocked, rejectLocked) => {
      const timer = setTimeout(() => rejectLocked(new Error('child lock timeout')), 3_000)
      child.stdout.once('data', (chunk: string) => {
        clearTimeout(timer)
        expect(chunk).toBe('locked\n')
        resolveLocked()
      })
      child.once('error', rejectLocked)
    })
    let terminationAttempted = false
    try {
      await locked
      terminationAttempted = true
      await terminateChildProcess(child, childClosed)

      const recovery = await createCapsuleStore({ rootDir }).acquire('recovery')
      expect(await recovery.readActive()).toBeNull()
      await recovery.release()
    } finally {
      if (!terminationAttempted && child.exitCode === null && child.signalCode === null) {
        await terminateChildProcess(child, childClosed)
      }
    }
  }, 10_000)

  it('lock 原子发布在 hardlink→temp unlink 之间崩溃时，仅 recovery 可修复 nlink=2 artifact', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    const lockPath = join(rootDir, RUNNER_LOCK_FILE_NAME)
    const ownerToken = 'c'.repeat(64)
    const publicationTemp = join(
      rootDir,
      `.${RUNNER_LOCK_FILE_NAME}.acquire-${ownerToken}-0123456789abcdef`,
    )
    await writeSecureFile(publicationTemp, staleLock())
    await fs.link(publicationTemp, lockPath)
    expect((await fs.stat(lockPath)).nlink).toBe(2)

    await expect(createCapsuleStore({ rootDir, processAlive: () => false }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule lock_stale_recovery_required')
    expect((await fs.stat(lockPath)).nlink).toBe(2)

    const recovery = await createCapsuleStore({ rootDir, processAlive: () => false }).acquire('recovery')
    await expect(fs.stat(publicationTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.stat(lockPath)).nlink).toBe(1)
    await recovery.release()
  })

  it('capsule 已删但 stale lock 尚在时，normal 仍阻断，recovery 可安全收尾', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    await writeSecureFile(join(rootDir, RUNNER_LOCK_FILE_NAME), staleLock())
    const processAlive = (pid: number) => pid === process.pid

    await expect(createCapsuleStore({ rootDir, processAlive }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule lock_stale_recovery_required')
    const recovery = await createCapsuleStore({ rootDir, processAlive }).acquire('recovery')
    expect(await recovery.readActive()).toBeNull()
    await recovery.release()

    const normal = await createCapsuleStore({ rootDir, processAlive }).acquire('normal')
    await normal.release()
  })

  it('release 只删除自己的 token 与 inode，拒绝替换后的 lock', async () => {
    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    const lockPath = join(rootDir, RUNNER_LOCK_FILE_NAME)
    const original = await fs.readFile(lockPath, 'utf8')
    const replacement = join(rootDir, '.lock-replacement')
    await writeSecureFile(replacement, original)
    await fs.rename(replacement, lockPath)

    await expect(lease.release()).rejects.toThrow('staging acceptance capsule lock_identity_changed')
    expect(await fs.readFile(lockPath, 'utf8')).toBe(original)
    await expect(lease.readActive()).rejects.toThrow('staging acceptance capsule lease_released')
    await expect(lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT }))
      .rejects.toThrow('staging acceptance capsule lease_released')
  })

  it('lock unlink 成功但 directory fsync 失败后永久 poison 旧 lease', async () => {
    const { rootDir } = await tempRoot()
    const lockPath = join(rootDir, RUNNER_LOCK_FILE_NAME)
    let failDirectorySync = false
    const failingFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'unlink') {
          return async (path: string) => {
            await target.unlink(path)
            if (path === lockPath) failDirectorySync = true
          }
        }
        if (property === 'open') {
          return async (path: string, flags: number, mode?: number) => {
            const handle = await target.open(path, flags, mode)
            if (path !== rootDir) return handle
            return new Proxy(handle, {
              get(handleTarget, handleProperty) {
                if (handleProperty === 'sync') {
                  return async () => {
                    if (failDirectorySync) throw new Error('secret directory fsync failure')
                    return handleTarget.sync()
                  }
                }
                const value = Reflect.get(handleTarget, handleProperty, handleTarget)
                return typeof value === 'function' ? value.bind(handleTarget) : value
              },
            })
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const lease = await createCapsuleStore({ rootDir, fileSystem: failingFileSystem }).acquire('normal')
    await lease.createPrepared(preparedIdentity())

    await expect(lease.release()).rejects.toThrow('staging acceptance capsule io_failed')
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lease.readActive()).rejects.toThrow('staging acceptance capsule lease_released')
    await expect(lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT }))
      .rejects.toThrow('staging acceptance capsule lease_released')
  })

  it('release 发现 lock 已被 unlink 时固定归一化并永久 poison', async () => {
    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    await fs.unlink(join(rootDir, RUNNER_LOCK_FILE_NAME))

    await expect(lease.release()).rejects.toThrow('staging acceptance capsule lock_identity_changed')
    await expect(lease.readActive()).rejects.toThrow('staging acceptance capsule lease_released')
    await expect(lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT }))
      .rejects.toThrow('staging acceptance capsule lease_released')
  })

  it('每次 read/mutation 前复核 lock identity，丢锁后立即 poison', async () => {
    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    const lockPath = join(rootDir, RUNNER_LOCK_FILE_NAME)
    const replacement = join(rootDir, '.replacement-before-read')
    await writeSecureFile(replacement, await fs.readFile(lockPath, 'utf8'))
    await fs.rename(replacement, lockPath)

    await expect(lease.readActive()).rejects.toThrow('staging acceptance capsule lock_identity_changed')
    await expect(lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT }))
      .rejects.toThrow('staging acceptance capsule lease_released')
  })

  it('release 与 in-flight transition 串行，closing 后拒绝新操作', async () => {
    const { rootDir } = await tempRoot()
    const activePath = join(rootDir, ACTIVE_CAPSULE_FILE_NAME)
    let blockTransitionRename = false
    let enteredRenameResolve!: () => void
    let resumeRenameResolve!: () => void
    const enteredRename = new Promise<void>((resolveEntered) => { enteredRenameResolve = resolveEntered })
    const resumeRename = new Promise<void>((resolveResume) => { resumeRenameResolve = resolveResume })
    const gatedFileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (from: string, to: string) => {
            if (blockTransitionRename && to === activePath) {
              enteredRenameResolve()
              await resumeRename
            }
            return target.rename(from, to)
          }
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const lease = await createCapsuleStore({ rootDir, fileSystem: gatedFileSystem }).acquire('normal')
    await lease.createPrepared(preparedIdentity())
    blockTransitionRename = true
    const transition = lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT })
    await enteredRename

    let releaseSettled = false
    const release = lease.release().finally(() => { releaseSettled = true })
    await expect(lease.readActive()).rejects.toThrow('staging acceptance capsule lease_released')
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate))
    expect(releaseSettled).toBe(false)
    expect(await fs.stat(join(rootDir, RUNNER_LOCK_FILE_NAME))).toBeDefined()

    resumeRenameResolve()
    await expect(transition).resolves.toMatchObject({ phase: 'clean_start_proven' })
    await expect(release).resolves.toBeUndefined()
    await expect(lease.readActive()).rejects.toThrow('staging acceptance capsule lease_released')
  })

  it('process liveness probe 异常时 fail closed，且不回显底层错误', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    await writeSecureFile(join(rootDir, RUNNER_LOCK_FILE_NAME), staleLock())
    const store = createCapsuleStore({
      rootDir,
      processAlive: () => { throw new Error('secret process table detail') },
    })

    try {
      await store.acquire('recovery')
      throw new Error('expected acquire failure')
    } catch (error) {
      expect((error as Error).message).toBe('staging acceptance capsule lock_probe_failed')
      expect((error as Error).message).not.toContain('secret')
    }
  })
})

describe('staging acceptance capsule filesystem safety checks', () => {
  it.each(['symlink', 'hardlink', 'fifo', 'mode', 'special-mode'] as const)(
    '拒绝不安全 active capsule：%s',
    async (kind) => {
      const { rootDir } = await tempRoot()
      await createPrivateRoot(rootDir)
      const activePath = join(rootDir, ACTIVE_CAPSULE_FILE_NAME)
      const source = join(rootDir, 'source')
      const serialized = serializeAcceptanceCapsule(capsuleAt('prepared'))
      if (kind === 'symlink') {
        await writeSecureFile(source, serialized)
        await fs.symlink(source, activePath)
      } else if (kind === 'hardlink') {
        await writeSecureFile(activePath, serialized)
        await fs.link(activePath, source)
      } else if (kind === 'fifo') {
        const result = spawnSync('mkfifo', [activePath])
        if (result.status !== 0) return
        await fs.chmod(activePath, 0o600)
      } else if (kind === 'mode') {
        await writeSecureFile(activePath, serialized)
        await fs.chmod(activePath, 0o644)
      } else {
        await writeSecureFile(activePath, serialized)
        await fs.chmod(activePath, 0o1600)
      }

      await expect(createCapsuleStore({ rootDir }).acquire('normal'))
        .rejects.toThrow('staging acceptance capsule file_unsafe')
      await expect(fs.stat(join(rootDir, RUNNER_LOCK_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it.each(['symlink', 'hardlink', 'fifo', 'mode', 'special-mode'] as const)(
    '拒绝不安全 runner lock：%s',
    async (kind) => {
      const { rootDir } = await tempRoot()
      await createPrivateRoot(rootDir)
      const lockPath = join(rootDir, RUNNER_LOCK_FILE_NAME)
      const source = join(rootDir, 'lock-source')
      if (kind === 'symlink') {
        await writeSecureFile(source, staleLock())
        await fs.symlink(source, lockPath)
      } else if (kind === 'hardlink') {
        await writeSecureFile(lockPath, staleLock())
        await fs.link(lockPath, source)
      } else if (kind === 'fifo') {
        const result = spawnSync('mkfifo', [lockPath])
        if (result.status !== 0) return
        await fs.chmod(lockPath, 0o600)
      } else if (kind === 'mode') {
        await writeSecureFile(lockPath, staleLock())
        await fs.chmod(lockPath, 0o644)
      } else {
        await writeSecureFile(lockPath, staleLock())
        await fs.chmod(lockPath, 0o1600)
      }

      await expect(createCapsuleStore({
        rootDir,
        processAlive: () => false,
      }).acquire('recovery')).rejects.toThrow('staging acceptance capsule file_unsafe')
    },
  )

  it('拒绝 symlink root、错误 root mode 与错误 owner uid', async () => {
    const first = await tempRoot()
    const realRoot = join(first.parent, 'real-root')
    await createPrivateRoot(realRoot)
    await fs.symlink(realRoot, first.rootDir)
    await expect(createCapsuleStore({ rootDir: first.rootDir }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule root_unsafe')

    const second = await tempRoot()
    await createPrivateRoot(second.rootDir)
    await fs.chmod(second.rootDir, 0o755)
    await expect(createCapsuleStore({ rootDir: second.rootDir }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule root_unsafe')

    const specialMode = await tempRoot()
    await createPrivateRoot(specialMode.rootDir)
    await fs.chmod(specialMode.rootDir, 0o2700)
    await expect(createCapsuleStore({ rootDir: specialMode.rootDir }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule root_unsafe')

    const third = await tempRoot()
    await createPrivateRoot(third.rootDir)
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0
    await expect(createCapsuleStore({ rootDir: third.rootDir, currentUid: uid + 1 }).acquire('normal'))
      .rejects.toThrow('staging acceptance capsule root_unsafe')
  })

  it('active capsule inode 被替换后，既有 lease 拒绝 transition 与 remove', async () => {
    const { rootDir } = await tempRoot()
    const lease = await createCapsuleStore({ rootDir }).acquire('normal')
    const prepared = await lease.createPrepared(preparedIdentity())
    const activePath = join(rootDir, ACTIVE_CAPSULE_FILE_NAME)
    const replacement = join(rootDir, '.active-replacement')
    await writeSecureFile(replacement, serializeAcceptanceCapsule(prepared))
    await fs.rename(replacement, activePath)

    await expect(lease.transition('clean_start_proven', { recoveryReceipt: RECEIPT }))
      .rejects.toThrow('staging acceptance capsule file_identity_changed')
    await lease.release()
  })

  it('malformed capsule 的错误固定且不泄漏 path 或内容', async () => {
    const { rootDir } = await tempRoot()
    await createPrivateRoot(rootDir)
    const secret = 'top-secret-bootstrap-value'
    await writeSecureFile(join(rootDir, ACTIVE_CAPSULE_FILE_NAME), `{"secret":"${secret}"}`)

    try {
      await createCapsuleStore({ rootDir }).acquire('normal')
      throw new Error('expected acquire failure')
    } catch (error) {
      expect((error as Error).message).toBe('staging acceptance capsule schema_invalid')
      expect((error as Error).message).not.toContain(secret)
      expect((error as Error).message).not.toContain(rootDir)
    }
  })
})
