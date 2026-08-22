# dsh-trace-narrator

[![npm version](https://img.shields.io/npm/v/dsh-trace-narrator?color=blue)](https://www.npmjs.com/package/dsh-trace-narrator)
[![CI](https://github.com/xiangyun0519/dsh-trace-narrator/actions/workflows/ci.yml/badge.svg)](https://github.com/xiangyun0519/dsh-trace-narrator/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-trace-narrator?color=green)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![DSH](https://img.shields.io/badge/DSH-cordis%20v4-purple)](https://github.com/deepseek-ai/deepseek-harness)

> 面向 DeepSeek Harness（DSH）开发者：把一次会话 trajectory 变成脱敏的 HTML、Markdown 或 JSON 复盘报告。

如果你需要回答“这次会话做了什么、哪里失败、哪些步骤值得交接或教学”，这个插件给出一条命令和一份可读报告。先看一个完全虚构、已脱敏的输出：[示例报告](examples/demo-report.md)。

## 30 秒开始

前置条件：Node.js ≥ 20、DSH cordis v4，以及 `@deepseek-ai/dsh-commands` / `@deepseek-ai/dsh-settings` ≥ 0.1.0-rc.6。

### 从源码安装

当前仓库可以直接验证，不依赖 npm 发布状态：

```bash
git clone https://github.com/xiangyun0519/dsh-trace-narrator.git
cd dsh-trace-narrator
pnpm install
pnpm build
dsh plugin --profile web add link:/absolute/path/to/dsh-trace-narrator
```

Windows 请把最后一行替换为实际绝对路径，例如 `link:F:/deepseek/dsh-trace-narrator/dsh-trace-narrator`。安装后重启 dsh。

### 从 npm 安装

npm 包发布后使用：

```bash
dsh plugin --profile web add dsh-trace-narrator
```

如果返回 `package not found`，说明当前版本还没有发布到 npm；请先使用上面的源码安装方式。发布和验收步骤见 [docs/release.md](docs/release.md)。

## 第一次使用

在任意 DSH 会话中运行：

```text
/trace-narrate
```

默认行为：当前会话 → `summary` schema → strict 脱敏 → 自包含 HTML → 对话内报告链接。

常用变体：

```text
/trace-narrate sess_abc --schema postmortem --lang en --format md
/trace-narrate --schema ./my-schema.json --redact minimal
/trace-narrate --format json --output ./trace-narrate
```

## 能解决什么

- 复盘一次 DSH 会话：目标、关键步骤、决策和结果
- 生成适合交接或教学的 `summary`、`postmortem`、`tutorial`、`debug`、`executive` 报告
- 将长 trajectory 压缩后再交给 LLM，总结输出通过 schema 校验
- 默认 strict 脱敏，支持 HTML、Markdown、JSON 三种输出
- 让对话模型在下一轮自然复述总结，并给出后续动作建议
- 可选地把已脱敏报告上报到自托管 viewer；不开启时不联网

## 安全边界

- trajectory 在发送给 LLM 前先脱敏；LLM 输出在写盘、inbox 和上传前再次脱敏
- HTML 动态内容全量转义；报告使用自包含资源，不依赖第三方脚本
- 上传是 opt-in，且只接受 HTTPS；Bearer token 只从环境变量读取
- 审计日志只记录检测器、计数和事件序号，不记录原文

## 不负责什么

这是 DSH 插件，不是公共在线报告站点。当前版本不负责实时采集、多会话合并、云端 viewer、公共知识库或 dsh 会话存储。报告默认落在本地；需要多人访问时，请自行提供受控的 viewer 和上传端点。

## 文档与示例

| 文档 | 内容 |
|---|---|
| [示例报告](examples/demo-report.md) | 不安装 DSH 也能看到的输出样例 |
| [使用文档](docs/usage.md) | 安装、命令、配置、退出码、审计与安全模型 |
| [发布指南](docs/release.md) | 打包、npm 发布、GitHub Release 和发布后检查 |
| [设计文档](docs/design.md) | 架构、运行时契约、数据流和版本计划 |
| [脱敏规则](docs/redaction.md) | 级别、检测器、占位符和审计日志 |
| [Schema 说明](docs/schemas.md) | 内置 schema、自定义加载、校验与重试 |
| [自定义 schema](examples/custom-schema.json) | 可直接复制的 JSON Schema 示例 |
| [变更记录](CHANGELOG.md) | 版本历史 |

## 本地开发

```bash
pnpm install
pnpm test        # Vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup → lib/
pnpm pack --dry-run
```

发布前请按 [docs/release.md](docs/release.md) 完成测试、打包和安装验证。CI 会在 push 和 pull request 上重复这些检查。

## 反馈

请在 [GitHub Issues](https://github.com/xiangyun0519/dsh-trace-narrator/issues) 中提供：DSH 版本、插件版本、命令、错误信息和可复现步骤。不要提交原始 trajectory、token、API key 或包含个人信息的报告。

## License

[MIT](./LICENSE)
