# @opencode-ai/opencode — AcuFlow CLI

AcuFlow 的命令行与终端交互（TUI）入口包。它基于 opencode 构建，内置 AcuFlow 的急腹症诊疗流程 agent、工具与技能；包名沿用上游 `@opencode-ai/opencode`。

> AcuFlow 是基于 opencode 的医疗分支，用于成人非创伤性急腹症的固定流程临床决策辅助。完整介绍、安装与使用教程见仓库根目录的 [`README.md`](../../README.md)。

## 运行

```bash
# 在仓库根目录（等价于本包内的 `bun run src/index.ts`）
bun run dev

# 或在本包目录内
bun run src/index.ts

# 查看版本
bun run src/index.ts --version
```

## 开发

| 目的 | 命令 |
|---|---|
| 构建独立可执行文件 | `bun run build --single`（产物在 `dist/`） |
| 类型检查 | `bun typecheck`（使用 `tsgo`，不要用 `tsc`） |
| 测试 | `bun test`（请在本包目录内运行，勿在仓库根目录运行） |

配置驱动的诊疗流程（节点、提示词、知识库）见根目录 `README.md` 的「给医学开发人员」一节。
