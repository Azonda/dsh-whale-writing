# 维护说明（MAINTAIN.md）

本仓库是从「老人与大肥鱼 · 超级写作」主工作区同步生成的**发布镜像**。

## 内容来源

| 本仓库文件 | 主工作区源 | 生成方式 |
|---|---|---|
| `src/index.ts` | `.dev/whale/host.js` | `scripts/generate-host.mjs`（host.js → TS 逻辑等价迁移） |
| `dist/` | `src/index.ts` | `npm run build`（tsc） |
| `lib/client.js` | `.dev/whale/client.js` | 手写移植（M6 固化，lazy-CJS） |
| `cordis.patch.yml` / `package.json` / `README.md` / `LICENSE` | 同主工作区 | 直接拷贝 |

**改逻辑的正确路径**：改主工作区 `.dev/whale/host.js` → 重跑 `scripts/generate-host.mjs` →
`npm run build` → `node .dev/whale/sync-github-repo.mjs`。**不要**直接改本仓库的 `src/index.ts`。

## 同步命令

在主工作区根目录执行：

```powershell
node .dev/whale/sync-github-repo.mjs       # 把 dsh-whale-writing/ 同步到 dsh-whale-writing-gh/
cd dsh-whale-writing-gh
git add -A
git commit -m "sync: ..."
git push origin main
git tag -a v0.1.0 -m "dsh-whale-writing v0.1.0"
git push origin v0.1.0
```

同步脚本只做**文件级拷贝**（排除 node_modules / .git / dist 之外的中间物按需要取舍），
不做 git 操作——git 动作留给你把握（提交粒度、tag、push 时机）。

## 发布检查单（每次同步前）

1. `node .dev/whale/verify-core-copy.cjs` —— 单一物理副本（#1337/#1633）回归。
2. `.dev/whale` 9 套测试全绿：host / m2 / m3 / client / m6-client / host-integration / m3-integration / m4 / m4-integration。
3. `npm pack --dry-run`（触发 `prepack` 守卫）——无 `@deepseek-ai/*` 运行期依赖、无调度器字面量。
4. `git status` 干净后再同步。

## 上游事件备注

- `TOOL_RUNTIME_SCHEDULER` = dsh-tools 的 module 级唯一 Symbol（本机实测
  `dsh-tools\lib\index.js:2416`，`registry[TOOL_RUNTIME_SCHEDULER]` :1220）。
  核心包第二份物理副本 → 符号分叉 → 所有工具调用崩溃（#1337 / #1633）。
  因此本插件 **`@deepseek-ai/*` 只允许出现在 devDependencies**（构建/类型检查），
  运行期由 DSH 安装闭包提供单一副本；`scripts/guard-publish.mjs`（prepack）自动拦断违规。
- 安装/依赖安全详见 `README.md`「依赖与安装安全」一节。
