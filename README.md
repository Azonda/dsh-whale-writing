# dsh-whale-writing

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![老人与大肥鱼 · 超级写作增强](assets/banner.jpg)

**给 DeepSeek Harness 加一个写作控制台。** 输入框上方一条快捷条，管四件事：怎么写、写多严谨、记住什么、最后润一遍。

- 🎚️ **风格 T1–T4**：鲸定谔 / 海明鲸 / 奥格鲸 / 鲸尔德。每档一套句法、节奏和护栏；固定档再附一份同源样例（中英各一套）。
- ⚖️ **严谨 L1–L5**：史官 / 辩护律师 / 科普作家 / 说书人 / 小说家。事实闸门独立于文风，两档正交组合。
- 🧠 **项目记忆**：术语、禁用写法、素材路径自动攒进 `.mem/config.md`，人工区只读。
- ✍️ **去 AI 味润色**：成稿最后过一遍 `whale_polish`，只改表达、不改事实，工具卡列出改动。
- 🐳 **一个总开关**：点最左边的鲸鱼，整条收起、插件休眠；再点恢复。

## 安装

```sh
dsh plugin --profile web add github:Azonda/dsh-whale-writing
```

重启 DSH（`dsh web`），输入框上方出现 🐳 快捷条。`dist/` 与 `lib/` 已提交，安装时不需要构建。

<details>
<summary>本地源码安装</summary>

```sh
dsh plugin --profile web add file:/绝对/路径/dsh-whale-writing
```

</details>

## 快捷条

| 控件 | 作用 |
|---|---|
| 🐳 | 总开关。关掉后整条只留它，档位、记忆、润色全部停用；再点一次恢复 |
| 风格 | T1–T4 或自动。自动挡由模型看任务自己挑 |
| 严谨 | L1–L5 或自动 |
| 记忆 | 开 / 关项目记忆。关掉后不注入、不建档，守卫也放行 |
| 后处理 | 开 / 关润色。关掉后模型不会主动调 `whale_polish` |
| ▸ | 收起整条。收起后剩一枚鲸鱼胶囊，点它展开 |

没有设置页。快捷条就是全部设置入口。

## 档位速查

风格管「怎么说」，严谨管「说到什么程度算数」。两档正交，可自由组合；注入时严谨在前、风格在后。

**风格**

| 档位 | 定位 | 一句话 |
|---|---|---|
| T1 鲸定谔 | 严肃工程写作 | 术语精确，先定义后展开，删掉一切装饰 |
| T2 海明鲸 | 简明扼要 | 短句，一段一个意思，不堆副词 |
| T3 奥格鲸 | 广告营销 | 标题即利益点，用第二人称，结尾给行动 |
| T4 鲸尔德 | 辞藻华丽考究 | 允许警句与通感，但每处修辞都要服务意思 |
| 自动 | — | 模型判断任务类型后直接写档 |

**严谨**

| 档位 | 定位 | 一句话 |
|---|---|---|
| L1 史官 | 绝对严肃公正 | 每个论断都有出处，没有就不写 |
| L2 辩护律师 | 论文 / 论证 | 结论先行，优势排开，局限框定 |
| L3 科普作家 | 通俗准确 | 允许类比和简化，关键数字不能错 |
| L4 说书人 | 文案场景 | 选择性真实，可修辞夸张，不编可证伪的数字 |
| L5 小说家 | 虚构创作 | 不限事实，只要求内部自洽 |
| 自动 | — | 模型判断后直接写档 |

## 项目记忆

会话目录下的 `.mem/config.md`，三个区：

- **人工锁定区**：你写的纪要，模型只读，有硬守卫挡改写
- **术语表**：统一写法、禁用写法、来源、置信度；超 30 条自动拆到 `.mem/glossary.md`
- **上下文资产**：文件路径和一句话描述

模型每轮收尾自动追加，不用确认。注入按预算（约 800 token 封顶），不会吃光上下文。

## 兼容

- 实机验证 DSH 0.2.1-rc.2（Desktop），同时兼容 0.1.1-rc.2；Node `^22.19.0 || >=24.0.0`
- 0.2.x 的接口差异（提示词插值、文件沙箱写盘、事件名）都已对齐，细节见更新日志

## 依赖安全

运行期不 import 任何 `@deepseek-ai/*` 包，`@deepseek-ai/cordis` 只做类型导入（构建时擦除）。所以不会触发「核心包第二份副本」那类事故：`TOOL_RUNTIME_SCHEDULER` 符号分叉，所有工具调用一起报错（上游 #1337 / #1633）。

安装只用 `dsh plugin add`，不要在 profile 里手动 `pnpm add @deepseek-ai/*`。事故现象、恢复步骤和发布守卫见 [MAINTAIN.md](./MAINTAIN.md)。

<details>
<summary>仓库结构（开发者）</summary>

| 路径 | 内容 |
|---|---|
| `src/index.ts` | Host 半侧：档位注入、项目记忆、两个工具、RPC |
| `dist/index.js` | 构建产物，随仓库提交，安装时零构建 |
| `lib/client.js` | 浏览器半侧：快捷条 + 润色工具卡 |
| `cordis.patch.yml` | 插件挂载点 |
| `scripts/guard-publish.mjs` | 发布守卫 |
| `MAINTAIN.md` | 同步与发布流程 |

Host↔Client 走 `POST /whale-writing/<method>`（`profile/get`、`profile/set`、`mem/status`、`mem/toggleGuard`），JSON 入出。`dsh.client.inject` 为 `@deepseek-ai/dsh-client-locale` 与 `@deepseek-ai/dsh-client-ui-conversation`。

</details>

<details>
<summary>维护者：本仓库是同步镜像</summary>

内容从「超级写作」主工作区同步（`node .dev/whale/sync-github-repo.mjs`，脚本在主工作区）。改逻辑请改主工作区的 `.dev/whale/host.js`，再跑生成链；流程见 [MAINTAIN.md](./MAINTAIN.md)。

本仓库 Topics：`dsh-plugin` / `deepseek-harness` / `writing` / `creative-writing` / `ai` / `deepseek`；条目通过 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 的收录列表维护（`data/plugins/Azonda__dsh-whale-writing.yml`），合并后可在市场检索。

</details>

## 更新日志

### v0.1.2 — 0.2.x 切档位修复 + 快捷条总开关

- 现象：DSH `0.2.x` 上快捷条点档位只闪一下又弹回；`whale_set_profile` 报
  `cannot write "…/.mem/config.md": file access denied under workspace-write mode`。
- 根因：`0.2.x` 的 `ctx.fs` 是 `SandboxedFileSystem`，`writeText(target, content, expected, signal, sandboxPolicy)`
  的第 5 参是 per-call 策略。插件不传时它回落 `sandboxPolicy.resolve()`（无会话）——用**部署默认**
  `workspace-write` + 进程 cwd 当工作区根，会话工作区里的 `.mem/**` 因此被判越界而拒写
  （`0.1.x` 的裸后端忽略该参数，所以旧版不受影响）。
- 修复：四处写盘（frontmatter 持久化、旧版记忆迁移、记忆回写、术语表拆分）统一走 `writeTextFor()`，
  按调用会话 `sandboxPolicy.resolve({ session })` 取策略——与 `dsh-tool-fs` 写盘同口径；
  `0.1.x` 没有该服务时退回旧行为。
- 新增总开关：快捷条最左侧的 🐳 图标改成开关。关闭后整条快捷条只剩这只鲸鱼（灰色虚线态），
  风格/严谨/记忆/后处理连同收起按钮全部不渲染；同时档位与记忆注入、后处理流程指令、记忆守卫一并停用，
  `whale_polish` 回原稿、`whale_set_profile` 拒写档（返回 `disabled: true`）。再点一次恢复。
- 开关状态写进 `.mem/config.md` 的 `plugin_enabled`（缺省 `true`：旧文件没有这个键也算开），
  重启/新会话仍保持；关闭态下快捷条仍能经 `profile/set` 重新打开（只读策略会话除外）。
- 回归：`host-integration-test` 的 fs 后端改为按 `0.2.x` 沙箱语义把关（不带策略即拒写）；
  新增 `dist-sandbox-test.mjs` 直接校验**发布产物**：`POST /whale-writing/profile/set` 与
  `whale_set_profile` 都能写盘，缺策略时确实按沙箱拒写；`host-test` / `m2-test` / `m4-test` /
  `m6-client-test` 补了总开关的解析、零注入与快捷条渲染回归（10 套测试全绿）。

### v0.1.1 — 兼容 DSH 0.2.x

- 修复 0.2.x 上 host 半体导入失败：
  `SyntaxError: The requested module '@deepseek-ai/dsh-llm' does not provide an export named 'CallId'`。
  根因是运行期 `import { defineTool } from '@deepseek-ai/dsh-tools'` 在同机存在旧版全局安装时解析到旧副本；
  现改为生成器自带的本地 `defineToolWw`（同一 schema DSL 子集、同构产物），`dist/index.js` 运行期零核心包导入。
- `agent/session-start` → 同时监听 0.2.x 的 `agent/created`（0.2.x 已移除前者），会话预热不再失效。
- `finish.reason.kind` 兼容 `stop`（0.2.x）/`done`（0.1.x）；`tool-calls` 按 fail-closed 处理。
- 四个提示词 section/context 显式 `interpolate: false`，防止 `.mem` 用户内容里的 `{{…}}` 触发组装期报错。
- `dsh.client.inject` 去掉已不存在的 `@deepseek-ai/dsh-client-runtime`。
- 发布守卫升级：发布物里出现任何 `@deepseek-ai/*` 模块导入即拦断（不再只拦非裸说明符）。
- 补充 `repository` / `homepage` / `bugs` 元数据。

## LICENSE

MIT
