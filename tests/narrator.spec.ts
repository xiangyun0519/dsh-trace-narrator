import { describe, expect, it } from 'vitest'
import { narrate } from '../src/narrator.ts'
import type { NarratorDeps } from '../src/narrator.ts'
import type { TraceNarratorConfig } from '../src/config.ts'
import type { SessionLogSnapshotLike, SessionEventLike } from '../src/reader.ts'
import type { SummaryLlm } from '../src/summarizer.ts'
import type { AuditEntry } from '../src/redaction/audit.ts'

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz123456'

function ev(type: string, data: unknown, seq: number, time = seq * 1000): SessionEventLike {
  return { type, seq, time, data }
}

function snapshot(id: string): SessionLogSnapshotLike {
  return {
    session: { id },
    events: [
      ev('turn/start', { turn: 1 }, 1),
      ev('user/message', { content: [{ type: 'text', text: `用这个 key：${SECRET}，联系 user@example.com` }], source: { kind: 'user' } }, 2),
      ev('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '好的' }] } }, 3),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4),
    ],
  }
}

const GOOD_SUMMARY = JSON.stringify({
  title: '示例', duration: '1 分钟', summary: '完成。',
  key_steps: ['a'], decisions: [], outcomes: [],
})

interface TestDeps extends NarratorDeps {
  written: Array<{ path: string; content: string }>
  auditLines: AuditEntry[]
  asked: Array<{ question: string; header: string; options: string[] }>
}

function makeDeps(overrides: Partial<NarratorDeps> = {}): TestDeps {
  const written: Array<{ path: string; content: string }> = []
  const auditLines: AuditEntry[] = []
  const asked: Array<{ question: string; header: string; options: string[] }> = []
  const config: TraceNarratorConfig = {
    lang: 'zh-CN', schema: 'summary', redact: 'strict', format: 'html', outputDir: 'trace-narrate',
    tokenBudget: 12000, maxTokens: 2048, confirmBeforeSend: true, schemaDir: '',
    audit: { enabled: true, dir: '', maxBytes: 1048576, keep: 3 }, upload: false,
  }
  const deps: TestDeps = {
    config,
    query: {
      async readSession(id) { return snapshot(id) },
    },
    schemaSource: {
      async readFileText() { throw new Error('no file') },
      async fetchUrl() { throw new Error('no net') },
    },
    questions: {
      async ask(request) {
        asked.push(request)
        return { selected: ['发送'] }
      },
    },
    llm: { async call() { return GOOD_SUMMARY } },
    model: { provider: 'p', model: 'm' },
    writeFile: async (path, content) => { written.push({ path, content }) },
    auditWriter: { write(entry) { auditLines.push(entry) } },
    home: '/dsh', workspaceRoot: '/ws',
    now: () => 1710001000000,
    written, auditLines, asked,
    ...overrides,
  }
  return deps
}

describe('narrate：成功路径', () => {
  it('全链路：读取→脱敏→总结→渲染→落盘→审计', async () => {
    const deps = makeDeps()
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: {} })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.outputPath.startsWith('trace-narrate')).toBe(true)
      expect(outcome.outputPath).toContain('sess_1-')
      expect(outcome.outputPath.endsWith('.html')).toBe(true)
      expect(outcome.report.status).toBe('ok')
      expect(outcome.report.summary?.title).toBe('示例')
      expect(outcome.report.meta.sessionId).toBe('sess_1')
    }
    expect(deps.written.length).toBe(1)
    expect(deps.written[0]?.content).toContain('<h3>标题</h3>')
    expect(deps.written[0]?.content).toContain('<p>示例</p>')
    // 时间戳不被脱敏检测器误伤（回归：IPv6 误报 ISO 时间）
    expect(deps.written[0]?.content).toContain('1970-01-01T00:00:01.000Z')
    expect(deps.auditLines.length).toBe(1)
    expect(deps.auditLines[0]).toMatchObject({ confirmed: true, sent: true })
    expect(deps.auditLines[0]?.total).toBeGreaterThanOrEqual(2)
  })

  it('输出物二次脱敏：剧本中的 secret 不出现在任何输出/审计中', async () => {
    const deps = makeDeps()
    await narrate(deps, { sessionId: 'sess_1', overrides: {} })
    const content = deps.written[0]?.content ?? ''
    expect(content).not.toContain(SECRET)
    expect(content).not.toContain('user@example.com')
    expect(JSON.stringify(deps.auditLines)).not.toContain(SECRET)
  })

  it('LLM 复述 secret 也被二次脱敏', async () => {
    const evil = JSON.stringify({
      title: `key=${SECRET}`, duration: '1 分钟', summary: '复述了密钥',
      key_steps: ['a'], decisions: [], outcomes: [],
    })
    const deps = makeDeps({ llm: { async call() { return evil } } })
    await narrate(deps, { sessionId: 'sess_1', overrides: {} })
    expect(deps.written[0]?.content).not.toContain(SECRET)
    expect(deps.written[0]?.content).toContain('[REDACTED:API_KEY:')
  })

  it('--yes 跳过确认（无 questions 也可）', async () => {
    const deps = makeDeps({ questions: undefined })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(outcome.kind).toBe('ok')
    expect(deps.auditLines[0]?.confirmed).toBe(true)
  })
})

describe('narrate：确认流程', () => {
  it('用户选「取消」→ exit 4，不调用 LLM、不写文件，审计记取消', async () => {
    const calls: string[] = []
    const deps = makeDeps({
      llm: { async call() { calls.push('llm'); return GOOD_SUMMARY } },
      questions: { async ask(request) { deps.asked.push(request); return { selected: ['取消'] } } },
    })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: {} })
    expect(outcome).toMatchObject({ kind: 'cancelled', exitCode: 4 })
    expect(calls).toEqual([])
    expect(deps.written).toEqual([])
    expect(deps.auditLines[0]).toMatchObject({ confirmed: false, sent: false })
    expect(deps.asked[0]?.question).toContain('sess_1')
    expect(deps.asked[0]?.question).toContain('已脱敏')
  })

  it('无 questions 且未跳过 → 非交互取消', async () => {
    const deps = makeDeps({ questions: undefined })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: {} })
    expect(outcome).toMatchObject({ kind: 'cancelled', exitCode: 4 })
  })

  it('ask 抛错（非 live root）→ 视为非交互取消', async () => {
    const deps = makeDeps({
      questions: { async ask() { throw new Error('CALLER_NOT_LIVE') } },
    })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: {} })
    expect(outcome).toMatchObject({ kind: 'cancelled', exitCode: 4 })
  })

  it('设置关闭确认时无 questions 也能跑', async () => {
    const deps = makeDeps({ questions: undefined })
    deps.config.confirmBeforeSend = false
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: {} })
    expect(outcome.kind).toBe('ok')
  })
})

describe('narrate：错误与降级', () => {
  it('会话读取失败 → exit 3', async () => {
    const deps = makeDeps({ query: { async readSession() { throw new Error('backend down') } } })
    const outcome = await narrate(deps, { sessionId: 'sess_9', overrides: { confirm: false } })
    expect(outcome).toMatchObject({ kind: 'error', exitCode: 3 })
    if (outcome.kind === 'error') expect(outcome.message).toContain('sess_9')
  })

  it('schema 加载失败 → exit 6', async () => {
    const deps = makeDeps()
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false, schema: './missing.json' } })
    expect(outcome).toMatchObject({ kind: 'error', exitCode: 6 })
  })

  it('无 llm → degraded（no-llm），exit 5 语义，审计 sent=false', async () => {
    const deps = makeDeps({ llm: undefined, model: undefined })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(outcome.kind).toBe('degraded')
    if (outcome.kind === 'degraded') {
      expect(outcome.report.status).toBe('no-llm')
      expect(outcome.message).toContain('未生成 AI 总结')
    }
    expect(deps.written.length).toBe(1)
    expect(deps.auditLines[0]).toMatchObject({ confirmed: true, sent: false })
  })

  it('校验始终失败 → degraded（validation-failed）+ 转义附录', async () => {
    const bad = JSON.stringify({ title: '<x>' })
    const deps = makeDeps({ llm: { async call() { return bad } } })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(outcome.kind).toBe('degraded')
    if (outcome.kind === 'degraded') {
      expect(outcome.report.status).toBe('validation-failed')
      expect(outcome.report.rawOutput).toBe(bad)
    }
    const content = deps.written[0]?.content ?? ''
    expect(content).toContain('未通过 schema 校验')
    expect(content).not.toContain('<x>')
    expect(content).toContain('&lt;x&gt;')
  })

  it('写入失败 → exit 7', async () => {
    const deps = makeDeps({ writeFile: async () => { throw new Error('sandbox denied') } })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(outcome).toMatchObject({ kind: 'error', exitCode: 7 })
  })

  it('LLM 调用中 abort → cancelled exit 4', async () => {
    const deps = makeDeps({
      llm: {
        async call() {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        },
      },
    })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(outcome).toMatchObject({ kind: 'cancelled', exitCode: 4 })
  })
})

describe('narrate：参数与标题', () => {
  it('CLI 覆盖：--output 目录与 --format md', async () => {
    const deps = makeDeps()
    const outcome = await narrate(deps, {
      sessionId: 'sess_1',
      overrides: { confirm: false, outputDir: 'reports', format: 'md' },
    })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.outputPath.startsWith('reports')).toBe(true)
      expect(outcome.outputPath).toContain('sess_1-')
      expect(outcome.outputPath.endsWith('.md')).toBe(true)
    }
    expect(deps.written[0]?.content.startsWith('# ')).toBe(true)
  })

  it('title 注入报告 meta', async () => {
    const deps = makeDeps({ title: async () => '自定义标题' })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    if (outcome.kind === 'ok') expect(outcome.report.meta.title).toBe('自定义标题')
  })

  it('已保存 schema 名 + 警告后缀', async () => {
    const custom = JSON.stringify({
      type: 'object', additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string' } }, // 缺 description → 警告
    })
    const deps = makeDeps({
      schemaSource: {
        async readFileText(path: string) {
          if (path.endsWith('my.json')) return custom
          throw new Error(`ENOENT ${path}`)
        },
        async fetchUrl() { throw new Error('no net') },
      },
      llm: { async call() { return JSON.stringify({ name: 'x' }) } },
    })
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false, schema: 'my' } })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') expect(outcome.message).toContain('非致命警告')
  })
})

describe('narrate：上报', () => {
  interface Uploaded { endpoint: string; authEnv: string | undefined; timeoutMs: number; body: unknown }
  const uploadDeps = (behavior?: (u: Uploaded) => void): TestDeps & { uploads: Uploaded[] } => {
    const uploads: Uploaded[] = []
    const deps = makeDeps({
      upload: async (endpoint, authEnv, timeoutMs, body) => {
        uploads.push({ endpoint, authEnv, timeoutMs, body })
        behavior?.({ endpoint, authEnv, timeoutMs, body })
      },
    }) as TestDeps & { uploads: Uploaded[] }
    deps.uploads = uploads
    return deps
  }

  it('显式 --upload 成功 → 消息含「已上传」，body 含 report 与 audit 且无 secret', async () => {
    const deps = uploadDeps()
    const outcome = await narrate(deps, {
      sessionId: 'sess_1',
      overrides: { confirm: false, uploadEndpoint: 'https://viewer.example.com' },
    })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') expect(outcome.message).toContain('已上传')
    const uploaded = deps.uploads[0]
    expect(uploaded?.endpoint).toBe('https://viewer.example.com')
    const body = uploaded?.body as { version: number; report: object; audit: object }
    expect(body.version).toBe(1)
    expect(body.report).toBeDefined()
    expect(body.audit).toBeDefined()
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })

  it('显式 --upload 失败 → exit 8，本地产物保留', async () => {
    const deps = uploadDeps(() => { throw new Error('HTTP 500') })
    const outcome = await narrate(deps, {
      sessionId: 'sess_1',
      overrides: { confirm: false, uploadEndpoint: 'https://viewer.example.com' },
    })
    expect(outcome.kind).toBe('upload-failed')
    if (outcome.kind === 'upload-failed') {
      expect(outcome.exitCode).toBe(8)
      expect(outcome.message).toContain('上传失败')
      expect(outcome.message).toContain('HTTP 500')
    }
    expect(deps.written.length).toBe(1)
  })

  it('配置端点（非显式）成功 → ok + 已上传', async () => {
    const deps = uploadDeps()
    deps.config.upload = { endpoint: 'https://cfg.example.com', authEnv: 'TOKEN', timeoutMs: 15000 }
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') expect(outcome.message).toContain('已上传')
    expect(deps.uploads[0]?.authEnv).toBe('TOKEN')
  })

  it('配置端点（非显式）失败 → 仍 ok，消息带警告', async () => {
    const deps = uploadDeps(() => { throw new Error('down') })
    deps.config.upload = { endpoint: 'https://cfg.example.com', authEnv: '', timeoutMs: 15000 }
    const outcome = await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') expect(outcome.message).toContain('上传失败')
    expect(deps.written.length).toBe(1)
  })

  it('无上传目标 → 不触发上传', async () => {
    const deps = uploadDeps()
    await narrate(deps, { sessionId: 'sess_1', overrides: { confirm: false } })
    expect(deps.uploads).toEqual([])
  })
})
