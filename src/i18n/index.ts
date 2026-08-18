/**
 * 命令输出与确认文案（zh-CN / en；ja 复用 zh）。
 * 设计树的 i18n/*.json 改为 TS 模块（避免 resolveJsonModule + 类型安全），
 * 语言同时作用于：确认问题、命令结果、错误信息、报告 chrome（renderer）。
 * @module dsh-trace-narrator/i18n
 */

export type UiLang = 'zh-CN' | 'en'

export interface Strings {
  usage: string
  usageBody: string
  errUnknownFlag: (flag: string) => string
  errBadValue: (flag: string, expected: string) => string
  errExtraPositional: string
  errNonInteractive: string
  errCancelled: string
  errSessionRead: (sessionId: string, detail: string) => string
  errSchema: (spec: string, detail: string) => string
  errWrite: (path: string, detail: string) => string
  confirmHeader: string
  confirmQuestion: (sessionId: string, events: number, steps: number, tokens: number, redacted: number) => string
  confirmSend: string
  confirmCancel: string
  okMessage: (path: string, redacted: number) => string
  degradedNoLlm: string
  degradedValidation: string
  schemaWarnings: (count: number) => string
}

const ZH: Strings = {
  usage: '用法：/trace-narrate [sessionId] [--schema <内置名|路径|URL>] [--lang zh-CN|en|ja] [--redact off|minimal|standard|strict] [--format html|md|json] [--output <dir>] [--token-budget <n>] [--max-tokens <n>] [--yes] [--no-confirm]',
  usageBody: '默认：当前会话、summary schema、strict 脱敏、HTML 输出到 trace-narrate/。退出码：0 成功｜2 用法｜3 会话读取失败｜4 取消/未确认｜5 降级报告｜6 schema 失败｜7 写入失败。',
  errUnknownFlag: flag => `未知参数：${flag}`,
  errBadValue: (flag, expected) => `${flag} 取值非法（应为 ${expected}）`,
  errExtraPositional: '最多一个位置参数（sessionId）',
  errNonInteractive: '发送前确认被要求，但当前环境无法交互。请追加 --yes 显式确认，或在设置里关闭 confirmBeforeSend。',
  errCancelled: '已取消：未调用 LLM，未生成报告。',
  errSessionRead: (sessionId, detail) => `会话 "${sessionId}" 读取失败：${detail}`,
  errSchema: (spec, detail) => `schema "${spec}" 加载失败：${detail}`,
  errWrite: (path, detail) => `报告写入失败：${path}（${detail}）`,
  confirmHeader: '发送前确认',
  confirmQuestion: (sessionId, events, steps, tokens, redacted) =>
    `即将调用 LLM 生成总结：会话 ${sessionId}，事件 ${events} 条 → 剧本 ${steps} 行，token 预算 ${tokens}；本次已脱敏 ${redacted} 处。发送后内容将离开本地。`,
  confirmSend: '发送',
  confirmCancel: '取消',
  okMessage: (path, redacted) => `报告已生成：${path}（脱敏 ${redacted} 处）`,
  degradedNoLlm: '⚠️ 未生成 AI 总结（LLM 不可用或重试耗尽），已输出纯模板报告。',
  degradedValidation: '⚠️ 总结未通过 schema 校验，原始输出已放入报告附录。',
  schemaWarnings: count => `（schema 有 ${count} 条非致命警告）`,
}

const EN: Strings = {
  usage: 'usage: /trace-narrate [sessionId] [--schema <builtin|path|URL>] [--lang zh-CN|en|ja] [--redact off|minimal|standard|strict] [--format html|md|json] [--output <dir>] [--token-budget <n>] [--max-tokens <n>] [--yes] [--no-confirm]',
  usageBody: 'Defaults: current session, summary schema, strict redaction, HTML into trace-narrate/. Exit codes: 0 ok | 2 usage | 3 session read | 4 cancelled/unconfirmed | 5 degraded | 6 schema | 7 write.',
  errUnknownFlag: flag => `unknown flag: ${flag}`,
  errBadValue: (flag, expected) => `invalid value for ${flag} (expected ${expected})`,
  errExtraPositional: 'at most one positional argument (sessionId)',
  errNonInteractive: 'Send confirmation is required but this environment cannot interact. Add --yes, or disable confirmBeforeSend in settings.',
  errCancelled: 'Cancelled: LLM was not called and no report was written.',
  errSessionRead: (sessionId, detail) => `session "${sessionId}" read failed: ${detail}`,
  errSchema: (spec, detail) => `schema "${spec}" load failed: ${detail}`,
  errWrite: (path, detail) => `report write failed: ${path} (${detail})`,
  confirmHeader: 'Confirm before sending',
  confirmQuestion: (sessionId, events, steps, tokens, redacted) =>
    `About to call the LLM: session ${sessionId}, ${events} events -> ${steps} script lines, token budget ${tokens}; ${redacted} secrets redacted. Content will leave this machine.`,
  confirmSend: 'Send',
  confirmCancel: 'Cancel',
  okMessage: (path, redacted) => `Report written: ${path} (${redacted} redacted)`,
  degradedNoLlm: '⚠️ No AI summary (LLM unavailable or retries exhausted); template-only report written.',
  degradedValidation: '⚠️ Summary failed schema validation; raw output is in the report appendix.',
  schemaWarnings: count => ` (schema has ${count} non-fatal warnings)`,
}

export function strings(lang: UiLang): Strings {
  return lang === 'en' ? EN : ZH
}
