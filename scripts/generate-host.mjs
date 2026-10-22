// M6 迁移脚本：.dev/whale/host.js（动态插件函数体）→ dsh-whale-writing/src/index.ts（npm 包 host 半侧）
// 转换规则（逻辑等价移植，见设计方案 §10 与 README M6 速览）：
//   1. 顶部：import type { Context }（纯类型，构建后擦除）+ 本地 defineToolWw 实现；
//      **运行期不得 import 任何 @deepseek-ai/* 核心包**——0.2.x 的运行时解析器与旧版
//      $DSH_HOME/profiles/node_modules 回退目录会各自给出一份副本，链接期报
//      "does not provide an export named ..."（0.1.1 ↔ 0.2.1 实机复现，见 defineToolWw 注释）。
//   2. 插件导出：`return { inject, apply(ctx) { ... } }` → `export const name / inject` + `export function apply(ctx: Context) { ... }`；
//   3. harness.defineTool → defineToolWw；harness.registerTool(ctx, t) → ctx.tools.register(t)；
//   4. harness.handle（动态插件专用 Builtin）→ 包形态 webServer 路由 shim（POST /whale-writing/<method>，JSON）；
//      保持 apply 内 handle 调用原样：shim 收集 disposer，清理统一由 rpcDisposerEffect 挂到 Fiber。
// 生成后请人工审查（尤其 RPC 段与日志行）。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hostsrcPath = join(here, '..', '..', '.dev', 'whale', 'host.js')
const outPath = join(here, '..', 'src', 'index.ts')

const SRC = readFileSync(hostsrcPath, 'utf8')
const MARKER = '// ───────────────────── 插件声明 ─────────────────────'
const idx = SRC.indexOf(MARKER)
if (idx < 0) throw new Error('host.js: 找不到插件声明标记')

const pure = SRC.slice(0, idx).replace(/\s+$/, '')
const decl = SRC.slice(idx)

// 1) 工具注册替换（两处）
const declT = decl
  .replaceAll('harness.defineTool(', 'defineToolWw(')
  .replace(/ctx\.effect\(\(\) => harness\.registerTool\(ctx, (setProfileTool|polishTool)\)\)/g,
    'ctx.effect(() => ctx.tools.register($1))')

// 2) 插件导出形态
const declExport = declT.replace(/^return \{\s*m?inject: \[[^\]]*\],\s*apply\(ctx\) \{/ms, '')

const head = `// @ts-nocheck — M6 逻辑等价迁移（.dev/whale/host.js 生成，类型宽严留给后续演进标注；改逻辑请改源文件后重跑本脚本）
// dsh-whale-writing —— HOST 半侧（M6 固化：由 .dev/whale/host.js 逻辑等价迁移，勿在此手改逻辑；开发期改 host.js 后重跑 scripts/generate-host.mjs）
// 包形态（npm）与动态插件形态的差异，见 .dev/whale/README.md「M6 行为速览」。

import type { Context } from '@deepseek-ai/cordis'

// ── 工具定义适配（包形态自带；运行期零 @deepseek-ai/* import） ──
// 为什么不用 @deepseek-ai/dsh-tools 的 defineTool：0.2.x 改由运行时解析器把核心包供给
// profile 插件，而机器上若同时留着旧版全局安装（$DSH_HOME/profiles/node_modules 里的
// 0.1.x 回退目录），插件的 import 会解析到旧副本、其依赖又解析到新副本，ESM 链接期直接失败：
//   SyntaxError: The requested module '@deepseek-ai/dsh-llm' does not provide an export named 'CallId'
//   （0.1.x dsh-tools 用 CallId，0.2.x dsh-llm 已改名 ToolCallId —— 0.1.1 ↔ 0.2.1 实机复现）。
// 这里按同一套 schema DSL 的插件实际子集本地实现，产物与 dsh-tools 的 defineTool 同构：
//   parameters DSL → { type: 'object', properties, required? }；
//   output.schema { type: 'json' } → 注解型 schema {}（任意 JSON 值）；
//   execute 前做同口径轻量校验（类型 + enum），非法参数按 INVALID_ARGS 抛错。
function valueSpecToJsonSchemaWw(spec: any): any {
  if (!spec || typeof spec !== 'object') return {}
  if (spec.type === 'json') return {}
  const out: any = { type: spec.type }
  if (Array.isArray(spec.enum)) out.enum = spec.enum.slice()
  if (typeof spec.description === 'string') out.description = spec.description
  return out
}

function parameterSchemaWw(parameters: any): any {
  const properties: any = {}
  const required: string[] = []
  for (const key of Object.keys(parameters || {})) {
    const spec = parameters[key] || {}
    properties[key] = valueSpecToJsonSchemaWw(spec)
    if (spec.required === true) required.push(key)
  }
  const schema: any = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

function validateArgsWw(parameters: any, args: any): string[] {
  const violations: string[] = []
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be an object']
  for (const key of Object.keys(parameters || {})) {
    const spec = parameters[key] || {}
    if (!Object.prototype.hasOwnProperty.call(args, key)) {
      if (spec.required === true) violations.push('"' + key + '" is required')
      continue
    }
    const value = args[key]
    const t = spec.type
    if (t === 'json') continue
    const ok = t === 'string' ? typeof value === 'string'
      : t === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : t === 'integer' ? Number.isInteger(value)
          : t === 'boolean' ? typeof value === 'boolean'
            : t === 'null' ? value === null
              : true
    if (!ok) { violations.push('"' + key + '" must be ' + t); continue }
    if (Array.isArray(spec.enum) && spec.enum.indexOf(value) < 0) {
      violations.push('"' + key + '" must be one of ' + JSON.stringify(spec.enum))
    }
  }
  return violations
}

function defineToolWw(spec: any): any {
  const parameters = parameterSchemaWw(spec.parameters)
  const outputSchema = valueSpecToJsonSchemaWw(spec.output && spec.output.schema)
  const render = spec.output && spec.output.render
  return {
    name: spec.name,
    description: spec.description,
    parameters,
    output: {
      schema: outputSchema,
      render(args: any, value: any) { return render(args, value) },
    },
    async execute(args: any, exec: any) {
      const violations = validateArgsWw(spec.parameters, args)
      if (violations.length > 0) {
        const error: any = new Error('invalid arguments: ' + violations.join('; '))
        error.code = 'INVALID_ARGS'
        throw error
      }
      return spec.execute(args, exec)
    },
  }
}

`
const shim = `
// ── M6：harness shim（harness 是动态插件沙箱 Builtin，npm 包形态无此物） ──
// Client 半侧经 fetch POST /whale-writing/<method> 调用；handler 签名与动态版一致 (args) => Promise<json>。
// 路由注册返回的 disposer 收进 rpcDisposers，由 Fiber 卸载统一清理（注册是 apply 裸调用，保持原代码形态）。
interface WwRouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => void
}
type WwWebServer = { register: (spec: WwRouteSpec) => () => void }

function jsonRouteWw(fn: (args: any) => Promise<any>) {
  return (req: any, res: any) => {
    let data = ''
    req.on('data', (c: Buffer) => { data += c.toString('utf8') })
    req.on('end', () => {
      let args: any = {}
      try { args = data ? JSON.parse(data) : {} } catch (e) { args = {} }
      fn(args).then((value: any) => {
        const body = JSON.stringify(value)
        const buf = Buffer.from(body, 'utf8')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length })
        res.end(buf)
      }).catch((e: any) => {
        const body = JSON.stringify({ ok: false, message: String((e && e.message) || e) })
        const buf = Buffer.from(body, 'utf8')
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length })
        res.end(buf)
      })
    })
  }
}

function makeHarnessShimWw(ws: WwWebServer, rpcDisposers: Array<() => void>) {
  return {
    handle(method: string, fn: (args: any) => Promise<any>): () => void {
      const dispose = ws.register({ kind: 'exact', path: '/whale-writing/' + method, handler: jsonRouteWw(fn) })
      rpcDisposers.push(dispose)
      return dispose
    },
  }
}

`

const injectOpen = `export const name = 'whale-writing'
export const inject = ['fs', 'systemPrompt', 'tools', 'webServer']

export function apply(ctx: Context) {
    const ws = (ctx as unknown as { webServer: WwWebServer }).webServer
    const rpcDisposers: Array<() => void> = []
    const harness = makeHarnessShimWw(ws, rpcDisposers)
    ctx.effect(() => () => {
      for (const d of rpcDisposers) {
        try { d() } catch (e) {}
      }
    }, 'whale-writing: rpc routes')
`

// 组装：head + pure + shim + injectOpen + decl（去掉原 return { ... apply 开头的部分后接原 apply 体）
const body = declExport.replace(/^\s*$/, '')
let out = head + pure + '\n' + shim + injectOpen + body
// 尾部：原 return 对象闭合（`  },\n}`）消除 → apply 函数闭合（`}`）
out = out.replace(/\n  \},\n\}\s*$/, '\n}\n')

writeFileSync(outPath, out, 'utf8')
console.log('generated', outPath, 'bytes:', out.length)
