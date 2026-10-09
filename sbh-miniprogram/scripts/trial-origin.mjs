export const STAGING_RUNTIME_ENV_ID = 'sbhmini-gateway-d3fbrmn8097478b8'
export const STAGING_RUNTIME_SERVICE_NAME = 'sbhmini'
export const STAGING_RUNTIME_ORIGIN =
  'https://sbhmini-305971-11-1253925058.sh.run.tcloudbase.com'

const stagingRuntimeHost = new URL(STAGING_RUNTIME_ORIGIN).hostname

export function normalizeTrialOrigin(value) {
  if (value !== STAGING_RUNTIME_ORIGIN) {
    throw new Error('trial API origin 与受控 staging 不一致')
  }
  return { origin: STAGING_RUNTIME_ORIGIN, host: stagingRuntimeHost }
}
