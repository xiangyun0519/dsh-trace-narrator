/**
 * 命令输出与确认文案（zh-CN / en；ja 复用 zh）。
 * 设计树的 i18n/*.json 改为 TS 模块（避免 resolveJsonModule + 类型安全），
 * 语言同时作用于：确认问题、命令结果、错误信息、报告 chrome（renderer）。
 * @module dsh-trace-narrator/i18n
 */

import type { OutputFormat, RedactLevel } from '../config.ts'

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
  processSummary: (sessionId: string, events: number, steps: number, redacted: number) => string
  openReport: (link: string) => string
  uploadOk: string
  uploadFail: (detail: string) => string
  degradedNoLlm: string
  degradedValidation: string
  schemaWarnings: (count: number) => string
  preInboxNotice: (args: PreInboxArgs) => string
  postInboxPrompt: (args: PostInboxArgs) => string
  commandAck: (args: CommandAckArgs) => string
}

export interface PostInboxArgs {
  sessionId: string
  events: number
  steps: number
  redacted: number
  outputPath: string
  link: string | undefined
  summary: Record<string, unknown>
  lang: 'zh-CN' | 'en'
}

export interface PreInboxArgs {
  sessionId: string
  events: number
  steps: number
  redacted: number
  schema: string
  redact: RedactLevel
  format: OutputFormat
  lang: 'zh-CN' | 'en'
}

export interface CommandAckArgs {
  sessionId: string
  outputPath: string
  link: string | undefined
  reportLine: string
  inboxDelivered: boolean
  lang: 'zh-CN' | 'en'
}

function formatName(format: OutputFormat): string {
  switch (format) {
    case 'html': return 'HTML'
    case 'md': return 'Markdown'
    case 'json': return 'JSON'
  }
}

function zhPreInboxNotice(args: PreInboxArgs): string {
  return `【插件通知】用户刚调用了 /trace-narrate（会话 ${args.sessionId}，事件 ${args.events} 条，剧本 ${args.steps} 行）。报告已生成，下一条 inbox 消息会提供已脱敏的完整总结。实际配置：${args.redact} 脱敏、${args.schema} schema、${formatName(args.format)} 报告；共脱敏 ${args.redacted} 处。你的任务：\n\n1. 用一句话向用户说明总结已完成，并给出事件数和脱敏数\n2. 直接复述下一条消息中的完整总结，不要自行补充报告中没有的内容\n3. 如需调整，提示用户重跑 /trace-narrate 并修改参数\n4. 保持简短、自然的对话口吻`
}

function enPreInboxNotice(args: PreInboxArgs): string {
  return `[Plugin notice] The user just invoked /trace-narrate (session ${args.sessionId}, ${args.events} events, ${args.steps} script lines). The report is written; the next inbox message contains the full redacted summary. Actual config: ${args.redact} redaction, ${args.schema} schema, ${formatName(args.format)} report; ${args.redacted} redactions in total. Your job:\n\n1. Briefly tell the user the summary is ready, including event and redaction counts\n2. Reproduce the complete summary from the next message without inventing details\n3. If they want changes, suggest re-running /trace-narrate with different flags\n4. Keep the reply short and conversational`
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
  processSummary: (sessionId, events, steps, redacted) =>
    `📋 会话 ${sessionId}：事件 ${events} 条 → 剧本 ${steps} 行 → 脱敏 ${redacted} 处 → 总结完成`,
  openReport: link => `[📄 打开报告](${link})`,
  uploadOk: '已上传',
  uploadFail: detail => `上传失败：${detail}`,
  degradedNoLlm: '⚠️ 未生成 AI 总结（LLM 不可用或重试耗尽），已输出纯模板报告。',
  degradedValidation: '⚠️ 总结未通过 schema 校验，原始输出已放入报告附录。',
  schemaWarnings: count => `（schema 有 ${count} 条非致命警告）`,
  preInboxNotice: args => zhPreInboxNotice(args),
  postInboxPrompt: args => args.lang === 'en' ? enPostPrompt(args) : zhPostPrompt(args),
  commandAck: args => args.lang === 'en' ? enCommandAck(args) : zhCommandAck(args),
}

function zhPostPrompt(args: PostInboxArgs): string {
  const linkLine = args.link === undefined
    ? `报告路径：${args.outputPath}`
    : `报告路径：${args.outputPath}\n同源链接：[📄 打开报告](${args.link})`
  const summaryJson = JSON.stringify(args.summary, null, 2)
  return `【插件 → 对话模型】你刚完成了一次 /trace-narrate 总结。**把下面的完整总结内容直接写在对话里给用户看**（用 Markdown，让 ta 不用打开文件就能读）：

## 会话 ${args.sessionId} 的轨迹总结

- 事件：${args.events} 条 → 剧本：${args.steps} 行 → 已脱敏：${args.redacted} 处
- ${linkLine}

### 总结内容（已脱敏）

\`\`\`json
${summaryJson}
\`\`\`

## 下一步

- 文件已在上面路径生成；同源链接点开即看浏览器版
- 如需调整（脱敏级别 / schema / 重新生成），告诉用户重跑命令加参数，例如：\`/trace-narrate --redact minimal --schema postmortem\`
- 也可以问用户要不要：导出 Markdown / 存到项目知识库 / 对比上次会话 / 展开某方面

## 回复要求

1. **必须把「总结内容」JSON 代码块完整复制到你的回复里**（让用户能直接读）
2. 用 Markdown 把「会话 总结」「数据」「下一步」三段组织好
3. 报告路径 + 链接放在「下一步」里（可点击）
4. 对话口吻，不要说"以下是"——直接以"这是这次会话的轨迹总结："开头
5. 不要压缩、不要缩写 summary 内容——完整性优先`
}

function enPostPrompt(args: PostInboxArgs): string {
  const linkLine = args.link === undefined
    ? `Report: ${args.outputPath}`
    : `Report: ${args.outputPath}\nLink: [📄 Open report](${args.link})`
  const summaryJson = JSON.stringify(args.summary, null, 2)
  return `[Plugin -> conversation model] You just finished a /trace-narrate run. **Write the full summary directly into the conversation for the user to read** (use Markdown; they should not need to open the file):

## Session ${args.sessionId} Trace Summary

- ${args.events} events -> ${args.steps} script lines -> ${args.redacted} redacted
- ${linkLine}

### Summary (redacted)

\`\`\`json
${summaryJson}
\`\`\`

## Next steps

- File written at the path above; click the link for the browser version
- To adjust (redact / schema / regenerate), tell the user to re-run with flags, e.g. \`/trace-narrate --redact minimal --schema postmortem\`
- Or ask: export Markdown / save to project knowledge / compare with last session / expand an angle

## Reply requirements

1. **MUST include the full summary JSON code block in your reply** so the user can read it
2. Organize the three sections above in Markdown
3. Put the report path + link in "Next steps" (clickable)
4. Conversational tone; start directly with "Here's the trace summary for this session:"
5. Do not compress or abbreviate the summary content — completeness over brevity`
}

function zhCommandAck(args: CommandAckArgs): string {
  const linkLine = args.link === undefined ? '' : ` · [📄 打开报告](${args.link})`
  const detailsLine = args.inboxDelivered ? '详情见对话下一轮（对话模型会为你复述）' : '完整内容请打开报告查看。'
  return `${args.reportLine}\n报告已生成：${args.outputPath}${linkLine}\n${detailsLine}`
}

function enCommandAck(args: CommandAckArgs): string {
  const linkLine = args.link === undefined ? '' : ` · [📄 Open report](${args.link})`
  const detailsLine = args.inboxDelivered ? 'Details will be narrated in the next conversation turn' : 'Open the report above for full details.'
  return `${args.reportLine}\nReport written: ${args.outputPath}${linkLine}\n${detailsLine}`
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
  processSummary: (sessionId, events, steps, redacted) =>
    `📋 Session ${sessionId}: ${events} events -> ${steps} script lines -> ${redacted} redacted -> summary done`,
  openReport: link => `[📄 Open report](${link})`,
  uploadOk: 'uploaded',
  uploadFail: detail => `upload failed: ${detail}`,
  degradedNoLlm: '⚠️ No AI summary (LLM unavailable or retries exhausted); template-only report written.',
  degradedValidation: '⚠️ Summary failed schema validation; raw output is in the report appendix.',
  schemaWarnings: count => ` (schema has ${count} non-fatal warnings)`,
  preInboxNotice: args => enPreInboxNotice(args),
  postInboxPrompt: args => args.lang === 'en' ? enPostPrompt(args) : zhPostPrompt(args),
  commandAck: args => args.lang === 'en' ? enCommandAck(args) : zhCommandAck(args),
}

export function strings(lang: UiLang): Strings {
  return lang === 'en' ? EN : ZH
}
