import { Buffer } from 'node:buffer'
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import { constants as FS_CONSTANTS, promises as nodeFileSystem } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

import { STAGING_RUNTIME_ORIGIN } from './trial-origin.mjs'

// This store fail-closes ordinary runner concurrency, crashes and accidental
// filesystem changes. It is not a sandbox against a malicious process already
// running as the same uid; path operations are therefore always revalidated,
// but no stronger same-uid race-resistance claim is made here.

export const CAPSULE_PHASES = Object.freeze([
  'prepared',
  'clean_start_proven',
  'first_write_dispatched',
  'lead_observed',
  'retry_write_dispatched',
  'idempotency_verified',
  'cleanup_dispatched',
  'cleanup_confirmed',
])

export const ACTIVE_CAPSULE_FILE_NAME = 'active.json'
export const RUNNER_LOCK_FILE_NAME = '.runner.lock'
export const DEFAULT_CAPSULE_ROOT = join(
  homedir(),
  'Library',
  'Application Support',
  'SBH',
  'acceptance-recovery',
)

const RUNNER_CLAIM_FILE_NAME = '.runner.lock.claim'

const CAPSULE_KEYS = Object.freeze([
  'schemaVersion',
  'phase',
  'runId',
  'submissionRequestId',
  'listingSlug',
  'fixtureNamespace',
  'origin',
  'expectedGitCommitSha',
  'expectedDeploymentRevision',
  'expectedDbFingerprint',
  'recoveryReceipt',
  'leadId',
])
const PREPARED_IDENTITY_KEYS = Object.freeze([
  'runId',
  'submissionRequestId',
  'listingSlug',
  'fixtureNamespace',
  'origin',
  'expectedGitCommitSha',
  'expectedDeploymentRevision',
  'expectedDbFingerprint',
])

const MAX_CAPSULE_BYTES = 8 * 1024
const MAX_LOCK_BYTES = 512
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const NAMESPACE_PATTERN = /^mp-e2e-[0-9a-f]{16}$/
const SHA_PATTERN = /^[0-9a-f]{40}$/
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/
const RECEIPT_PATTERN = /^([A-Za-z0-9_-]{64,4000})\.([A-Za-z0-9_-]{43})$/
const NUMBER_LEAD_ID_PATTERN = /^n:[1-9][0-9]*$/
const STRING_LEAD_ID_PATTERN = /^s:([A-Za-z0-9_-]+)$/
const CONTROL_PATTERN = /\p{Cc}/u
const WHITESPACE_PATTERN = /\p{White_Space}/u
const MAX_LEAD_STRING_BYTES = 128
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{64}$/
const MAX_PID = 2_147_483_647
const FILE_MODE = 0o600
const ROOT_MODE = 0o700
const FILE_OPEN_NOFOLLOW = FS_CONSTANTS.O_NOFOLLOW ?? 0
const DIRECTORY_OPEN_FLAGS = FS_CONSTANTS.O_RDONLY |
  (FS_CONSTANTS.O_DIRECTORY ?? 0) |
  FILE_OPEN_NOFOLLOW
const NORMAL_NEXT_PHASE = Object.freeze({
  prepared: 'clean_start_proven',
  clean_start_proven: 'first_write_dispatched',
  first_write_dispatched: 'lead_observed',
  lead_observed: 'retry_write_dispatched',
  retry_write_dispatched: 'idempotency_verified',
  idempotency_verified: 'cleanup_dispatched',
  cleanup_dispatched: 'cleanup_confirmed',
})

class CapsuleSafetyError extends Error {
  constructor(code) {
    super(`staging acceptance capsule ${code}`)
    this.name = 'CapsuleSafetyError'
    this.code = code
  }
}

function schemaInvalid() {
  throw new CapsuleSafetyError('schema_invalid')
}

function transitionInvalid() {
  throw new CapsuleSafetyError('transition_invalid')
}

function identityInvalid() {
  throw new CapsuleSafetyError('identity_invalid')
}

function hasExactKeys(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function createPreparedCapsule(identity) {
  try {
    if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) identityInvalid()
    const prototype = Object.getPrototypeOf(identity)
    if (prototype !== Object.prototype && prototype !== null) identityInvalid()

    const ownKeys = Reflect.ownKeys(identity)
    if (
      ownKeys.length !== PREPARED_IDENTITY_KEYS.length ||
      ownKeys.some((key) => typeof key !== 'string') ||
      !PREPARED_IDENTITY_KEYS.every((key) => ownKeys.includes(key))
    ) {
      identityInvalid()
    }

    const descriptors = Object.getOwnPropertyDescriptors(identity)
    const descriptorKeys = Reflect.ownKeys(descriptors)
    if (
      descriptorKeys.length !== PREPARED_IDENTITY_KEYS.length ||
      !PREPARED_IDENTITY_KEYS.every((key) => descriptorKeys.includes(key))
    ) {
      identityInvalid()
    }
    for (const key of PREPARED_IDENTITY_KEYS) {
      const descriptor = descriptors[key]
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        identityInvalid()
      }
    }

    return Object.freeze(validateCapsule({
      schemaVersion: 1,
      phase: 'prepared',
      runId: descriptors.runId.value,
      submissionRequestId: descriptors.submissionRequestId.value,
      listingSlug: descriptors.listingSlug.value,
      fixtureNamespace: descriptors.fixtureNamespace.value,
      origin: descriptors.origin.value,
      expectedGitCommitSha: descriptors.expectedGitCommitSha.value,
      expectedDeploymentRevision: descriptors.expectedDeploymentRevision.value,
      expectedDbFingerprint: descriptors.expectedDbFingerprint.value,
      recoveryReceipt: null,
      leadId: null,
    }))
  } catch {
    identityInvalid()
  }
}

function fixtureNamespace(runId) {
  return `mp-e2e-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`
}

function canonicalBase64url(value, expectedBytes) {
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.length === expectedBytes && decoded.toString('base64url') === value
  } catch {
    return false
  }
}

function validReceipt(value) {
  if (typeof value !== 'string' || value.length > 4096) return false
  const match = RECEIPT_PATTERN.exec(value)
  if (!match) return false
  const body = Buffer.from(match[1], 'base64url')
  return body.toString('base64url') === match[1] && canonicalBase64url(match[2], 32)
}

function validLeadId(value) {
  if (typeof value !== 'string') return false
  if (NUMBER_LEAD_ID_PATTERN.test(value)) {
    const number = Number(value.slice(2))
    return Number.isSafeInteger(number) && number > 0 && `n:${number}` === value
  }
  const match = STRING_LEAD_ID_PATTERN.exec(value)
  if (!match) return false
  try {
    const encoded = match[1]
    const bytes = Buffer.from(encoded, 'base64url')
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return (
      bytes.length >= 1 &&
      bytes.length <= MAX_LEAD_STRING_BYTES &&
      bytes.toString('base64url') === encoded &&
      Buffer.from(decoded, 'utf8').equals(bytes) &&
      !CONTROL_PATTERN.test(decoded) &&
      !WHITESPACE_PATTERN.test(decoded)
    )
  } catch {
    return false
  }
}

function validPhaseState(value) {
  const receipt = value.recoveryReceipt
  const leadId = value.leadId
  switch (value.phase) {
    case 'prepared':
      return receipt === null && leadId === null
    case 'clean_start_proven':
    case 'first_write_dispatched':
      return validReceipt(receipt) && leadId === null
    case 'lead_observed':
    case 'retry_write_dispatched':
    case 'idempotency_verified':
    case 'cleanup_dispatched':
      return validReceipt(receipt) && validLeadId(leadId)
    case 'cleanup_confirmed':
      return (
        (receipt === null && leadId === null) ||
        (validReceipt(receipt) && (leadId === null || validLeadId(leadId)))
      )
    default:
      return false
  }
}

function orderedCapsule(value) {
  return {
    schemaVersion: value.schemaVersion,
    phase: value.phase,
    runId: value.runId,
    submissionRequestId: value.submissionRequestId,
    listingSlug: value.listingSlug,
    fixtureNamespace: value.fixtureNamespace,
    origin: value.origin,
    expectedGitCommitSha: value.expectedGitCommitSha,
    expectedDeploymentRevision: value.expectedDeploymentRevision,
    expectedDbFingerprint: value.expectedDbFingerprint,
    recoveryReceipt: value.recoveryReceipt,
    leadId: value.leadId,
  }
}

function validateCapsule(value) {
  if (
    !hasExactKeys(value, CAPSULE_KEYS) ||
    value.schemaVersion !== 1 ||
    !CAPSULE_PHASES.includes(value.phase) ||
    typeof value.runId !== 'string' ||
    !UUID_V4_PATTERN.test(value.runId) ||
    typeof value.submissionRequestId !== 'string' ||
    !UUID_V4_PATTERN.test(value.submissionRequestId) ||
    typeof value.listingSlug !== 'string' ||
    !SLUG_PATTERN.test(value.listingSlug) ||
    value.listingSlug.length > 128 ||
    typeof value.fixtureNamespace !== 'string' ||
    !NAMESPACE_PATTERN.test(value.fixtureNamespace) ||
    value.fixtureNamespace !== fixtureNamespace(value.runId) ||
    value.origin !== STAGING_RUNTIME_ORIGIN ||
    typeof value.expectedGitCommitSha !== 'string' ||
    !SHA_PATTERN.test(value.expectedGitCommitSha) ||
    typeof value.expectedDeploymentRevision !== 'string' ||
    !REVISION_PATTERN.test(value.expectedDeploymentRevision) ||
    typeof value.expectedDbFingerprint !== 'string' ||
    !FINGERPRINT_PATTERN.test(value.expectedDbFingerprint) ||
    !validPhaseState(value)
  ) {
    schemaInvalid()
  }
  return orderedCapsule(value)
}

export function serializeAcceptanceCapsule(capsule) {
  try {
    const serialized = JSON.stringify(validateCapsule(capsule))
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CAPSULE_BYTES) schemaInvalid()
    return serialized
  } catch (error) {
    if (error instanceof CapsuleSafetyError) throw error
    schemaInvalid()
  }
}

export function parseAcceptanceCapsule(input) {
  try {
    const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)
    if (bytes.length === 0 || bytes.length > MAX_CAPSULE_BYTES) schemaInvalid()
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) schemaInvalid()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parsed = JSON.parse(text)
    const canonical = serializeAcceptanceCapsule(parsed)
    if (canonical !== text) schemaInvalid()
    return Object.freeze(validateCapsule(parsed))
  } catch (error) {
    if (error instanceof CapsuleSafetyError) throw error
    schemaInvalid()
  }
}

export function transitionAcceptanceCapsule(capsule, mode, nextPhase, patch = {}) {
  try {
    const current = validateCapsule(capsule)
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) transitionInvalid()
    const patchKeys = Reflect.ownKeys(patch)
    if (patchKeys.some((key) => typeof key !== 'string')) transitionInvalid()

    if (mode === 'recovery') {
      if (current.phase === 'cleanup_confirmed' || nextPhase !== 'cleanup_confirmed' || patchKeys.length !== 0) {
        transitionInvalid()
      }
      return Object.freeze(validateCapsule({ ...current, phase: nextPhase }))
    }

    if (mode !== 'normal' || NORMAL_NEXT_PHASE[current.phase] !== nextPhase) transitionInvalid()
    let expectedPatchKeys = []
    if (current.phase === 'prepared') expectedPatchKeys = ['recoveryReceipt']
    if (current.phase === 'first_write_dispatched') expectedPatchKeys = ['leadId']
    if (
      patchKeys.length !== expectedPatchKeys.length ||
      !expectedPatchKeys.every((key) => Object.prototype.hasOwnProperty.call(patch, key))
    ) {
      transitionInvalid()
    }
    return Object.freeze(validateCapsule({ ...current, ...patch, phase: nextPhase }))
  } catch (error) {
    if (error instanceof CapsuleSafetyError && error.code === 'transition_invalid') throw error
    transitionInvalid()
  }
}

function capsuleFailure(code) {
  throw new CapsuleSafetyError(code)
}

function errorCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined
}

function fileMode(stat) {
  return stat.mode & 0o7777
}

function fileIdentity(stat) {
  return Object.freeze({ dev: stat.dev, ino: stat.ino })
}

function sameIdentity(left, right) {
  return left !== null && right !== null && left.dev === right.dev && left.ino === right.ino
}

function safeRegularFile(stat, currentUid) {
  return (
    safeRegularFileMetadata(stat, currentUid) &&
    stat.nlink === 1
  )
}

function safeRegularFileMetadata(stat, currentUid) {
  return stat.isFile() && stat.uid === currentUid && fileMode(stat) === FILE_MODE
}

function safeRootDirectory(stat, currentUid) {
  return stat.isDirectory() && stat.uid === currentUid && fileMode(stat) === ROOT_MODE
}

async function closeHandle(handle) {
  if (!handle) return
  try {
    await handle.close()
  } catch {
    capsuleFailure('io_failed')
  }
}

async function inspectRoot(context, createIfMissing) {
  let before
  try {
    before = await context.fileSystem.lstat(context.rootDir)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT' || !createIfMissing) {
      if (errorCode(error) === 'ENOENT') capsuleFailure('root_unsafe')
      capsuleFailure('io_failed')
    }
    try {
      await context.fileSystem.mkdir(context.rootDir, { recursive: true, mode: ROOT_MODE })
      await context.fileSystem.chmod(context.rootDir, ROOT_MODE)
      before = await context.fileSystem.lstat(context.rootDir)
    } catch {
      capsuleFailure('io_failed')
    }
  }
  if (!safeRootDirectory(before, context.currentUid)) capsuleFailure('root_unsafe')

  let handle
  try {
    handle = await context.fileSystem.open(context.rootDir, DIRECTORY_OPEN_FLAGS)
    const after = await handle.stat()
    if (!safeRootDirectory(after, context.currentUid) || !sameIdentity(fileIdentity(before), fileIdentity(after))) {
      capsuleFailure('root_unsafe')
    }
    await closeHandle(handle)
    return fileIdentity(after)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The fixed error below is the only externally visible detail.
      }
    }
    if (error instanceof CapsuleSafetyError) throw error
    capsuleFailure('root_unsafe')
  }
}

async function assertRootIdentity(context, expectedIdentity) {
  const current = await inspectRoot(context, false)
  if (!sameIdentity(current, expectedIdentity)) capsuleFailure('root_unsafe')
}

async function syncDirectory(context, rootIdentity) {
  let handle
  try {
    handle = await context.fileSystem.open(context.rootDir, DIRECTORY_OPEN_FLAGS)
    const stat = await handle.stat()
    if (!safeRootDirectory(stat, context.currentUid) || !sameIdentity(fileIdentity(stat), rootIdentity)) {
      capsuleFailure('root_unsafe')
    }
    await handle.sync()
    await closeHandle(handle)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The fixed error below is the only externally visible detail.
      }
    }
    if (error instanceof CapsuleSafetyError) throw error
    capsuleFailure('io_failed')
  }
}

async function secureReadFile(context, path, maximumBytes, optional = false) {
  let before
  try {
    before = await context.fileSystem.lstat(path)
  } catch (error) {
    if (optional && errorCode(error) === 'ENOENT') return null
    if (errorCode(error) === 'ENOENT') capsuleFailure('file_identity_changed')
    capsuleFailure('io_failed')
  }
  if (!safeRegularFile(before, context.currentUid)) capsuleFailure('file_unsafe')
  if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > maximumBytes) {
    capsuleFailure('file_unsafe')
  }

  let handle
  try {
    handle = await context.fileSystem.open(path, FS_CONSTANTS.O_RDONLY | FILE_OPEN_NOFOLLOW)
    const opened = await handle.stat()
    if (
      !safeRegularFile(opened, context.currentUid) ||
      !sameIdentity(fileIdentity(before), fileIdentity(opened)) ||
      opened.size !== before.size
    ) {
      capsuleFailure('file_identity_changed')
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      !safeRegularFile(after, context.currentUid) ||
      !sameIdentity(fileIdentity(opened), fileIdentity(after)) ||
      after.size !== opened.size ||
      bytes.length !== opened.size
    ) {
      capsuleFailure('file_identity_changed')
    }
    await closeHandle(handle)
    return Object.freeze({ bytes, identity: fileIdentity(after) })
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The fixed error below is the only externally visible detail.
      }
    }
    if (error instanceof CapsuleSafetyError) throw error
    if (errorCode(error) === 'ELOOP') capsuleFailure('file_unsafe')
    capsuleFailure('io_failed')
  }
}

function serializeLockRecord(record) {
  if (
    typeof record !== 'object' ||
    record === null ||
    Array.isArray(record) ||
    Reflect.ownKeys(record).length !== 4 ||
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    record.pid < 1 ||
    record.pid > MAX_PID ||
    typeof record.ownerToken !== 'string' ||
    !OWNER_TOKEN_PATTERN.test(record.ownerToken) ||
    (record.mode !== 'normal' && record.mode !== 'recovery')
  ) {
    capsuleFailure('lock_invalid')
  }
  return JSON.stringify({
    schemaVersion: 1,
    pid: record.pid,
    ownerToken: record.ownerToken,
    mode: record.mode,
  })
}

function parseLockRecord(input) {
  try {
    const bytes = Buffer.from(input)
    if (bytes.length < 1 || bytes.length > MAX_LOCK_BYTES) capsuleFailure('lock_invalid')
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      capsuleFailure('lock_invalid')
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parsed = JSON.parse(text)
    if (serializeLockRecord(parsed) !== text) capsuleFailure('lock_invalid')
    return Object.freeze(parsed)
  } catch (error) {
    if (error instanceof CapsuleSafetyError) throw error
    capsuleFailure('lock_invalid')
  }
}

async function readLockFile(context, path, optional = false) {
  let preliminary
  try {
    preliminary = await context.fileSystem.lstat(path)
  } catch (error) {
    if (optional && errorCode(error) === 'ENOENT') return null
    if (errorCode(error) === 'ENOENT') capsuleFailure('file_identity_changed')
    capsuleFailure('io_failed')
  }
  if (preliminary.nlink === 2 && safeRegularFileMetadata(preliminary, context.currentUid)) {
    const prefix = `.${basename(path)}.acquire-`
    let names
    try {
      names = await context.fileSystem.readdir(context.rootDir)
    } catch {
      capsuleFailure('io_failed')
    }
    if (!Array.isArray(names) || names.length > 4096) capsuleFailure('file_unsafe')
    const candidates = []
    for (const name of names) {
      if (typeof name !== 'string' || !name.startsWith(prefix)) continue
      const suffix = name.slice(prefix.length)
      if (!/^[0-9a-f]{64}-[0-9a-f]{16}$/.test(suffix)) continue
      const candidatePath = join(context.rootDir, name)
      let candidate
      try {
        candidate = await context.fileSystem.lstat(candidatePath)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue
        capsuleFailure('io_failed')
      }
      if (
        safeRegularFileMetadata(candidate, context.currentUid) &&
        candidate.nlink === 2 &&
        sameIdentity(fileIdentity(candidate), fileIdentity(preliminary))
      ) {
        candidates.push({ path: candidatePath, ownerToken: suffix.slice(0, 64) })
      }
    }
    if (candidates.length !== 1) capsuleFailure('file_unsafe')

    let handle
    try {
      if (!Number.isSafeInteger(preliminary.size) || preliminary.size < 1 || preliminary.size > MAX_LOCK_BYTES) {
        capsuleFailure('file_unsafe')
      }
      handle = await context.fileSystem.open(path, FS_CONSTANTS.O_RDONLY | FILE_OPEN_NOFOLLOW)
      const opened = await handle.stat()
      if (
        !safeRegularFileMetadata(opened, context.currentUid) ||
        opened.nlink !== 2 ||
        opened.size !== preliminary.size ||
        !sameIdentity(fileIdentity(opened), fileIdentity(preliminary))
      ) {
        capsuleFailure('file_identity_changed')
      }
      const bytes = await handle.readFile()
      const after = await handle.stat()
      if (
        !safeRegularFileMetadata(after, context.currentUid) ||
        after.nlink !== 2 ||
        after.size !== opened.size ||
        bytes.length !== opened.size ||
        !sameIdentity(fileIdentity(after), fileIdentity(opened))
      ) {
        capsuleFailure('file_identity_changed')
      }
      await closeHandle(handle)
      const record = parseLockRecord(bytes)
      if (record.ownerToken !== candidates[0].ownerToken) capsuleFailure('file_unsafe')
      return Object.freeze({
        record,
        identity: fileIdentity(after),
        publicationTempPath: candidates[0].path,
      })
    } catch (error) {
      if (handle) {
        try {
          await handle.close()
        } catch {
          // The fixed error below is the only externally visible detail.
        }
      }
      if (error instanceof CapsuleSafetyError) throw error
      capsuleFailure('io_failed')
    }
  }
  const file = await secureReadFile(context, path, MAX_LOCK_BYTES, optional)
  if (file === null) return null
  return Object.freeze({
    record: parseLockRecord(file.bytes),
    identity: file.identity,
    publicationTempPath: null,
  })
}

async function repairLinkedLockPublication(context, path, linked) {
  if (linked.publicationTempPath === null) return linked
  let current
  let temp
  try {
    current = await context.fileSystem.lstat(path)
    temp = await context.fileSystem.lstat(linked.publicationTempPath)
  } catch {
    capsuleFailure('lock_identity_changed')
  }
  if (
    !safeRegularFileMetadata(current, context.currentUid) ||
    !safeRegularFileMetadata(temp, context.currentUid) ||
    current.nlink !== 2 ||
    temp.nlink !== 2 ||
    !sameIdentity(fileIdentity(current), linked.identity) ||
    !sameIdentity(fileIdentity(temp), linked.identity)
  ) {
    capsuleFailure('lock_identity_changed')
  }
  try {
    await context.fileSystem.unlink(linked.publicationTempPath)
    await syncDirectory(context, context.rootIdentity)
  } catch {
    capsuleFailure('io_failed')
  }
  return readLockFile(context, path)
}

async function readCapsuleFile(context, path, optional = false) {
  const file = await secureReadFile(context, path, MAX_CAPSULE_BYTES, optional)
  if (file === null) return null
  return Object.freeze({ capsule: parseAcceptanceCapsule(file.bytes), identity: file.identity })
}

async function unlinkExact(context, path, expectedIdentity, identityErrorCode) {
  let current
  try {
    current = await context.fileSystem.lstat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') capsuleFailure(identityErrorCode)
    capsuleFailure('io_failed')
  }
  if (!safeRegularFile(current, context.currentUid)) capsuleFailure('file_unsafe')
  if (!sameIdentity(fileIdentity(current), expectedIdentity)) capsuleFailure(identityErrorCode)
  try {
    await context.fileSystem.unlink(path)
    await syncDirectory(context, context.rootIdentity)
  } catch (error) {
    if (error instanceof CapsuleSafetyError) throw error
    capsuleFailure('io_failed')
  }
}

async function removeOwnedLockFile(context, path, expectedIdentity, ownerToken) {
  const current = await readLockFile(context, path)
  if (!sameIdentity(current.identity, expectedIdentity) || current.record.ownerToken !== ownerToken) {
    capsuleFailure('lock_identity_changed')
  }
  await unlinkExact(context, path, expectedIdentity, 'lock_identity_changed')
}

async function writeExclusiveFile(context, path, content) {
  const tempPath = join(
    context.rootDir,
    `.${basename(path)}.acquire-${context.ownerToken}-${randomHex(8)}`,
  )
  let handle
  let identity = null
  let published = false
  try {
    handle = await context.fileSystem.open(
      tempPath,
      FS_CONSTANTS.O_WRONLY |
        FS_CONSTANTS.O_CREAT |
        FS_CONSTANTS.O_EXCL |
        FILE_OPEN_NOFOLLOW,
      FILE_MODE,
    )
  } catch (error) {
    capsuleFailure('io_failed')
  }

  try {
    await handle.chmod(FILE_MODE)
    const opened = await handle.stat()
    if (!safeRegularFile(opened, context.currentUid)) capsuleFailure('file_unsafe')
    identity = fileIdentity(opened)
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.sync()
    const written = await handle.stat()
    if (!safeRegularFile(written, context.currentUid) || !sameIdentity(identity, fileIdentity(written))) {
      capsuleFailure('file_identity_changed')
    }
    await closeHandle(handle)
    handle = null

    try {
      await context.fileSystem.link(tempPath, path)
      published = true
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        await cleanupTemp(context, tempPath)
        return null
      }
      capsuleFailure('io_failed')
    }

    const linked = await context.fileSystem.lstat(path)
    if (
      !safeRegularFileMetadata(linked, context.currentUid) ||
      linked.nlink !== 2 ||
      !sameIdentity(fileIdentity(linked), identity)
    ) {
      capsuleFailure('file_identity_changed')
    }
    await context.fileSystem.unlink(tempPath)
    await syncDirectory(context, context.rootIdentity)
    const installed = await context.fileSystem.lstat(path)
    if (!safeRegularFile(installed, context.currentUid) || !sameIdentity(fileIdentity(installed), identity)) {
      capsuleFailure('file_identity_changed')
    }
    return fileIdentity(installed)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // Cleanup below remains best-effort and the outward error stays fixed.
      }
    }
    if (!published) {
      try {
        await cleanupTemp(context, tempPath)
      } catch {
        // A private orphan temp is ignored unless it is the second link of a published lock.
      }
    }
    if (error instanceof CapsuleSafetyError) throw error
    capsuleFailure('io_failed')
  }
}

async function cleanupTemp(context, tempPath) {
  try {
    await context.fileSystem.unlink(tempPath)
    await syncDirectory(context, context.rootIdentity)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') capsuleFailure('io_failed')
  }
}

function randomHex(bytes) {
  try {
    return nodeRandomBytes(bytes).toString('hex')
  } catch {
    capsuleFailure('random_failed')
  }
}

async function atomicReplaceFile(context, path, content, expectedIdentity, identityErrorCode) {
  const tempPath = join(
    context.rootDir,
    `.${path.slice(context.rootDir.length + 1)}.tmp-${context.ownerToken}-${randomHex(8)}`,
  )
  let handle
  let renamed = false
  let tempIdentity = null
  try {
    handle = await context.fileSystem.open(
      tempPath,
      FS_CONSTANTS.O_WRONLY |
        FS_CONSTANTS.O_CREAT |
        FS_CONSTANTS.O_EXCL |
        FILE_OPEN_NOFOLLOW,
      FILE_MODE,
    )
    await handle.chmod(FILE_MODE)
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.sync()
    const tempStat = await handle.stat()
    if (!safeRegularFile(tempStat, context.currentUid)) capsuleFailure('file_unsafe')
    tempIdentity = fileIdentity(tempStat)
    await closeHandle(handle)
    handle = null

    let current = null
    try {
      current = await context.fileSystem.lstat(path)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') capsuleFailure('io_failed')
    }
    if (expectedIdentity === null) {
      if (current !== null) capsuleFailure(identityErrorCode)
    } else {
      if (
        current === null ||
        !safeRegularFile(current, context.currentUid) ||
        !sameIdentity(fileIdentity(current), expectedIdentity)
      ) {
        capsuleFailure(identityErrorCode)
      }
    }

    await context.fileSystem.rename(tempPath, path)
    renamed = true
    await syncDirectory(context, context.rootIdentity)
    const installed = await context.fileSystem.lstat(path)
    if (!safeRegularFile(installed, context.currentUid)) capsuleFailure('file_unsafe')
    if (!sameIdentity(fileIdentity(installed), tempIdentity)) capsuleFailure(identityErrorCode)
    return fileIdentity(installed)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The fixed error below is the only externally visible detail.
      }
    }
    if (!renamed) {
      try {
        await cleanupTemp(context, tempPath)
      } catch {
        // A private orphan temp is ignored by future active-capsule reads.
      }
    }
    if (error instanceof CapsuleSafetyError) throw error
    capsuleFailure('io_failed')
  }
}

async function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false
    if (errorCode(error) === 'EPERM') return true
    throw error
  }
}

async function probeProcess(context, pid) {
  try {
    const result = await context.processAlive(pid)
    if (typeof result !== 'boolean') capsuleFailure('lock_probe_failed')
    return result
  } catch (error) {
    if (error instanceof CapsuleSafetyError) throw error
    capsuleFailure('lock_probe_failed')
  }
}

function createLease(context, mode, lockIdentity) {
  const activePath = join(context.rootDir, ACTIVE_CAPSULE_FILE_NAME)
  const lockPath = join(context.rootDir, RUNNER_LOCK_FILE_NAME)
  let status = 'active'
  let operationTail = Promise.resolve()
  let releasePromise = null
  let activeKnown = mode === 'normal'
  let activeIdentity = null

  async function assertOwnedLock() {
    await assertRootIdentity(context, context.rootIdentity)
    let current
    try {
      current = await readLockFile(context, lockPath)
    } catch {
      capsuleFailure('lock_identity_changed')
    }
    if (!sameIdentity(current.identity, lockIdentity) || current.record.ownerToken !== context.ownerToken) {
      capsuleFailure('lock_identity_changed')
    }
  }

  function scheduleOperation(action) {
    if (status !== 'active') capsuleFailure('lease_released')
    const operation = operationTail.then(async () => {
      if (status === 'released' || status === 'poisoned') capsuleFailure('lease_released')
      try {
        await assertOwnedLock()
      } catch (error) {
        status = 'poisoned'
        throw error
      }
      return action()
    })
    operationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  async function readActiveUnlocked() {
    const current = await readCapsuleFile(context, activePath, true)
    if (current === null) {
      if (activeKnown && activeIdentity !== null) capsuleFailure('file_identity_changed')
      activeKnown = true
      activeIdentity = null
      return null
    }
    if (activeKnown && !sameIdentity(activeIdentity, current.identity)) {
      capsuleFailure('file_identity_changed')
    }
    activeKnown = true
    activeIdentity = current.identity
    return current.capsule
  }

  return Object.freeze({
    async readActive() {
      return scheduleOperation(() => readActiveUnlocked())
    },
    async createPrepared(identity) {
      return scheduleOperation(async () => {
        if (mode !== 'normal') capsuleFailure('transition_invalid')
        if (await readActiveUnlocked() !== null) capsuleFailure('unresolved')
        const capsule = createPreparedCapsule(identity)
        const nextIdentity = await atomicReplaceFile(
          context,
          activePath,
          serializeAcceptanceCapsule(capsule),
          null,
          'unresolved',
        )
        activeKnown = true
        activeIdentity = nextIdentity
        return capsule
      })
    },
    async transition(nextPhase, patch = {}) {
      return scheduleOperation(async () => {
        const current = await readActiveUnlocked()
        if (current === null) capsuleFailure('capsule_missing')
        const next = transitionAcceptanceCapsule(current, mode, nextPhase, patch)
        const nextIdentity = await atomicReplaceFile(
          context,
          activePath,
          serializeAcceptanceCapsule(next),
          activeIdentity,
          'file_identity_changed',
        )
        activeIdentity = nextIdentity
        return next
      })
    },
    async removeConfirmed() {
      return scheduleOperation(async () => {
        const current = await readActiveUnlocked()
        if (current === null || current.phase !== 'cleanup_confirmed') {
          capsuleFailure('remove_not_confirmed')
        }
        await unlinkExact(context, activePath, activeIdentity, 'file_identity_changed')
        activeKnown = true
        activeIdentity = null
      })
    },
    async release() {
      if (status === 'released') return
      if (releasePromise !== null) return releasePromise
      if (status === 'poisoned') capsuleFailure('lease_released')
      status = 'closing'
      releasePromise = (async () => {
        await operationTail
        if (status === 'poisoned') capsuleFailure('lease_released')
        try {
          await assertRootIdentity(context, context.rootIdentity)
          await removeOwnedLockFile(context, lockPath, lockIdentity, context.ownerToken)
          status = 'released'
        } catch (error) {
          status = 'poisoned'
          if (error instanceof CapsuleSafetyError && error.code === 'file_identity_changed') {
            capsuleFailure('lock_identity_changed')
          }
          throw error
        }
      })()
      return releasePromise
    },
  })
}

export function createCapsuleStore(options = {}) {
  const rootDir = options.rootDir ?? DEFAULT_CAPSULE_ROOT
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const processAlive = options.processAlive ?? defaultProcessAlive
  const currentUid = options.currentUid ?? (typeof process.getuid === 'function' ? process.getuid() : null)
  if (
    typeof rootDir !== 'string' ||
    !isAbsolute(rootDir) ||
    typeof processAlive !== 'function' ||
    !Number.isSafeInteger(currentUid) ||
    currentUid < 0
  ) {
    capsuleFailure('store_config_invalid')
  }

  return Object.freeze({
    async acquire(mode) {
      if (mode !== 'normal' && mode !== 'recovery') capsuleFailure('mode_invalid')
      const context = {
        rootDir,
        fileSystem,
        processAlive,
        currentUid,
        ownerToken: randomHex(32),
        rootIdentity: null,
      }
      context.rootIdentity = await inspectRoot(context, true)
      const lockPath = join(rootDir, RUNNER_LOCK_FILE_NAME)
      const claimPath = join(rootDir, RUNNER_CLAIM_FILE_NAME)
      const ownRecord = Object.freeze({
        schemaVersion: 1,
        pid: process.pid,
        ownerToken: context.ownerToken,
        mode,
      })
      const serializedOwnRecord = serializeLockRecord(ownRecord)

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await assertRootIdentity(context, context.rootIdentity)
        let claim = await readLockFile(context, claimPath, true)
        if (claim !== null) {
          if (mode === 'normal') capsuleFailure('lock_stale_recovery_required')
          if (await probeProcess(context, claim.record.pid)) capsuleFailure('lock_active')
          claim = await repairLinkedLockPublication(context, claimPath, claim)
          try {
            await removeOwnedLockFile(context, claimPath, claim.identity, claim.record.ownerToken)
          } catch (error) {
            if (error instanceof CapsuleSafetyError && error.code === 'lock_identity_changed') continue
            throw error
          }
          continue
        }

        const createdIdentity = await writeExclusiveFile(context, lockPath, serializedOwnRecord)
        if (createdIdentity !== null) {
          if (mode === 'normal') {
            try {
              const active = await readCapsuleFile(context, join(rootDir, ACTIVE_CAPSULE_FILE_NAME), true)
              if (active !== null) capsuleFailure('unresolved')
            } catch (error) {
              await removeOwnedLockFile(context, lockPath, createdIdentity, context.ownerToken)
              throw error
            }
          }
          return createLease(context, mode, createdIdentity)
        }

        let existing = await readLockFile(context, lockPath)
        if (await probeProcess(context, existing.record.pid)) capsuleFailure('lock_active')
        if (mode === 'normal') capsuleFailure('lock_stale_recovery_required')
        existing = await repairLinkedLockPublication(context, lockPath, existing)

        const claimIdentity = await writeExclusiveFile(context, claimPath, serializedOwnRecord)
        if (claimIdentity === null) continue
        try {
          const rechecked = await readLockFile(context, lockPath)
          if (
            !sameIdentity(rechecked.identity, existing.identity) ||
            rechecked.record.ownerToken !== existing.record.ownerToken
          ) {
            capsuleFailure('lock_identity_changed')
          }
          if (await probeProcess(context, rechecked.record.pid)) capsuleFailure('lock_active')
          const replacementIdentity = await atomicReplaceFile(
            context,
            lockPath,
            serializedOwnRecord,
            rechecked.identity,
            'lock_identity_changed',
          )
          await removeOwnedLockFile(context, claimPath, claimIdentity, context.ownerToken)
          return createLease(context, mode, replacementIdentity)
        } catch (error) {
          try {
            await removeOwnedLockFile(context, claimPath, claimIdentity, context.ownerToken)
          } catch {
            // A later explicit recovery can reclaim a stale claim by PID.
          }
          if (error instanceof CapsuleSafetyError && error.code === 'lock_identity_changed') continue
          throw error
        }
      }
      capsuleFailure('lock_contention')
    },
  })
}

export { CapsuleSafetyError }
