# Schema 体系（summary / postmortem / tutorial / debug / executive）

> 设计定稿 v0.1.0 ｜实现：v0.5.0（loader + 校验）
> 关键前提（已实测）：DSH 的 `GenerateOptions` **没有**结构化输出字段，因此「schema」不是发给模型 API 的约束，而是**提示词约束 + 输出后校验**的契约。文档中所有 description 都会进入提示词，请写得对 LLM 友好。

## 1. 总则

- 全部内置 schema 遵循 **JSON Schema draft 2020-12**，根为 object。
- 统一规则：`"additionalProperties": false`（多余字段会被删除而非报错）、关键字段全部 `required`（LLM 缺字段 → 校验失败 → 重试）。
- 输出校验器：ajv + 提取流程（§4）。
- 用户自定义 schema 受 loader 安全检查（§3）。

## 2. 内置 5 套

### 2.1 summary（默认）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "duration", "summary", "key_steps", "decisions", "outcomes"],
  "properties": {
    "title":     { "type": "string", "description": "一句话标题，概括本次会话做了什么" },
    "duration":  { "type": "string", "description": "会话时长，如：12 分钟" },
    "summary":   { "type": "string", "description": "3-6 句的完整总结：目标、过程、结果" },
    "key_steps": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 12,
                   "description": "按时间顺序的关键步骤列表" },
    "decisions": { "type": "array", "items": { "type": "string" }, "maxItems": 8,
                   "description": "过程中做出的重要决策；没有则为空数组" },
    "outcomes":  { "type": "array", "items": { "type": "string" }, "maxItems": 8,
                   "description": "最终产出与结果；没有则为空数组" }
  }
}
```

### 2.2 postmortem（事故复盘）

| 字段 | 类型 | 说明 |
|---|---|---|
| `incident` | string | 事故一句话描述（发生了什么、影响） |
| `timeline` | array<string> | 时间线，每项如「12:03 用户报告 502」，minItems 1、maxItems 20 |
| `root_cause` | string | 根因分析 |
| `fix` | string | 修复动作（已实施/待实施要写明） |
| `lessons` | array<string> | 经验教训，minItems 1、maxItems 10 |

全部 required，`additionalProperties: false`。

### 2.3 tutorial（教学）

| 字段 | 类型 | 说明 |
|---|---|---|
| `goal` | string | 本教程要教会读者什么 |
| `prerequisites` | array<string> | 前置条件（环境/知识），maxItems 10，可为空数组 |
| `steps` | array<string> | 教学步骤，按顺序，minItems 3、maxItems 30 |
| `key_concepts` | array<string> | 涉及的核心概念及一句话解释，minItems 1、maxItems 12 |
| `pitfalls` | array<string> | 常见坑与避免方法，maxItems 12 |

### 2.4 debug（找 Bug）

| 字段 | 类型 | 说明 |
|---|---|---|
| `problem` | string | 症状描述 |
| `investigation` | string | 排查过程（试了什么、观察到了什么） |
| `smoking_gun` | string | 决定性证据（哪一行/哪个现象锁定问题）；未找到时写 "unknown" |
| `why_it_failed` | string | 根本原因 |
| `fix` | string | 修复方式 |

全部 required 的 string。

### 2.5 executive（给非技术人）

| 字段 | 类型 | 说明 |
|---|---|---|
| `what` | string | 这次做了什么，2-3 句，避免术语 |
| `who` | string | 参与方（用户/系统/模型），避免技术名词 |
| `when` | string | 时间与耗时 |
| `outcome` | string | 结果如何（成功/部分成功/失败及影响） |
| `next_actions` | array<string> | 建议的后续动作，minItems 1、maxItems 6 |

## 3. 自定义 schema 加载

`--schema` 的解析顺序：

1. **内置名**：`summary|postmortem|tutorial|debug|executive`；
2. **已保存名**：`$DSH_HOME/schemas/<name>.json`（`settings.schemaDir` 可覆盖）；
3. **路径**：相对路径（基于会话 workspace）或绝对路径（受沙箱策略约束，`ctx.fs` 读取）；
4. **URL**：`http(s)://` 前缀，走 `ctx.web.fetch`。

**URL 安全限制（loader 强制）**：仅 HTTPS；超时 10s；响应 ≤64KB；解析后必须是根为 object 的合法 JSON Schema；每会话缓存 1 次（防重复拉取）。

**loader 结构安全检查（对任何来源一律执行）**：
- 根必须是 `type: "object"`；
- 顶层 `properties` ≤30 个；
- 禁止外部 `$ref`（只允许 `#` 开头的内部引用；v1 实现可先直接拒绝所有 `$ref`）；
- 嵌套深度 ≤5；
- 每个字段必须有 `type` 与 `description`（description 进提示词，没有则加载警告但放行）。

任一不满足 → exit 6 + 明确原因。

## 4. 校验与重试（validator）

```
LLM 文本 → 剥围栏（```json ... ``` / 首尾空白）→ 定位第一个 { 到最后一个 } → JSON.parse
        → ajv 校验（draft 2020-12，对应 schema）
        → 通过：删除 additionalProperties 之外的字段 → 干净对象
        → 失败：把 ajv 错误文本回喂 LLM 重试（≤2 次；每次 temperature 保持 0）
        → 仍失败：降级——报告总结章节替换为「总结未通过 schema 校验」，
                   原始输出全文放入 HTML 转义后的附录（MD 用代码块，JSON 放 raw_output 字段）
```

- ajv 配置：`{ strict: true }`，不启用 `ajv-formats`（v1 不依赖 format 关键字）。
- 重试提示词增量：`上次输出未通过校验：<ajv错误>。请只输出修正后的 JSON。`

## 5. 用户写 schema 指南（docs 用）

1. 根必须是 object；给每个字段写清楚 `description`——它会进提示词，决定生成质量。
2. `additionalProperties: false` + 关键字段 `required`，让校验真正有效。
3. 数组给 `minItems/maxItems` 与 `items.type`；纯字符串列表最稳。
4. 不要用 `$ref`（v1 校验器不支持）；`oneOf/anyOf` 会增加 LLM 失败率，慎用。
5. 示例文件：`examples/custom-schema.json`（v1.0.0 提供）。
