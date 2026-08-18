import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildAuditEntry, createFileAuditWriter } from '../src/redaction/audit.ts'
import { createRedactor } from '../src/redaction/index.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-narrator-audit-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function sampleEntry(sessionId: string, confirmed: boolean, sent: boolean) {
  const redactor = createRedactor()
  const { report } = redactor.redactText('token: secretvalue12345678 and user@example.com')
  return buildAuditEntry(sessionId, report, confirmed, sent)
}

describe('buildAuditEntry', () => {
  it('结构完整且不含任何原文', () => {
    const entry = sampleEntry('sess_1', true, true)
    expect(entry.sessionId).toBe('sess_1')
    expect(entry.level).toBe('strict')
    expect(entry.total).toBeGreaterThan(0)
    expect(entry.confirmed).toBe(true)
    expect(entry.sent).toBe(true)
    const json = JSON.stringify(entry)
    expect(json).not.toContain('secretvalue12345678')
    expect(json).not.toContain('user@example.com')
    expect(json).not.toContain('example.com')
    const parsed = JSON.parse(json) as typeof entry
    expect(parsed.detectors.length).toBeGreaterThan(0)
    expect(parsed.detectors.every(d => typeof d.count === 'number')).toBe(true)
  })

  it('取消时 confirmed=false、sent=false 仍记录', () => {
    const entry = sampleEntry('sess_2', false, false)
    expect(entry.confirmed).toBe(false)
    expect(entry.sent).toBe(false)
    expect(entry.total).toBeGreaterThan(0)
  })
})

describe('createFileAuditWriter', () => {
  it('追加 JSONL 行，可解析', () => {
    const writer = createFileAuditWriter(dir)
    writer.write(sampleEntry('sess_1', true, true))
    writer.write(sampleEntry('sess_2', true, true))
    const lines = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(lines.every(line => JSON.parse(line).sessionId !== undefined)).toBe(true)
  })

  it('轮转：超过 maxBytes 时转移到 audit.1.jsonl，丢弃最旧', () => {
    const writer = createFileAuditWriter(dir, { maxBytes: 100, keep: 2 })
    for (let i = 0; i < 6; i += 1) writer.write(sampleEntry(`sess_${i}`, true, true))
    const files = readdirSync(dir).sort()
    expect(files).toContain('audit.jsonl')
    expect(files).toContain('audit.1.jsonl')
    expect(files).not.toContain('audit.2.jsonl')
    const all = files
      .map(f => readFileSync(join(dir, f), 'utf8').trim().split('\n'))
      .flat()
    expect(all.length).toBe(2) // keep=2：只保留最新两份
    const ids = all.map(line => (JSON.parse(line) as { sessionId: string }).sessionId).sort()
    expect(ids).toEqual(['sess_4', 'sess_5'])
  })

  it('keep=3 时保留最新三份', () => {
    const writer = createFileAuditWriter(dir, { maxBytes: 100, keep: 3 })
    for (let i = 0; i < 6; i += 1) writer.write(sampleEntry(`sess_${i}`, true, true))
    const all = readdirSync(dir)
      .map(f => readFileSync(join(dir, f), 'utf8').trim().split('\n'))
      .flat()
    const ids = all.map(line => (JSON.parse(line) as { sessionId: string }).sessionId).sort()
    expect(ids).toEqual(['sess_3', 'sess_4', 'sess_5'])
  })

  it('目录不存在时自动创建', () => {
    const nested = join(dir, 'a', 'b')
    const writer = createFileAuditWriter(nested)
    writer.write(sampleEntry('sess_1', true, true))
    expect(existsSync(join(nested, 'audit.jsonl'))).toBe(true)
  })

  it('日志内容不含 secret 原文', () => {
    const writer = createFileAuditWriter(dir)
    writer.write(sampleEntry('sess_1', true, true))
    const content = readFileSync(join(dir, 'audit.jsonl'), 'utf8')
    expect(content).not.toContain('secretvalue12345678')
    expect(content).not.toContain('user@example.com')
  })
})
