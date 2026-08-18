import { describe, expect, it } from 'vitest'
import { uploadReport, UploadError } from '../src/upload.ts'

interface Recorded {
  url: string
  body: unknown
  headers: Record<string, string>
  signal: AbortSignal
}

function makeDeps(envMap: Record<string, string> = {}, behavior?: (r: Recorded) => void) {
  const calls: Recorded[] = []
  return {
    calls,
    env: (name: string) => envMap[name],
    postJson: async (url: string, body: unknown, options: { headers: Record<string, string>; signal: AbortSignal }) => {
      const record: Recorded = { url, body, headers: options.headers, signal: options.signal }
      calls.push(record)
      behavior?.(record)
    },
  }
}

describe('uploadReport', () => {
  it('HTTPS 无认证：POST 携带 content-type 与 body', async () => {
    const deps = makeDeps()
    await uploadReport(deps, { endpoint: 'https://x.com/api', timeoutMs: 15000 }, { a: 1 })
    expect(deps.calls[0]?.url).toBe('https://x.com/api')
    expect(deps.calls[0]?.body).toEqual({ a: 1 })
    expect(deps.calls[0]?.headers['content-type']).toBe('application/json')
    expect(deps.calls[0]?.headers.authorization).toBeUndefined()
  })

  it('authEnv 存在时附 Bearer token（从环境变量读取）', async () => {
    const deps = makeDeps({ TRACE_UPLOAD_TOKEN: 'tok-123' })
    await uploadReport(deps, { endpoint: 'https://x.com', authEnv: 'TRACE_UPLOAD_TOKEN', timeoutMs: 15000 }, {})
    expect(deps.calls[0]?.headers.authorization).toBe('Bearer tok-123')
  })

  it('authEnv 配置了但环境变量缺失 → 明确报错（禁止明文）', async () => {
    const deps = makeDeps({})
    await expect(uploadReport(deps, {
      endpoint: 'https://x.com', authEnv: 'MISSING_VAR', timeoutMs: 15000,
    }, {})).rejects.toThrow('MISSING_VAR')
    expect(deps.calls).toEqual([])
  })

  it('http:// 拒绝', async () => {
    const deps = makeDeps()
    await expect(uploadReport(deps, { endpoint: 'http://x.com', timeoutMs: 15000 }, {})).rejects.toThrow('HTTPS')
    expect(deps.calls).toEqual([])
  })

  it('空 endpoint 拒绝', async () => {
    const deps = makeDeps()
    await expect(uploadReport(deps, { endpoint: '  ', timeoutMs: 15000 }, {})).rejects.toBeInstanceOf(UploadError)
  })

  it('postJson 抛错包装为 UploadError 且保留原因', async () => {
    const deps = makeDeps({}, () => { throw new Error('network down') })
    const error = await uploadReport(deps, { endpoint: 'https://x.com', timeoutMs: 15000 }, {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).message).toContain('network down')
  })

  it('调用方 signal 已中止 → 传给 postJson 的 signal 处于 aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = makeDeps()
    await uploadReport(deps, {
      endpoint: 'https://x.com', timeoutMs: 15000, signal: controller.signal,
    }, {}).catch(() => undefined)
    expect(deps.calls[0]?.signal.aborted).toBe(true)
  })

  it('postJson 抛 AbortError → 超时/中止语义', async () => {
    const deps = makeDeps({}, () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    const error = await uploadReport(deps, { endpoint: 'https://x.com', timeoutMs: 15000 }, {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).message).toContain('超时或已中止')
  })
})
