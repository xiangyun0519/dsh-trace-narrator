/**
 * 内置 5 套输出 schema（docs/schemas.md §2）：
 * summary（默认）/ postmortem / tutorial / debug / executive。
 * 全部遵循 JSON Schema draft 2020-12：根为 object、additionalProperties:false、
 * 关键字段 required；description 会进入 LLM 提示词，措辞面向模型友好。
 * 以 TS 模块形式内置（设计树里的 builtin/*.json 改为单文件，理由：类型安全、
 * 单文件可审计；用户可拷贝的自定义示例在 examples/custom-schema.json，v1.0.0 提供）。
 * @module dsh-trace-narrator/schemas/builtin
 */

export type JsonSchema = Record<string, unknown>

const str = (description: string): Record<string, unknown> => ({ type: 'string', description })
const strArray = (description: string, limits: { minItems?: number; maxItems?: number } = {}): Record<string, unknown> => ({
  type: 'array',
  items: { type: 'string' },
  description,
  ...(limits.minItems === undefined ? {} : { minItems: limits.minItems }),
  ...(limits.maxItems === undefined ? {} : { maxItems: limits.maxItems }),
})

/** 通用总结（默认）。 */
export const SUMMARY_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['title', 'duration', 'summary', 'key_steps', 'decisions', 'outcomes'],
  properties: {
    title: str('一句话标题，概括本次会话做了什么'),
    duration: str('会话时长，如：12 分钟'),
    summary: str('3-6 句的完整总结：目标、过程、结果'),
    key_steps: strArray('按时间顺序的关键步骤列表', { minItems: 1, maxItems: 12 }),
    decisions: strArray('过程中做出的重要决策；没有则为空数组', { maxItems: 8 }),
    outcomes: strArray('最终产出与结果；没有则为空数组', { maxItems: 8 }),
  },
}

/** 事故复盘。 */
export const POSTMORTEM_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['incident', 'timeline', 'root_cause', 'fix', 'lessons'],
  properties: {
    incident: str('事故一句话描述（发生了什么、影响）'),
    timeline: strArray('时间线，每项如「12:03 用户报告 502」', { minItems: 1, maxItems: 20 }),
    root_cause: str('根因分析'),
    fix: str('修复动作（已实施/待实施要写明）'),
    lessons: strArray('经验教训', { minItems: 1, maxItems: 10 }),
  },
}

/** 教学。 */
export const TUTORIAL_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'prerequisites', 'steps', 'key_concepts', 'pitfalls'],
  properties: {
    goal: str('本教程要教会读者什么'),
    prerequisites: strArray('前置条件（环境/知识）', { maxItems: 10 }),
    steps: strArray('教学步骤，按顺序', { minItems: 3, maxItems: 30 }),
    key_concepts: strArray('涉及的核心概念及一句话解释', { minItems: 1, maxItems: 12 }),
    pitfalls: strArray('常见坑与避免方法', { maxItems: 12 }),
  },
}

/** 找 Bug。 */
export const DEBUG_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['problem', 'investigation', 'smoking_gun', 'why_it_failed', 'fix'],
  properties: {
    problem: str('症状描述'),
    investigation: str('排查过程（试了什么、观察到了什么）'),
    smoking_gun: str('决定性证据（哪一行/哪个现象锁定问题）；未找到时写 "unknown"'),
    why_it_failed: str('根本原因'),
    fix: str('修复方式'),
  },
}

/** 给非技术人看。 */
export const EXECUTIVE_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['what', 'who', 'when', 'outcome', 'next_actions'],
  properties: {
    what: str('这次做了什么，2-3 句，避免术语'),
    who: str('参与方（用户/系统/模型），避免技术名词'),
    when: str('时间与耗时'),
    outcome: str('结果如何（成功/部分成功/失败及影响）'),
    next_actions: strArray('建议的后续动作', { minItems: 1, maxItems: 6 }),
  },
}

export const BUILTIN_SCHEMAS: Readonly<Record<string, JsonSchema>> = Object.freeze({
  summary: SUMMARY_SCHEMA,
  postmortem: POSTMORTEM_SCHEMA,
  tutorial: TUTORIAL_SCHEMA,
  debug: DEBUG_SCHEMA,
  executive: EXECUTIVE_SCHEMA,
})

export function isBuiltinName(name: string): boolean {
  return name in BUILTIN_SCHEMAS
}
