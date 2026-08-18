/**
 * HTML 全量转义：& < > " '。
 * 模板不信任任何动态文本——LLM 输出、剧本回显、标题一律经 escapeHtml。
 * 这是注入防护的最后一层（docs/design.md §6），不依赖 schema 校验。
 * @module dsh-trace-narrator/renderer/escape
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char)
}

/**
 * 生成一段内容装得下的代码围栏（围栏长度 = max(3, 内容中最长反引号连续段 + 1)），
 * 防止内容中的 ``` 逃逸出围栏。
 */
export function safeCodeFence(content: string, language = ''): string {
  const runs = content.match(/`+/g) ?? []
  const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0)
  const fence = '`'.repeat(Math.max(3, maxRun + 1))
  return `${fence}${language}\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}`
}
