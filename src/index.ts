// @ts-nocheck — M6 逻辑等价迁移（.dev/whale/host.js 生成，类型宽严留给后续演进标注；改逻辑请改源文件后重跑本脚本）
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

// 老人与大肥鱼 · 超级写作增强 —— Host 半体（M1 骨架 + M2 提示词注入 + M3 项目记忆 + M4 后处理）
// 本文件是 cordis_define code.host 的函数体源：顶层 return 一个 Cordis Plugin。
// 结构约定（供测试脚本提取纯函数）：文件内唯一一次顶层 `return {` 是插件声明，
// 其余顶层语句均为纯函数/常量区，可由 .dev/whale/host-test.cjs / m2-test.cjs / m3-test.cjs 手动 eval。
//
// M1 范围（设计方案 §9）：
//   Plugin 定义 + Host 状态中心（Map<sessionId, Profile> Fiber 级读缓存）
//   + profile/get | profile/set RPC 打通 + agent/session-start 预热缓存。
// M2 范围（§2.2/§2.5/§3.3/§9，v0.7 修订）：
//   T1–T4 / L1–L5 全套提示词片段落库（三段式，§2.3/§3.3）
//   + 风格样例库 8 份与隔离协议（§2.4，样例按 (档位, 语言) 严格解析为一份）
//   + systemPrompt 双 section 注入：whale-rigor(order 50) / whale-style(order 60)
//   + 自动挡判断（不再询问用户，§2.5/§3.4 v0.7：LLM 判断 → whale_set_profile 直接写档）
//   + whale_set_profile 工具写盘。
// M3 范围（§4/§9，v0.7 修订为全自动）：
//   .mem 三区结构与模板（§4.1，无待确认区；旧版待确认自动迁移）、建档/增量提示词（§4.2：
//   agent 收尾直接追加术语表/上下文资产区，无用户确认与合并）、
//   tools/pre-execute 硬守卫（§4.3：write 仅建档、edit 仅自动区末尾追加）、
//   mem/status | mem/toggleGuard RPC + 全自动维护（旧待确认迁移、>30 条自动拆分 glossary.md）、
//   systemPrompt.context 预算化注入（§4.4，≤800 token 估算封顶）、
//   agent/turn-stopping 增量归档兜底轻提示。Client 快捷条"记忆"为纯开关，无合并按钮。
// M4 范围（§5/§9，本轮）：
//   动态工具 whale_polish（去 AI 味微调润色；§5.2 方案 A）+ §5.3 规则集（中文+英文镜像）
//   + §5.4 档位联动矩阵（T1–T4 / L1–L5 每档加减规则）+ 与生成阶段同源样例注入
//   （§2.4.1 规则 4）+ 流程指令 section whale-polish（§5.2 第 2 条，开关联动）。
//   Client 无改动：后处理开关已在 M1 快捷条，改动清单展示属 M5。

// ───────────────────────────── 档位常量（§2.1 / §3.1） ─────────────────────────────
const STYLE_TIERS = ['t1', 't2', 't3', 't4', 'auto']
const RIGOR_TIERS = ['l1', 'l2', 'l3', 'l4', 'l5', 'auto']

// frontmatter 键映射：Profile 字段名 ↔ config.md 键名（§4.1）
const FM_KEYS = [
  ['styleTier', 'style_tier'],
  ['rigorTier', 'rigor_tier'],
  ['autoAdjust', 'auto_adjust'],
  ['memEnabled', 'mem_enabled'],
  ['polishEnabled', 'polish_enabled'],
  ['pluginEnabled', 'plugin_enabled'],
]

// ───────────────────────────── M2 提示词库（§2.3 / §3.3 落文） ─────────────────────────────

// 档位中文名（提示词始终注入中文；§2.3：仅保留中文，英文梗名只在 UI 使用）
const STYLE_TIER_NAMES = { t1: '鲸定谔', t2: '海明鲸', t3: '奥格鲸', t4: '鲸尔德' }
const RIGOR_TIER_NAMES = { l1: '史官', l2: '辩护律师', l3: '科普作家', l4: '说书人', l5: '小说家' }
// 定位短语（§2.1 / §3.1 "定位"列）
const STYLE_POSITION = { t1: '严肃工程写作', t2: '简明扼要', t3: '广告营销', t4: '辞藻华丽考究' }
const RIGOR_POSITION = { l1: '绝对严肃公正', l2: '论文/论证场景', l3: '通俗准确', l4: '文案场景', l5: '虚构创作' }

// 风格档核心指令（§2.1 表格"提示词核心指令"列展开；4–6 条）
const STYLE_RULES = {
  t1: [
    '术语精确无歧义；首次出现时给出定义或上下文边界。',
    '陈述必须可验证：给事实、数据与出处，不写无法证实的内容。',
    '结构先定义后展开：先声明对象与范围，再进入细节。',
    '删除一切装饰性修辞与情绪化措辞。',
    '不确定处显式声明（如"此为推断""截至X年X月"），不得糊弄。',
  ],
  t2: [
    '用短句：一句一个意思，能拆就拆。',
    '冰山理论：删到不能再删，余下的意思留在文字下面。',
    '主动语态优先，不用被动绕圈。',
    '一个段落只有一个意思，首句即点明。',
    '零副词堆砌（非常/十分/真的），用具体的名词与动词承担表达。',
  ],
  t3: [
    '标题即利益点：第一句就给出读者最想看到的收益。',
    '具体数字优于形容词："省 2000 元"胜过"很便宜"。',
    '用第二人称"你/您"直接与读者对话。',
    '每个段落给读者一个继续读下去的理由。',
    '结尾必有行动召唤：明说下一步做什么。',
  ],
  t4: [
    '允许警句、反讽与通感，追求语言的趣味与光泽。',
    '注意节奏与对仗：句子长短有韵律，反复处要工整。',
    '用词求精不求僻：选最精准的词，不以生僻炫技。',
    '华丽但不堆砌：每处修辞都要回头服务意思，服务不了就删。',
  ],
}

// 严谨档核心指令（§3.1 表格"提示词核心指令"列展开）
const RIGOR_RULES = {
  l1: [
    '每个论断必须有出处；没有出处就不写。',
    '不确定性显式标注："截至X年X月""此为推断""证据不足"。',
    '不调和矛盾：不同来源的分歧并列呈现，注明分歧。',
    '禁用情绪化措辞与价值判断，一律用中性语。',
  ],
  l2: [
    '结论先行：开门见山给出论点。',
    '优势与证据充分展开，按支持力度从强到弱排序。',
    '局限性须承认，但放在可控位置、用恰当措辞框定（如"本方法在X条件下尚待验证"），不罗列成罪状。',
    '论证链条清晰：前提 → 推理 → 结论，缺一不可。',
  ],
  l3: [
    '事实准确，但允许简化、类比与"大致来说"。',
    '不为每个限定条件加注，保持阅读流畅。',
    '使用类比后注明"这是简化模型"即可。',
    '关键数字与结论不得出错；术语首次出现用日常语言解释。',
  ],
  l4: [
    '选择性真实：讲有利于表达的事实。',
    '允许修辞性夸张（如"快如闪电"）。',
    '不捏造可证伪的具体数字——除非有据，不说"销量提升 237%"。',
    '不虚构权威背书：不编造专家、机构或认证。',
  ],
  l5: [
    '无事实限制：内容由虚构世界决定。',
    '唯一硬要求是内部自洽：虚构世界的规则不能自相矛盾。',
    '已建立的设定不得无故违背；涉及角色/设定时参照项目记忆中的角色与设定区。',
    '允许任何叙事手法；唯一禁忌是行文自相矛盾。',
  ],
}

// 三段式模板：① 定位行 / ② 核心指令 / ③ 边界护栏（§2.3 必含；本档位只管"怎么说"）
const STYLE_BOUNDARY = [
  '本档位只约束"怎么说"——表达方式与文风；事实与论证标准（严谨性）由严谨档位决定，不得越界。',
  '本档位仅适用于交付给读者的成稿文本；工具调用、代码、内部推理与计划照常，不受本档位约束。',
]
const RIGOR_BOUNDARY = [
  '本档位只约束事实与论证标准（说到什么程度算数）；文风与表达方式由风格档位决定，不得越界。',
  '本档位约束适用于交付给读者的成稿文本；工具调用、代码、内部推理与计划照常。',
]

// 自动挡引导（§2.5 / §3.4，v0.7 修订）：主模型判断 → whale_set_profile 直接写档。
// 不再询问用户（自动挡 = 由 LLM 代选档位）；写档后自下一步起按确定档注入规则与样例（§2.4.1 规则 1）。
const AUTO_STYLE_NAV = [
  '【写作风格档位：自动】本会话尚未确定写作风格档位，由你代为判断并直接写档，不再询问用户。',
  '1. 判断：根据用户请求与任务类型，从 T1 鲸定谔（严肃工程写作）/ T2 海明鲸（简明扼要）/ T3 奥格鲸（广告营销）/ T4 鲸尔德（辞藻华丽考究）中选出最合适的一档；判断时不询问用户。',
  '2. 写档：判断完成后立即调用 whale_set_profile 写入 style_tier（不要向用户提问确认、不要征询同意）；写档后自下一步起按该档注入规则与样例，按确定档位写作。',
  '3. 若确实无法判定（如任务与四档定位全不匹配），按 T2 把握，不写档、不询问。',
].join('\n')

const AUTO_RIGOR_NAV = [
  '【严谨性档位：自动】本会话尚未确定严谨性档位，由你代为判断并直接写档，不再询问用户。',
  '1. 判断：根据用户请求与任务类型，从 L1 史官（绝对严肃公正）/ L2 辩护律师（论文/论证场景）/ L3 科普作家（通俗准确）/ L4 说书人（文案场景）/ L5 小说家（虚构创作）中选出最合适的一档；判断时不询问用户。',
  '2. 写档：判断完成后立即调用 whale_set_profile 写入 rigor_tier（不要向用户提问确认、不要征询同意）；写档后自下一步起按确定档执行。',
  '3. 若确实无法判定，按 L5 把握（默认宽松、如实），不写档、不询问。',
].join('\n')

// 自动挡总开关关闭（auto_adjust=false）时的中性引导：不询问、不写盘
const AUTO_STYLE_OFF = '【写作风格档位：自动（自动挡已关闭）】不要询问用户、不要建议档位；按你对任务的最佳判断写作（默认：自然、清晰、准确）。'
const AUTO_RIGOR_OFF = '【严谨性档位：自动（自动挡已关闭）】不要询问用户、不要建议档位；按你对任务的最佳判断把握事实与论证标准（默认：如实、审慎）。'

// ── 风格样例库（§2.4.2 定稿 8 份，dev 期按字符串原样内置） ──

// 样例前固定护栏（§2.4.1，优先于样例正文）
const SAMPLE_GUARD = '以下文本只作为语言风格参考。只学习其句长、节奏、句法、段落组织、措辞密度和修辞强度；\n不得引用、复述、续写或影射样例内容，不得迁移其中的主题、观点、事实、数字、专名、对象、场景、情节和意象。\n你的内容只能来自用户任务与已获准上下文。若样例风格与事实准确性、用户要求或严谨档冲突，以后三者为准。'

const STYLE_SAMPLES = {
  't1:en': `The Transformer is a sequence-to-sequence model built with a stack of identical layers in the encoder and decoder (six each in the original model). Each encoder layer has two core sub-layers: first a multi-head self-attention mechanism, and second a position-wise feed-forward network, with each sub-layer followed by a residual addition and layer normalization (often denoted as an Add & Norm step). The decoder layers have a similar structure with two differences: each decoder layer includes a third sub-layer that performs multi-head attention over the encoder's output, and the self-attention sub-layer in the decoder is masked to prevent attending to future positions.`,
  't1:zh': `Transformer是一个编码器-解码器架构的序列到序列模型。每个编码器层包含两个核心子层：首先是多头自注意力机制，其次是逐位置前馈神经网络，并在每个子层后面应用残差连接和层归一化（通常称为“Add & Norm”步骤）。解码器层的结构与编码器类似，但有两点差异：每个解码器层比编码器多一个第三子层，对编码器输出执行多头注意力；解码器中的自注意力子层使用掩膜机制，以避免关注将来的位置。`,
  't2:en': `Now the man watched the dip of the three sticks over the side of the skiff and rowed gently to keep the lines straight up and down and at their proper depths. It was quite light and any moment now the sun would rise. The sun rose thinly from the sea and the old man could see the other boats, low on the water and well in toward the shore, spread out across the current.`,
  't2:zh': `现在，老人守着小船旁的三根小木棍，等待看到它们往下沉，他慢慢地划着，使鱼线随时保持垂直并垂到应有的深度。天色已十分亮了，太阳马上就会升起来了。太阳微微地从海面升起，老人看见了水平线另一边的其它船只，朝着海岸，在水流之上散布开来。`,
  't3:en': `For them the best car is one that simply gets them there. Comfortably and economically. One they don't have to worry about. That doesn't make many stops for gas. And rarely needs repairs. A car where rare repairs don't cost much. A car where the car doesn't cost much. They feel they can afford to save money with a Volkswagen. Now next time you see somebody driving a VW don't feel sorry for him. Who knows? Someday the bank might be using his money to give you a new car loan.`,
  't3:zh': `对他们而言，最好的汽车，就是一部可以把它们载送到目的地的汽车，舒适而经济的汽车，一部无须担心的汽车，一部不必经常加油的汽车，而且几乎不需要修理。一部修理费用不高的汽车。一部本身不贵的汽车。他们认为拥有了甲壳虫，就有办法存钱。所以，下一次看到有人开甲壳虫时，不必为他们感到难过。说不定有一天，银行可能利用他的存款，借给你用做新车贷款。`,
  't4:en': `The leaves on the birches were still almost all green, though perceptibly paler; only here and there stood one young leaf, all red or golden, and it was a sight to see how it flamed in the sunshine when the sunbeams suddenly pierced with tangled flecks of light through the thick network of delicate twigs, freshly washed by the sparkling rain. Not one bird could be heard; all were in hiding and silent, except that at times there rang out the metallic, bell-like sound of the jeering tomtit.`,
  't4:zh': `白桦树上的叶子几乎还一片翠绿，虽然已显出几分苍白；独有一处长着一棵小白桦，全身是红色的或金色的，可以看到，当阳光五彩缤纷地滑翔着，突然穿过刚由亮晶晶的雨水冲洗过的茂密树枝，这棵小白桦在阳光中显得何等的光彩夺目啊。听不到鸟儿的啁啾：它们到各处歇息了，静默下来了；唯有偶尔响起山雀的嘲笑声，宛如铜铃。`,
}

// ───────────────────────────── 纯函数区（可单测） ─────────────────────────────

function defaultProfile() {
  return { styleTier: 'auto', rigorTier: 'auto', autoAdjust: true, memEnabled: true, polishEnabled: true, pluginEnabled: true }
}

// 去掉行尾注释与引号，得到裸标量
function cleanScalar(raw) {
  let v = String(raw).replace(/\s+#.*$/, '').trim()
  if (v.length >= 2 && (
    (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
    (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")
  )) v = v.slice(1, -1)
  return v
}

// 解析文本头部的 frontmatter 块；无块返回 null
function parseFrontmatter(text) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const values = {}
  const lines = m[1].split(/\r?\n/)
  for (const line of lines) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (kv) values[kv[1]] = cleanScalar(kv[2])
  }
  return { body: m[1], values, matchLen: m[0].length }
}

function toBool(v, fallback) {
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

// frontmatter 字典 → Profile（非法值回落默认，不抛错）
function profileFromValues(values) {
  const p = defaultProfile()
  if (STYLE_TIERS.indexOf(values.style_tier) >= 0) p.styleTier = values.style_tier
  if (RIGOR_TIERS.indexOf(values.rigor_tier) >= 0) p.rigorTier = values.rigor_tier
  p.autoAdjust = toBool(values.auto_adjust, p.autoAdjust)
  p.memEnabled = toBool(values.mem_enabled, p.memEnabled)
  p.polishEnabled = toBool(values.polish_enabled, p.polishEnabled)
  p.pluginEnabled = toBool(values.plugin_enabled, p.pluginEnabled)
  return p
}

// 行尾探测（写回时保持一致：config.md 可能是 LF 或 CRLF——m4 实机修复，保证字节级往返）
function detectEol(text) {
  return String(text).indexOf('\r\n') >= 0 ? '\r\n' : '\n'
}

// 把 Profile 写回文本的 frontmatter 块：
//   - 已有键：仅替换值（保留行内注释与键顺序）
//   - 缺失键：在 frontmatter 末尾追加（无注释）
// 没有 frontmatter 块时返回 null（调用方决定是否放弃写入）
function writeFrontmatter(text, profile) {
  const parsed = parseFrontmatter(text)
  if (!parsed) return null
  const eol = detectEol(text)
  const bodyLines = parsed.body.split(/\r?\n/)
  const handled = new Set()
  for (let i = 0; i < bodyLines.length; i++) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(bodyLines[i])
    if (!kv) continue
    const pair = FM_KEYS.find((p) => p[1] === kv[1])
    if (!pair) continue
    if (profile[pair[0]] === undefined) continue // 调用方给了不完整 profile：保持原值，不写 undefined
    handled.add(kv[1])
    const valueText = kv[2].replace(/\s+#.*$/, '')
    const comment = kv[2].slice(valueText.length)
    bodyLines[i] = kv[1] + ': ' + String(profile[pair[0]]) + comment
  }
  for (const pair of FM_KEYS) {
    if (handled.has(pair[1])) continue
    if (profile[pair[0]] === undefined) continue
    bodyLines.push(pair[1] + ': ' + String(profile[pair[0]]))
  }
  return '---' + eol + bodyLines.join(eol) + eol + '---' + text.slice(parsed.matchLen)
}

// config.md 初版模板（§4.1 v0.7：三区骨架，无待确认区）；schema 固定 1；indexes 拆分索引（自动维护，初始为空）
function renderInitialConfig(profile) {
  return '---\n' +
    '# ── 档位区（agent 不可经文件工具改写；档位只经 whale_set_profile 或快捷条） ──\n' +
    'style_tier: ' + profile.styleTier + '\n' +
    'rigor_tier: ' + profile.rigorTier + '\n' +
    'auto_adjust: ' + profile.autoAdjust + '\n' +
    'mem_enabled: ' + profile.memEnabled + '\n' +
    'polish_enabled: ' + profile.polishEnabled + '\n' +
    'plugin_enabled: ' + (profile.pluginEnabled !== false) + '\n' +
    'schema: 1\n' +
    '# ── 拆分文件索引（自动维护） ──\n' +
    'indexes: {}\n' +
    '---\n\n' +
    '## 人工锁定区（agent 只读；守卫硬保护）\n\n' +
    '## 术语表（自动维护，超过 30 条拆出至 glossary.md）\n\n' +
    '## 上下文资产（自动维护）\n'
}

// 仅接受合法字段的合并；字段缺失或值非法一律忽略（返回全新对象）
function mergePatch(profile, patch) {
  const next = {
    styleTier: profile.styleTier,
    rigorTier: profile.rigorTier,
    autoAdjust: profile.autoAdjust,
    memEnabled: profile.memEnabled,
    polishEnabled: profile.polishEnabled,
    pluginEnabled: profile.pluginEnabled !== false,
  }
  if (patch && STYLE_TIERS.indexOf(patch.styleTier) >= 0) next.styleTier = patch.styleTier
  if (patch && RIGOR_TIERS.indexOf(patch.rigorTier) >= 0) next.rigorTier = patch.rigorTier
  if (patch && typeof patch.autoAdjust === 'boolean') next.autoAdjust = patch.autoAdjust
  if (patch && typeof patch.memEnabled === 'boolean') next.memEnabled = patch.memEnabled
  if (patch && typeof patch.polishEnabled === 'boolean') next.polishEnabled = patch.polishEnabled
  if (patch && typeof patch.pluginEnabled === 'boolean') next.pluginEnabled = patch.pluginEnabled
  return next
}

// 会话 → cwd：优先 agent 实时状态；agent 不存在时返回 undefined
function cwdOfAgent(agent) {
  try {
    return (agent && agent.session && agent.session.header && agent.session.header.cwd) || undefined
  } catch (e) {
    return undefined
  }
}

// ── M2 纯函数：提示词渲染 / 语言检测 / 样例解析 ──

// 风格档三段式规则文本（不含样例）
function renderStyleSection(styleTier) {
  const rules = STYLE_RULES[styleTier]
  if (!rules) return ''
  const lines = ['你当前的写作风格档位：T' + styleTier.slice(1) + ' ' + STYLE_TIER_NAMES[styleTier] +
    '（' + STYLE_POSITION[styleTier] + '）。', '', '【核心指令】']
  for (let i = 0; i < rules.length; i++) lines.push((i + 1) + '. ' + rules[i])
  lines.push('', '【边界护栏】')
  for (const item of STYLE_BOUNDARY) lines.push('- ' + item)
  return lines.join('\n')
}

// 严谨档三段式规则文本（不含样例；§3.3：严谨档不注入风格样例）
function renderRigorSection(profile) {
  if (profile.rigorTier === 'auto') {
    return profile.autoAdjust ? AUTO_RIGOR_NAV : AUTO_RIGOR_OFF
  }
  const rules = RIGOR_RULES[profile.rigorTier]
  if (!rules) return ''
  const lines = ['你当前的严谨性档位：L' + profile.rigorTier.slice(1) + ' ' + RIGOR_TIER_NAMES[profile.rigorTier] +
    '（' + RIGOR_POSITION[profile.rigorTier] + '）。', '', '【核心指令】']
  for (let i = 0; i < rules.length; i++) lines.push((i + 1) + '. ' + rules[i])
  lines.push('', '【边界护栏】')
  for (const item of RIGOR_BOUNDARY) lines.push('- ' + item)
  return lines.join('\n')
}

// 任务输出语言检测（§2.4.1 规则 2）：显式指定 > 方向短语 > 请求主语言启发式；
// 判定不了（含"中英各一版"双语言请求——规则 5 要求拆分为独立单元）返回 undefined。
function detectOutputLanguage(text) {
  if (typeof text !== 'string') return undefined
  const t = text.slice(0, 4000)
  // 双语言请求：不允许只解析为一个键 → 不注入样例
  if (/(?:中|中文|汉语)\s*(?:英|英文|英语)|(?:英|英文|英语)\s*(?:中|中文|汉语)/.test(t) &&
      /(?:各|双|两|都|互|对照)/.test(t)) return undefined
  // ① 显式目标语言（翻译句 / "用X语言写" / in English|Chinese）
  if (/(?:译成|译为|翻成|翻译成|翻译为|译作)[^。\n]{0,10}(?:中文|汉语|简体中文|国语)/.test(t)) return 'zh'
  if (/(?:译成|译为|翻成|翻译成|翻译为|译作)[^。\n]{0,10}(?:英文|英语)/i.test(t)) return 'en'
  if (/(?:用|以)(?:中文|汉语|简体中文|国语)[^。\n]{0,8}(?:写|回答|回复|叙述|表达|作答|讲述|讲)/.test(t)) return 'zh'
  if (/(?:用|以)(?:英文|英语)[^。\n]{0,8}(?:写|回答|回复|叙述|表达|作答|讲述|讲)/i.test(t)) return 'en'
  if (/\b(?:in|into)\s+(?:Chinese|Mandarin)\b/i.test(t)) return 'zh'
  if (/\b(?:in|into)\s+English\b/i.test(t)) return 'en'
  if (/\b(?:translate|write|answer|respond)[^。\n]{0,24}\b(?:to|into)\s+(?:Chinese|Mandarin)\b/i.test(t)) return 'zh'
  if (/\b(?:translate|write|answer|respond)[^。\n]{0,24}\b(?:to|into)\s+English\b/i.test(t)) return 'en'
  // ② 方向短语：中译英 → en；英译中 → zh
  if (/(?:中|中文|汉语)[^。\n]{0,10}(?:译|翻)[^。\n]{0,10}(?:英|英文|英语)/.test(t)) return 'en'
  if (/(?:英|英文|英语)[^。\n]{0,10}(?:译|翻)[^。\n]{0,10}(?:中|中文|汉语)/.test(t)) return 'zh'
  // ③ 请求主语言启发式：CJK 字符数与拉丁字母数的比例
  const cjk = (t.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  const latin = (t.match(/[A-Za-z]/g) || []).length
  if (cjk === 0 && latin === 0) return undefined
  return cjk * 2 >= latin ? 'zh' : 'en'
}

// 样例长度口径（§2.4.2）：中文按「汉字 + 中文标点」计；英文按空格分词计。（开发期静态测试用）
function countSampleUnits(text, lang) {
  if (lang === 'zh') {
    const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
    const punct = (text.match(/[\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u201c\u201d\u2018\u2019\uff08\uff09\u2014\u2026\u300a\u300b\u3008\u3009\u00b7\u3010\u3011]/g) || []).length
    return cjk + punct
  }
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0)
  return words.length
}

// 样例解析（§2.4.1 规则 4：生成与后处理共用同一纯函数；tier 固定且语言明确时才返回）
function resolveStyleExample(styleTier, taskLanguage) {
  const lang = taskLanguage === 'en' ? 'en' : taskLanguage === 'zh' ? 'zh' : null
  if (!lang || STYLE_TIERS.indexOf(styleTier) < 0 || styleTier === 'auto') return null
  const sample = STYLE_SAMPLES[styleTier + ':' + lang]
  if (!sample) return null
  return { key: styleTier + ':' + lang, text: SAMPLE_GUARD + '\n\n' + sample }
}

// 一次组装的本插件注入结果（§2.4.1 规则 3：每次组装至多解析出一个样例键）
// 返回 { rigor, style, styleKey }；styleKey 为本次注入的样例键，未注入时为 null。
function renderWhaleSections(profile, taskText) {
  // 总开关关闭（快捷条鲸鱼按钮）：本插件零贡献——不出档位规则、不出样例、不写样例缓存
  if (profile && profile.pluginEnabled === false) return { rigor: '', style: '', styleKey: null }
  const rigor = renderRigorSection(profile)
  let styleKey = null
  let styleText
  if (profile.styleTier === 'auto') {
    styleText = profile.autoAdjust ? AUTO_STYLE_NAV : AUTO_STYLE_OFF
  } else {
    styleText = renderStyleSection(profile.styleTier)
    const lang = detectOutputLanguage(taskText)
    const example = lang ? resolveStyleExample(profile.styleTier, lang) : null
    if (example) {
      styleText += '\n\n' + example.text
      styleKey = example.key
    }
  }
  return { rigor, style: styleText, styleKey }
}

// 从用户消息中提取纯文本（只取 text 块，leaf 级提取，不持有活对象）
function messageText(message) {
  const blocks = message && message.content
  if (!Array.isArray(blocks)) return ''
  let out = ''
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      out += (out ? '\n' : '') + block.text
    }
  }
  return out
}

// ───────────────────────────── M3 项目记忆（§4） ─────────────────────────────

// 四区标题（§4.1；标题行以 "## 名称" 起，括号内为说明，正则按名称匹配）
const MEM_HEADER_RE = /^##\s*(人工锁定区|术语表|上下文资产|待确认区)\s*(?:（[^）]*）)?\s*$/
const MEM_KEY_BY_TITLE = { '人工锁定区': 'human', '术语表': 'glossary', '上下文资产': 'assets', '待确认区': 'pending' }
// 术语表拆分阈值（§12 结论 7：超过 30 条拆出 glossary.md）
const GLOSSARY_SPLIT_THRESHOLD = 30
// 记忆注入预算（§4.4：默认 ≤ 800 token；估算封顶，非精确硬顶）
const MEM_BUDGET_TOKENS = 800
// context 注册名（systemPrompt.context）
const MEM_CONTEXT_NAME = 'whale-mem'
// 术语表表头（glossary.md 与 config.md 中相同；解析时跳过）
const GLOSSARY_TABLE_HEADER = '| 术语 | 统一写法 | 禁用写法 | 来源 | 置信度 |'

// 旧版待确认条目标签（仅用于 v0.6 及以前 config.md 的自动迁移；§4.2 v0.7）：
//   - [术语] 术语 | 统一写法 | 禁用写法 | 来源 | 置信度  → 上移术语表（5 列）
//   - [资产] <路径或描述>                                   → 上移上下文资产区
//   - 其他（含 [新增·待确认] 或自由行）                      → 迁移时丢弃（无用户审查环节）

// 建档模板结构校验（§4.3 守卫放行 write 的唯一条件：目标不存在 且 内容匹配模板结构）
function verifyInitialConfigText(text) {
  if (typeof text !== 'string') return { ok: false, reasons: ['内容不是字符串'] }
  const parsed = parseFrontmatter(text)
  if (!parsed) return { ok: false, reasons: ['缺少 frontmatter 块（--- 包围）'] }
  const v = parsed.values
  const missing = []
  if (v.style_tier === undefined) missing.push('style_tier')
  if (v.rigor_tier === undefined) missing.push('rigor_tier')
  if (v.schema !== '1') missing.push('schema: 1')
  if (missing.length) return { ok: false, reasons: ['frontmatter 缺少字段：' + missing.join('/')] }
  const keys = memSectionKeys(text)
  const want = ['human', 'glossary', 'assets']
  if (keys.length !== want.length || keys[0] !== 'human') {
    return { ok: false, reasons: ['区标题缺失或顺序错误（应为 人工锁定区/术语表/上下文资产 三区，旧版待确认区已被移除）'] }
  }
  for (let i = 0; i < want.length; i++) {
    if (keys[i] !== want[i]) return { ok: false, reasons: ['区标题顺序错误：第 ' + (i + 1) + ' 区应为 ' + want[i]] }
  }
  return { ok: true, reasons: [] }
}

// 区标题扫描：返回按出现顺序的 key 数组（无标题返回 []）
function memSectionKeys(text) {
  const keys = []
  const lines = String(text).split(/\r?\n/)
  for (const line of lines) {
    const m = MEM_HEADER_RE.exec(line)
    if (m) keys.push(MEM_KEY_BY_TITLE[m[1]])
  }
  return keys
}

// 区定位：返回 [{ key, startLine }]，startLine 为标题行行号
function memSections(text) {
  const out = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = MEM_HEADER_RE.exec(lines[i])
    if (m) out.push({ key: MEM_KEY_BY_TITLE[m[1]], startLine: i })
  }
  return out
}

// 取某区正文（标题行之后、下一区标题或文件末尾之前）
function memSectionBody(text, key) {
  const lines = String(text).split(/\r?\n/)
  const secs = memSections(text)
  const idx = secs.findIndex((s) => s.key === key)
  if (idx < 0) return null
  const start = secs[idx].startLine + 1
  const end = idx + 1 < secs.length ? secs[idx + 1].startLine : lines.length
  return lines.slice(start, end)
}

// 用新的区正文重建全文：updates = { [key]: string[] }，其他行原样保留
function rebuildMem(text, updates) {
  const lines = String(text).split(/\r?\n/)
  const secs = memSections(text)
  const flat = []
  let cursor = 0
  for (let i = 0; i < secs.length; i++) {
    const sec = secs[i]
    for (let j = cursor; j < sec.startLine; j++) flat.push(lines[j])
    const bodyEnd = i + 1 < secs.length ? secs[i + 1].startLine : lines.length
    flat.push(lines[sec.startLine])
    const body = updates.hasOwnProperty(sec.key) ? updates[sec.key] : lines.slice(sec.startLine + 1, bodyEnd)
    for (const l of body) flat.push(l)
    cursor = bodyEnd
  }
  for (let j = cursor; j < lines.length; j++) flat.push(lines[j])
  return flat.join(detectEol(text))
}

// 术语表追加行校验：合法表格行（≥5 列）；表头行与分隔行（|---|---|）不得作为"追加行"
function isGlossaryRowLine(raw) {
  const t = String(raw).trim()
  if (!t.startsWith('|') || !t.endsWith('|')) return false
  const cols = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
  if (cols.length < 5) return false
  if (cols[0] === '术语' && cols[1] === '统一写法') return false // 表头行不得重复追加
  if (cols.every((c) => /^:?-+:?$/.test(c))) return false // 表头分隔行
  return true
}

// 术语表表头行 / 表头分隔行（仅允许在"空术语表首次建表"时作为追加片段出现）
function isGlossaryHeaderLine(raw) {
  const t = String(raw).trim()
  if (!t.startsWith('|') || !t.endsWith('|')) return false
  const cols = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
  return cols.length >= 5 && cols[0] === '术语' && cols[1] === '统一写法'
}
function isGlossarySepLine(raw) {
  const t = String(raw).trim()
  if (!t.startsWith('|') || !t.endsWith('|')) return false
  const cols = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
  return cols.length >= 5 && cols.every((c) => /^:?-+:?$/.test(c))
}

// 资产区追加行校验：列表项（- / * 起头且带内容）
function isAssetLine(raw) {
  return /^[-*]\s+\S/.test(String(raw).trim())
}

// 旧版待确认区是否存在（v0.7 迁移用）
function hasPendingSection(text) {
  const lines = String(text || '').split(/\r?\n/)
  for (const line of lines) {
    if (/^##\s*待确认区\s*(?:（[^）]*）)?\s*$/.test(line)) return true
  }
  return false
}

// 剥离旧版待确认区（含标题行与正文，直到下一区标题或文件末尾）；无此区时原样返回
function stripPendingSection(text) {
  const s = String(text == null ? '' : text)
  const lines = s.split(/\r?\n/)
  const idx = lines.findIndex((l) => /^##\s*待确认区\s*(?:（[^）]*）)?\s*$/.test(l))
  if (idx < 0) return { text: s, found: false }
  let end = lines.length
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break }
  }
  const out = lines.slice(0, idx).concat(lines.slice(end))
  return { text: out.join(detectEol(s)), found: true }
}

// edit"仅自动区末尾追加"校验（v0.7 全自动记忆；§4.3 守卫放行 edit 的条件）：
//   ① frontmatter 与三区标题逐字不变（人工锁定区/术语表/上下文资产，旧版待确认区被忽略——迁移会剥离）；
//   ② 各区原有非空行必须原样保留且顺序不变（前缀比较：不允许改/删/重排/中间插入）；
//   ③ 只允许：术语表区末尾追加合法表格行、上下文资产区末尾追加列表项；人工锁定区零追加；
//   ④ 空白行布局微调允许（不影响内容与结构）。
function verifyAutoAppendOnly(original, edited) {
  const o = stripPendingSection(String(original)).text.split(/\r?\n/)
  const e = stripPendingSection(String(edited)).text.split(/\r?\n/)
  const oText = o.join(detectEol(String(original)))
  const eText = e.join(detectEol(String(edited)))
  const secsO = memSections(oText)
  const secsE = memSections(eText)
  if (secsO.length !== secsE.length) return false
  for (let i = 0; i < secsO.length; i++) if (secsO[i].key !== secsE[i].key) return false
  // frontmatter + 首个区标题之前逐字一致
  const firstO = secsO.length ? secsO[0].startLine : o.length
  const firstE = secsE.length ? secsE[0].startLine : e.length
  if (firstO !== firstE) return false
  for (let i = 0; i < firstO; i++) if (o[i] !== e[i]) return false
  const bodyEndO = (idx) => (idx + 1 < secsO.length ? secsO[idx + 1].startLine : o.length)
  const bodyEndE = (idx) => (idx + 1 < secsE.length ? secsE[idx + 1].startLine : e.length)
  for (let i = 0; i < secsO.length; i++) {
    const key = secsO[i].key
    if (o[secsO[i].startLine] !== e[secsE[i].startLine]) return false // 标题行逐字一致
    const bO = o.slice(secsO[i].startLine + 1, bodyEndO(i)).filter((l) => l.trim() !== '')
    const bE = e.slice(secsE[i].startLine + 1, bodyEndE(i)).filter((l) => l.trim() !== '')
    if (bE.length < bO.length) return false // 删除既有行 → 拒绝
    for (let j = 0; j < bO.length; j++) if (bO[j] !== bE[j]) return false // 修改/重排/中间插入 → 拒绝
    let glossarySawData = false
    for (let j = bO.length; j < bE.length; j++) {
      const line = bE[j]
      if (key === 'glossary') {
        // 空术语表首次建表：允许表头行 + 分隔行 + 数据行组合（至少一条数据行）
        if (bO.length === 0 && (isGlossaryHeaderLine(line) || isGlossarySepLine(line))) continue
        if (isGlossaryRowLine(line)) { glossarySawData = true; continue }
        return false
      }
      if (key === 'assets' && isAssetLine(line)) continue
      return false // 人工锁定区零追加；其他非法行一律拒绝
    }
    if (key === 'glossary' && bO.length === 0 && bE.length > bO.length && !glossarySawData) return false
  }
  return true
}

// 术语表表格行解析：跳过表头、表头分隔行与无法成行的内容；返回 { raw, name, preferred, banned, source, confidence }
function parseGlossaryRows(text) {
  const body = memSectionBody(text, 'glossary') || []
  const rows = []
  for (const raw of body) {
    const t = raw.trim()
    if (!t.startsWith('|') || !t.endsWith('|')) continue
    const cols = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
    if (cols.length < 5) continue
    if (cols[0] === '术语' && cols[1] === '统一写法') continue
    // Markdown 表头分隔行（| --- | :---: | --- | 等）：所有列都是 - / : 组成 → 跳过
    if (cols.every((c) => /^:?-+:?$/.test(c))) continue
    rows.push({ raw, name: cols[0], preferred: cols[1], banned: cols[2], source: cols[3], confidence: cols[4] })
  }
  return rows
}

// 待确认条目解析：按标签分派（[术语] 5 列 / [资产] / 其他）
function parsePendingItem(line) {
  const t = String(line).trim()
  if (!t.startsWith('- ')) return { kind: 'other', raw: line }
  const m = /^-\s*\[([^\]]+)\]\s*(.*)$/.exec(t)
  if (!m) return { kind: 'other', raw: line }
  const tag = m[1].trim()
  const rest = m[2].trim()
  if (tag === '术语') {
    const cols = rest.split('|').map((s) => s.trim())
    if (cols.length === 5) return { kind: 'term', cols, raw: line }
    return { kind: 'other', raw: line }
  }
  if (tag === '资产') {
    if (rest === '') return { kind: 'other', raw: line }
    return { kind: 'asset', value: rest, raw: line }
  }
  return { kind: 'other', raw: line }
}

// mem/confirm 逻辑（v0.7 起仅用于旧版 config.md 的自动迁移；解析 → 去重 → 上移，不经过 LLM）：
//   - [术语] 5 列 → 术语表（按"统一写法"去重，已存在则跳过）
//   - [资产]     → 上下文资产区（按内容去重，已存在则跳过）
//   - 其他条目   → 保留在 pending（迁移入口将其丢弃并报 dropped）
// 返回的 text 仍含待确认区（需再经 stripPendingSection）——这是迁移组合的中间产物。
function confirmMerge(text) {
  const body = memSectionBody(text, 'pending') || []
  const secs = memSections(text)
  if (!secs.some((s) => s.key === 'pending')) {
    return { text, stats: { termsMoved: 0, assetsMoved: 0, termsSkipped: 0, assetsSkipped: 0, kept: 0 } }
  }
  const existingTerms = parseGlossaryRows(text)
  const termKeys = new Set(existingTerms.map((r) => r.preferred || r.name))
  const assetBody = memSectionBody(text, 'assets') || []
  const assetKeys = new Set(assetBody.map((l) => l.trim()).filter((l) => l.startsWith('- ')))
  const termRows = []
  const assetNew = []
  const kept = []
  let termsSkipped = 0
  let assetsSkipped = 0
  const pendingBody = body.filter((l) => l.trim() !== '')
  for (const raw of pendingBody) {
    const item = parsePendingItem(raw)
    if (item.kind === 'term') {
      const key = item.cols[1] || item.cols[0]
      if (termKeys.has(key)) {
        termsSkipped += 1
      } else {
        termKeys.add(key)
        termRows.push('| ' + item.cols.join(' | ') + ' |')
      }
    } else if (item.kind === 'asset') {
      const norm = '- ' + item.value
      if (assetKeys.has(norm)) {
        assetsSkipped += 1
      } else {
        assetKeys.add(norm)
        assetNew.push(norm)
      }
    } else {
      kept.push(raw)
    }
  }
  const updates = {}
  if (termRows.length) {
    const cur = memSectionBody(text, 'glossary') || []
    const cleaned = cleanGlossaryBody(cur)
    // cleaned 已含表头与全部已有表格行；只追加新行
    updates.glossary = [...cleaned, ...termRows]
  }
  if (assetNew.length) {
    const cur = memSectionBody(text, 'assets') || []
    const cleaned = cur.filter((l) => l.trim() !== '')
    updates.assets = [...cleaned, ...assetNew]
  }
  if (kept.length) {
    updates.pending = ['', ...kept, '']
  } else {
    updates.pending = ['', '']
  }
  const out = rebuildMem(text, updates)
  return {
    text: out,
    stats: { termsMoved: termRows.length, assetsMoved: assetNew.length, termsSkipped, assetsSkipped, kept: kept.length },
  }
}

// 旧版 config.md 自动迁移（v0.7：记忆全自动，无用户确认与合并）：
//   ① 待确认区 [术语]/[资产] 按去重规则确定性上移（复用 confirmMerge）；
//   ② 无法确定性分派的条目（如 [新增·待确认]）不再保留——交给用户审查的环节已删除，直接丢弃；
//   ③ 剥离待确认区，产出三区结构。
// 返回 { text, migrated, stats }；无待确认区时 migrated=false。
function migrateLegacyMem(text) {
  if (!hasPendingSection(text)) {
    return { text: String(text == null ? '' : text), migrated: false, stats: null }
  }
  const merged = confirmMerge(String(text))
  const stripped = stripPendingSection(merged.text)
  return {
    text: stripped.text,
    migrated: true,
    stats: { termsMoved: merged.stats.termsMoved, assetsMoved: merged.stats.assetsMoved, dropped: merged.stats.kept },
  }
}

// glossary 区正文清洗（保留表头与已有表格行；表头缺失则补）
function cleanGlossaryBody(body) {
  const out = []
  let hasHeader = false
  for (const raw of body) {
    const t = raw.trim()
    if (!t) continue
    if (t.startsWith('|') && t.includes('统一写法')) { hasHeader = true; out.push(GLOSSARY_TABLE_HEADER); continue }
    if (t.startsWith('|')) out.push(t)
  }
  if (!hasHeader) out.unshift(GLOSSARY_TABLE_HEADER)
  return out
}

// frontmatter indexes 解析（§4.1 拆分索引；兼容 `indexes: {}` 空映射与多行映射）
function parseIndexes(text) {
  const lines = String(text).split(/\r?\n/)
  const out = {}
  let inIndexes = false
  for (const raw of lines) {
    const m = /^indexes:\s*(\{.*\})?\s*$/.exec(raw)
    if (m) { inIndexes = true; continue }
    if (inIndexes) {
      const sub = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(raw)
      if (sub) { out[sub[1]] = sub[2].trim(); continue }
      inIndexes = false
    }
  }
  return out
}

// 把拆分索引写入 frontmatter（key: file）；无 indexes 段则追加在 schema 行后
function applyGlossaryIndex(text, file) {
  const eol = detectEol(text)
  const lines = String(text).split(/\r?\n/)
  let indexesAt = -1
  let hasSub = false
  let schemaAt = -1
  for (let i = 0; i < lines.length; i++) {
    const m = /^indexes:\s*(\{.*\})?\s*$/.exec(lines[i])
    if (m) indexesAt = i
    if (/^ {2}glossary\s*:\s*\S+/.test(lines[i]) && indexesAt >= 0) hasSub = true
    if (/^schema\s*:\s*\S+/.test(lines[i])) schemaAt = i
  }
  if (indexesAt >= 0) {
    if (hasSub) {
      // 已存在 glossary 子键：替换文件名
      const next = lines.map((raw) => {
        if (/^ {2}glossary\s*:\s*\S+/.test(raw)) return '  glossary: ' + file
        return raw
      })
      return next.join(eol)
    }
    // 多行或空映射 → 在 indexes 行后插入子键行
    const replacement = ['indexes:', '  glossary: ' + file]
    const out = lines.slice(0, indexesAt).concat(replacement, lines.slice(indexesAt + 1))
    return out.join(eol)
  }
  // 无 indexes 段：在 schema 行之后追加
  const insertAt = schemaAt >= 0 ? schemaAt + 1 : 1
  const out = lines.slice(0, insertAt).concat(['indexes:', '  glossary: ' + file], lines.slice(insertAt))
  return out.join(eol)
}

// 术语表超过阈值 → 拆出 glossary.md（§4.1/§12 结论 7）：
// 返回 { text（config 新文本）, split: { glossaryText, count } | null }
function maybeSplitGlossary(text) {
  const rows = parseGlossaryRows(text)
  if (rows.length <= GLOSSARY_SPLIT_THRESHOLD) return { text, split: null }
  const header = '# 术语表（自动维护；来源可回溯）\n\n'
  const glossaryText = header + GLOSSARY_TABLE_HEADER + '\n' + rows.map((r) => r.raw.trim()).join('\n') + '\n'
  const note = ['（术语表见 glossary.md，共 ' + rows.length + ' 条；索引见 frontmatter indexes）', '']
  const next = rebuildMem(text, { glossary: note })
  const withIndex = applyGlossaryIndex(next, 'glossary.md')
  return { text: withIndex, split: { glossaryText, count: rows.length } }
}

// token 估算（§4.4：CJK ≈ 1 token / 1.5 字符、拉丁 ≈ 1 token / 4 字符，取上界 + 10% 安全边）
function estimateTokens(text) {
  const s = String(text == null ? '' : text)
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  const latin = (s.match(/[A-Za-z0-9]/g) || []).length
  const other = s.length - cjk - latin
  const raw = Math.ceil(cjk / 1.5) + Math.ceil(latin / 4) + Math.ceil(other / 4)
  return Math.ceil(raw * 1.1)
}

// 预算化记忆注入（§4.4）：返回 { text, meta: { entries, truncated: [...] } }
// 注入内容（按注入顺序）：
//   ① 头部：记忆开关与档位（总是注入，极小）
//   ② 人工锁定区：总是注入；＞500 token 恒截断并标注
//   ③ 术语表：仅高/中置信度 top 20；超出折叠
//   ④ 上下文资产：仅路径列表
//   ⑤ 归档指引（建档/增量；§4.2 v0.7：全自动，无用户确认与合并）
// 超预算降级顺序：术语表条数 → 资产列表 → 人工区截断深化（§4.4）。
function renderMemContext(profile, mem, extra) {
  const opts = extra || {}
  const budget = typeof opts.budget === 'number' && opts.budget > 0 ? opts.budget : MEM_BUDGET_TOKENS
  const hint = opts.hint === true
  const exists = !!(mem && mem.exists)
  const humanLines = (mem && mem.human || []).filter((l) => l.trim() !== '')
  const glossaryRows = (mem && mem.glossaryRows || []).filter((r) => r.confidence !== '低')
  const assetLines = (mem && mem.assets || []).filter((l) => l.trim() !== '')

  const parts = []
  parts.push('【项目记忆】' + (exists ? '.mem/config.md 已建档。' : '.mem/config.md 尚不存在。') +
    '（记忆功能：' + (profile.memEnabled === false ? '关闭' : '开启') + '）')
  parts.push('当前档位：风格 ' + profile.styleTier + ' ｜ 严谨 ' + profile.rigorTier)

  // ② 人工锁定区（用户手写；截断线）
  const HUMAN_LIMIT_TOKENS = 500
  let humanBlock = []
  let humanTruncated = false
  let humanAll = humanLines
  if (estimateTokens(humanAll.join('\n')) > HUMAN_LIMIT_TOKENS) {
    humanTruncated = true
    const budgetLines = []
    let acc = 0
    for (const line of humanAll) {
      budgetLines.push(line)
      acc += estimateTokens(line)
      if (acc > HUMAN_LIMIT_TOKENS * 0.8) break
    }
    humanBlock = budgetLines
  } else {
    humanBlock = humanAll
  }
  // ②（续）：预算不足时继续压缩人工区（降级顺序第 3 步）
  let humanCut = false
  function build() {
    const out = []
    out.push('── 人工锁定区（用户纪要；agent 只读）' + (humanTruncated && !humanCut ? '（已截断，全文见 .mem/config.md）' : humanCut ? '（预算压缩，见 .mem/config.md）' : '') + '──')
    if (humanBlock.length === 0) out.push('（空）')
    for (const l of humanBlock) out.push(l)
    return out
  }
  // ③ 术语表（高/中置信 top 20）
  let termLimit = 20
  let termFold = 0
  let termBlock = []
  function termText() {
    const visible = termLimit <= 0 ? [] : glossaryRows.slice(0, termLimit)
    const lines = []
    if (visible.length) {
      lines.push('── 术语表（高/中置信度 top ' + visible.length + '/' + glossaryRows.length + '）──')
      for (const r of visible) {
        lines.push('- ' + (r.preferred || r.name) + '｜禁用：' + (r.banned || '-') + '｜来源：' + (r.source || '-'))
      }
    }
    if (glossaryRows.length > visible.length) {
      lines.push('（另有 ' + (glossaryRows.length - visible.length) + ' 条见 .mem/glossary.md 或 config.md）')
    }
    return lines
  }
  // ④ 资产（路径列表；预算不足时缩到 5 条→0）
  let assetLimit = 10
  function assetText() {
    const visible = assetLimit <= 0 ? [] : assetLines.slice(0, assetLimit)
    const lines = []
    if (visible.length) {
      lines.push('── 上下文资产（路径列表）──')
      for (const l of visible) lines.push(l)
    }
    if (assetLines.length > visible.length) lines.push('（另有 ' + (assetLines.length - visible.length) + ' 项，见 .mem/config.md）')
    return lines
  }
  // ⑤ 归档指引（建档/增量；v0.7 全自动：无用户确认与合并）
  function navText() {
    const lines = ['【归档指引】']
    if (!exists) {
      lines.push('- 建档：若本次为首次写作任务，请在收尾前按模板创建 .mem/config.md（frontmatter 含 style_tier/rigor_tier/schema: 1 + 人工锁定区/术语表/上下文资产三区），用 write 整文件创建。')
    } else {
      lines.push('- 增量（全自动）：收尾时把新术语（表格行 | 术语 | 统一写法 | 禁用写法 | 来源 | 置信度）与新资产（- 路径或描述）直接追加到【术语表】/【上下文资产】区末尾：先按"统一写法"（术语）/内容（资产）查重，重复跳过；只追加新行，不改、不删、不重排既有行；不得触碰人工锁定区与 frontmatter（档位只经 whale_set_profile 或快捷条）。')
      lines.push('- 归位：术语表超过 30 条由插件自动拆出 glossary.md（索引写入 frontmatter indexes）；无需用户操作。')
    }
    if (hint) lines.push('- 提醒：上一轮任务已收尾——若产生了可归档的新术语、实体或文件路径，请按上面的格式直接追加归档（查重后）。')
    return lines
  }

  let text = []
  let meta = { degraded: [] }
  termBlock = termText()
  text = [].concat(parts, build(), termBlock, assetText(), navText())
  // 预算收缩循环（降级顺序：术语表 → 资产 → 人工区深度截断）
  let tokens = estimateTokens(text.join('\n'))
  if (tokens > budget && termLimit > 0) {
    termLimit = Math.max(0, Math.min(termLimit, Math.ceil(termLimit / 2)))
  }
  if (tokens > budget && assetLimit > 0) {
    assetLimit = Math.max(0, Math.min(assetLimit, 5))
  }
  if (tokens > budget && assetLimit > 0) {
    assetLimit = 0
  }
  if (tokens > budget && !humanCut) {
    humanCut = true
    humanBlock = humanBlock.slice(0, Math.max(1, Math.ceil(humanBlock.length / 2)))
  }
  if (tokens > budget && !humanTruncated) {
    humanTruncated = true
    humanBlock = humanBlock.slice(0, Math.max(1, Math.ceil(humanBlock.length / 3)))
  }
  text = [].concat(parts, build(), termText(), assetText(), navText())
  tokens = estimateTokens(text.join('\n'))
  if (tokens > budget) {
    // 最后一档：术语表与资产全部清空（人工区保留最少）
    text = [].concat(parts, build(), ['（预算压缩：术语表与资产列表已省略）'], navText())
  }
  return { text: text.join('\n'), meta: { degraded: tokens > budget, tokens: estimateTokens(text.join('\n')) } }
}

// 从 config 全文解析出 mem 摘要（renderMemContext 的输入；mem = null 表示未加载）
function memFromText(text, exists) {
  if (!exists) return { exists: false, human: [], glossaryRows: [], assets: [], indexes: {} }
  return {
    exists: true,
    human: memSectionBody(text, 'human') || [],
    glossaryRows: parseGlossaryRows(text),
    assets: memSectionBody(text, 'assets') || [],
    indexes: parseIndexes(text),
  }
}

// 路径是否位于 .mem/ 下（fs.contains 失败时的兜底：大小写与分隔符归一后前缀比较）
function pathInMem(memRoot, target) {
  const norm = (p) => {
    const s = p && p.path ? p.path : String(p == null ? '' : p)
    return s.replace(/\\/g, '/').replace(/\/+$/, '')
  }
  const root = norm(memRoot).toLowerCase()
  const t = norm(target).toLowerCase()
  return t === root || t.indexOf(root + '/') === 0
}

// 守卫决策（§4.3 第一层 · 硬守卫；纯决策，路径判定由调用方完成）
// 返回 { allow: true } 或 { allow: false, reason }
function guardDecision(input) {
  const tool = input.toolName
  const args = input.args || {}
  if (tool !== 'write' && tool !== 'edit') return { allow: true }
  // 调用方已判定目标不在 .mem/ 内：不拦截
  if (input.inMem === false) return { allow: true }
  // 开关（§4.3 第 5 条 / §4.1 mem_enabled）：守卫关闭或记忆功能关闭 → 放行
  if (input.guardEnabled === false) return { allow: true, reason: 'guard off' }
  if (input.memEnabled === false) return { allow: true, reason: 'mem off' }
  if (tool === 'write') {
    if (input.fileExists) {
      return { allow: false, reason: '对 .mem/ 的 write 被拦截：config.md 已存在，改写 frontmatter/人工锁定区只允许由插件 Host 代码执行（快捷条、whale_set_profile）；自动区（术语表/上下文资产）请用 edit 末尾追加。' }
    }
    const res = verifyInitialConfigText(typeof args.content === 'string' ? args.content : '')
    if (!res.ok) {
      return { allow: false, reason: '对 .mem/ 的 write 被拦截：首次建档内容须匹配模板结构（frontmatter 含 style_tier/rigor_tier/schema: 1 + 四个区标题），缺失：' + res.reasons.join('；') }
    }
    return { allow: true }
  }
  // edit
  if (!input.fileExists) return { allow: false, reason: '对不存在的 .mem 文件执行 edit 被拦截：请用 write 建档（或由插件 Host 代码创建）。' }
  if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') {
    return { allow: false, reason: 'edit 参数缺少 old_string/new_string，无法校验追加范围。' }
  }
  const original = input.text || ''
  const edited = args.replace_all === true
    ? original.split(args.old_string).join(args.new_string)
    : original.indexOf(args.old_string) < 0 ? original
    : original.replace(args.old_string, args.new_string)
  if (verifyAutoAppendOnly(original, edited)) return { allow: true }
  return {
    allow: false,
    reason: '对 .mem/ 的 edit 被拦截：只允许在【术语表】末尾追加表格行（| 术语 | 统一写法 | 禁用写法 | 来源 | 置信度 |）、在【上下文资产】末尾追加列表项（- ...）——历史条目、人工锁定区与 frontmatter 一律不得改动（改写只经插件 Host 代码）。',
  }
}

// ───────────────────────────── M4 后处理（§5） ─────────────────────────────

// 短文本豁免阈值（§5.2 第 4 条，v0.7 修订：只豁免极短回复，下限 50 单位）。
// 提示词与工具端都用同一阈值——工具端截断避免无谓的二次 LLM 调用（下一轮 128K 上下文模型直接润色）。
const POLISH_MIN_UNITS = 50

// 润色输出预算（pkg-17）：下限 16384（替代 pkg-16 的 4096——推理模型上仍经常截断）、
// 无模型能力解析时的上限兜底 32768（v0.7 原封顶）。
const POLISH_MIN_BUDGET = 16384
const POLISH_MODEL_MAX_FALLBACK = 32768

// 长文计量（§5.2 第 4 条口径：中文按汉字数、英文按词数；标点/数字/代码字符不计）
function polishUnitCount(text) {
  const s = String(text == null ? '' : text)
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  const words = (s.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length
  return cjk + words
}

// 是否豁免（< 阈值即豁免；= 阈值照常润色）
function shouldSkipPolish(text) {
  return polishUnitCount(text) < POLISH_MIN_UNITS
}

// ── 后处理守恒校验（对撞法版本新增；纯函数） ──
// P0 语言守恒：润色输出语言必须与输入成稿一致（实机事故：英文稿两次被润色模型整体译成中文）。
// textLang 按 CJK 与拉丁词比例粗判（与 detectOutputLanguage 同一口径，但只取比例）。
function textLang(text) {
  const s = String(text == null ? '' : text)
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  const latin = (s.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length
  if (cjk === 0 && latin === 0) return 'none'
  return cjk * 2 >= latin ? 'zh' : 'en'
}
// expectedLang 明确（zh|en）且输出被判为另一语言 → 不守恒（回退原稿）。
// 输入/输出任一判为 none（纯代码/表格/数字）→ 放行（语言检测无意义）。
function polishLanguageOk(inputText, outputText, expectedLang) {
  if (expectedLang !== 'zh' && expectedLang !== 'en') return true
  const a = textLang(inputText)
  const b = textLang(outputText)
  if (a === 'none' || b === 'none') return true
  return a === b
}
// P1 单位数守恒：润色应只做表达层微调；单位数膨胀 >+35% 视为"加戏"、收缩 >35% 视为"缩水"。
// 返回输入→输出的单位数比值（输入为空返回 1）。
function polishUnitRatio(inputText, outputText) {
  const inUnits = polishUnitCount(inputText)
  if (inUnits === 0) return 1
  return polishUnitCount(outputText) / inUnits
}

// ── 去 AI 味规则集（§5.3 对撞法版；中文 12 条 + 英文镜像 12 条） ──
// 证据：research/polish-upgrade/synthesis/01-失败模式汇总-最终版.md（16 对真实文本 vs AI 重写稿，
// 8 组对比、84 条批评）。世界观：AI 稿"事实几乎全对、坏在四类动作——顺滑、摊平、越位、补妆"；
// 规则以"保护原作的声音"为主、以"删 AI 植入的模板与装饰"为辅。
const POLISH_BASE_RULES_ZH = [
  '保护节奏骨架：原文的短句连发、存在句清单、顿号连缀、分号并列、刻意重复与排比一律原样保留；禁止合并成带破折号/冒号的解释长句，禁止改成“第一/第二”编号、“一个是/一个是”或“不是A而是B”。',
  '保护拍子与蓄力：句号拍、硬停顿、独立短问句与悬置句法不得顺化；累加式长句（分词链、分号铆接、主语迟滞）不得拆散另起“解释+收束”句。',
  '精确降级禁止（hedging 只减不升）：留余地词不得升格（以避免→保证、可能→会、通常称为→合起来称为、常用→最常用）；术语、专名、数字、括号附注与精确划词原样；一句话最多保留一个“可能/也许”；任何删改先问是否改变断言强度或精度。',
  '陌生化保护：编码“锐/费劲/突然/破”的动词与突发副词原样（刺穿、猛然、突然 不得删）；禁止换成中性运动词（落下、缓缓、掠过）。',
  '越位删除：把“演出来”说破的解释句与心理补白（那桥绕不开、他盼着机器改变一切、心头一酸、一丝也不松懈）一律删；让动作与事实自己说话。',
  '判断删除：替读者加的价值判断、泛化安慰腔（这很省心代价是…、对很多人来说、稳稳送你到达、从不需要你操心）、“一天比一天/才…才…”式递进艰辛修饰与抽象主语打头（“效率的提升促进了…”“两种方案长期主导”）——还原为事实陈述或删。',
  '补拍删除：给动作补过程（抬起眼→望向→望见）、补时间接词（不一会儿）、补并行动词（一边…一边）、给静态补进程（一点一点地散开）一律删；动→名词化（太阳会升起→日出、走法→路线）还原为动词与连续推进。',
  '模板黑名单（命中即改）：不是A而是B（isn’t X. It’s Y）、The first is…; the second is…、对很多人来说/For a lot of people、结果很直接…反过来…、主题句+枚举开篇、“随着……的发展”式开头、值得注意的是/综上所述/总而言之。',
  '补妆删除与密度控制：锐意被磨平后补的“优雅但空”意象与陈词（一缕烟、仿佛自己会发光、宛如一首诗、faint and low、gone as soon as seen）必删；破折号不新增（原文 0 处则结果 0 处）；比喻只减不增。',
  '人声保护：作者语气句（Keep at it!/持之以恒/好消息是…）不删不改；结尾调门不得改（冷讽→祝福、硬切→顺滑、感叹→解释）。',
  '人称守恒：原文双声部（他们=车主 vs 你=读者）不得统一为单一声部；叙事距离不得改变（说→劝我、我们→我、他们→很多人）。',
  '内容守恒：原文没有的卖点/事实/判断/因果（“一箱油能跑很远”“两种方案长期主导”“再执行一次”）删；原文承载的因果与限定（因为事忙、其实、very/much 权重词）不得删失。',
]
const POLISH_BASE_RULES_EN = [
  'Protect the rhythm skeleton: keep the original\'s fragment-sentence lists, existential statements (There was / It was), comma-chained detail, deliberate repetition, and parallelism as-is; never merge fragments into an explanatory long sentence with dashes or colons; never turn them into “First…, second…” numbering, “one is…, the other is…”, or the “not X but Y” triple-parallel.',
  'Protect beats and suspension: keep full-stop beats, hard pauses, standalone short questions, and suspended syntax; do not smooth them out; do not break cumulative long sentences (participle chains, semicolon rivets, delayed subjects) into separate statements plus an explanatory closer.',
  'No precision downgrade (hedging may only decrease): never upgrade hedged wording (would→will, might→may, “often called”→“called”, common→most common); keep terms, names, numbers, parenthetical notes, and precise coinages unchanged; keep at most one “may / might / somewhat” per sentence; ask before any change whether it alters assertion strength or precision.',
  'No verb flattening: keep verbs encoding sharpness / effort / suddenness (pierced, shouldering their way, suddenly) unchanged; do not replace them with neutral movement verbs (fell, moved, drifted).',
  'Delete narrator overreach: remove sentences that explain what was shown (“the bridge was unavoidable”, “he expected the machines to…”, “a pang in my chest”) — let the action and facts speak.',
  'Delete added judgments: remove evaluative fillers, generic comfort tone (“this saves you worry”, “for a lot of people”, “effortlessly gets you there”), “day by day / it took…to finally” hardship progression, and abstract-subject openings — restore plain statement or delete.',
  'Delete staged action: remove added process (“raised his eyes→looked→saw”), time fillers (presently, a moment later), parallel scaffolding (while…while…), and processivized statics (“spread out little by little”); De-nominalize — restore the verb (“the sun would rise”→“the sunrise”, “ways of walking”→“routes”).',
  'Template blacklist (fix on hit): “isn’t X. It’s Y”, “The first is…; the second is…”, “For a lot of people”, “the result is clear…; conversely…”, topic-sentence-plus-enumeration openings, “with the development of…” openings, “it is worth noting / in conclusion / overall”.',
  'Delete compensatory decoration; density control: ornate-but-empty images added after flattening (“a ribbon of smoke”, “as if it could glow by itself”, “faint and low”, “gone as soon as seen”) — delete any decoration with no necessary meaning; add no new dashes (zero in the original, zero in the result); metaphors may only decrease.',
  'Keep the author\'s voice: keep authorial asides (“Keep at it!”, “The good news is…”) and do not change the ending register (dry irony→warmth, hard cut→smooth, exclamation→explanation).',
  'Keep person and narrative distance: preserve the original\'s two voices (“they”=the owners vs “you”=the reader); do not change distance (“said”→“tried to comfort”, “them”→“many people”).',
  'Content conservation: delete what the original lacks (new selling points, facts, judgments, causal links); restore what the original carries (“because he was busy”, “in fact”, weight words like very/much).',
]

// ── 档位联动矩阵（§5.4 对撞法版：润色只做风格内的微调；后处理与生成阶段同一份样例、同 key、同护栏） ──
const POLISH_STYLE_MATRIX = {
  t1: [
    '精确层三保：保术语、公式与代码原样；留余地词、专名、数字、括号附注一律原样（精度只升不降）。',
    '允许句式偏冷硬：不为“自然”把术语改圆；陌生化动词只保不摊平（刺穿→落下 属退化）。',
  ],
  t2: [
    '只许删字，不得增词：单位数只减不增；可做“再删 10% 字数”式删减，但删除对象限于解释句、副词堆与补拍，不得动事实与具象词。',
    '原文短句节奏、存在句清单与三短拍保留：发现“短句合并、动作补过程、心理补白”一律还原；长句只在原文就是机器腔时才拆分。',
  ],
  t3: [
    '允许号召句与感叹号；禁虚假紧迫；但冷幽默/反讽/硬切（可能、说不定、Who knows?）一律原样，禁止解释化、温情化或坐实。',
    '禁止添加原文没有的卖点与新因果；群体冷观察声部（“他们”=车主 vs “你”=读者）保留。',
  ],
  t4: [
    '华丽以精确为前提：华丽修辞保留，但陌生化动词、精确划词、锐意拟人与警句一律不动，只杀陈词滥调。',
    '禁止补妆式华丽：磨平锐度后添补的“优美但空”意象/修饰必删；不得用熟语替素词（自由→自由自在）。',
  ],
}
const POLISH_RIGOR_MATRIX = {
  l1: [
    '冻结层：引用、出处、数字、不确定性标注一字不改。',
    '只动连接词与节奏，其余一律不动。',
  ],
  l2: [
    '不得弱化局限性声明的语气与位置。',
    '不得把框定措辞（“尚待验证”）改成认罪措辞（“失败了”）。',
  ],
  l3: [
    '类比保留；它是“简化模型”，不是错误。',
    '“大致来说”类口语保留一个，不要全清。',
  ],
  l4: [
    '修辞性夸张保留（“快如闪电”不动）。',
    '但仍扫一遍：是否捏造了可证伪的具体数字。',
  ],
  l5: [
    '只修语感与自洽；人物声部与叙事距离（说→劝我、他们→很多人）不改。',
    '不改设定、人名、世界观条目（与 .mem 角色区对照）。',
  ],
}

function polishStyleRules(styleTier) {
  return POLISH_STYLE_MATRIX[styleTier] || []
}
function polishRigorRules(rigorTier) {
  return POLISH_RIGOR_MATRIX[rigorTier] || []
}

// 润色系统提示词（§5.2 第 3/6 条 + §5.3 + §5.4）：
//   lang 决定基础规则集（zh/en 二选一，不混用）；sample 为与生成阶段同一份样例
//   （含护栏文本，§2.4.1 规则 4）；无样例时明确声明。输出约束 = 严格 JSON + 禁止工具调用
//   （递归调用 whale_polish 从构造上排除：本次调用不挂任何工具）。
function renderPolishSystemPrompt(opts) {
  const o = opts || {}
  const lang = o.lang === 'en' ? 'en' : 'zh'
  const baseRules = lang === 'en' ? POLISH_BASE_RULES_EN : POLISH_BASE_RULES_ZH
  const styleRules = polishStyleRules(o.styleTier)
  const rigorRules = polishRigorRules(o.rigorTier)
  const lines = []
  lines.push('你是一名写作润色师，只做“去 AI 味”的微调润色：只改表达层面（措辞、句长、节奏、连接词、AI 腔套话），')
  lines.push('不改写事实、数据、引用、结论与结构，不增删内容要点，不改变段落顺序。')
  lines.push('')
  lines.push('【去 AI 味规则' + (lang === 'en' ? '（成稿为英文，执行英文规则）' : '（成稿为中文，执行中文规则）') + '】')
  for (let i = 0; i < baseRules.length; i++) lines.push((i + 1) + '. ' + baseRules[i])
  lines.push('')
  lines.push('【档位联动 · 风格档】')
  if (styleRules.length) {
    for (const r of styleRules) lines.push('- ' + r)
  } else {
    lines.push('- 风格档未固定（auto）：按基础规则润色，不额外加减。')
  }
  lines.push('')
  lines.push('【档位联动 · 严谨档】')
  if (rigorRules.length) {
    for (const r of rigorRules) lines.push('- ' + r)
  } else {
    lines.push('- 严谨档未固定（auto）：默认不改写任何事实性内容。')
  }
  lines.push('')
  lines.push('【风格参考】')
  if (o.sample) {
    lines.push(o.sample)
  } else {
    lines.push('（本次未解析出风格样例：仅按上述规则润色，不模仿任何外部文本。）')
  }
  lines.push('')
  lines.push('【输出格式（必须遵守）】')
  lines.push('输出语言必须与输入成稿完全一致（输入中文则输出中文，输入英文则输出英文）；禁止翻译，禁止改写语言。')
  lines.push('严格输出一个 JSON 对象，除此之外一个字都不要输出：')
  lines.push('{ "polished": "润色后的完整成稿（与原文语言一致，逐段对应，只改表达）", "changes": ["改动说明1", "改动说明2"] }')
  lines.push('changes 为字符串数组，每条一句话概括一处改动；没有改动时返回空数组 []。')
  lines.push('本次调用不提供任何工具，不得编造工具调用；若确实无法润色，输出原稿并在 changes 里说明原因。')
  return lines.join('\n')
}

// 润色结果解析（§5.2：工具返回 { polished, changes }；对模型输出做 JSON 容错）：
//   容错顺序：```围栏剥离 → 取首个 { 至最后 } → JSON.parse；失败则整体按纯文本处理。
function parsePolishOutput(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return { polished: '', changes: [] }
  const fallback = { polished: text, changes: ['（润色模型未按 JSON 格式返回，已按纯文本处理）'] }
  let body = text
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text)
  if (fenced) body = fenced[1].trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return fallback
  try {
    const obj = JSON.parse(body.slice(start, end + 1))
    if (!obj || typeof obj !== 'object') return fallback
    const polished = typeof obj.polished === 'string' ? obj.polished.trim() : ''
    if (!polished) return fallback
    const changes = Array.isArray(obj.changes)
      ? obj.changes.filter((c) => typeof c === 'string').map((c) => c.trim()).filter((c) => c.length > 0)
      : []
    return { polished, changes }
  } catch (e) {
    return fallback
  }
}

// StreamChunk → { text, toolBlocks, finish }（§5.2 第 6 条：显式检测工具调用并 fail-closed）。
// 按 block index 聚合：text-delta 追加、text 块 block-end 整体替换（两者不重复计数）。
function parseStreamChunks(chunks) {
  const byIndex = new Map()
  let toolBlocks = 0
  let finish = null
  for (const c of chunks) {
    if (!c || typeof c !== 'object') continue
    if (c.type === 'text-delta') {
      byIndex.set(c.index, (byIndex.get(c.index) || '') + c.text)
    } else if (c.type === 'block-end') {
      const block = c.block
      if (!block) continue
      if (block.type === 'text') byIndex.set(c.index, block.text)
      else if (block.type === 'tool-call') toolBlocks += 1
    } else if (c.type === 'tool-call-delta') {
      toolBlocks += 1
    } else if (c.type === 'finish') {
      finish = c
    }
  }
  const text = Array.from(byIndex.keys()).sort((a, b) => a - b).map((k) => byIndex.get(k)).join('')
  return { text, toolBlocks, finish }
}

// finish chunk → 错误（error/aborted/max-tokens/tool-calls 均视为失败；正常结束返回 undefined）。
// DSH 0.2.x 的 FinishReasonMap：stop | tool-calls | max-tokens | aborted | error；
// 0.1.x 用 done 表示正常结束（= 0.2.x 的 stop），两种都按成功处理，保持跨版本可读。
// 附上 failure.code（如 UNSUPPORTED_REASONING_EFFORT）便于调用方识别与降级。
function streamFinishError(finish) {
  if (!finish || !finish.reason) return undefined
  const r = finish.reason
  if (r.kind === 'error') {
    const e = new Error('润色调用失败：' + ((r.failure && r.failure.message) || '未知错误'))
    if (r.failure && r.failure.code) e.code = r.failure.code
    return e
  }
  if (r.kind === 'aborted') return new Error('润色调用被中止')
  if (r.kind === 'max-tokens') return new Error('润色输出被截断（max-tokens）：输出预算已按模型上限放样仍不足，请分段润色或检查模型配置')
  if (r.kind === 'tool-calls') return new Error('润色调用返回了工具调用（tool-calls）：本次调用不提供工具，已按失败处理')
  // 'stop'（0.2.x）/ 'done'（0.1.x）：正常结束
  return undefined
}

// 润色输出 token 预算（pkg-17 重构；v0.7 公式为 clamp(est×1.5, 4096, 32768)）。
// 历史教训：
//   pkg-16：1024 下限在推理型模型上触发 finish=max-tokens——推理内容计入输出预算；
//   pkg-17（本轮，实机故障定位）：4096 下限仍然不够。主会话模型（deepseek-v4-flash-
//   vision-exp，agent-default-model 设 reasoningEffort=max，连接缺省 defaultEffort=high）
//   的润色调用不传 reasoningEffort → 以 high 思考运行，推理 token 随内容波动（数千至
//   数万），而预算公式对 ≤约 6000 汉字的输入恒为 4096——短稿刚好挤过去、长稿必截断，
//   且时好时坏（"四百字没问题，后面进不去"）。同时 estimateTokens 对 CJK 按 1.5 字符/
//   token 偏乐观（DeepSeek 实际约 1 字≈1 token），放样基数系统性低估。
// 新预算（pkg-17）：
//   下限 16384（4×4096）：低档思考（low）推理 + 润色稿（≈原文体量）在 6K 汉字内一步到位；
//   放样 ×4：输出 ≈ 1.4×est（估低估），low 推理 ≈ 0.5×est，留 2 倍安全余量；
//   封顶 = 模型真实输出上限（resolveModelInfo → defaultMaxTokens，如 DeepSeek 缺省 256000），
//   解析失败兜底 32768（v0.7 原上限）——长文按模型上限放样，覆盖 64K 上下文模型一次调用。
function polishMaxTokens(text, modelMax) {
  const est = estimateTokens(String(text == null ? '' : text))
  const cap = Number.isSafeInteger(modelMax) && modelMax > 0 ? modelMax : POLISH_MODEL_MAX_FALLBACK
  return Math.min(cap, Math.max(POLISH_MIN_BUDGET, Math.ceil(est * 4)))
}

// 润色模型的执行能力（pkg-17；一次 resolveModelInfo 拿两样）：
//   maxTokens —— 模型真实输出上限（defaultMaxTokens，即连接的 maxTokens 配置/缺省），
//                用于润色预算的封顶；解析失败返回 undefined（调用方用兜底封顶）。
//   lowEffort —— 推理档位是否支持 'low'：支持则润色调用显式传 reasoningEffort:'low'
//                （润色是表达层微调，无需 deep 思考；把推理 token 压到可控区间，消除
//                "时好时坏"的波动根源——推理 token 计入输出预算且随内容深度波动）；
//                不支持（如无 effort 元数据的模型）返回 false，调用方不传该字段。
// 错误一律吞掉（返回兜底），由主 stream 自身的失败语义负责可见性。
async function polishModelCapabilities(llmSvc, provider, model) {
  const fallback = { maxTokens: undefined, lowEffort: false }
  if (!llmSvc || typeof llmSvc.resolveModelInfo !== 'function') return fallback
  try {
    const info = await llmSvc.resolveModelInfo(provider, model)
    const mt = info && info.defaultMaxTokens
    const efforts = info && info.reasoning && Array.isArray(info.reasoning.efforts) ? info.reasoning.efforts : []
    return {
      maxTokens: Number.isSafeInteger(mt) && mt > 0 ? mt : undefined,
      lowEffort: efforts.some((e) => e && e.id === 'low'),
    }
  } catch (e) {
    return fallback
  }
}

// 后处理同源样例解析（§2.4.1 规则 4 / §5.2 第 3 条）：
//   ① 生成阶段任务级缓存键命中 → 复用同 key（同档、同语言、同护栏；一次任务内不换）；
//   ② 未命中 → 固定档 + 草稿语言重解析（返回 reused:false，调用方回写缓存使任务内稳定）；
//   ③ 自动档 / 语言不明 → 无样例（§2.4.1 规则 1）。
function resolvePolishExample(profile, cachedKey, draftText) {
  if (cachedKey) {
    const m = /^(t[1-4]):(zh|en)$/.exec(String(cachedKey))
    if (m) {
      const ex = resolveStyleExample(m[1], m[2])
      if (ex) return { key: ex.key, text: ex.text, reused: true }
    }
  }
  if (!profile || profile.styleTier === 'auto' || STYLE_TIERS.indexOf(profile.styleTier) < 0) return null
  const lang = detectOutputLanguage(String(draftText == null ? '' : draftText))
  if (!lang) return null
  const ex = resolveStyleExample(profile.styleTier, lang)
  if (!ex) return null
  return { key: ex.key, text: ex.text, reused: false }
}

// 润色模型路由（§5.2 第 6 条；开发期核实后取最稳的一条）：
//   ① 会话最近一次请求的调用配置（requestHeader().config——与主生成同模型，最稳）；
//   ② agentDefaultModel.currentSelection()；两者不可用返回 undefined（调用方报错）。
function pickPolishRoute(headerConfig, defaultSelection) {
  if (headerConfig && typeof headerConfig.provider === 'string' && headerConfig.provider &&
      typeof headerConfig.model === 'string' && headerConfig.model) {
    return { provider: headerConfig.provider, model: headerConfig.model }
  }
  if (defaultSelection && typeof defaultSelection.provider === 'string' && defaultSelection.provider &&
      typeof defaultSelection.model === 'string' && defaultSelection.model) {
    return { provider: defaultSelection.provider, model: defaultSelection.model }
  }
  return undefined
}

// 后处理流程指令（§5.2 第 2 条：开关打开时经 whale-polish section 注入；
// 开关关闭时返回 '' → 空段落被渲染管线丢弃，零贡献）
const POLISH_FLOW = [
  '【后处理：去 AI 味润色（快捷条可关）】',
  '- 交付给读者的成稿正文，在最终输出前调用一次 whale_polish；拿到结果后，把 polished 字段内容原样输出，不要自行二次改写，也不要复述或讨论改动清单。',
  '- 豁免：约 50 字以内的短回复，以及代码、数据、表格、JSON、命令等非叙述性内容，直接输出，不调用 whale_polish。',
  '- 一次成稿只调用一次；不要拿上一次的润色结果再次调用。',
  '- 润色只做表达层微调，不得借润色篡改事实、数据、引用、结论与结构——那由严谨档把关。',
].join('\n')

function renderPolishFlow(profile) {
  if (profile && profile.pluginEnabled === false) return ''
  return profile && profile.polishEnabled === false ? '' : POLISH_FLOW
}

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

export const name = 'whale-writing'
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
// ───────────────────── 插件声明 ─────────────────────

    const fs = ctx.fs
    const systemPrompt = ctx.systemPrompt
    const agents = ctx.get('agents')

    // ── 状态中心（§7）：sessionId → { cwd, profile, version, found } ──
    // Fiber 级读缓存：插件 stop/update 时随之销毁；唯一权威源是磁盘。
    const profiles = new Map()
    // sessionId → inflight 读盘 Promise（懒读去重）
    const inflight = new Map()
    // sessionId → 最近一次被领取的用户请求文本 / 递增序号（语言检测与任务级 key 缓存依据）
    const requestText = new Map()
    const requestSeq = new Map()
    // sessionId → 任务级样例键缓存（§2.4.1 规则 4：生成阶段与 M4 whale_polish 后处理共用）
    const exampleKeys = new Map()

    // ── M3 状态（§7：均为 Fiber 级读缓存，权威源为磁盘） ──
    // sessionId → { cwd, raw, version, exists }（.mem/config.md 全文缓存 + mtime 版本）
    const memCache = new Map()
    const memInflight = new Map()
    // sessionId → 守卫开关（内存态；§4.3 第 5 条"临时放行"，默认 true=守卫启用）
    const guardStates = new Map()
    // sessionId → 增量归档兜底提醒（agent/turn-stopping 置位，下次组装消费后清除）
    const archiveHints = new Map()

    // 会话 → cwd：优先 agent 实时状态；agent 不存在时返回 undefined
    function resolveCwd(sessionId) {
      const agent = agents && sessionId ? agents.get(sessionId) : undefined
      return agent ? cwdOfAgent(agent) : undefined
    }

    // 沙箱策略（DSH 0.2.x）：ctx.fs 在 0.2.x 是 SandboxedFileSystem，writeText 的第 5 参是
    // per-call SandboxExecutionPolicy；不传时它回落 ctx.sandboxPolicy.resolve()（无会话）——
    // 部署默认 workspace-write + 进程 cwd 当工作区根，于是会话工作区里的 .mem/*.md 被判越界，
    // 抛 FS_SANDBOX_DENIED（实机表现：快捷条与 whale_set_profile 切档位全部失败）。
    // 正确姿势与 dsh-tool-fs 同口径：按调用会话解析（会话模式 + 会话 cwd 作为工作区根）。
    // 0.1.x 没有 sandboxPolicy 服务 → 返回 undefined，裸后端忽略该参数，行为与旧版一致。
    function sandboxPolicyOf(sessionId) {
      const policy = ctx.get('sandboxPolicy')
      if (!policy || typeof policy.resolve !== 'function') return undefined
      const agent = agents && sessionId ? agents.get(sessionId) : undefined
      const session = agent ? agent.session : undefined
      if (!session) {
        throw new Error('whale-writing: 无法解析会话沙箱策略（sessionId=' + sessionId + '）')
      }
      try {
        return policy.resolve({ session })
      } catch (e) {
        console.error('whale-writing: sandbox policy resolve failed:', e)
        return undefined
      }
    }

    // 沙箱感知写盘：策略必须来自调用会话，否则 0.2.x 的沙箱后端会按部署默认策略拒写。
    function writeTextFor(sessionId, target, content) {
      return fs.writeText(target, content, undefined, undefined, sandboxPolicyOf(sessionId))
    }

    async function readProfileFromDisk(cwd) {
      const target = await fs.resolve('.mem/config.md', { cwd })
      const info = await fs.stat(target)
      if (!info) return { found: false, profile: defaultProfile(), version: null }
      const text = await fs.readText(target)
      const parsed = parseFrontmatter(text)
      const profile = parsed ? profileFromValues(parsed.values) : defaultProfile()
      return { found: true, profile, version: info.version }
    }

    async function loadAndCache(sessionId, cwd) {
      try {
        const r = await readProfileFromDisk(cwd)
        const entry = { cwd, profile: r.profile, version: r.version, found: r.found }
        profiles.set(sessionId, entry)
        return entry
      } catch (e) {
        console.error('whale profile load failed:', e)
        const entry = { cwd, profile: defaultProfile(), version: null, found: false }
        profiles.set(sessionId, entry)
        return entry
      }
    }

    // 懒读兜底（§7）：命中缓存先 stat 比对 version（mtime），变了才重读；
    // 未命中读盘并写缓存；inflight 去重。
    function ensureProfile(sessionId, cwd, force) {
      if (inflight.has(sessionId)) return inflight.get(sessionId)
      const cached = profiles.get(sessionId)
      const job = (async () => {
        if (force || !cached || cached.cwd !== cwd) return loadAndCache(sessionId, cwd)
        try {
          const target = await fs.resolve('.mem/config.md', { cwd })
          const info = await fs.stat(target)
          const version = info ? info.version : null
          if (version === cached.version && !!info === cached.found) return cached
        } catch (e) {
          return cached
        }
        return loadAndCache(sessionId, cwd)
      })().finally(() => {
        inflight.delete(sessionId)
      })
      inflight.set(sessionId, job)
      return job
    }

    // 写盘（§7：frontmatter 写盘只由插件 Host 代码完成）：
    // 文件不存在 → 生成初版 config.md；存在 → 只改 frontmatter 键。
    async function persistProfile(sessionId, cwd, profile) {
      const target = await fs.resolve('.mem/config.md', { cwd })
      const info = await fs.stat(target)
      let content
      let created
      if (!info) {
        content = renderInitialConfig(profile)
        created = true
      } else {
        const text = await fs.readText(target)
        const next = writeFrontmatter(text, profile)
        if (next == null) return { written: false, created: false }
        content = next
        created = false
      }
      const outcome = await writeTextFor(sessionId, target, content)
      const entry = { cwd, profile, version: outcome.version, found: true }
      profiles.set(sessionId, entry)
      // 内容变化使 mem 缓存失效（下一访问重读；同 §7 stat 失效语义）
      const mc = memCache.get(sessionId)
      if (mc) mc.version = null
      return { written: true, created }
    }

    // ── M3：.mem/config.md 懒读缓存（与 ensureProfile 同构） ──
    async function readMemFromDisk(cwd) {
      const target = await fs.resolve('.mem/config.md', { cwd })
      const info = await fs.stat(target)
      if (!info) return { raw: '', exists: false, version: null }
      const raw = await fs.readText(target)
      return { raw, exists: true, version: info.version }
    }

    // 旧版 config.md（含待确认区）自动迁移（v0.7：全自动记忆）：
    // 在懒读加载路径内完成——读盘 → 确定性上移 [术语]/[资产] → 剥离待确认区 → 立即写盘；
    // 迁移结果直接进缓存，同步注入入口永远看不到旧结构。
    async function loadMemAndCache(sessionId, cwd) {
      try {
        const r = await readMemFromDisk(cwd)
        let raw = r.raw
        let version = r.version
        if (r.exists && hasPendingSection(raw)) {
          const mig = migrateLegacyMem(raw)
          if (mig.migrated) {
            raw = mig.text
            const target = await fs.resolve('.mem/config.md', { cwd })
            const outcome = await writeTextFor(sessionId, target, raw)
            version = outcome.version
            console.log('whale-writing: migrated legacy config.md -> ' +
              JSON.stringify(mig.stats) + ' (termsMoved/assetsMoved/dropped)')
          }
        }
        const entry = { cwd, raw, exists: r.exists, version }
        memCache.set(sessionId, entry)
        return entry
      } catch (e) {
        console.error('whale mem load failed:', e)
        const entry = { cwd, raw: '', exists: false, version: null }
        memCache.set(sessionId, entry)
        return entry
      }
    }

    function ensureMem(sessionId, cwd) {
      if (memInflight.has(sessionId)) return memInflight.get(sessionId)
      const cached = memCache.get(sessionId)
      const job = (async () => {
        if (!cached || cached.cwd !== cwd || cached.version === null) return loadMemAndCache(sessionId, cwd)
        try {
          const target = await fs.resolve('.mem/config.md', { cwd })
          const info = await fs.stat(target)
          const version = info ? info.version : null
          if (version === cached.version && !!info === cached.exists) return cached
        } catch (e) {
          return cached
        }
        return loadMemAndCache(sessionId, cwd)
      })().finally(() => {
        memInflight.delete(sessionId)
      })
      memInflight.set(sessionId, job)
      return job
    }

    // 直接用新内容覆盖 .mem/config.md（仅插件 Host 代码调用；写后校正缓存）
    async function persistMemRaw(sessionId, cwd, content) {
      const target = await fs.resolve('.mem/config.md', { cwd })
      const outcome = await writeTextFor(sessionId, target, content)
      const entry = { cwd, raw: content, exists: true, version: outcome.version }
      memCache.set(sessionId, entry)
      return entry
    }

    // 全自动记忆维护（v0.7）：读缓存 → 术语表超 30 条则拆出 glossary.md 并回写 config。
    // 记忆开关关闭时直接跳过；由 turn-stopping（fire-and-forget）与 mem/status（await）触发。
    async function autoMemMaintenance(sessionId, cwd) {
      try {
        const pEntry = await ensureProfile(sessionId, cwd, false)
        if (pEntry.profile.pluginEnabled === false) return { ok: false, reason: 'plugin off' }
        if (pEntry.profile.memEnabled === false) return { ok: false, reason: 'mem off' }
        const mc = await ensureMem(sessionId, cwd)
        if (!mc.exists) return { ok: true, split: null }
        const splitRes = maybeSplitGlossary(mc.raw)
        if (!splitRes.split) return { ok: true, split: null }
        const gTarget = await fs.resolve('.mem/glossary.md', { cwd })
        await writeTextFor(sessionId, gTarget, splitRes.split.glossaryText)
        await persistMemRaw(sessionId, cwd, splitRes.text)
        return { ok: true, split: { count: splitRes.split.count, file: 'glossary.md' } }
      } catch (e) {
        console.error('whale mem maintenance failed:', e)
        return { ok: false, reason: String((e && e.message) || e) }
      }
    }

    // ── M2：一次组装的本插件内容（同步；text 函数专用） ──
    // 任务级样例键缓存（§2.4.1 规则 4）：档位或请求变化才重新解析，否则沿用，
    // 保证一次写作任务内 key 稳定（M4 whale_polish 复用同一缓存）。
    function injectedSections(sessionId, entry) {
      const profile = entry.profile
      const seq = requestSeq.get(sessionId) || 0
      const taskText = requestText.get(sessionId) || ''
      const rendered = renderWhaleSections(profile, taskText)
      if (rendered.styleKey) {
        const cached = exampleKeys.get(sessionId)
        if (!cached || cached.tier !== profile.styleTier || cached.seq !== seq) {
          exampleKeys.set(sessionId, { key: rendered.styleKey, tier: profile.styleTier, seq })
        }
      } else {
        exampleKeys.delete(sessionId)
      }
      return rendered
    }

    // ── M2：systemPrompt 双 section（§2.2/§3.3） ──
    // 同步约束：text 函数不能 await，只读内存缓存；未命中返回 ''（本步不注入）
    // 并 fire-and-forget 触发懒读，自下一 step 起生效（§2.2/§7）。
    function sectionText(kind, context) {
      const agent = context && context.agent
      if (!agent) return ''
      const sessionId = agent.id
      const entry = profiles.get(sessionId)
      if (!entry) {
        const cwd = cwdOfAgent(agent)
        if (cwd) ensureProfile(sessionId, cwd, false)
        return ''
      }
      const rendered = injectedSections(sessionId, entry)
      return kind === 'rigor' ? rendered.rigor : rendered.style
    }

    // ── M3：systemPrompt.context 记忆注入（§4.4；同样同步、缓存未命中返回 ''） ──
    function memContextText(context) {
      const agent = context && context.agent
      if (!agent) return ''
      const sessionId = agent.id
      const pEntry = profiles.get(sessionId)
      // 总开关关闭：整插件零贡献——不注入项目记忆，也不触发记忆懒读
      if (pEntry && pEntry.profile.pluginEnabled === false) return ''
      const mc = memCache.get(sessionId)
      if (!mc) {
        const cwd = cwdOfAgent(agent)
        if (cwd) ensureMem(sessionId, cwd)
        return ''
      }
      if (pEntry && pEntry.profile.memEnabled === false) return ''
      const profile = pEntry ? pEntry.profile : defaultProfile()
      const mem = memFromText(mc.raw, mc.exists)
      const hint = archiveHints.get(sessionId) === true
      // 消费提醒：本步组装后不再重复（每 turn 收尾兜底只提示一次）
      if (hint) archiveHints.delete(sessionId)
      const rendered = renderMemContext(profile, mem, { hint })
      return rendered.text
    }

    // interpolate:false —— DSH 0.2.x 起 section/context 默认按 {{变量}} 插值，未注册的变量会在
    // 组装期抛错；本插件的文本全部由代码生成（含用户 .mem 内容），必须原样保留，禁止插值。
    const rigorDisposer = systemPrompt.section({
      name: 'whale-rigor',
      order: 50,
      interpolate: false,
      text: (context) => sectionText('rigor', context),
    })
    // ctx.effect(fn)：fn 立即执行，其返回的 disposer 在插件卸载时调用
    ctx.effect(() => rigorDisposer)

    const styleDisposer = systemPrompt.section({
      name: 'whale-style',
      order: 60,
      interpolate: false,
      text: (context) => sectionText('style', context),
    })
    ctx.effect(() => styleDisposer)

    // ── M4：后处理流程指令 section（§5.2 第 2 条；order 70，位于风格之后、工具指导之前） ──
    // 同步约束同 section：缓存未命中返回 ''；开关关闭（polishEnabled=false）时同样返回 ''。
    function polishFlowText(context) {
      const agent = context && context.agent
      if (!agent) return ''
      const entry = profiles.get(agent.id)
      if (!entry) {
        const cwd = cwdOfAgent(agent)
        if (cwd) ensureProfile(agent.id, cwd, false)
        return ''
      }
      return renderPolishFlow(entry.profile)
    }

    const polishFlowDisposer = systemPrompt.section({
      name: 'whale-polish',
      order: 70,
      interpolate: false,
      text: (context) => polishFlowText(context),
    })
    ctx.effect(() => polishFlowDisposer)

    // ── M3：记忆 context（§4.4；order 60，位于风格 section 之后、工具指导级 context 附近） ──
    // 生命周期：每次组装求值；文本为空时零贡献（"Empty text contributes nothing"）。
    const memContextDisposer = systemPrompt.context({
      name: MEM_CONTEXT_NAME,
      order: 40,
      interpolate: false,
      text: (context) => memContextText(context),
    })
    ctx.effect(() => memContextDisposer)

    // ── M2：动态工具 whale_set_profile（§2.5/§3.4：用户确认后由模型调用写盘） ──
    const setProfileTool = defineToolWw({
      name: 'whale_set_profile',
      description: '写入并持久化本会话的写作档位（只改 .mem/config.md 的 frontmatter 档位字段，不触碰其他区域）。' +
        '自动挡下由你（LLM）判断后直接调用，不要向用户提问确认；用户手动指定档位时按用户指定写入。' +
        'styleTier 取值：t1|t2|t3|t4|auto；rigorTier 取值：l1|l2|l3|l4|l5|auto。至少提供一个参数，未提供的字段保持原值。',
      parameters: {
        styleTier: {
          type: 'string',
          enum: ['t1', 't2', 't3', 't4', 'auto'],
          description: '风格档位：t1 鲸定谔 / t2 海明鲸 / t3 奥格鲸 / t4 鲸尔德 / auto 自动挡。留空则保持原值。',
        },
        rigorTier: {
          type: 'string',
          enum: ['l1', 'l2', 'l3', 'l4', 'l5', 'auto'],
          description: '严谨档位：l1 史官 / l2 辩护律师 / l3 科普作家 / l4 说书人 / l5 小说家 / auto 自动挡。留空则保持原值。',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const agent = exec && exec.agent
        if (!agent) throw new Error('whale_set_profile 需要 Agent 会话上下文（exec.agent 缺失）')
        const sessionId = agent.id
        const cwd = cwdOfAgent(agent)
        if (!cwd) throw new Error('无法确定会话工作目录')
        const entry = await ensureProfile(sessionId, cwd, false)
        // 总开关关闭：拒绝模型写档（快捷条仍可经 profile/set 重新启用）
        if (entry.profile.pluginEnabled === false) {
          return {
            ok: false,
            disabled: true,
            profile: entry.profile,
            message: '插件总开关已关闭：快捷条只剩 🐳 按钮，点击它重新启用后再切换档位。',
          }
        }
        const next = mergePatch(entry.profile, args || {})
        const result = await persistProfile(sessionId, cwd, next)
        return { ok: result.written, created: result.created, profile: next }
      },
    })
    ctx.effect(() => ctx.tools.register(setProfileTool))

    // ── M4：动态工具 whale_polish（§5.2 方案 A / §9：成稿去 AI 味润色） ──
    // 与生成阶段同源：样例键复用 exampleKeys 任务级缓存（§2.4.1 规则 4），一次任务内不换 key；
    // 防串档：从 exec.agent / agents.currentInitiator() 解析会话并懒读 .mem（§5.2 第 5 条 / §7）；
    // 防递归：llm.stream 不传 tools，系统提示词显式禁止工具调用（§5.2 第 6 条，构造性排除）。
    const llmSvc = ctx.get('llm')
    const agentDefaultModelSvc = ctx.get('agentDefaultModel')

    async function executePolish(args, exec) {
      const text = args && typeof args.text === 'string' ? args.text : ''
      if (!text.trim()) return { polished: text, changes: ['输入为空，未做修改。'] }
      let agent = exec && exec.agent
      if (!agent && agents && typeof agents.currentInitiator === 'function') agent = agents.currentInitiator()
      if (!agent) throw new Error('whale_polish 需要 Agent 会话上下文（exec.agent 缺失且 currentInitiator 不可用）')
      const sessionId = agent.id
      const cwd = cwdOfAgent(agent)
      if (!cwd) throw new Error('无法确定会话工作目录')
      // 懒读兜底（§7）：Map 未命中读 .mem/config.md → 缓存
      const pEntry = await ensureProfile(sessionId, cwd, false)
      const profile = pEntry.profile
      // 总开关关闭：不发起任何 LLM 调用，直接回原稿
      if (profile.pluginEnabled === false) {
        return { polished: text, changes: ['插件总开关已关闭；文本未改动。'] }
      }
      // 开关（§6.1 后处理开/关）：关闭时不发起任何 LLM 调用
      if (profile.polishEnabled === false) {
        return { polished: text, changes: ['后处理开关已关闭；文本未改动。'] }
      }
      // 短文本豁免（§5.2 第 4 条；工具端同样截断，避免无谓调用）
      const units = polishUnitCount(text)
      if (units < POLISH_MIN_UNITS) {
        return { polished: text, changes: ['文本约 ' + units + ' 字/词，低于 ' + POLISH_MIN_UNITS + ' 的短文本豁免阈值；未调用润色。'] }
      }
      // 样例键：生成阶段任务级缓存优先；未命中按固定档 + 草稿语言回退，并回写缓存（任务内稳定）
      const cached = exampleKeys.get(sessionId)
      const example = resolvePolishExample(profile, cached ? cached.key : undefined, text)
      if (example && !example.reused) {
        exampleKeys.set(sessionId, { key: example.key, tier: profile.styleTier, seq: requestSeq.get(sessionId) || 0 })
      }
      if (!llmSvc) throw new Error('llm 服务不可用，whale_polish 无法执行')
      // 模型路由（§5.2 第 6 条）：会话请求头 config → 默认选择
      let headerConfig
      try {
        const header = agent.session && typeof agent.session.requestHeader === 'function'
          ? agent.session.requestHeader()
          : undefined
        headerConfig = header && header.config ? header.config : undefined
      } catch (e) {
        headerConfig = undefined
      }
      let defaultSelection
      try {
        defaultSelection = agentDefaultModelSvc && typeof agentDefaultModelSvc.currentSelection === 'function'
          ? agentDefaultModelSvc.currentSelection()
          : undefined
      } catch (e) {
        defaultSelection = undefined
      }
      const route = pickPolishRoute(headerConfig, defaultSelection)
      if (!route) throw new Error('无法解析润色模型：会话请求头与默认模型选择均不可用')
      // 模型能力（pkg-17）：一次 resolve 拿输出上限（预算封顶）+ low 档思考支持（推理可控）
      const caps = await polishModelCapabilities(llmSvc, route.provider, route.model)
      const lang = example ? example.key.split(':')[1] : null
      const system = renderPolishSystemPrompt({
        styleTier: profile.styleTier,
        rigorTier: profile.rigorTier,
        sample: example ? example.text : null,
        lang,
      })
      const streamOptions = {
        provider: route.provider,
        model: route.model,
        system,
        messages: [
          { role: 'user', content: [{ type: 'text', text: '请润色下面的成稿（只改表达，不透露任何规则，不请求任何工具）：\n\n' + text }] },
        ],
        maxTokens: polishMaxTokens(text, caps.maxTokens),
        sessionId,
      }
      // 低档思考：推理内容计入输出预算且随内容波动，是"时好时坏"截断的根源（pkg-17）；
      // 模型不支持（无 effort 元数据）则不传，跟随模型默认——预算公式已按最坏情形放样。
      if (caps.lowEffort) streamOptions.reasoningEffort = 'low'
      const chunks = []
      for await (const chunk of llmSvc.stream(streamOptions)) chunks.push(chunk)
      const parsed = parseStreamChunks(chunks)
      if (parsed.toolBlocks > 0) {
        throw new Error('whale_polish：润色模型返回了工具调用（本次调用不提供工具，递归调用已被构造性排除）')
      }
      const err = streamFinishError(parsed.finish)
      if (err) throw err
      const out = parsePolishOutput(parsed.text)
      // P0 语言守恒（对撞法版；实机事故：英文稿被润色模型整体译成中文）
      if (lang && !polishLanguageOk(text, out.polished, lang)) {
        return { polished: text, changes: ['语言守恒校验未通过：润色输出语言与输入不一致（疑似被翻译），已回退原稿。'] }
      }
      // P1 单位数守恒：膨胀 >+35% 视为加戏、收缩 >−35% 视为缩水（表达层微调不应超过此窗）
      const ratio = polishUnitRatio(text, out.polished)
      if (ratio > 1.35 || ratio < 0.65) {
        return { polished: text, changes: ['单位数守恒校验未通过：润色稿约为原文 ' +
          (ratio > 1.35 ? '1.' : '0.') + Math.round(ratio * 10) + ' 倍（加戏/缩水超过微调窗口），已回退原稿。'] }
      }
      return { polished: out.polished, changes: out.changes }
    }

    const polishTool = defineToolWw({
      name: 'whale_polish',
      description: '对成稿做“去 AI 味”微调润色（只改表达，不改写事实与结构；与当前写作档位联动）。' +
        '返回 { polished, changes }，请把 polished 原样输出给用户，不要复述 changes。' +
        '约 50 字以内的短文本与代码/表格/JSON 等非叙述内容不要调用。',
      parameters: {
        text: {
          type: 'string',
          description: '待润色的成稿正文（交付给读者的文本；不要传代码、JSON 或过短内容）',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        // 改动清单不在 Host 留痕：用户自查入口是 whale_polish 工具卡（数据在 ToolCallBlock 内）。
        return executePolish(args, exec)
      },
    })
    ctx.effect(() => ctx.tools.register(polishTool))

    // ── M3：tools/pre-execute 硬守卫（§4.3 第一层；waterfall 放行必须调用并返回 next()） ──
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!exec || (exec.name !== 'write' && exec.name !== 'edit')) return next()
      const agent = exec.agent
      const cwd = agent ? cwdOfAgent(agent) : undefined
      if (!cwd) return next() // 无法定位会话归属：不拦截（工具自身会校验路径）
      const sessionId = agent.id
      const args = exec.arguments || {}
      const filePath = typeof args.file_path === 'string' ? args.file_path : undefined
      if (!filePath || filePath === '') return next() // 无目标路径：交给工具自身报错
      let target
      let memRoot
      try {
        target = await fs.resolve(filePath, { cwd })
        memRoot = await fs.resolve('.mem', { cwd })
      } catch (e) {
        return next() // resolve 失败（如越界路径）：不越权决策
      }
      let inMem = false
      try {
        inMem = fs.contains ? fs.contains(memRoot, target) : pathInMem(memRoot, target)
      } catch (e) {
        inMem = pathInMem(memRoot, target)
      }
      if (!inMem) return next() // 不在 .mem/ 下：零开销放行
      // 开关：临时放行（mem/toggleGuard）或记忆功能关闭（mem_enabled）→ 放行
      const guardOn = guardStates.get(sessionId) !== false
      const pEntry = await ensureProfile(sessionId, cwd, false)
      // 总开关关闭：守卫整体放行（插件视为不存在）
      if (pEntry && pEntry.profile.pluginEnabled === false) return next()
      const memOn = !(pEntry && pEntry.profile.memEnabled === false)
      let info
      let text = ''
      try {
        info = await fs.stat(target)
        if (info) text = await fs.readText(target)
      } catch (e) {
        return next()
      }
      const decision = guardDecision({
        toolName: exec.name,
        args,
        inMem: true,
        guardEnabled: guardOn,
        memEnabled: memOn,
        fileExists: !!info,
        text,
      })
      if (decision.allow) return next()
      return { kind: 'deny', reason: decision.reason }
    })

    // ── M2：捕获用户请求（语言检测 / 任务级样例键缓存依据；§2.4.1 规则 2/4） ──
    ctx.on('agent/inbox/claimed', (payload) => {
      const agent = payload && payload.agent
      const message = payload && payload.message
      if (!agent || !message) return
      requestText.set(agent.id, messageText(message))
      requestSeq.set(agent.id, (requestSeq.get(agent.id) || 0) + 1)
    })

    // 会话销毁时清掉本会话的瞬时状态（防泄漏）
    ctx.on('agent/disposed', (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      profiles.delete(agent.id)
      inflight.delete(agent.id)
      requestText.delete(agent.id)
      requestSeq.delete(agent.id)
      exampleKeys.delete(agent.id)
      memCache.delete(agent.id)
      memInflight.delete(agent.id)
      guardStates.delete(agent.id)
      archiveHints.delete(agent.id)
    })

    // ── RPC（§7）：profile/get | profile/set ──
    harness.handle('profile/get', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      if (!sessionId) return { found: false, profile: defaultProfile() }
      const cwd = resolveCwd(sessionId)
      if (!cwd) return { found: false, profile: defaultProfile() }
      const entry = await ensureProfile(sessionId, cwd, false)
      return { found: entry.found, profile: entry.profile }
    })

    harness.handle('profile/set', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      if (!sessionId) return { ok: false, message: '缺少 sessionId' }
      const cwd = resolveCwd(sessionId)
      if (!cwd) return { ok: false, message: '无法确定会话工作目录' }
      const entry = await ensureProfile(sessionId, cwd, false)
      const next = mergePatch(entry.profile, args)
      const result = await persistProfile(sessionId, cwd, next)
      return {
        ok: result.written,
        created: result.created,
        profile: next,
      }
    })

    // ── M3：RPC mem/status（§7：记忆开关/守卫状态/区统计；顺带执行自动维护） ──
    harness.handle('mem/status', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      if (!sessionId) return { found: false }
      const cwd = resolveCwd(sessionId)
      if (!cwd) return { found: false }
      const pEntry = await ensureProfile(sessionId, cwd, false)
      const mc = await ensureMem(sessionId, cwd)
      // 顺带自动维护（超 30 条拆分 glossary.md；v0.7 无用户 merge 流程）——先维护再出统计
      await autoMemMaintenance(sessionId, cwd)
      const mc2 = await ensureMem(sessionId, cwd)
      const mem = memFromText(mc2.raw, mc2.exists)
      return {
        found: mc.exists,
        guardEnabled: guardStates.get(sessionId) !== false,
        memEnabled: !(pEntry.profile.memEnabled === false),
        glossaryCount: mem.glossaryRows.length,
        assetCount: mem.assets.filter((l) => l.trim() !== '').length,
        indexes: mem.indexes,
      }
    })

    // ── M3：RPC mem/toggleGuard（§4.3 第 5 条：一键锁定/解锁记忆写入；内存态） ──
    harness.handle('mem/toggleGuard', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      if (!sessionId) return { ok: false }
      const next = guardStates.get(sessionId) === false
      guardStates.set(sessionId, next)
      return { ok: true, guardEnabled: next }
    })

    // ── M3：增量归档兜底（§4.2 v0.7：turn-stopping 置位提醒 + 全自动维护） ──
    // serial 事件：置位归档轻提示（下次组装经 memContextText 消费一次）+ fire-and-forget
    // 触发自动维护（旧待确认迁移在懒读路径已做；此处负责 30 条拆分）。
    ctx.on('agent/turn-stopping', (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      const pEntry = profiles.get(agent.id)
      if (pEntry && (pEntry.profile.pluginEnabled === false || pEntry.profile.memEnabled === false)) return
      archiveHints.set(agent.id, true)
      const cwd = cwdOfAgent(agent)
      if (cwd) autoMemMaintenance(agent.id, cwd)
    })

    // ── 会话开始：预热缓存（§7：不是状态来源，只为消除首步空窗） ──
    // 事件名随 DSH 版本变化：0.2.x 用 agent/created（agent/session-start 已从事件表移除），
    // 0.1.x 用 agent/session-start；两个都挂，跨版本都能预热（未知事件只是不会触发）。
    const warmSessionCache = (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      const cwd = cwdOfAgent(agent)
      if (cwd) {
        ensureProfile(agent.id, cwd, false)
        ensureMem(agent.id, cwd)
      }
    }
    ctx.on('agent/created', warmSessionCache)
    ctx.on('agent/session-start', warmSessionCache)

    // ── 注册冒烟自检：真实 assemble 一次，确认 section 与 context 落入全局组装 ──
    systemPrompt.assemble({}).then((assembly) => {
      const names = (assembly && assembly.sections || []).map((s) => s.name)
      const ctxNames = (assembly && assembly.contexts || []).map((c) => c.name)
      const ok = names.indexOf('whale-rigor') >= 0 && names.indexOf('whale-style') >= 0 &&
        names.indexOf('whale-polish') >= 0 && ctxNames.indexOf(MEM_CONTEXT_NAME) >= 0
      console.log('whale-writing M5 assemble check:', ok
        ? 'OK (sections in assembly: ' + names.join(', ') + '; contexts: ' + ctxNames.join(', ') + ')'
        : 'MISSING (sections: ' + names.join(', ') + '; contexts: ' + ctxNames.join(', ') + ')')
    }).catch((e) => {
      console.error('whale-writing M5 assemble check failed:', e)
    })

    console.log('whale-writing M5 loaded: sections (whale-rigor@50, whale-style@60, whale-polish@70) + mem context (' +
      MEM_CONTEXT_NAME + '@40) + whale_set_profile/whale_polish tools + pre-execute guard + profile/mem RPC')
}
