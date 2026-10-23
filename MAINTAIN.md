# 维护说明（MAINTAIN.md）

本仓库是从「老人与大肥鱼 · 超级写作」主工作区同步生成的**发布镜像**。

> **已上线**：https://github.com/Azonda/dsh-whale-writing（main + tag `v0.1.0`；`v0.1.1` = DSH 0.2.x 兼容修复）。
> 每次同步后推送：`git push origin main`；版本更新时打新 tag（`v0.1.1` …）。

## 内容来源

| 本仓库文件 | 主工作区源 | 生成方式 |
|---|---|---|
| `src/index.ts` | `.dev/whale/host.js` | `scripts/generate-host.mjs`（host.js → TS 逻辑等价迁移；`harness.defineTool` → 生成的本地 `defineToolWw`） |
| `dist/` | `src/index.ts` | `npm run build`（tsc） |
| `lib/client.js` | `.dev/whale/client.js` | 手写移植（M6 固化，lazy-CJS） |
| `cordis.patch.yml` / `package.json` / `README.md` / `LICENSE` | 同主工作区 | 直接拷贝 |

**改逻辑的正确路径**：改主工作区 `.dev/whale/host.js` → 重跑 `scripts/generate-host.mjs` →
`npm run build` → `node .dev/whale/sync-github-repo.mjs`。**不要**直接改本仓库的 `src/index.ts`。

**生成器的运行期零核心包规则**：`src/index.ts` 只在类型位置引用 `@deepseek-ai/cordis`（构建时擦除），
不得再 `import` 任何 `@deepseek-ai/*` 运行期模块——0.2.x 的运行时解析器与本机旧版全局安装
（`$DSH_HOME/profiles/node_modules` 的 0.1.x 回退目录）会给出不同副本，链接期报
`does not provide an export named 'CallId'`（0.1.1 ↔ 0.2.1 实测）。工具定义用生成器自带的 `defineToolWw`。

## 同步命令

在主工作区根目录执行：

```powershell
node .dev/whale/sync-github-repo.mjs       # 把 dsh-whale-writing/ 同步到 dsh-whale-writing-gh/
cd dsh-whale-writing-gh
git add -A
git commit -m "sync: ..."
git push origin main
git tag -a v0.1.1 -m "dsh-whale-writing v0.1.1"
git push origin v0.1.1
```

同步脚本只做**文件级拷贝**（排除 node_modules / .git / dist 之外的中间物按需要取舍），
不做 git 操作——git 动作留给你把握（提交粒度、tag、push 时机）。

## 发布检查单（每次同步前）

1. `node .dev/whale/verify-core-copy.cjs` —— 单一物理副本（#1337/#1633）回归。
2. `.dev/whale` **10 套**测试全绿：host / m2 / m3 / client / m6-client / host-integration / m3-integration / m4 / m4-integration / dist-sandbox（发布产物 + 0.2.x 沙箱写盘回归）。
3. `npm pack --dry-run`（触发 `prepack` 守卫）——无 `@deepseek-ai/*` 运行期依赖、发布物无核心包导入、无调度器字面量。
4. `git status` 干净后再同步。

## 上游事件备注

- `TOOL_RUNTIME_SCHEDULER` = dsh-tools 的 module 级唯一 Symbol（0.1.x 本机实测
  `dsh-tools\lib\index.js:2416`，`registry[TOOL_RUNTIME_SCHEDULER]` :1220）。
  核心包第二份物理副本 → 符号分叉 → 所有工具调用崩溃（#1337 / #1633）。
  因此本插件 **`@deepseek-ai/*` 只允许出现在 devDependencies**，且运行期**一条核心包 import 都不要有**。
- **v0.1.1 新增第二类事故（DSH 0.2.x）**：0.2.x 把核心包改由运行时解析器供给，本机同时存在
  0.1.1 全局安装时，`import { defineTool } from '@deepseek-ai/dsh-tools'` 解析到旧副本，
  其内部 `import { CallId } from '@deepseek-ai/dsh-llm'` 又解析到 0.2.x 的新副本（已改名 `ToolCallId`），
  链接期报 `does not provide an export named 'CallId'` → 整个 host 半体不激活。
  修复方式：生成器自带本地 `defineToolWw`，运行期零核心包导入；守卫同步升级为拦断发布物里的任何核心包导入。
- **v0.1.2 新增第三类事故（DSH 0.2.x 文件沙箱）**：0.2.x 的 `ctx.fs` 是 `SandboxedFileSystem`，
  `writeText` 不带 per-call `sandboxPolicy` 时按部署默认（`workspace-write` + 进程 cwd）判越界，
  会话工作区里的 `.mem/config.md` 直接被拒写 → 快捷条/`whale_set_profile` 切档位全部失效。
  修复方式：所有写盘按调用会话 `sandboxPolicy.resolve({ session })` 传第五参（与 `dsh-tool-fs` 同口径）；
  0.2.x 的插件写盘**必须**带上策略，读到不等于写到。
- 安装/依赖安全详见 `README.md`「依赖与安装安全」一节。
