import type { RuntimeEnvironment } from '../config/environment.js'
import type {
  RequestTransport,
  RequestTransportInput,
  RequestTransportResponse,
} from './request.js'

interface WxTransportResponse {
  statusCode: number
  data: unknown
  header: Readonly<Record<string, unknown>>
}

interface WxRequestInput {
  url: string
  method: RequestTransportInput['method']
  data: RequestTransportInput['data']
  timeout: number
  redirect: 'manual'
  header: Readonly<Record<string, string>>
  success: (response: WxTransportResponse) => void
  fail: (error: unknown) => void
}

interface WxCallContainerInput {
  path: string
  method: RequestTransportInput['method']
  data: RequestTransportInput['data']
  timeout: number
  followRedirect: false
  header: Readonly<Record<string, string>>
  success: (response: WxTransportResponse) => void
  fail: (error: unknown) => void
}

export interface WxTransportApi {
  request: (input: WxRequestInput) => void
  cloud: Readonly<{
    init: (input: Readonly<{ env: string }>) => void
    callContainer: (input: WxCallContainerInput) => void
  }>
}

function mapResponse(response: WxTransportResponse): RequestTransportResponse {
  return {
    statusCode: response.statusCode,
    data: response.data,
    headers: response.header,
  }
}

function callWxRequest(
  api: WxTransportApi,
  input: RequestTransportInput,
  environment: Extract<RuntimeEnvironment, { transport: 'http' }>,
): Promise<RequestTransportResponse> {
  return new Promise((resolve, reject) => {
    api.request({
      url: `${environment.apiBaseUrl}${input.path}`,
      method: input.method,
      data: input.data,
      timeout: input.timeoutMs,
      redirect: 'manual',
      header: input.headers,
      success: (response) => resolve(mapResponse(response)),
      fail: reject,
    })
  })
}

function callContainer(
  api: WxTransportApi,
  input: RequestTransportInput,
  environment: Extract<RuntimeEnvironment, { transport: 'cloud-container' }>,
): Promise<RequestTransportResponse> {
  return new Promise((resolve, reject) => {
    api.cloud.callContainer({
      path: input.path,
      method: input.method,
      data: input.data,
      timeout: input.timeoutMs,
      followRedirect: false,
      header: {
        ...input.headers,
        'X-WX-SERVICE': environment.cloudServiceName,
      },
      success: (response) => resolve(mapResponse(response)),
      fail: reject,
    })
  })
}

export function createWxTransport(api: WxTransportApi): RequestTransport {
  let initializedCloudEnvId: string | null = null

  return async (input) => {
    if (input.environment.transport === 'http') {
      return callWxRequest(api, input, input.environment)
    }

    if (initializedCloudEnvId !== null && initializedCloudEnvId !== input.environment.cloudEnvId) {
      throw new Error('cloud runtime environment changed')
    }
    if (initializedCloudEnvId === null) {
      api.cloud.init({ env: input.environment.cloudEnvId })
      initializedCloudEnvId = input.environment.cloudEnvId
    }

    return callContainer(api, input, input.environment)
  }
}
