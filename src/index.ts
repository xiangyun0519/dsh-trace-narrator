/**
 * dsh-trace-narrator：把 dsh 会话轨迹（append-only 事件流）变成可分享、
 * 可复盘、可教学的结构化报告（HTML / Markdown / JSON）。
 *
 * v0.2.0 脚手架：注册 settings 命名空间与 /trace-narrate 命令（no-op）。
 * 管线（读取→压缩→脱敏→确认→LLM→校验→渲染）随 v0.3.0+ 逐步落地，
 * 完整设计见 docs/design.md。
 * @module dsh-trace-narrator
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
// Type-only：合并 ctx.commands 的 Context 声明（ctx.commands.register）。
import type {} from '@deepseek-ai/dsh-commands'

/** settings 命名空间：trace-narrator（lowercase kebab-case）。 */
export const TRACE_NARRATOR_NAMESPACE = settingsNamespace('trace-narrator')

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
  /** false = 关闭上传（默认，绝不联网） */
  upload: false | UploadConfig
}

/**
 * 构建一份独立的 schemastery schema 实例。
 * 行配置（static Config）与 settings 命名空间各需要一份实例，不可复用。
 */
function buildConfigSchema() {
  const auditSchema = z.object({
    enabled: z.boolean().default(true),
    dir: z.string().default(''),
    maxBytes: z.number().step(1).min(1).default(1048576),
    keep: z.number().step(1).min(1).default(3),
  })
  const uploadSchema = z.union([
    z.const(false),
    z.object({
      endpoint: z.string().default(''),
      authEnv: z.string().default(''),
      timeoutMs: z.number().step(1).min(1).default(15000),
    }),
  ])
  return z.object({
    lang: z.union([z.const('zh-CN'), z.const('en'), z.const('ja')]).default('zh-CN'),
    schema: z.string().default('summary'),
    redact: z.union([z.const('off'), z.const('minimal'), z.const('standard'), z.const('strict')]).default('strict'),
    format: z.union([z.const('html'), z.const('md'), z.const('json')]).default('html'),
    outputDir: z.string().default('trace-narrate'),
    tokenBudget: z.number().step(1).min(3000).max(100000).default(12000),
    maxTokens: z.number().step(1).min(256).max(8192).default(2048),
    confirmBeforeSend: z.boolean().default(true),
    schemaDir: z.string().default(''),
    audit: auditSchema.default({ enabled: true, dir: '', maxBytes: 1048576, keep: 3 }),
    upload: uploadSchema.default(false),
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    traceNarrator: TraceNarratorService
  }
}

/**
 * 插件服务：挂载即注册设置与命令，卸载时随 fiber 一并回收。
 * 行配置（cordis.patch.yml）由 static Config 校验后传入构造函数。
 */
export class TraceNarratorService extends Service {
  static inject = ['settings', 'commands']
  static Config: z<TraceNarratorConfig> = buildConfigSchema()

  private readonly scope: SettingsScope<TraceNarratorConfig>

  constructor(ctx: Context, config: TraceNarratorConfig) {
    super(ctx, 'traceNarrator')

    // 优先级：schema 默认 < cordis.patch.yml 行配置（base）< 用户设置 < CLI 参数（v0.8.0 起）。
    this.scope = ctx.settings.register(TRACE_NARRATOR_NAMESPACE, buildConfigSchema(), {
      base: config,
    })

    ctx.logger.info('trace-narrator v0.2.0: mounted (settings namespace + /trace-narrate registered)')

    ctx.commands.register({
      name: 'trace-narrate',
      description: '把会话轨迹生成结构化报告（脱敏 + LLM 总结，HTML/MD/JSON）',
      input: {
        hint: '[sessionId] [--schema <内置名|路径|URL>] [--redact off|minimal|standard|strict] [--format html|md|json] [--output <dir>] [--yes] [--upload <endpoint>]',
      },
      handler: () => ({
        kind: 'success',
        text: `[v0.2.0 脚手架] /trace-narrate 已注册，管线尚未实现。当前配置：${JSON.stringify(this.scope.get())}`,
      }),
    })
  }

  /** 当前已解析配置（schema 默认 + 行配置 + 用户设置）。 */
  resolvedConfig(): TraceNarratorConfig {
    return this.scope.get()
  }
}

export default TraceNarratorService
