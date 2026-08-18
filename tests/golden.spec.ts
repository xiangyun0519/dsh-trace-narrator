import { describe, expect, it } from 'vitest'
import { narrate } from '../src/narrator.ts'
import type { NarratorDeps } from '../src/narrator.ts'
import type { TraceNarratorConfig } from '../src/config.ts'
import type { SessionEventLike, SessionLogSnapshotLike } from '../src/reader.ts'
import type { AuditEntry } from '../src/redaction/audit.ts'

/**
 * 全管线 golden 测试：固定事件流 + 固定 LLM + 固定时钟 → 渲染产物必须逐字节确定。
 * 快照文件提交进仓库（tests/__snapshots__/golden.spec.ts.snap）作为 golden。
 * 任何投影/脱敏/渲染/编排变更都会在此处暴露差异，需人工确认后更新快照。
 */

function ev(type: string, data: unknown, seq: number, time: number): SessionEventLike {
  return { type, seq, time, data }
}

const T0 = 1710000000000
const events: SessionEventLike[] = [
  ev('turn/start', { turn: 1 }, 1, T0),
  ev('user/message', {
    content: [{ type: 'text', text: '帮我把 sk-abcdefghijklmnopqrstuvwxyz123456 配进 /home/alice/app/.env，联系 user@example.com，服务器 10.0.0.1' }],
    source: { kind: 'user' },
  }, 2, T0 + 1000),
  ev('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '好的，我来处理。' }] } }, 3, T0 + 2000),
  ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"Set-Content .env"}' }, 4, T0 + 3000),
  ev('tool/result', {
    turn: 1, step: 1,
    message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(3000) }] }] },
  }, 5, T0 + 4000),
  ev('todo/write', { todos: [{ content: '写配置', status: 'in_progress' }, { content: '验证', status: 'pending' }] }, 6, T0 + 5000),
  ev('request/header', { header: {}, reason: 'step' }, 7, T0 + 5100),
  ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 8, T0 + 6000),
]

const snapshot: SessionLogSnapshotLike = { session: { id: 'sess_golden' }, events }

const GOOD_SUMMARY = JSON.stringify({
  title: '配置密钥到环境文件', duration: '6 秒', summary: '完成了配置写入与验证。',
  key_steps: ['写入配置', '验证'], decisions: ['本地写入'], outcomes: ['配置完成'],
})

function goldenDeps(format: 'html' | 'json'): NarratorDeps & { written: Array<{ path: string; content: string }>; auditLines: AuditEntry[] } {
  const written: Array<{ path: string; content: string }> = []
  const auditLines: AuditEntry[] = []
  const config: TraceNarratorConfig = {
    lang: 'zh-CN', schema: 'summary', redact: 'strict', format, outputDir: 'trace-narrate',
    tokenBudget: 12000, maxTokens: 2048, confirmBeforeSend: true, schemaDir: '',
    audit: { enabled: true, dir: '', maxBytes: 1048576, keep: 3 }, upload: false,
  }
  return {
    config,
    query: { async readSession() { return snapshot } },
    schemaSource: {
      async readFileText() { throw new Error('no file') },
      async fetchUrl() { throw new Error('no net') },
    },
    llm: { async call() { return GOOD_SUMMARY } },
    model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    writeFile: async (path, content) => { written.push({ path, content }) },
    auditWriter: { write(entry) { auditLines.push(entry) } },
    home: '/dsh', workspaceRoot: '/ws',
    now: () => T0 + 10000,
    written, auditLines,
  }
}

describe('全管线 golden', () => {
  it('HTML 渲染逐字节确定（快照）', async () => {
    const deps = goldenDeps('html')
    const outcome = await narrate(deps, { sessionId: 'sess_golden', overrides: { confirm: false } })
    expect(outcome.kind).toBe('ok')
    expect(deps.written.length).toBe(1)
    expect(deps.written[0]?.content).toMatchSnapshot()
  })

  it('JSON 报告逐字节确定（快照）', async () => {
    const deps = goldenDeps('json')
    const outcome = await narrate(deps, { sessionId: 'sess_golden', overrides: { confirm: false } })
    expect(outcome.kind).toBe('ok')
    expect(JSON.parse(deps.written[0]?.content ?? '{}')).toMatchSnapshot()
  })

  it('golden 输出不含任何 secret 原文', async () => {
    const deps = goldenDeps('html')
    await narrate(deps, { sessionId: 'sess_golden', overrides: { confirm: false } })
    const content = deps.written[0]?.content ?? ''
    expect(content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
    expect(content).not.toContain('user@example.com')
    expect(content).not.toContain('/home/alice')
    expect(content).not.toContain('10.0.0.1')
    expect(JSON.stringify(deps.auditLines)).not.toContain('alice')
  })

  it('golden 元数据完整（截断统计/轮数/事件数）', async () => {
    const deps = goldenDeps('json')
    const outcome = await narrate(deps, { sessionId: 'sess_golden', overrides: { confirm: false } })
    if (outcome.kind !== 'ok') throw new Error('expected ok')
    expect(outcome.report.meta).toMatchObject({
      sessionId: 'sess_golden', eventCount: 8, turns: 1,
      droppedEvents: 1, // request/header
      redactLevel: 'strict', schemaName: 'summary',
    })
    expect(outcome.report.status).toBe('ok')
    expect(outcome.report.summary?.title).toBe('配置密钥到环境文件')
  })
})
