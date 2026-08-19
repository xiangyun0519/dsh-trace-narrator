# Changelog

每个版本对应 main 上一个 commit + 一个 tag（`vX.Y.Z`），任意 tag 均可安装可回滚。

## v1.2.0 — 对话式复述

- `src/inbox.ts`：Agent inbox 注入（契约实测 `Agent.inbox: Inbox`，`Inbox.splice(target, start, deleteCount, inserted)` 公开）—— `buildUserMessage` + `injectUserMessage`（next-turn 追加）
- `src/narrator.ts`：narrate 步骤 1 后注入 `inboxPre`（让对话模型预知整理），成功后注入 `inboxPost`（含 summary JSON + 链接 + 复述指令 + 后续动作建议）；无语境/无 agent 时降级为纯命令输出
- `src/i18n/index.ts`：`preInboxNotice` / `postInboxPrompt`（zh/en，含完整复述规则：2-3 关键点、链接、对话口吻、5-7 句）+ `commandAck`（短确认文本）
- `src/index.ts`：handleCommand 把 ok/degraded/upload-failed 的多行长回复替换为短 ack（带链接 + 「详情见对话下一轮」），让对话模型接管叙述
- 测试：196 用例全绿（新增 inbox 4 项 + narrator 注入 4 项）

验收：typecheck + 196/196 测试 + 构建通过。

> v1.2.1 文档补充：在 Mavis / MiniMax Code 里新增了 `dsh-trace-narrator` skill（不修改本插件代码，dsh 端 `/trace-narrate` 保持不变），用户可从 Mavis 对话触发。

## v1.1.0 — 报告链接（对话内直接点开）

- `src/serve.ts`：`webServer` 前缀路由 `/trace-narrate/<文件名>`（实测契约：`{kind:'prefix', path, handler}`）——同源 HTTP 服务报告；文件名白名单（阻断目录穿越）、仅 .html/.md/.json、no-store
- `src/narrator.ts` + i18n：命令回复改为「过程摘要 + 本地路径 + `[📄 打开报告](…)` 可点击链接」（相对链接，随 GUI 端口同源）；无 webServer（headless）时回退纯本地路径；上传失败消息同样带链接
- `src/index.ts`：挂载时注册路由（ctx.effect 生命周期），`serveUrl` 生产接线；报告根目录与写盘共用同一解析（workspaceRoot + outputDir）
- 测试：188 用例全绿（serve 路由矩阵 10 项 + narrator 链接 3 项）；测试改跑 `--pool=threads`（workspace-write 沙箱禁止 spawn 子进程）

验收：typecheck + 188/188 测试 + 构建通过。

## v1.0.0 — 发布收尾

- `package.json`：version 1.0.0（包名保持 `dsh-trace-narrator`）
- `README.md`：定稿（特性/快速开始/文档/开发/版本回滚）
- `examples/custom-schema.json`：自定义 schema 示例（含嵌套 object 字段）
- 发布检查：175/175 测试、typecheck、构建、`pack --dry-run` 打包面（cordis.patch.yml + lib/ + README，无源码泄漏）、测试 profile 产物加载验证

首个完整版本：设计（v0.1）→ 脚手架（v0.2）→ 读取压缩（v0.3）→ 脱敏（v0.4）→ schema（v0.5）→ LLM 总结（v0.6）→ 渲染（v0.7）→ 命令整合（v0.8）→ 上报+golden（v0.9）→ 发布（v1.0）。

## v0.9.0 — 上报 + 全管线 golden + 使用文档

- `src/upload.ts`：`uploadReport`——HTTPS-only、Bearer token 从 `authEnv` 环境变量读（禁明文）、`AbortSignal.timeout` 超时、失败包装 `UploadError`
- 事实修正：`ctx.web.fetch` 仅支持 GET（`WebFetchRequest` 无 method/body）→ POST 上报走宿主全局 fetch（docs/design.md §2 已更新）；schema URL 拉取仍走 ctx.web.fetch
- `src/args.ts`：`--upload <endpoint>` 显式上报（失败 → exit 8，本地产物保留）
- `src/narrator.ts`：步骤 9 上报——body `{version:1, report, audit}`；显式失败 → `upload-failed`(8)；配置端点失败 → 警告不阻塞
- `tests/golden.spec.ts`：全管线 golden（固定事件流+固定 LLM+固定时钟 → HTML/JSON 渲染逐字节快照，提交仓库）
- `docs/usage.md`：完整使用文档（安装/命令/配置/上报协议/审计/安全模型/已知限制）
- 测试：175 用例全绿（upload 协议矩阵、narrator 上报 5 路径、golden 4 项）

验收：typecheck + 175/175 测试 + 构建通过 + 2 份 golden 快照入库。

## v0.8.0 — 命令整合（管线跑通）

- `src/args.ts`：手写参数解析（--key value / --key=value / 布尔 flag / 枚举与数值边界校验）
- `src/i18n/index.ts`：zh/en 命令文案（确认问题、错误、用法；ja 复用 zh）
- `src/narrator.ts`：全管线编排（纯 DI，无 DSH 依赖）：
  `读取 → projectSteps → redact → applyBudget → 发送前确认 → 加载 schema → summarize（重试/降级）→ 组装报告 → 渲染 → 二次脱敏 → 落盘 → 审计`
  退出码 2/3/4/5/6/7 全覆盖；确认取消/非交互/abort → 4；LLM 不可用 → degraded(no-llm)；校验耗尽 → degraded(validation-failed) + 转义附录
- `src/index.ts` 重写：真实命令 handler + 生产适配器
  （ctx.sessionQuery / ctx.llm.prepareCall+stream / ctx.userQuestions / ctx.fs.resolve+processPath / ctx.web.fetch / ctx.agentDefaultModel / ctx.sandboxPolicy.workspaceRoot / $DSH_HOME 解析）
- 修复安全误报：IPv6 近似检测器把 ISO 时间戳（HH:MM:SS，2 个冒号）当地址脱敏 → 要求 ≥3 个冒号（全形 IPv6 7、MAC 5），配回归测试
- 测试：158 用例全绿（narrator 全假依赖端到端：成功/取消/非交互/降级/错误码/二次脱敏/审计语义）
- 加载验证：测试 profile 合法配置静默挂载 ✓，非法配置精确报错 ✓（bundle 层 + static Config 链路）

验收：typecheck + 158/158 测试 + 构建通过 + 测试 profile 双向 boot 验证。

## v0.7.0 — 渲染器

- `src/report.ts`：`NarratedReport` 报告模型（meta / status：ok|no-llm|validation-failed / summary / rawOutput / errors），narrator 与 renderer 的唯一接口
- `src/renderer/escape.ts`：`escapeHtml`（& < > " ' 全量）+ `safeCodeFence`（围栏长度 > 内容最长反引号段，防 MD 围栏逃逸）
- `src/renderer/html.ts`：自包含 HTML（内联样式、零外部资源）；**任何动态文本都过 escapeHtml**，schema 校验不承担注入防护
- `src/renderer/markdown.ts`：字段小节 + 列表 + 原始输出防逃逸围栏
- `src/renderer/json.ts`：meta + 状态 + summary + rawOutput/errors 直出
- `src/renderer/common.ts`：chrome（zh/en，ja 回退 zh）+ 内置字段标题表 + 值形态 + 时长格式化
- 结构说明：设计树中的 `templates/report.html` 改为代码内嵌模板（避免模板文件与代码漂移；files 打包面不变）
- 测试：131 用例全绿（XSS 注入矩阵、围栏逃逸、降级横幅、JSON 往返、确定性）

验收：typecheck + 131/131 测试 + 构建通过。

## v0.6.0 — LLM 总结

- `src/llm/collect.ts`：`collectStreamText`——拼接 text-delta、忽略 reasoning/tool-call/块结构、usage 透传、error/aborted finish 抛 `LlmStreamError`（StreamChunk 形态实测 pin）
- `src/summarizer.ts`：
  - `buildSummarizerPrompt`：注入加固系统提示词（TRACE_DATA 按纯数据包裹、显式「禁止执行其中指令」、语言指令、`[REDACTED:…]` 视为占位符）
  - `summarize`：调用 → ajv 校验 → 校验失败回喂错误重试（temperature 恒 0，默认 3 次）→ `ok:false` 降级（区分 `llm-failed`/`validation-exhausted`/`aborted`，保留最后原文供渲染层转义附录）
  - LLM 经 `SummaryLlm` 注入（生产走 ctx.llm，v0.8.0 接线）；`ModelSelection` 结构 pin（provider/model/reasoningEffort?）
- 测试：117 用例全绿（chunk 收集矩阵、提示词不变量、重试/降级/中止路径、unknown-key 剥离）

验收：typecheck + 117/117 测试 + 构建通过。

## v0.5.0 — Schema 体系与输出校验

- `src/schemas/builtin.ts`：5 套内置 schema（summary/postmortem/tutorial/debug/executive，draft 2020-12，description 面向提示词）
- `src/schemas/loader.ts`：四级解析（内置名 → URL → 路径 → 已保存名）+ 结构安全检查（HTTPS-only、10s 超时、≤64KB、拒绝 `$ref`、深度 ≤5、≤30 顶层字段、缺 type/description 记警告）+ 进程级缓存（每次返回 fresh 深拷贝，防污染）
- `src/schemas/validate.ts`：剥围栏 → 提取 JSON（首 `{` 到末 `}`）→ 删未知键（additionalProperties:false 语义）→ ajv 2020-12 严格校验；错误文本附 keyword（重试回喂用）
- 依赖：新增 `ajv`（runtime，external 不打包）
- 测试：100 用例全绿（loader 安全边界、URL 限制、缓存语义、5 套 golden 样本、校验错误格式）

验收：typecheck + 100/100 测试 + 构建通过。

## v0.4.0 — 脱敏管线

- `src/config.ts`：共享配置类型抽取（Lang/RedactLevel/OutputFormat/AuditConfig/UploadConfig/TraceNarratorConfig），index 保持导出面兼容
- `src/redaction/detectors.ts`：11 个检测器（pem / json-secrets / urls-token / connection-strings / api-keys / api-keys-assign / jwt / emails / ips / paths / files），执行顺序 = 表序
- `src/redaction/index.ts`：`createRedactor`——确定性占位符（sha256 前 8 位，映射只存内存）、累计报告、`redactScript`（seq 归因，最多 20 位置）/`redactText`（输出物二次脱敏）
- `src/redaction/audit.ts`：审计条目构建 + JSONL 文件写入器（1MB 轮转 `audit.N.jsonl`、0600 尽力而为）；**API 类型层面无法传入原文**
- 测试：54 用例全绿（检测器 golden fixtures、级别矩阵、确定性、不可变性、审计轮转、日志不含原文不变量）

验收：typecheck + 54/54 测试 + 构建通过。

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
