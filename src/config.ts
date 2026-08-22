/**
 * 共享配置类型：settings 命名空间、行配置、redaction、args、narrator 共用。
 * 与 docs/design.md §7 的配置面一一对应。
 * @module dsh-trace-narrator/config
 */

export type Lang = 'zh-CN' | 'en' | 'ja'

export type RedactLevel = 'off' | 'minimal' | 'standard' | 'strict'

export type OutputFormat = 'html' | 'md' | 'json'

export interface AuditConfig {
  enabled: boolean
  /** 空串 = 运行时解析为 $DSH_HOME/trace-narrator */
  dir: string
  maxBytes: number
  keep: number
}

export interface UploadConfig {
  /** HTTPS 端点；token 一律从 authEnv 指定的环境变量读取 */
  endpoint: string
  authEnv: string
  timeoutMs: number
}

/** 完整配置面（docs/design.md §7）。 */
export interface TraceNarratorConfig {
  lang: Lang
  schema: string
  redact: RedactLevel
  format: OutputFormat
  outputDir: string
  tokenBudget: number
  maxTokens: number
  confirmBeforeSend: boolean
  /** 空串 = 运行时解析为 $DSH_HOME/schemas */
  schemaDir: string
  audit: AuditConfig
  /** false = 关闭 viewer 上报（默认；LLM 和 HTTPS schema URL 仍可能联网） */
  upload: false | UploadConfig
}
