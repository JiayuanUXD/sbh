import { decodeAttestationSecret, type AcceptanceRuntimeConfig } from '@/domain/mini-program/acceptance-attestation'

const REVISION = /^[A-Za-z0-9._-]{1,128}$/
const SHA = /^[0-9a-f]{40}$/
const FINGERPRINT = /^[0-9a-f]{64}$/

export function readAcceptanceRuntimeConfig(env: Readonly<Record<string, string | undefined>> = process.env): AcceptanceRuntimeConfig | null {
  if (env.MP_ACCEPTANCE_ENABLED !== '1' || env.MP_ACCEPTANCE_DEPLOYMENT_ENVIRONMENT !== 'staging') return null
  const deploymentRevision = env.MP_ACCEPTANCE_DEPLOYMENT_REVISION ?? ''
  const deploymentGitCommitSha = env.MP_ACCEPTANCE_DEPLOYMENT_GIT_COMMIT_SHA ?? ''
  const attestationSecret = decodeAttestationSecret(env.MP_ACCEPTANCE_ATTESTATION_SECRET ?? '')
  const operatorBootstrapSecret = decodeAttestationSecret(env.MP_ACCEPTANCE_OPERATOR_BOOTSTRAP_SECRET ?? '')
  const dbFingerprintAllowlist = (env.MP_ACCEPTANCE_DB_FINGERPRINT_ALLOWLIST ?? '').split(',').filter(Boolean)
  if (!SHA.test(deploymentGitCommitSha) || !REVISION.test(deploymentRevision) || !attestationSecret || !operatorBootstrapSecret || Buffer.from(attestationSecret).equals(Buffer.from(operatorBootstrapSecret)) || dbFingerprintAllowlist.length === 0 || dbFingerprintAllowlist.some((value) => !FINGERPRINT.test(value))) return null
  return { deploymentGitCommitSha, deploymentRevision, attestationSecret, operatorBootstrapSecret, dbFingerprintAllowlist }
}
