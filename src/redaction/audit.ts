/**
 * 脱敏审计日志（docs/redaction.md §4）：
 * 只记「哪类被替换了多少处 + 出现位置（seq）」，绝不记原文、绝不记
 * secret→占位符映射。JSONL 追加 + 大小轮转（默认 1MB × 3 份，0600 尽力而为）。
 *
 * 生产实现直接使用本模块的 node:fs 写入（宿主进程写 $DSH_HOME/trace-narrator，
 * 与 session-persistence 等宿主插件的写盘方式一致；ctx.fs 面向工作区沙箱，
 * 不适用于宿主家目录）。
 * @module dsh-trace-narrator/redaction/audit
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { RedactLevel } from '../config.ts'
import type { RedactionReport } from './index.ts'

export interface AuditDetectorEntry {
  id: string
  count: number
  eventSeqs: number[]
  truncated?: boolean
}

/** 一轮叙述的一条审计记录。 */
export interface AuditEntry {
  ts: number
  sessionId: string
  level: RedactLevel
  total: number
  detectors: AuditDetectorEntry[]
  /** 用户是否通过发送确认（false = 取消，仍记录预览统计）。 */
  confirmed: boolean
  /** 是否实际调用了 LLM（发送）。 */
  sent: boolean
}

/** 从累计脱敏报告构建审计条目（detached 拷贝，绝不引用红actor内部状态）。 */
export function buildAuditEntry(
  sessionId: string,
  report: RedactionReport,
  confirmed: boolean,
  sent: boolean,
): AuditEntry {
  return {
    ts: Date.now(),
    sessionId,
    level: report.level,
    total: report.total,
    detectors: report.detectors.map(entry => ({
      id: entry.id,
      count: entry.count,
      eventSeqs: [...entry.eventSeqs],
      ...(entry.truncated === true ? { truncated: true } : {}),
    })),
    confirmed,
    sent,
  }
}

export interface AuditWriter {
  write(entry: AuditEntry): void
}

export interface FileAuditWriterOptions {
  /** 单文件轮转阈值（字节）；默认 1MB。 */
  maxBytes?: number
  /** 保留份数（不含当前文件）；默认 3。 */
  keep?: number
  /** 文件名；默认 audit.jsonl。 */
  filename?: string
}

/**
 * JSONL 文件审计写入器：audit.jsonl 满 maxBytes 时轮转为
 * audit.1.jsonl … audit.<keep-1>.jsonl（更旧的丢弃）。
 */
export function createFileAuditWriter(dir: string, options: FileAuditWriterOptions = {}): AuditWriter {
  const maxBytes = options.maxBytes ?? 1048576
  const keep = Math.max(1, options.keep ?? 3)
  const filename = options.filename ?? 'audit.jsonl'
  return {
    write(entry) {
      mkdirSync(dir, { recursive: true })
      const file = join(dir, filename)
      if (existsSync(file)) {
        let size = 0
        try {
          size = statSync(file).size
        } catch {
          size = 0
        }
        if (size >= maxBytes) rotate(dir, filename, keep)
      }
      appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
      try {
        chmodSync(file, 0o600)
      } catch {
        // Windows：权限由 ACL 控制，0600 尽力而为。
      }
    },
  }
}

function rotate(dir: string, filename: string, keep: number): void {
  const rotated = (i: number): string =>
    filename.endsWith('.jsonl')
      ? `${filename.slice(0, -'.jsonl'.length)}.${i}.jsonl`
      : `${filename}.${i}`
  const path = (i: number): string => join(dir, i === 0 ? filename : rotated(i))
  for (let i = keep - 1; i >= 1; i -= 1) {
    const from = path(i - 1)
    if (!existsSync(from)) continue
    const to = path(i)
    if (i === keep - 1 && existsSync(to)) unlinkSync(to)
    renameSync(from, to)
  }
}
