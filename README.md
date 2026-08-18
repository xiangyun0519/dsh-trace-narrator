# dsh-trace-narrator

DeepSeek Harness 插件：把 dsh 最被称赞的 trajectory 特性从本地私有日志变成可分享、可复盘、可教学的结构化报告。

## 特性

- **`/trace-narrate` 命令**：当前会话或任意历史会话 → 结构化报告；**回复里直接给可点击链接**（`/trace-narrate/<文件>` 同源路由），点开即看，不用翻文件夹
- **内置 5 套 schema**（summary / postmortem / tutorial / debug / executive）+ 自定义（本地路径 / URL / 已保存名）
- **默认 strict 脱敏**：11 个检测器、确定性占位符、审计日志（只记类别与计数，不含原文）
- **三种输出**：自包含 HTML（零外部资源）/ Markdown / JSON（便于二次处理）
- **发送前确认** + **两层注入防护**（trace→LLM 的 prompt injection、LLM→HTML 的全量转义）+ LLM 输出 ajv 校验与重试
- **opt-in `--upload`**：自托管 viewer 协议（HTTPS-only、token 走环境变量），不开就绝不联网

## 快速开始

```bash
# 安装（profile 名换成你自己的）
dsh plugin --profile <profile> add dsh-trace-narrator

# 在任意会话里：
/trace-narrate                                            # 当前会话、summary、HTML、strict
/trace-narrate sess_abc --schema postmortem --lang en --format md
/trace-narrate --schema ./my-schema.json --redact minimal
/trace-narrate --upload https://viewer.myteam.com
```

## 文档

- [使用文档](docs/usage.md)：安装、命令、配置、上报协议、审计、安全模型、已知限制
- [设计文档](docs/design.md)：架构、运行时契约（实测）、管线、版本计划
- [脱敏规则](docs/redaction.md)：强度级别、检测器、占位符、审计日志
- [Schema 说明](docs/schemas.md)：5 套内置、自定义加载、校验与重试
- [自定义 schema 示例](examples/custom-schema.json)

## 开发

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest（175 用例 + golden 快照）
pnpm run build       # tsup → lib/
```

## 版本与回滚

每个版本对应 main 上一个 commit + 一个 tag（`vX.Y.Z`），任意 tag 均可安装可回滚：

```bash
git checkout v0.8.0   # 回到任意历史版本
```

## 状态

**v1.1.0**：v1.0 全部里程碑 + 报告链接（对话内直接点开）。版本历史见 CHANGELOG。
