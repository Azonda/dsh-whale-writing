// dsh-whale-writing —— BROWSER 半侧（M6 固化：由 .dev/whale/client.js 移植；lazy-CJS 格式照 create-dsh-plugin panel 模板）
//
// 加载机制：package.json 声明 `dsh.client`（inject + platform: web）+ `exports["./client"]`；
// DSH 模块加载器（dsh-client-modules）把它作为模块表条目，经 /plugins/dsh-whale-writing/client.js 提供给页面。
// `require(...)` 解析官方包（react 由 shell/runtime 依赖图提供）；不要写裸 ESM import。
//
// 与动态插件形态的差异（M6 实现确定，见 .dev/whale/README.md）：
//   1. harness（动态插件专属 Builtin）不可用：host.call → fetch POST /whale-writing/<method>（Host 侧 webServer 路由 shim）；
//   2. styles Builtin 不可用：CSS 改为官方范式——factory 顶部 document head 注入（data-plugin-css 防重）；
//   3. LOCALE_NS 恢复固定命名空间 'whale-writing'（动态期 -v3 版本化 hack 是为绕旧 bundle 残留，包形态无此问题）；
//   4. 插件导出形态：factory 返回 { inject: ['slots', 'locale'], apply(ctx) }（官方面板模板范式）。
window.__ModuleLoader__.load({
  id: 'dsh-whale-writing',
  factory: (require) => {
    const React = require('react')

    const LOCALE_NS = 'whale-writing'

    const DICT_ZH = {
      'dock.label': '超级写作',
      'pill': '🐳 老人与大肥鱼',
      'style': '风格',
      'rigor': '严谨',
      'memory': '记忆',
      'polish': '后处理',
      'collapse': '收起',
      'expand': '展开',
      'loading': '…',
      'tier.auto': '自动',
      'style.t1': 'T1 鲸定谔',
      'style.t2': 'T2 海明鲸',
      'style.t3': 'T3 奥格鲸',
      'style.t4': 'T4 鲸尔德',
      'rigor.l1': 'L1 史官',
      'rigor.l2': 'L2 辩护律师',
      'rigor.l3': 'L3 科普作家',
      'rigor.l4': 'L4 说书人',
      'rigor.l5': 'L5 小说家',
      'on': '开',
      'off': '关',
      // M5：工具卡改动清单（快捷条润色徽标 v1.3 已移除）
      'tool.polish.title': '🐳 去 AI 味润色',
      'tool.polish.running': '润色进行中…',
      'tool.polish.error': '润色失败（结果已按原稿处理）',
      'tool.polish.changes': '改动清单',
      'tool.polish.preview': '润色后预览',
      'tool.polish.expand': '展开',
      'tool.polish.collapse': '收起',
      'tool.polish.unchanged': '未变更（原因见清单）',
      'tool.polish.unit': ' 单位',
    }
    const DICT_EN = {
      'dock.label': 'Whale Writing',
      'pill': '🐳 Whale Writing',
      'style': 'Style',
      'rigor': 'Rigor',
      'memory': 'Memory',
      'polish': 'Polish',
      'collapse': 'Collapse',
      'expand': 'Expand',
      'loading': '…',
      'tier.auto': 'Auto',
      'style.t1': 'T1 Whaledinger',
      'style.t2': 'T2 Hemingwhale',
      'style.t3': 'T3 Ogilwhale',
      'style.t4': 'T4 Whalede',
      'rigor.l1': 'L1 Historian',
      'rigor.l2': 'L2 Advocate',
      'rigor.l3': 'L3 Pop-Sci Writer',
      'rigor.l4': 'L4 Bard',
      'rigor.l5': 'L5 Novelist',
      'on': 'On',
      'off': 'Off',
      // M5：工具卡改动清单（快捷条润色徽标 v1.3 已移除）
      'tool.polish.title': '🐳 Whale Polish',
      'tool.polish.running': 'Polishing…',
      'tool.polish.error': 'Polish failed (original kept)',
      'tool.polish.changes': 'Changes',
      'tool.polish.preview': 'Polished preview',
      'tool.polish.expand': 'More',
      'tool.polish.collapse': 'Less',
      'tool.polish.unchanged': 'Unchanged (see list)',
      'tool.polish.unit': ' units',
    }

    const STYLE_ORDER = ['t1', 't2', 't3', 't4', 'auto']
    const RIGOR_ORDER = ['l1', 'l2', 'l3', 'l4', 'l5', 'auto']

    // ── 解析纯函数（与 .dev/whale/client.js 同源；工具卡数据解析，降级兜底不吞数据） ──
    function polishUnitCountWw(text) {
      const s = String(text == null ? '' : text)
      const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
      const words = (s.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length
      return cjk + words
    }

    function parsePolishArgs(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return null
      try {
        const obj = JSON.parse(raw)
        return obj && typeof obj.text === 'string' ? { text: obj.text } : null
      } catch (e) {
        return null
      }
    }

    function contentTextOf(content) {
      if (!Array.isArray(content)) return ''
      let out = ''
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') out += block.text
      }
      return out
    }

    function parsePolishJson(text) {
      const raw = String(text == null ? '' : text)
      let body = raw.trim()
      const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (fence) body = fence[1].trim()
      const start = body.indexOf('{')
      const end = body.lastIndexOf('}')
      if (start < 0 || end <= start) return null
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch (e) {
        return null
      }
    }

    function summarizePolishBlock(block) {
      if (!block || block.kind !== 'tool-result') return { state: 'running' }
      if (block.isError) {
        return {
          state: 'error',
          errorText: block.error ? (block.error.name + ': ' + block.error.code) : 'unknown error',
        }
      }
      const result = parsePolishJson(contentTextOf(block.content))
      const call = block.call || null
      const args = call && call.argsRaw ? parsePolishArgs(call.argsRaw) : null
      if (!result || typeof result.polished !== 'string') {
        return { state: 'raw', raw: contentTextOf(block.content).slice(0, 400), text: args ? args.text : '' }
      }
      const changes = Array.isArray(result.changes) ? result.changes : []
      const text = args ? args.text : ''
      return {
        state: 'ok',
        text,
        polished: result.polished,
        changes,
        unchanged: text !== '' && result.polished === text,
        unitsIn: polishUnitCountWw(text),
        unitsOut: polishUnitCountWw(result.polished),
      }
    }

    const collapsedBySession = new Map()
    let localeRegistered = false

    // ── CSS（官方范式：factory 顶部注入 + data-plugin-css 防重；styles Builtin 仅动态插件有） ──
    const WW_CSS_TAG = 'dsh-whale-writing'
    const CSS = [
      '.ww-row{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,12px) - var(--dsh-composer-dock-inset,12px));max-width:calc(var(--dsh-composer-card-max-width,720px) - var(--dsh-composer-dock-inset,12px) - var(--dsh-composer-dock-inset,12px));margin:0 auto 6px;padding:0 var(--dsh-composer-dock-inset,12px);flex:none;}',
      '.ww-dock{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:fit-content;max-width:100%;font-size:13px;color:var(--dsw-alias-label-primary,inherit);}',
      '.ww-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;',
      'border:1px solid var(--dsw-alias-border-l1,#8884);background:var(--dsw-alias-bg-layer-2,transparent);',
      'color:var(--dsw-alias-label-primary,inherit);line-height:1.6;white-space:nowrap;',
      'transition:border-color .12s ease,background-color .12s ease,color .12s ease;}',
      '.ww-chip:hover{border-color:var(--dsw-alias-border-l2,#aaa6);background:var(--dsw-alias-bg-base,transparent);}',
      '.ww-chip select{border:none;background:transparent;color:inherit;font:inherit;outline:none;cursor:pointer;max-width:150px;padding:0;}',
      '.ww-chip select option{color:#333;}',
      '.ww-chip select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#5b9dff));outline-offset:2px;border-radius:4px;}',
      '.ww-toggle{cursor:pointer;user-select:none;}',
      '.ww-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#5b9dff));outline-offset:2px;}',
      '.ww-toggle.ww-off{color:var(--dsw-alias-label-secondary,inherit);border-style:dashed;opacity:.75;}',
      '.ww-brand{width:26px;height:26px;padding:0;justify-content:center;gap:0;font-size:14px;',
      'background:var(--dsw-alias-bg-layer-2,transparent);}',
      '.ww-mini{padding:3px 7px;color:var(--dsw-alias-label-secondary,inherit);}',
      '.ww-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border-radius:999px;',
      'border:1px solid var(--dsw-alias-border-l2,#aaa6);background:var(--dsw-alias-bg-layer-2,transparent);',
      'color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.6;cursor:pointer;user-select:none;',
      'transition:border-color .12s ease,background-color .12s ease;}',
      '.ww-pill:hover{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#5b9dff));}',
      '.ww-pill:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#5b9dff));outline-offset:2px;}',
      '.ww-loading{color:var(--dsw-alias-label-secondary,inherit);border-style:dashed;animation:ww-blink 1s ease-in-out infinite;}',
      '@keyframes ww-blink{0%,100%{opacity:.45;}50%{opacity:.9;}}',
      '.ww-tcard{border:1px solid var(--dsw-alias-border-l1,#8884);border-radius:10px;padding:10px 14px;margin:2px 0;',
      'font-size:13px;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-2,transparent);max-width:660px;}',
      '.ww-tcard-head{font-weight:600;margin-bottom:6px;}',
      '.ww-tcard-body{white-space:pre-wrap;word-break:break-word;line-height:1.6;}',
      '.ww-tcard-dim{color:var(--dsw-alias-label-secondary,inherit);}',
      '.ww-tcard-pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;margin:0;font-size:12.5px;}',
      '.ww-tcard-list{margin:4px 0 0;padding-left:18px;}',
      '.ww-tcard-list li{margin:2px 0;}',
      '.ww-tcard-fold{display:inline-flex;margin-top:6px;padding:2px 10px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l1,#8884);cursor:pointer;color:var(--dsw-alias-label-secondary,inherit);}',
      '.ww-tcard-fold:hover{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#5b9dff));}',
    ].join('')
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + WW_CSS_TAG + '"]') === null) {
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', WW_CSS_TAG)
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ── 包私有 RPC 通道（动态版 host.call → 包形态 fetch；Host 侧 webServer shim 见 src/index.ts） ──
    async function call(method, args) {
      const res = await fetch('/whale-writing/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args || null),
      })
      let data = null
      if (res.status !== 204) {
        const text = await res.text()
        try { data = text ? JSON.parse(text) : null } catch (e) { data = null }
      }
      if (!res.ok) {
        throw new Error((data && data.message) || 'whale-writing RPC failed: ' + method)
      }
      return data
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale')
        const slots = ctx.get('slots')
        if (!slots) return

        let localeDisposer = undefined
        if (locale) {
          if (!localeRegistered) {
            try {
              localeDisposer = locale.register(LOCALE_NS, { zh: DICT_ZH, en: DICT_EN })
            } catch (e) {
              // 已注册（重复挂载）：复用既有字典
            }
            localeRegistered = true
          }
        }
        const translate = locale ? locale.bind(LOCALE_NS) : (key) => key

        ctx.effect(() => () => {
          if (localeDisposer) localeDisposer()
          collapsedBySession.clear()
        })

        function WhaleDock(props) {
          const sessionId = props.sessionId
          const [profile, setProfile] = React.useState(null)
          const [collapsed, setCollapsed] = React.useState(() => collapsedBySession.get(sessionId) === true)
          const [, setTick] = React.useState(0)

          React.useEffect(() => {
            if (!locale) return undefined
            return locale.subscribe(() => setTick((n) => n + 1))
          }, [])

          React.useEffect(() => {
            let alive = true
            setProfile(null)
            call('profile/get', { sessionId }).then((r) => {
              if (alive && r && r.profile) setProfile(r.profile)
            }).catch(() => {})
            return () => { alive = false }
          }, [sessionId])

          function setCollapsedForSession(next) {
            collapsedBySession.set(sessionId, next)
            setCollapsed(next)
          }

          function patch(p) {
            setProfile((prev) => Object.assign({}, prev || {}, p))
            call('profile/set', Object.assign({ sessionId }, p)).then((r) => {
              if (r && r.profile) setProfile(r.profile)
            }).catch(() => {
              call('profile/get', { sessionId }).then((r) => {
                if (r && r.profile) setProfile(r.profile)
              }).catch(() => {})
            })
          }

          if (!profile) {
            return React.createElement('div', { className: 'ww-row' },
              React.createElement('div', { className: 'ww-dock', 'aria-busy': 'true' },
                React.createElement('span', { className: 'ww-chip ww-loading' }, translate('loading'))))
          }

          if (collapsed) {
            return React.createElement('div', { className: 'ww-row' },
              React.createElement('span', {
                className: 'ww-pill',
                role: 'button',
                title: translate('expand'),
                onClick: () => setCollapsedForSession(false),
              }, translate('pill')))
          }

          const t = translate
          const children = []
          children.push(React.createElement('span', { key: 'brand', className: 'ww-chip ww-brand' }, '🐳'))

          const styleOptions = STYLE_ORDER.map((tier) =>
            React.createElement('option', { key: tier, value: tier },
              tier === 'auto' ? t('tier.auto') : t('style.' + tier)))
          children.push(React.createElement('span', { key: 'style', className: 'ww-chip' },
            t('style') + ' ',
            React.createElement('select', {
              'aria-label': t('style'),
              value: profile.styleTier,
              onChange: (e) => patch({ styleTier: e.target.value }),
            }, styleOptions)))

          const rigorOptions = RIGOR_ORDER.map((tier) =>
            React.createElement('option', { key: tier, value: tier },
              tier === 'auto' ? t('tier.auto') : t('rigor.' + tier)))
          children.push(React.createElement('span', { key: 'rigor', className: 'ww-chip' },
            t('rigor') + ' ',
            React.createElement('select', {
              'aria-label': t('rigor'),
              value: profile.rigorTier,
              onChange: (e) => patch({ rigorTier: e.target.value }),
            }, rigorOptions)))

          const memOn = profile.memEnabled !== false
          children.push(React.createElement('span', {
            key: 'memory',
            className: 'ww-chip ww-toggle' + (memOn ? '' : ' ww-off'),
            role: 'switch',
            'aria-checked': memOn ? 'true' : 'false',
            tabIndex: 0,
            onClick: () => patch({ memEnabled: !memOn }),
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); patch({ memEnabled: !memOn }) }
            },
          }, t('memory') + ' ' + (memOn ? t('on') : t('off'))))

          const polishOn = profile.polishEnabled !== false
          children.push(React.createElement('span', {
            key: 'polish',
            className: 'ww-chip ww-toggle' + (polishOn ? '' : ' ww-off'),
            role: 'switch',
            'aria-checked': polishOn ? 'true' : 'false',
            tabIndex: 0,
            onClick: () => patch({ polishEnabled: !polishOn }),
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); patch({ polishEnabled: !polishOn }) }
            },
          }, t('polish') + ' ' + (polishOn ? t('on') : t('off'))))

          // 快捷条润色徽标（✍ N）v1.3 已移除：全自动后处理不打扰，改动清单自查见 whale_polish 工具卡

          children.push(React.createElement('span', {
            key: 'collapse',
            className: 'ww-chip ww-mini ww-toggle',
            role: 'button',
            title: t('collapse'),
            tabIndex: 0,
            onClick: () => setCollapsedForSession(true),
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsedForSession(true) }
            },
          }, '▸'))

          return React.createElement('div', { className: 'ww-row' },
            React.createElement('div', { className: 'ww-dock', 'data-session-id': sessionId }, children))
        }

        // ── M5：whale_polish 专用工具卡（§5.2 第 3 条"改动清单展示"；keyed 槽，key = 工具名） ──
        function WhalePolishCard(props) {
          const block = props && props.block
          const summary = summarizePolishBlock(block)
          const [expanded, setExpanded] = React.useState(false)
          const [, setTick] = React.useState(0)
          React.useEffect(() => {
            if (!locale) return undefined
            return locale.subscribe(() => setTick((n) => n + 1))
          }, [])
          const t = translate
          const rows = [React.createElement('div', { key: 'head', className: 'ww-tcard-head' }, t('tool.polish.title'))]
          if (summary.state === 'running') {
            rows.push(React.createElement('div', {
              key: 'body', className: 'ww-tcard-body ww-tcard-dim',
            }, t('tool.polish.running')))
          } else if (summary.state === 'error') {
            rows.push(React.createElement('div', {
              key: 'body', className: 'ww-tcard-body ww-tcard-dim',
            }, t('tool.polish.error') + ' — ' + summary.errorText))
          } else if (summary.state === 'raw') {
            rows.push(React.createElement('div', { key: 'body', className: 'ww-tcard-body' },
              React.createElement('pre', { className: 'ww-tcard-pre' }, summary.raw || '(no data)')))
          } else {
            const status = summary.unchanged
              ? t('tool.polish.unchanged')
              : summary.unitsIn + ' → ' + summary.unitsOut + t('tool.polish.unit')
            rows.push(React.createElement('div', {
              key: 'status', className: 'ww-tcard-body ww-tcard-dim',
            }, status))
            if (summary.changes.length > 0) {
              const shown = summary.changes.slice(0, 20)
              rows.push(React.createElement('ul', { key: 'list', className: 'ww-tcard-list' },
                shown.map((c, i) => React.createElement('li', { key: i }, c)),
                summary.changes.length > shown.length
                  ? React.createElement('li', { key: 'more', className: 'ww-tcard-dim' },
                    '… +' + (summary.changes.length - shown.length))
                  : null))
            }
            const preview = expanded ? summary.polished : summary.polished.slice(0, 180)
            rows.push(React.createElement('div', { key: 'preview', className: 'ww-tcard-body' },
              t('tool.polish.preview') + '：' + preview + (expanded || summary.polished.length <= 180 ? '' : '…')))
            if (summary.polished.length > 180) {
              rows.push(React.createElement('div', { key: 'fold' },
                React.createElement('span', {
                  className: 'ww-tcard-fold',
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => setExpanded(!expanded),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) }
                  },
                }, expanded ? t('tool.polish.collapse') : t('tool.polish.expand'))))
            }
          }
          return React.createElement('div', { className: 'ww-tcard' }, rows)
        }

        // 快捷条（§6.1）：id 'whale'、order 15；label 用 thunk 形式，语言切换实时跟随。
        slots.inject('conversation.input.dock', () => slots.register(
          { name: 'conversation.input.dock', id: 'whale', order: 15, label: () => translate('dock.label') },
          (props) => React.createElement(WhaleDock, props),
        ))

        // M5：whale_polish 专用工具卡（改动清单展示；keyed 槽，key = 工具名，追加式注册不顶替住户）
        slots.inject('tool.call.toolview', () => slots.register(
          { name: 'tool.call.toolview', key: 'whale_polish' },
          (props) => React.createElement(WhalePolishCard, props),
        ))

        console.log('whale-writing client loaded: input dock quick bar + whale_polish tool card')
      },
    }
  },
})
