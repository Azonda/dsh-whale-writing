#!/usr/bin/env node
// guard-publish.mjs —— 发布前守卫（npm pack / npm publish 的 prepack 钩子）。
//
// 拦断目标（上游 deepseek-ai/deepseek-harness #1337 / #1633，本插件开发期实踩）：
//   第三方插件让 @deepseek-ai/dsh-tools（或同族核心包）在 profile 里出现第二份物理副本。
//   TOOL_RUNTIME_SCHEDULER 是 dsh-tools 的 module 级唯一 Symbol，每份物理副本求值出不同实例；
//   插件经外来副本注册工具后，agent-loop 用自己副本的 Symbol 去 ctx.tools[symbol] 取调度器
//   → undefined.prepare → 所有会话所有工具调用崩溃，且孤儿 tool_calls 会把会话毒化成永久 400。
//
// 单副本机制：DSH 的安装闭包（$DSH_HOME/profiles/node_modules 回退，healProfilesModuleFallback）
// 为每个核心包提供且只提供一份物理副本，插件运行时从 profile 的普通 parent-walk 解析到它。
// 因此插件**绝不能**在 dependencies / peerDependencies / optionalDependencies / bundledDependencies
// 里声明任何 @deepseek-ai/* 包——pnpm（尤其 autoInstallPeers 默认态）会在 profile 顶层平铺出
// 第二份副本，回退机制被绕过（已存在拷贝就不再 fall through）。核心包只允许出现在 devDependencies
// （构建/类型检查用），运行期由 DSH 安装自身提供。
//
// 用法：node scripts/guard-publish.mjs [packageDir]（prepack 时由 npm 用默认值调用）。
// 可选 <packageDir> 仅用于自查/测试守卫本身；打包入口固定为调用方所在包。

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ? process.argv[2] : '.')
const manifestPath = join(root, 'package.json')
if (!existsSync(manifestPath)) {
  console.error(`[guard-publish] 找不到 ${manifestPath}`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))

const CORE_RE = /^@deepseek-ai\//
// 运行期依赖普查：这些字段里的任何 @deepseek-ai/* 都意味着 pnpm 会在 profile 闭包内
// 平铺出第二份物理副本（#1337/#1633 的完整触发条件）。devDependencies 豁免。
const RUNTIME_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies']

const problems = []
for (const section of RUNTIME_SECTIONS) {
  for (const name of Object.keys(manifest[section] ?? {})) {
    if (CORE_RE.test(name)) {
      problems.push(`运行期依赖 ${section}.${name} —— @deepseek-ai/* 核心包只能出现在 devDependencies（参见 scripts/guard-publish.mjs 头部说明，#1337/#1633）`)
    }
  }
}
// bundledDependencies 也可能是裸名列表（旧格式），一并普查
for (const name of Array.isArray(manifest.bundledDependencies) ? manifest.bundledDependencies : []) {
  if (CORE_RE.test(name)) {
    problems.push(`运行期依赖 bundledDependencies.${name} —— 同第一条规则，核心包不得捆绑进发布物`)
  }
}

// 发布产物扫描：dist/（tsc 输出）与 lib/（client 半体，交付物）。
// ① 调度器字面量出现 = 把 dsh-tools 的核心代码捆绑进了发布物（#1337 第二条触发路径）；
// ② @deepseek-ai/* 的导入说明符必须是裸说明符；出现相对路径/node_modules 说明符 = 可疑拷贝。
function scanDir(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      scanDir(full)
      continue
    }
    if (!/\.(js|mjs|cjs)$/.test(name)) continue
    const text = readFileSync(full, 'utf8')
    if (/['"]@deepseek-ai\/dsh-tools\.scheduler['"]/.test(text)) {
      problems.push(`${full} 内含 dsh-tools 调度器字面量（"@deepseek-ai/dsh-tools.scheduler"）——疑似把 dsh-tools 副本捆绑进发布物（#1337 第二条触发路径）`)
    }
    for (const m of text.matchAll(/from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] || m[2] || m[3]
      if (!spec || !spec.startsWith('@deepseek-ai/')) continue
      if (spec.includes('node_modules') || spec.includes('\\') || !/^@deepseek-ai\/[A-Za-z0-9._-]+$/.test(spec)) {
        problems.push(`${full} 中的 @deepseek-ai 导入说明符不是裸说明符：${spec}（应保持 import { x } from '@deepseek-ai/dsh-tools' 形态，由安装闭包解析）`)
      }
    }
  }
}
scanDir(join(root, 'dist'))
scanDir(join(root, 'lib'))

if (problems.length) {
  console.error('[guard-publish] ❌ 发布被拦截：该包会让 DSH 出现第二份核心包物理副本，导致所有工具调用崩溃（#1337/#1633）')
  for (const p of problems) console.error('  - ' + p)
  console.error('[guard-publish] 处置：把 @deepseek-ai/* 移回 devDependencies（运行期由 DSH 安装闭包提供）；发布物与源码均不得捆绑核心包。')
  process.exit(1)
}
console.log(`[guard-publish] ✅ ${manifest.name}@${manifest.version}：无核心包运行期依赖，发布物干净。`)
