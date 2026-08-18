# Changelog

每个版本对应 main 上一个 commit + 一个 tag（`vX.Y.Z`），任意 tag 均可安装可回滚。

## v0.3.0 — 事件读取 + 投影压缩

- `src/script.ts`：剧本格式（Script/ScriptStep/ScriptMeta）、固定密度 token 估算（chars/4，与 `@deepseek-ai/dsh-token-meter` 启发式一致）、zh/en chrome
- `src/reader.ts`：`loadSessionLog`（可注入源，DI）+ `SessionReadError`（映射命令退出码 3）
- `src/compressor.ts`：`projectSteps`（投影表，不做文本截断）+ `applyBudget`（4 级截断阶梯：单条上限 → tool-result 收紧 → 丢 note → 头-中-尾 → 硬截 500）+ `buildScript` 串联
- **顺序约束**：文本截断必须在脱敏之后——v0.8.0 管线按 `projectSteps → redact → applyBudget` 编排（docs/redaction.md §3）
- 类型 pin（dsh-session / dsh-llm 0.1.0-rc.x 实测）：UserMessage / AssistantMessage / ToolResultMessage / ContentBlock / TurnEndReason / TodoItem
- 测试：22 用例（投影映射、截断阶梯、确定性、错误包装），全绿

验收：typecheck + 22/22 测试 + 构建通过；包仍可安装（bundle 结构未变）。

## v0.2.0 — 脚手架

- `package.json`：`dsh.bundle.patch` 声明、`@deepseek-ai/*` 走 peerDependencies（共享 profile 单一 cordis 实例）、schemastery 为运行时依赖
- `cordis.patch.yml`：插件行 `trace-narrator` + 部署级默认配置（lang/redact/format/预算/audit/upload）
- `src/index.ts`：`TraceNarratorService`（Service 形态，`static inject` + `static Config`）
  - 注册 settings 命名空间 `trace-narrator`（schemastery schema，base = 行配置）
  - 注册 `/trace-narrate` 命令（no-op，回显当前已解析配置）
- `tsconfig.json` / `tsup.config.ts` / `.gitignore`

验收：可安装（`dsh plugin --profile … add`）、可加载（`--dump-config` 可见行与配置）、命令可发现。

## v0.1.0 — 设计定稿

- `docs/design.md`：架构、实测运行时契约、管线、安全模型、版本计划
- `docs/redaction.md`：4 级强度、10 检测器、确定性占位符、审计日志
- `docs/schemas.md`：5 套内置 schema、自定义加载限制、校验与重试
- `README.md`：文档指针
