/**
 * dsh-trace-narrator：把 dsh 会话轨迹（append-only 事件流）变成可分享、
 * 可复盘、可教学的结构化报告（HTML / Markdown / JSON）。
 *
 * 插件入口：注册 settings 命名空间与 /trace-narrate 命令。
 * 管线编排在 narrator.ts（纯 DI），本文件只做生产适配：
 *   ctx.sessionQuery → SessionLogSource / title
 *   ctx.llm + ctx.agentDefaultModel → SummaryLlm / 模型路由
 *   ctx.userQuestions → 发送前确认
 *   ctx.fs + ctx.sandboxPolicy → 报告落盘与 schema 文件读取
 *   ctx.web → schema URL 拉取（尊重部署网络策略）
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
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

// v0.3.0：剧本格式、会话读取、投影与预算截断（详见 docs/design.md §4-5）。
export * from './script.ts'
export * from './reader.ts'
export * from './compressor.ts'
// v0.4.0：脱敏管线与审计日志（docs/redaction.md）。
export * from './redaction/index.ts'
export * from './redaction/audit.ts'
// v0.5.0：内置 schema、自定义加载、输出校验（docs/schemas.md）。
export * from './schemas/builtin.ts'
export * from './schemas/loader.ts'
export * from './schemas/validate.ts'
// v0.6.0：LLM 流收集与总结编排（docs/design.md §6 注入防护 + §7 降级）。
export * from './llm/collect.ts'
export * from './summarizer.ts'
// v0.7.0：报告模型与渲染器（HTML/MD/JSON，全量转义）。
export * from './report.ts'
export * from './renderer/index.ts'
// v0.8.0：参数解析、文案、管线编排。
export * from './args.ts'
export * from './i18n/index.ts'
export * from './narrator.ts'

/** settings 命名空间：trace-narrator（lowercase kebab-case）。 */
export const TRACE_NARRATOR_NAMESPACE = settingsNamespace('trace-narrator')

// 共享配置类型（src/config.ts），保持 v0.2.0 起的包根导出面。
import type { TraceNarratorConfig } from './config.ts'
export type * from './config.ts'

import type { SessionLogSnapshotLike } from './reader.ts'
import { collectStreamText } from './llm/collect.ts'
import type { StreamChunkLike } from './llm/collect.ts'
import { createFileAuditWriter } from './redaction/audit.ts'
import { parseArgs } from './args.ts'
import type { NarrateOverrides } from './args.ts'
import { narrate } from './narrator.ts'
import type { NarratorDeps } from './narrator.ts'
import { strings } from './i18n/index.ts'
import type { UiLang } from './i18n/index.ts'

// ---- 生产服务的结构契约（避免引入 @deepseek-ai/dsh-* 运行时依赖）----

interface LlmServiceLike {
  prepareCall(config: unknown, signal?: AbortSignal): Promise<{ stream(options: unknown): AsyncIterable<unknown> }>
}

interface UserQuestionsServiceLike {
  ask(request: unknown): Promise<{ answers: Array<{ id: string; selected: string[] }> }>
}

interface SessionQueryLike {
  readSession(sessionId: string): Promise<SessionLogSnapshotLike>
  readTitle(sessionId: string): Promise<{ title: string } | undefined>
}

interface FsServiceLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  processPath(target: unknown): string
  readText(target: unknown): Promise<string>
}

interface WebServiceLike {
  fetch(request: { url: string }, signal?: AbortSignal): Promise<{
    statusCode: number
    body: { kind: string; content: string }
  }>
}

interface SandboxPolicyLike {
  workspaceRoot: string
}

interface AgentDefaultModelLike {
  currentSelection(): { provider: string; model: string } | undefined
}

/** 可选服务读取：未注册时返回 undefined（headless/裁剪组合下优雅降级）。 */
function getService<T>(ctx: Context, name: string): T | undefined {
  return (ctx as unknown as { get(key: string): unknown }).get(name) as T | undefined
}

function resolveDshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  return env !== undefined && env.length > 0 ? env : join(homedir(), '.dsh')
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

    // 优先级：schema 默认 < cordis.patch.yml 行配置（base）< 用户设置 < CLI 参数。
    this.scope = ctx.settings.register(TRACE_NARRATOR_NAMESPACE, buildConfigSchema(), {
      base: config,
    })

    ctx.logger.info('trace-narrator v0.8.0: mounted (settings namespace + /trace-narrate)')

    ctx.commands.register({
      name: 'trace-narrate',
      description: '把会话轨迹生成结构化报告（脱敏 + LLM 总结，HTML/MD/JSON）',
      input: {
        hint: '[sessionId] [--schema <内置名|路径|URL>] [--redact off|minimal|standard|strict] [--format html|md|json] [--output <dir>] [--yes]',
      },
      handler: invocation => this.handleCommand(invocation),
    })
  }

  /** 当前已解析配置（schema 默认 + 行配置 + 用户设置）。 */
  resolvedConfig(): TraceNarratorConfig {
    return this.scope.get()
  }

  /** 命令入口：解析参数 → 组装生产依赖 → 编排管线。 */
  private async handleCommand(invocation: {
    rawInput: string
    agent: { session: { id: string } }
  }): Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }> {
    try {
      const config = this.scope.get()
      const ui = strings(config.lang === 'en' ? 'en' : 'zh-CN')
      const parsed = parseArgs(invocation.rawInput)
      if (!parsed.ok) {
        return { kind: 'error', text: `[exit 2] ${parsed.errors.join('\n')}\n\n${ui.usage}` }
      }
      if (parsed.help) {
        return { kind: 'success', text: `${ui.usage}\n${ui.usageBody}` }
      }
      const sessionId = parsed.sessionId ?? invocation.agent.session.id
      const outcome = await this.runNarrate(invocation, sessionId, parsed.overrides)
      switch (outcome.kind) {
        case 'ok': return { kind: 'success', text: outcome.message }
        case 'degraded': return { kind: 'success', text: `[exit 5] ${outcome.message}` }
        case 'cancelled': return { kind: 'error', text: `[exit ${outcome.exitCode}] ${outcome.message}` }
        case 'error': return { kind: 'error', text: `[exit ${outcome.exitCode}] ${outcome.message}` }
        /* v8 ignore next -- 封闭联合 */
        default: return { kind: 'error', text: '[exit 2] 未知结果' }
      }
    } catch (error) {
      return { kind: 'error', text: `[exit 2] trace-narrator 内部错误：${String(error)}` }
    }
  }

  /** 组装生产依赖并执行管线。 */
  private async runNarrate(
    invocation: { agent: { session: { id: string } } },
    sessionId: string,
    overrides: NarrateOverrides,
  ) {
    const ctx = this.ctx
    const config = this.scope.get()
    const home = resolveDshHome()
    const sandboxPolicy = getService<SandboxPolicyLike>(ctx, 'sandboxPolicy')
    const workspaceRoot = sandboxPolicy?.workspaceRoot ?? process.cwd()
    const fsService = getService<FsServiceLike>(ctx, 'fs')
    const webService = getService<WebServiceLike>(ctx, 'web')
    const sessionQuery = getService<SessionQueryLike>(ctx, 'sessionQuery')
    const userQuestions = getService<UserQuestionsServiceLike>(ctx, 'userQuestions')
    const llmService = getService<LlmServiceLike>(ctx, 'llm')
    const defaultModel = getService<AgentDefaultModelLike>(ctx, 'agentDefaultModel')

    const deps: NarratorDeps = {
      config,
      home,
      workspaceRoot,
      query: {
        async readSession(id) {
          if (sessionQuery === undefined) throw new Error('会话查询服务不可用')
          return sessionQuery.readSession(id)
        },
      },
      ...(sessionQuery === undefined ? {} : {
        title: async () => (await sessionQuery.readTitle(sessionId))?.title,
      }),
      schemaSource: {
        async readFileText(path) {
          if (fsService !== undefined) {
            const target = await fsService.resolve(path, { cwd: workspaceRoot })
            return fsService.readText(target)
          }
          return readFileSync(path, 'utf8')
        },
        async fetchUrl(url, options) {
          if (webService === undefined) throw new Error('无 web 服务（部署禁用网络）')
          const result = await webService.fetch({ url }, options.signal)
          if (result.statusCode < 200 || result.statusCode >= 300) {
            throw new Error(`HTTP ${result.statusCode}`)
          }
          if (result.body.kind !== 'text' && result.body.kind !== 'html') {
            throw new Error(`不支持的内容类型：${result.body.kind}`)
          }
          return result.body.content
        },
      },
      ...(userQuestions === undefined ? {} : {
        questions: {
          async ask(request) {
            const result = await userQuestions.ask({
              questions: [{
                id: 'trace-narrate-confirm',
                question: request.question,
                header: request.header,
                options: request.options.map(label => ({ label })),
              }],
              agent: invocation.agent,
            })
            return { selected: result.answers[0]?.selected ?? [] }
          },
        },
      }),
      ...(llmService === undefined ? {} : {
        llm: {
          async call(options) {
            const generateOptions = {
              provider: options.provider,
              model: options.model,
              system: options.system,
              messages: [{
                id: randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: options.user }],
                source: { kind: 'user' },
              }],
              temperature: options.temperature,
              maxTokens: options.maxTokens,
              signal: options.signal,
            }
            const prepared = await llmService.prepareCall(generateOptions, options.signal)
            const collected = await collectStreamText(
              prepared.stream(generateOptions) as AsyncIterable<StreamChunkLike>,
            )
            return collected.text
          },
        },
        ...(defaultModel === undefined ? {} : { model: defaultModel.currentSelection() }),
      }),
      writeFile: async (path, content) => {
        const absolute = isAbsolute(path) ? path : join(workspaceRoot, path)
        if (fsService !== undefined) {
          const target = await fsService.resolve(absolute, { cwd: workspaceRoot })
          const procPath = fsService.processPath(target)
          mkdirSync(dirname(procPath), { recursive: true })
          writeFileSync(procPath, content, 'utf8')
          return
        }
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, content, 'utf8')
      },
      ...(config.audit.enabled ? {
        auditWriter: createFileAuditWriter(
          config.audit.dir.length > 0 ? config.audit.dir : join(home, 'trace-narrator'),
          { maxBytes: config.audit.maxBytes, keep: config.audit.keep },
        ),
      } : {}),
    }

    return narrate(deps, { sessionId, overrides })
  }
}

export default TraceNarratorService
