/**
 * opt-in 上报（docs/design.md §4 步骤 11 + §6 安全模型）：
 *  - 仅 HTTPS；Bearer token 一律从环境变量读取（authEnv 指定变量名，禁止明文）；
 *  - 超时（默认 15s）由 AbortSignal.timeout 组合调用方 signal；
 *  - 失败抛 UploadError，绝不阻塞本地产物。
 * 生产适配（index.ts）用宿主全局 fetch POST——ctx.web.fetch 实测仅支持 GET
 * （WebFetchRequest 只有 url 字段），见 docs/design.md §3 更新。
 * @module dsh-trace-narrator/upload
 */

export class UploadError extends Error {
  readonly code = 'UPLOAD_FAILED'

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`trace-narrator: 上传失败：${message}`)
    this.name = 'UploadError'
  }
}

export interface UploadTarget {
  endpoint: string
  /** 读取 Bearer token 的环境变量名；空/缺省 = 不带认证头。 */
  authEnv?: string
  timeoutMs: number
  signal?: AbortSignal
}

export interface UploadDeps {
  env(name: string): string | undefined
  postJson(
    url: string,
    body: unknown,
    options: { headers: Record<string, string>; signal: AbortSignal },
  ): Promise<void>
}

export async function uploadReport(deps: UploadDeps, target: UploadTarget, body: unknown): Promise<void> {
  const endpoint = target.endpoint.trim()
  if (endpoint.length === 0) throw new UploadError('endpoint 为空')
  if (!/^https:\/\//i.test(endpoint)) throw new UploadError('endpoint 必须为 HTTPS')

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (target.authEnv !== undefined && target.authEnv.length > 0) {
    const token = deps.env(target.authEnv)
    if (token === undefined || token.length === 0) {
      throw new UploadError(`环境变量 ${target.authEnv} 未设置（token 禁止明文传入）`)
    }
    headers.authorization = `Bearer ${token}`
  }

  const timeout = AbortSignal.timeout(Math.max(1, target.timeoutMs))
  const signal = target.signal === undefined ? timeout : AbortSignal.any([target.signal, timeout])
  try {
    await deps.postJson(endpoint, body, { headers, signal })
  } catch (error) {
    if (error instanceof UploadError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UploadError(`超时或已中止（${target.timeoutMs}ms）`, error)
    }
    throw new UploadError(String(error), error)
  }
}
