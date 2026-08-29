# dsh-whale-writing

「老人与大肥鱼 · 超级写作增强」—— DeepSeek Harness (DSH) 插件：写作档位（T1–T4 风格 × L1–L5 严谨）、项目记忆（`.mem` 三区 + 硬守卫）、去 AI 味后处理（`whale_polish`）。双半体（Host 工具/提示词注入 + 浏览器快捷条/工具卡）。

## 功能

| 模块 | 说明 |
|---|---|
| 写作风格 | T1 鲸定谔 / T2 海明鲸 / T3 奥格鲸 / T4 鲸尔德 + 自动挡；Host `systemPrompt.section` 每步注入档位提示词 + 一份同源风格样例（隔离协议：按 (档位, 输出语言) 解析单一键，一次只注入一份） |
| 严谨性 | L1 史官 / L2 辩护律师 / L3 科普作家 / L4 说书人 / L5 小说家 + 自动挡；与风格正交叠加（严谨在前、风格在后） |
| 项目记忆 | 会话 cwd 下 `.mem/config.md`（人工锁定区只读 + 术语表/上下文资产自动追加）；`tools/pre-execute` 硬守卫保护人工区与 frontmatter；>30 条自动拆 glossary.md；预算化注入（≤800 token 估算封顶） |
| 后处理 | 动态工具 `whale_polish`：成稿去 AI 味微调（与档位联动 12 条证据版规则 + P0 语言守恒 / P1 单位数守恒）；快捷条开关；工具调用卡展示改动清单；≥50 单位（汉字+英文词）才执行 |

快捷条（输入框上方）：风格 / 严谨 / 记忆 / 后处理 / 收起；中英双语跟随 Harness 语言。
（无 ✍ 润色徽标——全自动后处理不打扰，改动清单自查见 `whale_polish` 工具卡。）
**无设置页**：插件开关用 Harness 自身的插件管理（Plugins），快捷条即全部设置入口。

## 安装

```sh
# 方式一（推荐）：GitHub 源码安装。无需构建——dist/ 与 lib/ 已提交，
# 且无 prepare 脚本，安装时不会触发 pnpm 的构建脚本拦截。
dsh plugin --profile web add github:<user>/dsh-whale-writing

# 方式二：npm（发布后）
dsh plugin --profile web add dsh-whale-writing

# 方式三：本地源码（开发调试）
dsh plugin --profile web add file:/绝对/路径/dsh-whale-writing
```

安装后**重启 DSH**（`dsh web`）。启动后：

- 会话输入框上方出现 🐳 快捷条；
- 模型工具列表出现 `whale_set_profile` / `whale_polish`；
- 会话流中 `whale_polish` 的调用卡为改动清单视图。

> 维护者注意：本仓库的 content 是从「超级写作」主工作区同步生成的（`node .dev/whale/sync-github-repo.mjs`，脚本在工作区，不在本仓库）。改逻辑请改主工作区的 `.dev/whale/host.js` 后重跑生成链；详见 [MAINTAIN.md](./MAINTAIN.md)。

## 依赖与安装安全

本插件**不声明任何 `@deepseek-ai/*` 运行期依赖**（含 peerDependencies）：`@deepseek-ai/cordis`、
`@deepseek-ai/dsh-tools` 等核心包由 DSH 安装自身提供**单一物理副本**
（`$DSH_HOME/profiles/node_modules` 安装闭包回退），插件运行时从 profile 的普通 parent-walk
解析到它——这是 DSH 防「核心包分叉」的既定机制。

- **请只用 `dsh plugin add` 安装**；不要在 profile 里手动 `pnpm add @deepseek-ai/dsh-tools` / `@deepseek-ai/cordis`。
  pnpm（尤其 `autoInstallPeers` 为默认 true 的旧 profile）会在 profile 顶层平铺出**第二份物理副本**，
  而 `TOOL_RUNTIME_SCHEDULER` 是 dsh-tools 的 module 级唯一 `Symbol`——副本一多，插件注册工具用的符号
  与执行器取符号的副本就分叉，表现为：**任何会话任何工具调用**报
  `Cannot read properties of undefined (reading 'prepare')`（上游 #1337 / #1633），
  且残留孤儿 tool_calls 会把会话毒化成持续 `400 INVALID_REQUEST`。
- 已发生同款故障的恢复步骤：① 从 profile `package.json` 的 `dependencies` 移除 `@deepseek-ai/*` 核心包；
  ② 删除 `profiles/web/node_modules/@deepseek-ai` 下对应实体（dsh-tools、cordis 等）；
  ③ `pnpm dedupe`（或直接重装）；④ 已毒化无法恢复的会话导出后重建。
  `pnpm-workspace.yaml` 保持 `nodeLinker: hoisted` + `autoInstallPeers: false`（initProfile 默认写入）。
- 上游防线：`npm pack` / `npm publish` 前的 `prepack` 守卫（`scripts/guard-publish.mjs`）自动拦断——
  运行期依赖（dependencies/peerDependencies/optionalBundled）出现任何 `@deepseek-ai/*`、
  或发布物里出现 dsh-tools 调度器字面量（捆绑副本），发布即失败。

## 结构

```
src/index.ts      host 半侧 TS（tsc → dist/index.js；由主工作区 .dev/whale/host.js 迁移生成，
                  scripts/generate-host.mjs 可重新生成——改逻辑请改源文件，勿在此手改）
lib/client.js     browser 半侧（lazy-CJS：window.__ModuleLoader__.load({id, factory})）
dist/             tsc 构建产物（随仓库提交：GitHub/源码安装零构建）
cordis.patch.yml  bundle patch：配置树插入插件行（id: whale-writing, name: dsh-whale-writing）
scripts/guard-publish.mjs  发布守卫（prepack）：防核心包重复副本（见上）
```

- Host↔Client 通信：`POST /whale-writing/<method>`（`profile/get`、`profile/set`、`mem/status`、`mem/toggleGuard`），JSON 入出。
- `dsh.client.inject`：`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-conversation`（槽声明）。

## 兼容

- 开发基线：DSH `0.1.1-rc.2`（`@deepseek-ai/dsh-tools` `next` 线 `^0.1.1-rc.2`、`@deepseek-ai/cordis` `^4.0.1`、React `^18.2.0`；核心包仅为构建/devDependencies 基线，**运行期由 DSH 安装闭包提供，不随包安装**）。
- 最低要求：DSH `0.1.1-rc.2`（依赖其 profile 安装闭包回退机制；更早版本无单副本保证）。
- Node：`^22.19.0 || >=24.0.0`（DSH 要求）。

## LICENSE

MIT
