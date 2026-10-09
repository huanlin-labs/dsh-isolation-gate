/**
 * dsh-access-gate · CLIENT half —— 「门禁 · 目录访问管制」整页
 *
 * 捆绑格式（client-modules 协议）：经典脚本，向 `window.__ModuleLoader__`
 * 注册工厂；工厂拿到 `require`，返回插件的导出（apply / inject）。无 JSX。
 *
 * 挂载面（与 dsh-skill-panel 同款官方槽位，不依赖任何第三方侧栏插件）：
 *   ① `sidebar.panellist`（root 作用域 list = 左上应用级导航排）→ 图标行，`order: 6`
 *      ⇒ **紧贴在「技能」（order 5）下方**，仍在官方「自动化任务」（order 10）之前；
 *   ② `main`（root 作用域 keyed）→ 主区整页，`key` 与行 `id` 同名（`access-gate`）。
 * 外壳按 `order` 升序排，因此"在技能正下方"与加载先后无关，只由 6 这个数决定。
 *
 * 状态从哪来：**每次渲染都问宿主半要**（`GET /__dsh-access-gate/state`），页面自己
 * 不留副本 ⇒ 页面不可能显示一个与工具侧读到的不一样的授权。
 *
 * 受管对象两类（列表里同时显示）：
 *   · **名字** —— D 根一级目录名（旧行为），与盘根一层目录做差异比对；
 *   · **路径** —— 任意绝对路径（新能力），只判"目录存在 / 不存在"，带 `[路径]` 标记。
 *
 * `GateView` 是**纯函数**（只有 props，没有 hook），自测可以直接调它渲染 ——
 * 这是本包唯一能被自测断言 UI 结构的入口，因此刻意与 hook 层分开。
 */

window.__ModuleLoader__.load({
  id: 'dsh-access-gate',
  factory: (require) => {
    // 这一行放最前：apply() 会被 loader 卡在"注入服务就绪"之前，
    // 有它就分得清"bundle 没求值"和"求值了但 apply 没跑"。
    console.log('[dsh-access-gate] client bundle evaluated')

    const React = require('react')
    const { useCallback, useEffect, useState } = React
    const h = React.createElement

    const BASE = '/__dsh-access-gate'

    /** 导航行 id 与主区座位 key —— 必须同名，否则点行打不开页。 */
    const PANEL_ID = 'access-gate'

    /**
     * 导航排里的位置。官方「插件」= 0、「自动化任务」= 10；「技能」= 5。
     * 户主要求「门禁」在**技能正下方** ⇒ 取 6（升序排序下唯一落点）。
     */
    const PANEL_ORDER = 6

    const C = {
      text: 'var(--dsw-color-text, #e8e8e8)',
      dim: 'var(--dsw-color-text-secondary, #9aa0a6)',
      card: 'var(--dsw-color-bg-secondary, rgba(255,255,255,0.04))',
      border: 'var(--dsw-color-border, rgba(255,255,255,0.12))',
      ok: 'var(--dsw-color-success, #4ade80)',
      warn: 'var(--dsw-color-warning, #fbbf24)',
      bad: 'var(--dsw-color-error, #f87171)',
      btn: 'var(--dsw-color-bg-tertiary, rgba(255,255,255,0.10))',
      accent: 'var(--dsw-color-primary, #4d6bfe)',
    }

    const LEVEL_COLOR = { deny: C.dim, read: C.warn, full: C.bad }

    async function call(path, init) {
      const res = await fetch(path, init)
      let body = null
      try {
        body = await res.json()
      } catch {
        body = null
      }
      if (!res.ok || (body && body.ok === false)) {
        throw new Error((body && body.error) || `HTTP ${res.status}`)
      }
      return body
    }

    function post(path, payload) {
      return call(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    /**
     * 导航行图标。外壳负责按钮、文字、提示、高亮与折叠 —— 本组件只画图标，
     * 尺寸与选中态由外壳通过 props 给。
     * `data-dsh-panel-entry` 是皮肤契约认领本行插件的唯一钩子（与 dsh-ssh / 任务看板同惯例）。
     */
    function GateIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        // 一个"闸门"的图形：门框 + 一道横闩
        h('path', { d: 'M3 2.5h10v11H3z' }),
        h('path', { d: 'M3 8h10' }),
        h('circle', { cx: '8', cy: '8', r: '1' }),
      )
    }

    function Badge(props) {
      return h(
        'span',
        {
          style: {
            fontSize: '11px',
            lineHeight: '16px',
            padding: '1px 6px',
            borderRadius: '999px',
            border: `1px solid ${props.color || C.border}`,
            color: props.color || C.dim,
            whiteSpace: 'nowrap',
          },
        },
        props.text,
      )
    }

    function SmallButton(props) {
      return h(
        'button',
        {
          onClick: props.onClick,
          disabled: props.disabled === true,
          title: props.title,
          style: {
            cursor: props.disabled === true ? 'default' : 'pointer',
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '6px',
            background: props.background || C.btn,
            color: props.color || C.text,
            border: 'none',
            opacity: props.disabled === true ? 0.5 : 1,
          },
        },
        props.label,
      )
    }

    function Line(props) {
      return h(
        'div',
        { style: Object.assign({ fontSize: '11px', color: C.dim, marginTop: '2px', wordBreak: 'break-all' }, props.style || {}) },
        props.children,
      )
    }

    /** 三级切换按钮组（当前级别高亮；点击 = 请求切到该级）。 */
    function LevelSwitch(props) {
      return h(
        'div',
        { style: { display: 'flex', gap: '4px' } },
        (props.levels || []).map((item) =>
          h(SmallButton, {
            key: item.level,
            label: item.label,
            title: `${item.level} · ${item.hint}`,
            disabled: props.busy === true,
            onClick: () => props.onPick(item.level),
            background: item.level === props.value ? LEVEL_COLOR[item.level] : C.btn,
            color: item.level === props.value ? '#10131a' : C.text,
          }),
        ),
      )
    }

    /**
     * 纯视图：`props.model` 为 null 时是首次加载态。
     * 自测直接调它，不需要 React 运行时。
     */
    function GateView(props) {
      const model = props.model
      const levels = (model && model.levels) || []

      if (!model) {
        return h(
          'div',
          { 'data-dsh-plugin': PANEL_ID, style: { padding: '10px 12px', color: C.text } },
          h('div', { style: { fontSize: '14px', fontWeight: 700 } }, '门禁'),
          h(Line, null, props.busy ? '读取中…' : '（未读取）'),
          props.error ? h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '6px' } }, `✗ ${props.error}`) : null,
        )
      }

      const diffs = model.diffs || {}
      const rosterRows = model.roster || []
      const missingDir = diffs.rosterMissingDir || []
      const suspectUnlisted = diffs.dirNotListedSuspect || []
      const caseMismatch = diffs.caseMismatch || []
      const pathMissing = diffs.pathMissing || []
      const pathNotDir = diffs.pathNotDir || []
      const unlisted = model.unlistedDirs || []
      const stateOnly = model.stateOnly || []
      const gateClosed = model.files && model.files.gateClosed === true

      return h(
        'div',
        {
          'data-dsh-plugin': PANEL_ID,
          style: { padding: '10px 12px', color: C.text, fontFamily: 'inherit', overflow: 'auto', height: '100%' },
        },

        // —— 抬头 ——
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', { style: { fontSize: '14px', fontWeight: 700 } }, '门禁 · 目录访问管制'),
          h('span', { style: { flex: '1 1 auto' } }),
          h(SmallButton, { label: props.busy ? '刷新中…' : '刷新', onClick: props.onRefresh, disabled: props.busy }),
        ),
        h(
          Line,
          null,
          '每一行 = 一个受管对象（**名字** = D 根一级目录名，或**任意绝对路径**）。级别即授权：' +
            levels.map((item) => `${item.label}=${item.level}`).join(' · ') +
            ' · 默认全禁（未明确授权一律按默认禁执行）',
        ),

        // —— fail-closed 警示（名单不可用 ⇒ 一切拒绝）——
        gateClosed
          ? h(
              'div',
              { style: { marginTop: '8px', border: `1px solid ${C.bad}`, borderRadius: '8px', padding: '6px 8px' } },
              h('div', { style: { fontSize: '12px', color: C.bad } }, '⚠ 名单不可用 —— 通道当前**一律拒绝**'),
              h(Line, null, model.files.rosterGateMessage || '请先恢复名单文件，再刷新本页。'),
            )
          : null,

        // —— 文件状态 ——
        h(
          'div',
          { style: { marginTop: '8px', borderTop: `1px solid ${C.border}`, paddingTop: '6px' } },
          h(Line, null, `状态文件：${model.paths.state}（${model.files.stateExists ? '存在' : '尚未创建'}）`),
          h(Line, null, `受管名单：${model.paths.roster}（${model.files.rosterExists ? '存在' : '缺失'}）`),
          h(Line, null, `盘根：${model.paths.root} · 最后一改：${model.updatedAt || '—'}（${model.updatedBy || '—'}）`),
          h(
            Line,
            null,
            `受管对象：共 ${(model.rosterCounts && model.rosterCounts.total) || rosterRows.length} 个` +
              `（名字 ${(model.rosterCounts && model.rosterCounts.names) || 0} · 路径 ${(model.rosterCounts && model.rosterCounts.paths) || 0}）`,
          ),
          model.files.stateError ? h(Line, { style: { color: C.bad } }, `⚠ ${model.files.stateError}`) : null,
          model.files.rosterError ? h(Line, { style: { color: C.bad } }, `⚠ ${model.files.rosterError}`) : null,
          (model.files.rosterDuplicates || []).length > 0
            ? h(Line, { style: { color: C.warn } }, `⚠ 名单里有重复行：${model.files.rosterDuplicates.join(' / ')}`)
            : null,
          (model.files.rosterInvalid || []).length > 0
            ? h(
                Line,
                { style: { color: C.warn } },
                `⚠ 名单里有不合法、**未生效**的行：${model.files.rosterInvalid
                  .map((row) => `${row.raw}（${row.error}）`)
                  .join(' / ')}`,
              )
            : null,
        ),

        // —— 差异提示（本页最要紧的一块）——
        h(
          'div',
          { style: { marginTop: '8px', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px 8px', background: C.card } },
          h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '名单 ↔ 磁盘 差异（名字类）'),
          missingDir.length === 0 && suspectUnlisted.length === 0 && caseMismatch.length === 0 && pathMissing.length === 0
            ? h(Line, { style: { color: C.ok } }, '✓ 无差异（名单里的目录都在，疑似受管目录都已入名单）')
            : null,
          missingDir.length > 0
            ? h(Line, { style: { color: C.warn } }, `⚠ 已在名单但目录不存在：${missingDir.join(' / ')}（疑似笔误 / 已删 / 盘未挂）`)
            : null,
          pathMissing.length > 0
            ? h(Line, { style: { color: C.warn } }, `⚠ [路径] 受管对象当前目录不存在：${pathMissing.join(' / ')}`)
            : null,
          pathNotDir.length > 0
            ? h(Line, { style: { color: C.warn } }, `⚠ [路径] 受管对象存在但不是目录：${pathNotDir.join(' / ')}`)
            : null,
          suspectUnlisted.length > 0
            ? h(Line, { style: { color: C.warn } }, `⚠ 目录存在但未入名单（疑似受管目录）：${suspectUnlisted.join(' / ')} —— 未入名单 ⇒ 当前不在受管辖范围内，下方可一键加入`)
            : null,
          caseMismatch.length > 0
            ? h(Line, { style: { color: C.dim } }, `· 大小写不一致：${caseMismatch.map((row) => `${row.roster}→${row.disk}`).join(' / ')}（Windows 不区分，不影响生效）`)
            : null,
        ),

        props.error ? h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '6px' } }, `✗ ${props.error}`) : null,
        props.notice ? h('div', { style: { color: C.accent, fontSize: '12px', marginTop: '6px' } }, `✓ ${props.notice}`) : null,

        // —— 待确认条（名单改动一律两步：先看差异，再点确认）——
        props.pending
          ? h(
              'div',
              { style: { marginTop: '8px', border: `1px solid ${C.warn}`, borderRadius: '8px', padding: '6px 8px' } },
              h(
                'div',
                { style: { fontSize: '12px', color: C.warn } },
                props.pending.action === 'add'
                  ? `把「${props.pending.name}」加入受管名单？加入后它立即按「禁」处理（新增项不会自动授权）。`
                  : `把「${props.pending.name}」从受管名单移除？⚠ 这会**降低管制范围**：移除后它不再受管辖。`,
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
                h(SmallButton, {
                  label: props.pending.action === 'add' ? '确认加入（改前先备份）' : '确认移除（改前先备份）',
                  background: props.pending.action === 'add' ? C.accent : C.bad,
                  color: '#10131a',
                  disabled: props.busy,
                  onClick: props.onConfirmPending,
                }),
                h(SmallButton, { label: '取消', onClick: props.onCancelPending, disabled: props.busy }),
              ),
            )
          : null,

        // —— 受管对象行（名字与路径都在这里，两类都有 禁/只读/可读写删 + 从名单移除）——
        h('div', { style: { marginTop: '10px' } },
          rosterRows.length === 0
            ? h(Line, null, '名单为空（没有受管辖的对象）。可在下方把疑似受管目录加入名单。')
            : rosterRows.map((row) =>
                h(
                  'div',
                  {
                    key: `${row.kind || 'name'}:${row.name}`,
                    'data-gate-object': row.name,
                    style: {
                      border: `1px solid ${row.status === 'roster-missing-dir' || row.status === 'path-missing' ? C.warn : C.border}`,
                      borderRadius: '8px',
                      padding: '6px 8px',
                      marginTop: '6px',
                      background: C.card,
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                    row.isPath === true ? h(Badge, { text: '[路径]', color: C.accent }) : null,
                    h('span', { style: { fontSize: '13px', fontWeight: 600 } }, row.name),
                    h(Badge, { text: row.levelLabel, color: LEVEL_COLOR[row.level] }),
                    h(Badge, { text: row.dirExists ? '目录存在' : '目录不存在', color: row.dirExists ? C.ok : C.warn }),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h(LevelSwitch, {
                      levels,
                      value: row.level,
                      busy: props.busy,
                      onPick: (level) => props.onPickLevel(row.name, level),
                    }),
                    h(SmallButton, {
                      label: '从名单移除',
                      title: '降低管制范围：移除后该对象不再受管辖',
                      disabled: props.busy,
                      onClick: () => props.onAskRemove(row.name),
                    }),
                  ),
                  h(Line, null, `${row.hint} · 允许：${(row.allowedOps || []).join(',') || '无'}`),
                ),
              ),
        ),

        // —— 未入名单目录（只列目录名）——
        h(
          'div',
          { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { fontSize: '12px', fontWeight: 600 } }, `未入名单的 ${model.paths.root} 一层目录（${unlisted.length} 个 · 仅目录名，本页不读任何目录内容）`),
            h('span', { style: { flex: '1 1 auto' } }),
            h(SmallButton, { label: props.showUnlisted ? '收起' : '展开', onClick: props.onToggleUnlisted }),
          ),
          suspectUnlisted.length > 0
            ? h(
                'div',
                { style: { marginTop: '4px' } },
                suspectUnlisted.map((name) =>
                  h(
                    'div',
                    { key: name, style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' } },
                    h(Badge, { text: '疑似受管目录', color: C.warn }),
                    h('span', { style: { fontSize: '12px' } }, name),
                    h(SmallButton, { label: '加入名单', disabled: props.busy, onClick: () => props.onAskAdd(name) }),
                  ),
                ),
              )
            : null,
          props.showUnlisted
            ? h(
                'div',
                { style: { marginTop: '4px', maxHeight: '220px', overflow: 'auto' } },
                unlisted.map((dir) =>
                  h(
                    'div',
                    { key: dir.name, style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                    h('span', { style: { fontSize: '12px', color: dir.suspect ? C.warn : C.dim, flex: '0 0 auto' } }, dir.name),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h(SmallButton, { label: '加入名单', disabled: props.busy, onClick: () => props.onAskAdd(dir.name) }),
                  ),
                ),
              )
            : null,
        ),

        // —— 状态里有、名单里没有 ——
        stateOnly.length > 0
          ? h(
              'div',
              { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
              h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '状态里有、名单里没有（当前不受管辖）'),
              stateOnly.map((row) => h(Line, { key: row.name }, `${row.name} = ${row.level}（${row.levelLabel}）· ${row.hint}`)),
            )
          : null,

        // —— 给 agent / 工具侧的读法 ——
        h(
          'div',
          { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
          h('div', { style: { fontSize: '12px', fontWeight: 600 } }, '工具 / agent 侧怎么读这个状态'),
          h(Line, null, `状态文件（唯一真身）：${model.paths.state} —— 级别键：${levels.map((item) => item.level).join(' / ')}`),
          h(Line, null, '受管辖通道：node D:\\插件\\dsh-access-gate\\bin\\gate.mjs status'),
          h(Line, null, '判定（不动手）：… check --name <名> --op read|write|delete|traverse（也可 --path <绝对路径>）；被拒时退出码 3，拒绝文案在 stderr'),
          (model.policy || []).map((line) => h(Line, { key: line }, `· ${line}`)),
        ),

        // —— 审计 ——
        h(
          'div',
          { style: { marginTop: '12px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
          h('div', { style: { fontSize: '12px', fontWeight: 600 } }, `受管辖通道审计（最近 ${(model.audit && model.audit.entries.length) || 0} 条 / 共 ${(model.audit && model.audit.total) || 0} 条）`),
          !model.audit || model.audit.entries.length === 0
            ? h(Line, null, '（暂无记录）')
            : model.audit.entries.map((entry, index) =>
                h(
                  Line,
                  { key: `${entry.at || index}-${index}`, style: { color: entry.allowed ? C.dim : C.bad } },
                  `${entry.atLocal || entry.at} · ${entry.allowed ? '放行' : '拒绝'} · ${entry.channel} · ${entry.name || '-'} · ${entry.op} · ${entry.detail || ''}`,
                ),
              ),
        ),

        // —— 纪律页脚 ——
        h(
          Line,
          { style: { marginTop: '14px' } },
          '纪律：本页只读写两个配置文件（状态 JSON / 名单 TXT）、列出盘根一层目录名，并对名单里**显式列出的路径**做一次存在性判定 —— **不读任何受管对象内部内容**；' +
            '改名单前自动备份到回收站；开关即落盘，重启后保持。名单缺失 / 损坏时通道**一律拒绝**（fail-closed）。列出的目录名不代表已授权访问。',
        ),
      )
    }

    /** 有状态的一层：只负责取数与动作，渲染全交给 GateView。 */
    function GatePage() {
      const [model, setModel] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [showUnlisted, setShowUnlisted] = useState(false)
      const [pending, setPending] = useState(null)

      const load = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          setModel(await call(`${BASE}/state`))
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const pickLevel = useCallback(
        async (name, level) => {
          setBusy(true)
          setError(null)
          setNotice(null)
          try {
            const result = await post(`${BASE}/level`, { name, level })
            setNotice(`${result.name} → ${result.levelLabel}（${result.level}）· 已落盘，重启后保持`)
            setModel(result.report)
          } catch (err) {
            setError(err.message)
          } finally {
            setBusy(false)
          }
        },
        [],
      )

      const confirmPending = useCallback(async () => {
        if (!pending) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const result = await post(`${BASE}/roster`, { action: pending.action, name: pending.name })
          setNotice(
            `名单${result.action === 'add' ? '加入' : '移除'}「${result.name}」已落盘` +
              `（备份：${result.backup || '原文件不存在，无需备份'}）` +
              (result.stateNote ? ` · ${result.stateNote}` : ''),
          )
          setModel(result.report)
          setPending(null)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }, [pending])

      return h(GateView, {
        model,
        busy,
        error,
        notice,
        pending,
        showUnlisted,
        onRefresh: load,
        onPickLevel: pickLevel,
        onAskAdd: (name) => setPending({ action: 'add', name }),
        onAskRemove: (name) => setPending({ action: 'remove', name }),
        onConfirmPending: confirmPending,
        onCancelPending: () => setPending(null),
        onToggleUnlisted: () => setShowUnlisted((value) => !value),
      })
    }

    function apply(ctx) {
      // `inject: ['slots']`（下面 return 里声明）是必须的：apply 触碰未声明的服务，
      // cordis 会抛 "cannot get property slots without inject" ⇒ 整插件激活失败。
      // 声明了就用，**不做 if(ctx.slots) 之类的探测**。
      try {
        const disposeRow = ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: '门禁',
            },
            GateIcon,
          ),
        )
        const disposePage = ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, GatePage),
        )
        ctx.effect(() => () => {
          disposePage()
          disposeRow()
        })
        console.log(
          `[dsh-access-gate] client: 「门禁」行 + 整页已挂到 slots（order ${PANEL_ORDER}，紧贴「技能」5 下方）`,
        )
      } catch (error) {
        console.error('[dsh-access-gate] client: 槽位注册失败', error)
      }
    }

    // 宿主 loader 只读 `apply` / `inject`；`__selftest` 是给 test/run-client.mjs 的出口
    // —— 没有它就没法在无浏览器环境里断言"加载态/差异态/交互回调"真的渲染得出来。
    return { apply, inject: ['slots'], __selftest: { GateView, GateIcon, PANEL_ID, PANEL_ORDER } }
  },
})
