# dsh-trace-narrator
DeepSeek Harness 插件：把 dsh 最被称赞的 trajectory 特性从本地私有日志变成可分享、可复盘、可教学的结构化报告。  内置 5 套 schema（summary / postmortem / tutorial / debug / executive），支持中英日三语，严格脱敏默认开启，数据不出本地。

## 文档

- [设计文档](docs/design.md)：架构、运行时契约（已实测）、安全模型、版本计划
- [脱敏规则](docs/redaction.md)：强度级别、检测器、占位符、审计日志
- [Schema 说明](docs/schemas.md)：5 套内置 schema、自定义加载、校验与重试

## 状态

设计定稿（v0.1.0）；脚手架完成（v0.2.0，可安装、命令已注册）。实现按里程碑推进：`docs/design.md` §13。

```bash
# 本地开发：安装进任意 profile（link，随源码变化）
dsh plugin --profile <profile> add ../dsh-trace-narrator

# 命令
/trace-narrate [sessionId] [--schema …] [--redact …] [--format html|md|json] [--yes]
```
