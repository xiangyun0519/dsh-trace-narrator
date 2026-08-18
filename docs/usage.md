# 使用文档（dsh-trace-narrator）

把 dsh 会话轨迹（append-only 事件流）变成可分享、可复盘、可教学的结构化报告。

## 1. 安装

```bash
# 本地开发（link，随源码变化）
dsh plugin --profile <profile> add link:/path/to/dsh-trace-narrator

# 或普通安装
dsh plugin --profile <profile> add dsh-trace-narrator
```

重启 dsh 后生效。命令 `/trace-narrate` 出现在任意会话中。

## 2. 命令

```
/trace-narrate [sessionId] [--schema <内置名|路径|URL>] [--lang zh-CN|en|ja]
               [--redact off|minimal|standard|strict] [--format html|md|json]
               [--output <dir>] [--token-budget <n>] [--max-tokens <n>]
               [--yes] [--no-confirm] [--upload <endpoint>] [--help]
```

- 默认：当前会话、`summary` schema、`strict` 脱敏、HTML 输出到 `trace-narrate/`（基于会话工作区）。
- **报告链接**：执行完成后，命令回复里直接给出过程摘要与 `[📄 打开报告](/trace-narrate/<文件名>)` 可点击链接（同源，随当前 GUI 端口），点击即在浏览器打开自包含 HTML；无需去文件夹找文件。
- `--schema` 解析顺序：内置名（summary/postmortem/tutorial/debug/executive）→ URL（仅 HTTPS，10s/64KB 限制）→ 文件路径 → 已保存名（`$DSH_HOME/schemas/<name>.json`）。
- 发送前确认：默认弹出「N 事件、已脱敏 M 处，发送？」；`--yes` 跳过；无交互能力的环境必须显式 `--yes`，否则不发送（exit 4）。
- `--upload <endpoint>`：显式上报；失败时本地产物保留并返回 exit 8。

**退出码**：0 成功（含降级但产出报告）｜2 用法｜3 会话读取失败｜4 取消/未确认｜5 降级报告（LLM 不可用或校验耗尽）｜6 schema 失败｜7 写入失败｜8 显式上传失败。

## 3. 配置（settings 面板命名空间 `trace-narrator`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `lang` | `zh-CN` | 输出语言（zh-CN/en/ja） |
| `schema` | `summary` | 默认 schema |
| `redact` | `strict` | 脱敏强度（off/minimal/standard/strict） |
| `format` | `html` | 输出格式 |
| `outputDir` | `trace-narrate` | 输出目录（相对工作区） |
| `tokenBudget` | `12000` | 剧本 token 预算 |
| `maxTokens` | `2048` | 总结生成上限 |
| `confirmBeforeSend` | `true` | 发送前确认 |
| `schemaDir` | 空 | 已保存 schema 目录（空 = `$DSH_HOME/schemas`） |
| `audit` | 启用，1MB×3 | 审计日志（位置/轮转） |
| `upload` | `false` | opt-in：`{endpoint, authEnv, timeoutMs}` |

部署级默认值在插件 `cordis.patch.yml` 的行配置里；profile 自己的 `cordis.patch.yml` 可整体替换该行 `config`（不合并）。

## 4. 上报协议（自托管 viewer）

`POST <endpoint>`，`Content-Type: application/json`，body：

```jsonc
{
  "version": 1,
  "report": { /* NarratedReport：meta + status + summary + rawOutput/errors */ },
  "audit":  { /* 脱敏审计：类别计数 + seq 位置，无任何原文 */ }
}
```

- 仅 HTTPS；`authEnv` 指定读取 Bearer token 的环境变量名（**token 禁止出现在命令行或配置值里**）；超时 15s。
- 失败不影响本地产物；viewer 实现自便——本插件只负责安全的协议侧。

## 5. 审计日志

`$DSH_HOME/trace-narrator/audit.jsonl`（可用 settings 覆盖目录）：每轮一行
`{ts, sessionId, level, total, detectors:[{id,count,eventSeqs,truncated?}], confirmed, sent}`。
只记「哪类替换了多少处、出现在哪些事件」，**不含任何原文**；1MB 轮转保留 3 份；文件权限 0600 尽力而为。

## 6. 自定义 schema

见 [schemas.md](schemas.md)：根 object、`additionalProperties:false`、字段带 `description`（会进入提示词）；不支持 `$ref`；示例见 `examples/custom-schema.json`。

## 7. 安全模型摘要

1. **脱敏先于 LLM**：剧本在离开本地前已完成脱敏（默认 strict）。
2. **确定性占位符**：同一 secret 同一 `[REDACTED:TYPE:hash8]`，映射只存内存。
3. **输出物二次脱敏**：LLM 复述的 secret 也会在渲染后被替换。
4. **注入防护分层**：trace→LLM 的 prompt injection（DATA 包裹 + 显式指令）与 LLM→HTML 的注入（渲染器全量转义）是两层独立防线。
5. **本地为默认**：不开 `--upload` / 不配置 upload 端点绝不联网。

## 8. 已知限制

- IPv4/IPv6 检测器存在文档化的误报倾向（宁可多脱）；IPv6 只识别全形地址（≥3 冒号）。
- `$ref` 不支持（v1）；`format` 关键字不生效（未启用 ajv-formats）。
- 长会话按预算阶梯截断（单条上限 → 收紧工具输出 → 丢弃 todo → 头-中-尾），报告标注截断。
