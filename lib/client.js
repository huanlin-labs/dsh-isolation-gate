/**
 * dsh-isolation-gate · CLIENT half —— 「门禁 · 目录访问管制」整页
 *
 * 捆绑格式（client-modules 协议）：经典脚本，向 `window.__ModuleLoader__`
 * 注册工厂；工厂拿到 `require`，返回插件的导出（apply / inject）。无 JSX。
 *
 * 挂载面（与 dsh-skill-panel 同款官方槽位，不依赖任何第三方侧栏插件）：
 *   ① `sidebar.panellist`（root 作用域 list = 左上应用级导航排）→ 图标行，`order: 6`
 *      ⇒ **紧贴在「技能」（order 5）下方**，仍在官方「自动化任务」（order 10）之前；
 *   ② `main`（root 作用域 keyed）→ 主区整页，`key` 与行 `id` 同名（`isolation-gate`）。
 *
 * 2026-10-21 界面重构（户主原话「现在太丑了」）：
 *   · 顶部状态摘要（受管数 / 组数 / 三级分布 / 工具门 / 名单可用性）
 *   · 分组卡片 + 组头一键切（组内统一时高亮，不统一时显示"混合"）
 *   · 每行「级别」用**分段控件**，不再三个独立按钮
 *   · 次要动作（归组 / 从名单移除）收进 `⋯` 菜单
 *   · 空态设计；添加受管对象走「选择文件夹」原生对话框（不可用则退路）
 *
 * 状态从哪来：**每次渲染都问宿主半要**（`GET /__dsh-isolation-gate/state`），页面自己
 * 不留副本 ⇒ 页面不可能显示一个与工具侧读到的不一样的授权。
 *
 * `GateView` 是**纯函数**（只有 props，没有 hook），自测可以直接调它渲染。
 */

window.__ModuleLoader__.load({
  id: 'dsh-isolation-gate',
  factory: (require) => {
    console.log('[dsh-isolation-gate] client bundle evaluated')

    const React = require('react')
    const { useCallback, useEffect, useState } = React
    const h = React.createElement

    const BASE = '/__dsh-isolation-gate'
    const PANEL_ID = 'isolation-gate'
    const PANEL_ORDER = 6

    /** 宿主真实主题 token（`--dsw-alias-*`）；旧 `--dsw-color-*` 仅作兜底。 */
    const C = {
      text: 'var(--dsw-alias-label-primary, var(--dsw-color-text, #e8e8e8))',
      dim: 'var(--dsw-alias-label-secondary, var(--dsw-color-text-secondary, #9aa0a6))',
      card: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.04))',
      card2: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.03))',
      border: 'var(--dsw-alias-border-l1, rgba(255,255,255,0.12))',
      border2: 'var(--dsw-alias-border-l2, rgba(255,255,255,0.2))',
      ok: 'var(--dsw-alias-state-success-primary, #4ade80)',
      warn: 'var(--dsw-alias-state-warn-primary, #fbbf24)',
      bad: 'var(--dsw-alias-state-error-primary, #f87171)',
      idle: 'var(--dsw-alias-state-idle-primary, #9aa0a6)',
      accent: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      overlay: 'var(--dsw-alias-bg-overlay, #1b1d24)',
    }

    const LEVEL_COLOR = { deny: C.idle, read: C.warn, full: C.bad }
    const LEVEL_TONE = { deny: 'rgba(154,160,166,0.16)', read: 'rgba(251,191,36,0.16)', full: 'rgba(248,113,113,0.16)' }

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
            lineHeight: '18px',
            padding: '0 7px',
            borderRadius: '999px',
            border: `1px solid ${props.color || C.border}`,
            background: props.bg || 'transparent',
            color: props.color || C.dim,
            whiteSpace: 'nowrap',
          },
        },
        props.text,
      )
    }

    function Button(props) {
      const disabled = props.disabled === true
      return h(
        'button',
        {
          onClick: props.onClick,
          disabled,
          title: props.title,
          'data-gate-action': props.action || undefined,
          style: {
            cursor: disabled ? 'default' : 'pointer',
            fontSize: props.big ? '13px' : '12px',
            fontWeight: props.primary ? 600 : 500,
            padding: props.big ? '7px 14px' : '4px 10px',
            borderRadius: '8px',
            background: props.background || (props.primary ? C.accent : 'transparent'),
            color: props.color || (props.primary ? '#0b0e14' : C.text),
            border: props.primary ? 'none' : `1px solid ${C.border}`,
            opacity: disabled ? 0.45 : 1,
          },
        },
        props.label,
      )
    }

    function Line(props) {
      return h(
        'div',
        {
          style: Object.assign(
            { fontSize: '11px', color: C.dim, marginTop: '2px', wordBreak: 'break-all' },
            props.style || {},
          ),
        },
        props.children,
      )
    }

    /** 分段控件：一格三档，当前档高亮。 */
    function Segmented(props) {
      const levels = props.levels || []
      return h(
        'div',
        {
          'data-gate-segmented': props.scope || 'row',
          role: 'group',
          'aria-label': '访问级别',
          style: {
            display: 'inline-flex',
            padding: '2px',
            gap: '2px',
            borderRadius: '9px',
            border: `1px solid ${C.border}`,
            background: C.card2,
          },
        },
        levels.map((item) =>
          h(
            'button',
            {
              key: item.level,
              type: 'button',
              disabled: props.busy === true,
              title: `${item.level} · ${item.hint}`,
              onClick: () => props.onPick(item.level),
              style: {
                cursor: props.busy ? 'default' : 'pointer',
                fontSize: '11px',
                lineHeight: '20px',
                padding: '0 9px',
                borderRadius: '7px',
                border: 'none',
                background: item.level === props.value ? LEVEL_COLOR[item.level] : 'transparent',
                color: item.level === props.value ? '#0b0e14' : C.dim,
                fontWeight: item.level === props.value ? 700 : 500,
                opacity: props.busy ? 0.55 : 1,
              },
            },
            item.label,
          ),
        ),
      )
    }

    /** 状态摘要里的一块数字。 */
    function Stat(props) {
      return h(
        'div',
        {
          style: {
            minWidth: '92px',
            padding: '8px 10px',
            borderRadius: '10px',
            border: `1px solid ${props.color ? props.color : C.border}`,
            background: props.bg || C.card,
          },
        },
        h('div', { style: { fontSize: '11px', color: C.dim } }, props.label),
        h('div', { style: { fontSize: '18px', fontWeight: 700, color: props.color || C.text, lineHeight: '24px' } }, props.value),
      )
    }

    function SectionTitle(props) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '18px 0 8px' } },
        h('div', { style: { fontSize: '13px', fontWeight: 700, color: C.text } }, props.title),
        props.hint ? h('span', { style: { fontSize: '11px', color: C.dim } }, props.hint) : null,
        h('span', { style: { flex: '1 1 auto' } }),
        props.right || null,
      )
    }

    /** 行的次要动作菜单。 */
    function RowMenu(props) {
      const groups = props.groups || []
      return h(
        'div',
        {
          style: {
            marginTop: '8px',
            padding: '8px',
            borderRadius: '8px',
            border: `1px dashed ${C.border2}`,
            background: C.card2,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
          h('span', { style: { fontSize: '11px', color: C.dim } }, '归组：'),
          h(
            'select',
            {
              value: props.groupDraft && props.groupDraft.select !== undefined ? props.groupDraft.select : props.row.group || '',
              onChange: (event) => props.onGroupSelect(event.target.value),
              style: {
                fontSize: '12px',
                padding: '3px 6px',
                borderRadius: '6px',
                border: `1px solid ${C.border}`,
                background: C.overlay,
                color: C.text,
              },
            },
            h('option', { value: '' }, '（不分组）'),
            groups.map((group) => h('option', { key: group.name, value: group.name }, `${group.name}（${group.count}）`)),
          ),
          h(
            'input',
            {
              value: props.groupDraft && props.groupDraft.text ? props.groupDraft.text : '',
              placeholder: '或新建组名…',
              onChange: (event) => props.onGroupText(event.target.value),
              style: {
                fontSize: '12px',
                padding: '3px 7px',
                width: '130px',
                borderRadius: '6px',
                border: `1px solid ${C.border}`,
                background: C.overlay,
                color: C.text,
              },
            },
          ),
          h(Button, {
            label: '应用',
            disabled: props.busy,
            onClick: props.onApplyGroup,
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: '6px' } },
          h(Button, {
            label: '从名单移除',
            title: '降低管制范围：移除后该对象不再受管辖；状态条目会同步清掉',
            disabled: props.busy,
            onClick: props.onAskRemove,
            color: C.bad,
          }),
        ),
      )
    }

    /** 拖：对象行可被拖走（数据放 text/plain，与技能面板同款）。 */
    function rowDragProps(name) {
      return {
        draggable: true,
        'data-gate-draggable': 'true',
        onDragStart: (event) => {
          try {
            event.dataTransfer.setData('text/plain', name)
            event.dataTransfer.effectAllowed = 'copy'
          } catch (error) {
            /* 忽略：个别环境不给 dataTransfer */
          }
        },
      }
    }

    /** 放：组卡片（groupName=组名）或「未分组」区（groupName=''）。 */
    function makeDropProps(groupName, onDropToGroup) {
      const clear = (event) => {
        if (event && event.currentTarget && event.currentTarget.style) {
          event.currentTarget.style.borderColor = ''
          event.currentTarget.style.boxShadow = ''
        }
      }
      return {
        onDragOver: (event) => {
          event.preventDefault()
          try {
            event.dataTransfer.dropEffect = 'copy'
          } catch (error) {
            /* 忽略 */
          }
          if (event.currentTarget && event.currentTarget.style) {
            event.currentTarget.style.borderColor = C.accent
            event.currentTarget.style.boxShadow = '0 0 0 2px rgba(77,107,254,0.28)'
          }
        },
        onDragLeave: clear,
        onDrop: (event) => {
          event.preventDefault()
          clear(event)
          let name = ''
          try {
            name = event.dataTransfer.getData('text/plain') || ''
          } catch (error) {
            /* 忽略 */
          }
          if (name && typeof onDropToGroup === 'function') onDropToGroup(name, groupName)
        },
      }
    }

    /** 一行受管对象。 */
    function ObjectRow(props) {
      const row = props.row
      const open = props.menuFor === row.name
      const missing = row.status === 'roster-missing-dir' || row.status === 'path-missing' || row.status === 'path-not-dir'
      return h(
        'div',
        {
          'data-gate-object': row.name,
          ...rowDragProps(row.name),
          style: {
            border: `1px solid ${missing ? C.warn : C.border}`,
            borderRadius: '10px',
            padding: '9px 11px',
            marginTop: '6px',
            background: C.card,
            cursor: 'grab',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          row.isPath === true ? h(Badge, { text: '[路径]', color: C.accent }) : null,
          h('span', { style: { fontSize: '13px', fontWeight: 600, color: C.text, wordBreak: 'break-all' } }, row.name),
          h(Badge, {
            text: row.levelLabel,
            color: LEVEL_COLOR[row.level],
            bg: LEVEL_TONE[row.level],
          }),
          h(Badge, { text: row.dirExists ? '目录存在' : '目录不存在', color: row.dirExists ? C.ok : C.warn }),
          h('span', { style: { flex: '1 1 auto' } }),
          h(Segmented, {
            scope: `row:${row.name}`,
            levels: props.levels,
            value: row.level,
            busy: props.busy,
            onPick: (level) => props.onPickLevel(row.name, level),
          }),
          h(
            'button',
            {
              type: 'button',
              title: '更多动作',
              'aria-label': '更多动作',
              'data-gate-menu': 'row',
              onClick: () => props.onToggleMenu(row.name),
              style: {
                cursor: 'pointer',
                width: '26px',
                height: '26px',
                borderRadius: '7px',
                border: `1px solid ${open ? C.border2 : C.border}`,
                background: open ? C.card2 : 'transparent',
                color: C.text,
                fontSize: '15px',
                lineHeight: '18px',
              },
            },
            '⋯',
          ),
        ),
        h(
          Line,
          null,
          `${row.hint} · 允许：${(row.allowedOps || []).join(',') || '无'}` + (row.group ? ` · 组：${row.group}` : ''),
        ),
        open
          ? h(RowMenu, {
              row,
              groups: props.groups,
              groupDraft: props.groupDraft,
              busy: props.busy,
              onGroupSelect: props.onGroupSelect,
              onGroupText: props.onGroupText,
              onApplyGroup: () => props.onApplyGroup(row.name),
              onAskRemove: () => props.onAskRemove(row.name),
            })
          : null,
      )
    }

    /** 组卡片：组头一键切 + 组内成员。 */
    function GroupCard(props) {
      const group = props.group
      const rows = props.rows
      const open = props.menuFor === `group:${group.name}`
      return h(
        'div',
        {
          'data-gate-group': group.name,
          ...makeDropProps(group.name, props.onDropToGroup),
          style: {
            marginTop: '10px',
            border: `1px solid ${C.border2}`,
            borderRadius: '12px',
            background: C.card2,
            overflow: 'hidden',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              padding: '10px 12px',
              borderBottom: `1px solid ${C.border}`,
            },
          },
          h('span', { style: { fontSize: '13px', fontWeight: 700, color: C.text } }, group.name),
          h(Badge, { text: `${rows.length} 个`, color: C.dim }),
          group.uniformLevel
            ? h(Badge, { text: `组内统一：${props.labelOf(group.uniformLevel)}`, color: LEVEL_COLOR[group.uniformLevel] })
            : h(Badge, { text: '组内级别混合', color: C.warn }),
          h('span', { style: { flex: '1 1 auto' } }),
          h(Segmented, {
            scope: `group:${group.name}`,
            levels: props.levels,
            value: group.uniformLevel || '',
            busy: props.busy,
            onPick: (level) => props.onPickGroupLevel(group.name, level),
          }),
          h(
            'button',
            {
              type: 'button',
              title: '组动作',
              'aria-label': '组动作',
              'data-gate-menu': 'group',
              onClick: () => props.onToggleMenu(`group:${group.name}`),
              style: {
                cursor: 'pointer',
                width: '26px',
                height: '26px',
                borderRadius: '7px',
                border: `1px solid ${open ? C.border2 : C.border}`,
                background: open ? C.card : 'transparent',
                color: C.text,
                fontSize: '15px',
                lineHeight: '18px',
              },
            },
            '⋯',
          ),
        ),
        open
          ? h(
              'div',
              { style: { padding: '8px 12px', borderBottom: `1px solid ${C.border}` } },
              h(Button, {
                label: '删除这个组（成员保留，只清归属）',
                disabled: props.busy,
                onClick: () => props.onDeleteGroup(group.name),
                color: C.bad,
              }),
            )
          : null,
        h(
          'div',
          { style: { padding: '2px 10px 10px' } },
          rows.length === 0
            ? h(Line, null, '这个组还没有成员 —— 把下面「未分组」里的对象直接拖进这张卡片即可。')
            : rows.map((row) =>
                h(ObjectRow, {
                  key: `${row.kind || 'name'}:${row.name}`,
                  row,
                  levels: props.levels,
                  groups: props.groups,
                  busy: props.busy,
                  menuFor: props.menuFor,
                  groupDraft: props.groupDraft,
                  onPickLevel: props.onPickLevel,
                  onToggleMenu: props.onToggleMenu,
                  onGroupSelect: props.onGroupSelect,
                  onGroupText: props.onGroupText,
                  onApplyGroup: props.onApplyGroup,
                  onAskRemove: props.onAskRemove,
                }),
              ),
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
          { 'data-dsh-plugin': PANEL_ID, style: { padding: '24px', color: C.text } },
          h('div', { style: { fontSize: '16px', fontWeight: 700 } }, '门禁 · 目录访问管制'),
          h(Line, null, props.busy ? '读取中…' : '（尚未读取）'),
          props.error ? h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '8px' } }, `✗ ${props.error}`) : null,
        )
      }

      const rosterRows = model.roster || []
      const groups = model.groups || []
      const ungrouped = rosterRows.filter((row) => !row.group || !groups.some((group) => group.name === row.group))
      const diffs = model.diffs || {}
      const gateClosed = model.files && model.files.gateClosed === true
      const missingDir = diffs.rosterMissingDir || []
      const suspectUnlisted = diffs.dirNotListedSuspect || []
      const caseMismatch = diffs.caseMismatch || []
      const pathMissing = diffs.pathMissing || []
      const pathNotDir = diffs.pathNotDir || []
      const unlisted = model.unlistedDirs || []
      const stateOnly = model.stateOnly || []
      const counts = model.rosterCounts || {}
      const labelOf = (level) => {
        const found = levels.find((item) => item.level === level)
        return found ? found.label : level
      }

      const groupProps = {
        levels,
        groups,
        busy: props.busy,
        menuFor: props.menuFor,
        groupDraft: props.groupDraft,
        labelOf,
        onPickLevel: props.onPickLevel,
        onToggleMenu: props.onToggleMenu,
        onGroupSelect: props.onGroupSelect,
        onGroupText: props.onGroupText,
        onApplyGroup: props.onApplyGroup,
        onAskRemove: props.onAskRemove,
        onPickGroupLevel: props.onPickGroupLevel,
        onDeleteGroup: props.onDeleteGroup,
        onDropToGroup: props.onDropToGroup,
      }

      return h(
        'div',
        {
          'data-dsh-plugin': PANEL_ID,
          style: {
            padding: '18px 22px 32px',
            color: C.text,
            fontFamily: 'inherit',
            overflow: 'auto',
            height: '100%',
            boxSizing: 'border-box',
            background: C.card2,
          },
        },

        // —— 局部样式（主题 token；仅本面板作用域） ——
        h(
          'style',
          { key: 'gate-style' },
          [
            '.gate-path-input::placeholder{color:var(--dsw-alias-label-secondary,#9aa0a6);opacity:.72}',
            '.gate-path-input:hover{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.24))}',
            '.gate-path-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 3px rgba(77,107,254,.16)}',
            '.gate-browse>summary{list-style:none;cursor:pointer;user-select:none}',
            '.gate-browse>summary::-webkit-details-marker{display:none}',
            '.gate-browse[open]>summary{border-color:var(--dsw-alias-brand-primary,#4d6bfe)!important;color:var(--dsw-alias-brand-primary,#4d6bfe)!important}',
          ].join('\n'),
        ),

        // —— 抬头 ——
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
          h('div', { style: { fontSize: '20px', fontWeight: 750, letterSpacing: '0.2px' } }, '门禁 · 目录访问管制'),
          h('div', { style: { fontSize: '12px', color: C.dim } }, '隔离区授权台 · 默认禁 · 名单制'),
          h('span', { style: { flex: '1 1 auto' } }),
          h(Button, { label: props.busy ? '刷新中…' : '刷新', onClick: props.onRefresh, disabled: props.busy }),
        ),

        // —— 摘要条 ——
        h(
          'div',
          { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
          h(Stat, { label: '受管对象', value: counts.total || 0 }),
          h(Stat, { label: '分组', value: groups.length }),
          h(Stat, { label: '禁', value: counts.deny || 0, color: LEVEL_COLOR.deny }),
          h(Stat, { label: '只读', value: counts.read || 0, color: LEVEL_COLOR.read }),
          h(Stat, { label: '可读写删', value: counts.full || 0, color: LEVEL_COLOR.full }),
          h(Stat, {
            label: '工具执行门',
            value: model.features && model.features.toolGate ? '已开' : '未开',
            color: model.features && model.features.toolGate ? C.ok : C.warn,
          }),
          h(Stat, {
            label: `名字 ${counts.names || 0} · 路径 ${counts.paths || 0}`,
            value: gateClosed ? '不可用' : '正常',
            color: gateClosed ? C.bad : C.ok,
          }),
        ),

        // —— 警示 ——
        gateClosed
          ? h(
              'div',
              { style: { marginTop: '10px', border: `1px solid ${C.bad}`, borderRadius: '10px', padding: '8px 10px', background: 'rgba(248,113,113,0.08)' } },
              h('div', { style: { fontSize: '12px', color: C.bad, fontWeight: 700 } }, '⚠ 名单不可用 —— 通道与工具门当前一律拒绝'),
              h(Line, null, model.files.rosterGateMessage || '请先恢复名单文件，再刷新本页。'),
            )
          : null,
        model.files && model.files.stateMigratedFrom
          ? h(Line, { style: { color: C.ok, marginTop: '8px' } }, `✓ 状态文件已从 v${model.files.stateMigratedFrom} 自动迁移（级别未丢；下次写盘落成 v${model.version || 2}）`)
          : null,
        model.files && model.files.stateError
          ? h(Line, { style: { color: C.bad } }, `⚠ ${model.files.stateError}`)
          : null,
        model.files && (model.files.rosterDuplicates || []).length > 0
          ? h(Line, { style: { color: C.warn } }, `⚠ 名单里有重复行：${model.files.rosterDuplicates.join(' / ')}`)
          : null,
        model.files && (model.files.rosterInvalid || []).length > 0
          ? h(
              Line,
              { style: { color: C.warn } },
              `⚠ 名单里有不合法、**未生效**的行：${model.files.rosterInvalid
                .map((row) => `${row.raw}（${row.error}）`)
                .join(' / ')}`,
            )
          : null,
        props.error ? h('div', { style: { color: C.bad, fontSize: '12px', marginTop: '8px' } }, `✗ ${props.error}`) : null,
        props.notice ? h('div', { style: { color: C.ok, fontSize: '12px', marginTop: '8px' } }, `✓ ${props.notice}`) : null,

        // —— 添加受管对象 ——
        h(
          'div',
          {
            'data-gate-add': 'bar',
            style: {
              marginTop: '14px',
              padding: '12px',
              borderRadius: '12px',
              border: `1px solid ${C.border}`,
              background: C.card,
            },
          },
          h('div', { style: { fontSize: '13px', fontWeight: 700 } }, '添加受管对象'),
          h(
            Line,
            null,
            model.features && model.features.picker
              ? '用「选择文件夹」调系统的目录选择器；也可以直接输入绝对路径。新增项一律先按「禁」处理。'
              : '没有系统目录选择器？点「浏览目录」从本机一层目录里挑，或直接输入绝对路径。新增项一律先按「禁」处理。',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
            model.features && model.features.picker
              ? h(Button, {
                  label: props.picking ? '选择中…' : '选择文件夹…',
                  disabled: props.busy || props.picking,
                  onClick: props.onPickFolder,
                  primary: true,
                })
              : h(
                  'details',
                  { className: 'gate-browse', style: { position: 'relative' } },
                  h(
                    'summary',
                    {
                      style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '9px',
                        border: `1px solid ${C.border2}`,
                        background: C.card2,
                        color: C.text,
                        fontSize: '13px',
                        whiteSpace: 'nowrap',
                      },
                    },
                    '浏览目录 ▾',
                  ),
                  h(
                    'div',
                    {
                      style: {
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        zIndex: 30,
                        width: '320px',
                        maxHeight: '220px',
                        overflow: 'auto',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px',
                        padding: '10px',
                        borderRadius: '10px',
                        border: `1px solid ${C.border2}`,
                        background: C.overlay,
                        boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
                      },
                    },
                    unlisted.length === 0
                      ? h('span', { style: { fontSize: '12px', color: C.dim } }, '一层目录已全部在名单里；可直接输入绝对路径。')
                      : unlisted.map((dir) =>
                          h(Button, {
                            key: dir.name,
                            label: dir.suspect ? `${dir.name} ⚠` : dir.name,
                            disabled: props.busy,
                            onClick: () => props.onAskAdd(dir.name),
                          }),
                        ),
                  ),
                ),
            h('input', {
              className: 'gate-path-input',
              value: props.pathInput || '',
              placeholder: '输入绝对路径，如 D:\\Zcode',
              onChange: (event) => props.onPathInput(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') props.onAskAddPath()
              },
              style: {
                flex: '1 1 320px',
                minWidth: '220px',
                fontSize: '13px',
                padding: '9px 12px',
                borderRadius: '9px',
                border: `1px solid ${C.border2}`,
                background: C.card2,
                color: C.text,
                transition: 'border-color .15s ease, box-shadow .15s ease',
              },
            }),
            h(Button, { label: '加入名单', primary: true, disabled: props.busy || !(props.pathInput || '').trim(), onClick: props.onAskAddPath }),
          ),
        ),

        // —— 待确认条 ——
        props.pending
          ? h(
              'div',
              { style: { marginTop: '10px', border: `1px solid ${C.warn}`, borderRadius: '10px', padding: '8px 10px', background: 'rgba(251,191,36,0.08)' } },
              h(
                'div',
                { style: { fontSize: '12px', color: C.warn } },
                props.pending.action === 'add'
                  ? `把「${props.pending.name}」加入受管名单？加入后它立即按「禁」处理（新增项不会自动授权）。`
                  : `把「${props.pending.name}」从受管名单移除？⚠ 这会**降低管制范围**：移除后它不再受管辖，状态条目也会同步清掉。`,
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
                h(Button, {
                  label: props.pending.action === 'add' ? '确认加入（改前先备份）' : '确认移除（改前先备份）',
                  primary: true,
                  background: props.pending.action === 'add' ? C.accent : C.bad,
                  disabled: props.busy,
                  onClick: props.onConfirmPending,
                }),
                h(Button, { label: '取消', onClick: props.onCancelPending, disabled: props.busy }),
              ),
            )
          : null,

        // —— 空态 ——
        rosterRows.length === 0
          ? h(
              'div',
              {
                'data-gate-empty': 'true',
                style: {
                  marginTop: '16px',
                  padding: '26px 20px',
                  textAlign: 'center',
                  borderRadius: '14px',
                  border: `1px dashed ${C.border2}`,
                  background: C.card,
                },
              },
              h('div', { style: { fontSize: '28px', lineHeight: '34px' } }, '🛡'),
              h('div', { style: { fontSize: '14px', fontWeight: 700, marginTop: '6px' } }, '还没有受管对象'),
              h(Line, null, '把要隔离的目录加进来（比如别的 harness 的家目录），它们会先按「禁」处理，再逐项放开。'),
              suspectUnlisted.length > 0
                ? h(
                    'div',
                    { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '10px' } },
                    suspectUnlisted.map((name) =>
                      h(Button, { key: name, label: `加入「${name}」`, disabled: props.busy, onClick: () => props.onAskAdd(name) }),
                    ),
                  )
                : null,
            )
          : null,

        // —— 分组 ——
        h(
          'div',
          null,
          h(SectionTitle, {
            title: '分组',
            hint: '组头一键切三档 · 把对象拖进卡片即可归组',
            right: h(Button, {
              label: props.newGroupOpen ? '× 收起' : '＋ 新建分组',
              disabled: props.busy,
              onClick: props.onToggleNewGroup,
            }),
          }),
          props.newGroupOpen
            ? h(
                'div',
                {
                  style: {
                    marginTop: '8px',
                    padding: '10px',
                    borderRadius: '10px',
                    border: `1px solid ${C.border}`,
                    background: C.card,
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  },
                },
                h('input', {
                  className: 'gate-path-input',
                  value: (props.newGroupDraft && props.newGroupDraft.name) || '',
                  placeholder: '新组名，如：harness 隔离 2',
                  autoFocus: true,
                  onChange: (event) => props.onNewGroupName(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') props.onCreateGroup()
                  },
                  style: {
                    flex: '1 1 200px',
                    minWidth: '170px',
                    fontSize: '13px',
                    padding: '6px 9px',
                    borderRadius: '8px',
                    border: `1px solid ${C.border}`,
                    background: C.overlay,
                    color: C.text,
                  },
                }),
                h('input', {
                  className: 'gate-path-input',
                  value: (props.newGroupDraft && props.newGroupDraft.note) || '',
                  placeholder: '备注（可选）',
                  onChange: (event) => props.onNewGroupNote(event.target.value),
                  style: {
                    flex: '1 1 150px',
                    minWidth: '130px',
                    fontSize: '13px',
                    padding: '6px 9px',
                    borderRadius: '8px',
                    border: `1px solid ${C.border}`,
                    background: C.overlay,
                    color: C.text,
                  },
                }),
                h(Button, { label: '创建', disabled: props.busy, onClick: props.onCreateGroup }),
                h(
                  'div',
                  { style: { fontSize: '11px', color: C.dim, flex: '1 1 100%' } },
                  '建出来是空组（0 个成员）；把对象放进去：该行 `⋯` →「归组」里选这个组 → 应用。',
                ),
              )
            : null,
          groups.length === 0 && !props.newGroupOpen
            ? h(Line, null, '还没有分组。点右上「＋ 新建分组」先起组名，或在某个对象的 `⋯` 里直接归组（组名不存在会自动建）。')
            : null,
          groups.map((group) =>
            h(GroupCard, {
              key: group.name,
              group,
              rows: rosterRows.filter((row) => row.group === group.name),
              ...groupProps,
            }),
          ),
        ),

        // —— 未分组对象（也是"拖出组"的落点：拖到这里 = 取消分组） ——
        rosterRows.length > 0
          ? h(
              'div',
              {
                'data-gate-drop': 'ungrouped',
                ...makeDropProps('', props.onDropToGroup),
                style: { borderRadius: '12px' },
              },
              h(SectionTitle, {
                title: groups.length > 0 ? '未分组' : '受管对象',
                hint:
                  groups.length > 0
                    ? `${ungrouped.length} 个 · 拖进上面的组卡片即可归组`
                    : '每行 `⋯` 可归组 / 从名单移除，也可直接拖进组卡片',
              }),
              ungrouped.length === 0
                ? h(Line, null, '所有对象都已归组。')
                : ungrouped.map((row) =>
                    h(ObjectRow, {
                      key: `${row.kind || 'name'}:${row.name}`,
                      row,
                      levels,
                      groups,
                      busy: props.busy,
                      menuFor: props.menuFor,
                      groupDraft: props.groupDraft,
                      onPickLevel: props.onPickLevel,
                      onToggleMenu: props.onToggleMenu,
                      onGroupSelect: props.onGroupSelect,
                      onGroupText: props.onGroupText,
                      onApplyGroup: props.onApplyGroup,
                      onAskRemove: props.onAskRemove,
                    }),
                  ),
            )
          : null,

        // —— 差异 ——
        h(
          'div',
          { style: { marginTop: '18px', border: `1px solid ${C.border}`, borderRadius: '12px', padding: '10px 12px', background: C.card } },
          h('div', { style: { fontSize: '13px', fontWeight: 700 } }, '名单 ↔ 磁盘 差异'),
          missingDir.length === 0 && suspectUnlisted.length === 0 && caseMismatch.length === 0 && pathMissing.length === 0 && pathNotDir.length === 0
            ? h(Line, { style: { color: C.ok } }, '✓ 无差异（名单里的目录都在；疑似受管目录都已入名单）')
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
            ? h(Line, { style: { color: C.warn } }, `⚠ 目录存在但未入名单（疑似受管目录）：${suspectUnlisted.join(' / ')} —— 下方可一键加入`)
            : null,
          caseMismatch.length > 0
            ? h(Line, { style: { color: C.dim } }, `· 大小写不一致：${caseMismatch.map((row) => `${row.roster}→${row.disk}`).join(' / ')}（Windows 不区分，不影响生效）`)
            : null,
        ),

        // —— 未入名单目录 ——
        h(
          'div',
          { style: { marginTop: '12px' } },
          h(SectionTitle, {
            title: `未入名单的 ${(model.paths && model.paths.root) || ''} 一层目录`,
            hint: `${unlisted.length} 个 · 仅目录名，不读任何目录内容`,
            right: h(Button, { label: props.showUnlisted ? '收起' : '展开', onClick: props.onToggleUnlisted }),
          }),
          props.showUnlisted
            ? h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '240px', overflow: 'auto' } },
                unlisted.map((dir) =>
                  h(
                    'span',
                    { key: dir.name, style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
                    h(
                      'span',
                      { style: { fontSize: '12px', color: dir.suspect ? C.warn : C.dim } },
                      dir.name,
                    ),
                    h(Button, { label: '加入名单', disabled: props.busy, onClick: () => props.onAskAdd(dir.name) }),
                  ),
                ),
              )
            : null,
        ),

        // —— 孤儿键 ——
        stateOnly.length > 0
          ? h(
              'div',
              { style: { marginTop: '12px', border: `1px solid ${C.warn}`, borderRadius: '12px', padding: '10px 12px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 700, color: C.warn } }, '孤儿键（状态里有、名单里没有）'),
                h('span', { style: { flex: '1 1 auto' } }),
                h(Button, { label: `清理 ${stateOnly.length} 个`, disabled: props.busy, onClick: props.onPrune }),
              ),
              stateOnly.map((row) => h(Line, { key: row.name }, `${row.name} = ${row.level}（${row.levelLabel}）${row.group ? ` · 组：${row.group}` : ''}`)),
            )
          : null,

        // —— 工具 / agent 读法 + 审计（折叠） ——
        h(
          'details',
          { style: { marginTop: '16px', borderTop: `1px solid ${C.border}`, paddingTop: '8px' } },
          h('summary', { style: { cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: C.text } }, '工具 / agent 侧怎么读这个状态'),
          h(Line, null, `状态文件（唯一真身）：${model.paths.state} · 级别键：${levels.map((item) => item.level).join(' / ')}`),
          h(Line, null, '受管辖通道：node <插件目录>\\bin\\gate.mjs status'),
          h(Line, null, '判定（不动手）：… check --name <名> --op read|write|delete|traverse（也可 --path <绝对路径>）；被拒时退出码 3'),
          h(Line, null, '工具执行门：宿主 tools/pre-execute 钩子；判定与通道同一套 checkAccess，拒绝文案会回到模型'),
          (model.policy || []).map((line) => h(Line, { key: line }, `· ${line}`)),
        ),
        h(
          'details',
          { style: { marginTop: '8px' } },
          h(
            'summary',
            { style: { cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: C.text } },
            `审计（最近 ${(model.audit && model.audit.entries.length) || 0} 条 / 共 ${(model.audit && model.audit.total) || 0} 条）`,
          ),
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

        h(
          Line,
          { style: { marginTop: '16px' } },
          '纪律：本页只读写两个配置文件（状态 JSON / 名单 TXT）、列出盘根一层目录名，并对名单里**显式列出的路径**做一次存在性判定 —— **不读任何受管对象内部内容**；' +
            '改名单前自动备份到回收站；开关即落盘，重启后保持。名单缺失 / 损坏时通道与工具门**一律拒绝**（fail-closed）。列出的目录名不代表已授权访问。',
        ),
      )
    }

    /** 有状态的一层：只负责取数与动作，渲染全交给 GateView。 */
    function GatePage() {
      const [model, setModel] = useState(null)
      const [busy, setBusy] = useState(false)
      const [picking, setPicking] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [showUnlisted, setShowUnlisted] = useState(false)
      const [pending, setPending] = useState(null)
      const [pathInput, setPathInput] = useState('')
      const [menuFor, setMenuFor] = useState(null)
      const [groupDraft, setGroupDraft] = useState({ select: '', text: '' })
      const [newGroupOpen, setNewGroupOpen] = useState(false)
      const [newGroupDraft, setNewGroupDraft] = useState({ name: '', note: '' })

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

      const run = useCallback(async (action, successText) => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const result = await action()
          if (result && result.report) setModel(result.report)
          else await load()
          if (successText) setNotice(typeof successText === 'function' ? successText(result) : successText)
          return result
        } catch (err) {
          setError(err.message)
          return null
        } finally {
          setBusy(false)
        }
      }, [load])

      const pickLevel = useCallback(
        (name, level) =>
          run(
            () => post(`${BASE}/level`, { name, level }),
            (result) => `${result.name} → ${result.levelLabel}（${result.level}）· 已落盘，重启后保持`,
          ),
        [run],
      )

      const pickGroupLevel = useCallback(
        (group, level) =>
          run(
            () => post(`${BASE}/group-level`, { group, level }),
            (result) => `组「${result.group}」${result.count} 个对象 → ${result.levelLabel}（${result.level}）`,
          ),
        [run],
      )

      const pickFolder = useCallback(async () => {
        setPicking(true)
        setError(null)
        setNotice(null)
        try {
          const result = await post(`${BASE}/pick`, {})
          if (result && result.ok && result.path) {
            setPathInput(result.path)
            setNotice(`已选择：${result.path} —— 点「加入名单」确认`)
          }
        } catch (err) {
          setError(`${err.message}（可改用下方"未入名单的一层目录"或手动输入）`)
        } finally {
          setPicking(false)
        }
      }, [])

      const applyGroup = useCallback(
        (name) =>
          run(
            () => {
              const group = (groupDraft.text || '').trim() || groupDraft.select || ''
              return post(`${BASE}/group`, { action: 'assign', name, group })
            },
            (result) => (result.group ? `「${result.name}」已归入组「${result.group}」` : `「${result.name}」已取消分组`),
          ).then(() => {
            setMenuFor(null)
            setGroupDraft({ select: '', text: '' })
          }),
        [run, groupDraft],
      )

      const createGroup = useCallback(
        () =>
          run(
            async () => {
              try {
                return await post(`${BASE}/group`, {
                  action: 'create',
                  group: (newGroupDraft.name || '').trim(),
                  note: (newGroupDraft.note || '').trim(),
                })
              } catch (err) {
                const text = String(err && err.message ? err.message : err)
                // 宿主半还停在旧代码（旧路由只认 assign / delete）⇒ 说人话，别让人猜
                if (text.includes('assign / delete') || text.includes('assign / delete，收到')) {
                  throw new Error('宿主半还是旧版：请重启一次 dsh，再点「创建」')
                }
                throw err
              }
            },
            (result) => `已新建分组「${result.group}」（空组 · 0 个成员）`,
          ).then((result) => {
            if (result) {
              setNewGroupOpen(false)
              setNewGroupDraft({ name: '', note: '' })
            }
          }),
        [run, newGroupDraft],
      )

      const dropToGroup = useCallback(
        (name, group) =>
          run(
            () => post(`${BASE}/group`, { action: 'assign', name, group }),
            (result) => (result.group ? `「${result.name}」已拖入组「${result.group}」` : `「${result.name}」已拖出分组`),
          ),
        [run],
      )

      const deleteGroup = useCallback(
        (group) =>
          run(
            () => post(`${BASE}/group`, { action: 'delete', group }),
            (result) => `组「${result.group}」已删除（${result.released.length} 个成员保留）`,
          ).then(() => setMenuFor(null)),
        [run],
      )

      const confirmPending = useCallback(async () => {
        if (!pending) return
        await run(
          () => post(`${BASE}/roster`, { action: pending.action, name: pending.name }),
          (result) =>
            `名单${result.action === 'add' ? '加入' : '移除'}「${result.name}」已落盘` +
            `（备份：${result.backup || '原文件不存在，无需备份'}）` +
            (result.stateNote ? ` · ${result.stateNote}` : ''),
        )
        setPending(null)
      }, [pending, run])

      const prune = useCallback(
        () => run(() => post(`${BASE}/prune`, {}), (result) => `已清理 ${result.removed.length} 个孤儿键`),
        [run],
      )

      return h(GateView, {
        model,
        busy,
        picking,
        error,
        notice,
        pending,
        showUnlisted,
        pathInput,
        menuFor,
        groupDraft,
        newGroupOpen,
        newGroupDraft,
        onRefresh: load,
        onPickLevel: pickLevel,
        onPickGroupLevel: pickGroupLevel,
        onPickFolder: pickFolder,
        onPathInput: setPathInput,
        onAskAddPath: () => {
          const value = (pathInput || '').trim()
          if (value) setPending({ action: 'add', name: value })
        },
        onAskAdd: (name) => setPending({ action: 'add', name }),
        onAskRemove: (name) => setPending({ action: 'remove', name }),
        onConfirmPending: confirmPending,
        onCancelPending: () => setPending(null),
        onToggleUnlisted: () => setShowUnlisted((value) => !value),
        onToggleMenu: (key) => {
          setMenuFor((current) => (current === key ? null : key))
          setGroupDraft({ select: '', text: '' })
        },
        onGroupSelect: (value) => setGroupDraft((draft) => ({ ...draft, select: value, text: '' })),
        onGroupText: (value) => setGroupDraft((draft) => ({ ...draft, text: value, select: '' })),
        onApplyGroup: applyGroup,
        onDeleteGroup: deleteGroup,
        onDropToGroup: dropToGroup,
        onToggleNewGroup: () => setNewGroupOpen((open) => !open),
        onNewGroupName: (value) => setNewGroupDraft((draft) => ({ ...draft, name: value })),
        onNewGroupNote: (value) => setNewGroupDraft((draft) => ({ ...draft, note: value })),
        onCreateGroup: createGroup,
        onPrune: prune,
      })
    }

    function apply(ctx) {
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
          `[dsh-isolation-gate] client: 「门禁」行 + 整页已挂到 slots（order ${PANEL_ORDER}，紧贴「技能」5 下方）`,
        )
      } catch (error) {
        console.error('[dsh-isolation-gate] client: 槽位注册失败', error)
      }
    }

    return {
      apply,
      inject: ['slots'],
      __selftest: { GateView, GateIcon, Segmented, ObjectRow, GroupCard, PANEL_ID, PANEL_ORDER },
    }
  },
})
