/**
 * JSON 输出：原始 + 总结，便于二次处理。
 * 所有字段均为纯数据（已脱敏），JSON.stringify 自带转义。
 * @module dsh-trace-narrator/renderer/json
 */

import type { NarratedReport } from '../report.ts'

export function renderJson(report: NarratedReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
