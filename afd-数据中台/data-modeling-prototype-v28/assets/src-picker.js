/* ==========================================================================
   源表切换器 src-picker —— 左栏「当前 ODS 源表」的高级切换交互
   --------------------------------------------------------------------------
   替换原来那个原生 <select>（10 个 option 平铺、不能搜、看不出切过去的后果）。

   设计目标（大厂级 Combobox）：
     1. 触发器 = 「当前源表」本身（点击 / Enter / ⇧⌘K 唤起），不再有独立的下拉行
     2. 搜索：表名 / 中文名 / 目标表 / 数据源 / 源端表名 / 字段名 全维度匹配，命中处 <mark> 高亮
     3. 分组：按**数据源**分组（MySQL · 汇文流通 / ALEPH…），组标题带「可清洗/本组张数」
        —— 候选来自 DF.integration.ODS_TABLES（29 张 / 12 个数据源），不是只看 SOURCES 那 10 张；
        没配清洗任务的表（nc）显式标注「未配清洗任务」，点了不切表、只给出下一步（2026-09-18）
     4. 键盘：↑↓ 移动（循环）、↵ 切换、Esc 关闭、Home/End，焦点不逃逸
     5. 后果预知：高亮行直接回答「切过去会发生什么」——
        角色齐备度（同类 / 缺 X）+ 模板适配结果（N 项规则不适用 / 模板可完整适配）
     6. 一致性：**两个召唤点、一套浮层** —— 面包屑第三段（#crumb-table）与左栏当前表卡片
        （#src-trigger）都只是"打开同一个 srcpick"，没有第二套长得不一样的切换 UI。
        ⚠ 2026-09-21 整合：原来顶部还有第三个「📋 切换源表」按钮，与上面两处完全同功能，
          只是位置更远（对象在左上角、入口在右上角 = 对象与入口分离）→ 已下线。
     7. 无障碍：role=button/listbox/option + aria-expanded / aria-activedescendant

   ⚠ 本文件必须挂在 cleaning.js **之后**（依赖 SOURCES / esc / clone / adaptConfig 等全局，
     且 cleaning.js 末尾会同步跑一次 renderAll()）。
   ⚠ 浮层挂在 document.body 上、position:fixed：左栏 .src-panel 是 overflow-y:auto，
     挂在里面会被裁切。
   ========================================================================== */

let SRCPICK_ANCHOR = null;   // 触发元素（用于定位 + 关闭后把焦点还回去）
let SRCPICK_IDX = 0;         // 键盘高亮项在 SRCPICK_ROWS 中的下标
let SRCPICK_ROWS = [];       // 当前过滤结果（扁平，仅可见项）
let SRCPICK_CACHE = {};      // name -> 后果预知（每次打开重算，避免配置改了还拿旧结论）
const SRCPICK_CTX = { groupWidth: 0 };

/* ---------- 小工具 ---------- */
function srcFmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿行';
  if (n >= 1e4) return (n / 1e4).toFixed(2) + ' 万行';
  return n + ' 行';
}
// 转义 + 把命中片段包进 <mark>（q 为空则只转义）
function srcHi(text, q) {
  const t = String(text == null ? '' : text);
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(t);
  return esc(t.slice(0, i))
    + '<mark class="srcpick__mk">' + esc(t.slice(i, i + q.length)) + '</mark>'
    + esc(t.slice(i + q.length));
}
function srcPickEl() { return document.getElementById('srcpick'); }
function srcPickOpen() { const el = srcPickEl(); return !!el && el.classList.contains('is-open'); }

/* ---------- 切换后果预知 ----------
   ⚠ 绝不能复用 adaptPipeline()：它是「就地适配」，会把 s.config = r.config 写回全局 pipeline。
     那样「只是打开一下切换器」就会把当前表的规则悄悄改掉（0 报错、静默改配置）。
     这里在 pipeline 的**克隆副本**上重放一遍，结论与真实切换完全一致，但现场分毫不动。 */
function srcConsequence(name) {
  if (SRCPICK_CACHE[name]) return SRCPICK_CACHE[name];
  const target = SOURCES[name];
  if (!target) return null;
  const gap = roleGapLabels(target);
  let dropped = 0, manual = 0;
  try {
    const tplRoles = activeRoles();
    const ro = renameOutOf(pipeline);          // 与 adaptPipeline 一致：全程只算一次
    const opts = batchOpts();
    const sim = pipeline.map(s => ({ id: s.id, config: clone(s.config) }));  // 一次性快照，只读
    sim.forEach(s => {
      const r = adaptConfig(s.id, s.config, target, opts, tplRoles, ro);
      s.config = r.config;                     // 写在副本上，模拟出「下一步看到的是适配后的配置」
      dropped += r.dropped.length;
      manual += r.manual.length;
    });
  } catch (e) { /* 预知失败不影响切换本身 */ }
  const out = { gap, dropped, manual, total: dropped + manual };
  SRCPICK_CACHE[name] = out;
  return out;
}
function srcConsequenceText(c) {
  if (!c) return { cls: '', text: '' };
  if (c.total === 0) return { cls: 'is-ok', text: '✓ 模板可完整适配该表' };
  const parts = [];
  if (c.dropped) parts.push(`${c.dropped} 项规则不适用`);
  if (c.manual) parts.push(`${c.manual} 项需人工确认`);
  return { cls: 'is-warn', text: '⚠ 切换后：' + parts.join(' · ') };
}

/* ---------- 浮层骨架（只建一次，之后只刷列表） ---------- */
function srcPickBuild() {
  let el = srcPickEl();
  if (el) return el;
  el = document.createElement('div');
  el.id = 'srcpick';
  el.className = 'srcpick';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '切换当前编辑的源表');
  el.innerHTML = `
    <div class="srcpick__search">
      <span class="srcpick__ico" aria-hidden="true">🔎</span>
      <input id="srcpick-q" class="srcpick__q" type="text" autocomplete="off" spellcheck="false"
             placeholder="搜索表名 / 中文名 / 数据源 / 字段名" aria-label="搜索源表"
             role="combobox" aria-expanded="true" aria-controls="srcpick-list" aria-autocomplete="list">
      <span class="srcpick__cnt" id="srcpick-cnt"></span>
    </div>
    <div class="srcpick__list" id="srcpick-list" role="listbox" aria-label="源表列表"></div>
    <div class="srcpick__foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>↵</kbd> 切换</span>
      <span><kbd>Esc</kbd> 关闭</span>
      <span class="srcpick__foot-tip">切表后字段 / 预览 / SQL 同步刷新</span>
    </div>`;
  document.body.appendChild(el);

  const q = el.querySelector('#srcpick-q');
  q.addEventListener('input', () => { SRCPICK_IDX = 0; srcPickRender(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); srcPickMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); srcPickMove(-1); }
    else if (e.key === 'Home') { e.preventDefault(); SRCPICK_IDX = 0; srcPickHighlight(true); }
    else if (e.key === 'End') { e.preventDefault(); SRCPICK_IDX = Math.max(0, SRCPICK_ROWS.length - 1); srcPickHighlight(true); }
    else if (e.key === 'Enter') { e.preventDefault(); srcPickCommit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSrcPicker(true); }
  });
  // Tab 走开 = 浮层跟着关掉（ARIA combobox 的推荐行为）。否则焦点跑到别处、浮层还挂在那儿像个幽灵。
  // ⚠ 代价是必须兜住「点击条目」：blur 会抢在 click 之前把浮层 display:none 掉，click 就不再触发。
  //   下面 list 的 mousedown preventDefault 就是干这个的。
  q.addEventListener('blur', () => {
    setTimeout(() => {
      const box = srcPickEl();
      if (box && box.contains(document.activeElement)) return;   // 焦点仍在浮层内 → 不关
      if (srcPickOpen()) closeSrcPicker(false);
    }, 0);
  });

  const list = el.querySelector('#srcpick-list');
  list.addEventListener('mousedown', e => { e.preventDefault(); });
  // 鼠标划过 = 键盘高亮：hover 与 ↑↓ 走同一套高亮/后果提示，视线不会跳
  list.addEventListener('mouseover', e => {
    const item = e.target.closest ? e.target.closest('.srcpick__item') : null;
    if (!item) return;
    const i = Number(item.dataset.idx);
    if (i !== SRCPICK_IDX) { SRCPICK_IDX = i; srcPickHighlight(false); }
  });
  list.addEventListener('click', e => {
    const item = e.target.closest ? e.target.closest('.srcpick__item') : null;
    if (!item) return;
    srcPickCommit(item.dataset.name);
  });
  return el;
}

/* ---------- 候选目录：按「数据源 → 它下面的 ODS 表」组织 ----------
   ⚠ 事实源是 DF.integration.ODS_TABLES（与 02b/02c 同一份，29 张 / 12 个数据源），
     不再只看清洗页自己的 10 张 SOURCES。否则用户在「数据源管理」里认识的表
     （ds-003 编目库的 holding、ds-014 门禁的 gate_visit…）到了清洗页就凭空消失。

   每张表分两档：
     ready  已配清洗任务：id 在 SOURCES 里 → 有字段清单 + 样例行 + 语义角色，能真跑流水线
     nc     未配清洗任务：只在 ODS 注册表里 → **显式标注并给出下一步**，绝不静默失败 */
function srcPickCatalog() {
  const intg = window.DF && window.DF.integration;
  const rows = [];
  if (intg && Array.isArray(intg.ODS_TABLES)) {
    const label = intg.SOURCE_LABEL || {};
    intg.ODS_TABLES.forEach(t => {
      const s = SOURCES[t.id];
      rows.push({
        name: t.id, kind: s ? 'ready' : 'nc',
        cn: (s && s.cn) || t.cn || '', target: (s && s.target) || t.tgt || '',
        domain: t.domain || (s && s.domain) || '', fields: (s && s.fields) || null,
        ds: t.ds || '', dsLabel: label[t.ds] || t.ds || '未知数据源',
        srcDb: t.srcDb || '', srcTable: t.srcTable || '', status: t.status || '', note: t.note || '',
      });
    });
    // 兜底：清洗页有模板、但还没登记进集成注册表的表也得能被选到（否则新加模板就"隐身"）
    Object.values(SOURCES).forEach(s => {
      if (rows.some(r => r.name === s.name)) return;
      rows.push({ name: s.name, kind: 'ready', cn: s.cn, target: s.target, domain: s.domain || '',
                  fields: s.fields, ds: '', dsLabel: '未登记在集成注册表', srcDb: '', srcTable: '', status: '' });
    });
  } else {
    // 没加载集成注册表时的降级：退回清洗页自己的 10 张（功能不残废，只是缺数据源维度）
    Object.values(SOURCES).forEach(s => {
      rows.push({ name: s.name, kind: 'ready', cn: s.cn, target: s.target, domain: s.domain || '',
                  fields: s.fields, ds: '', dsLabel: '未加载 ODS 注册表', srcDb: '', srcTable: '', status: '' });
    });
  }
  const META = (intg && intg.STATUS_META) || {};
  const stOrd = k => (META[k] && META[k].order != null ? META[k].order : 9);
  const byDs = new Map();
  rows.forEach(r => {
    const key = r.dsLabel || '其他';
    if (!byDs.has(key)) byDs.set(key, []);
    byDs.get(key).push(r);
  });
  const groups = [...byDs.entries()].map(([label, list]) => {
    list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ready' ? -1 : 1)
      || (stOrd(a.status) - stOrd(b.status))
      || String(a.name).localeCompare(String(b.name)));
    return { label, ds: (list.find(x => x.ds) || {}).ds || '', list };
  });
  // 有 ds 编号的组按编号排；没有的（兜底组）垫底
  groups.sort((a, b) => (a.ds ? 0 : 1) - (b.ds ? 0 : 1) || String(a.ds).localeCompare(String(b.ds)) || a.label.localeCompare(b.label));
  return groups;
}
function srcPickBadge(s) {
  if (s.kind === 'nc') {
    return `<span class="srcpick__badge srcpick__badge--nc" title="该表已在 ODS 层同步，但还没有清洗任务">未配清洗任务</span>`;
  }
  const c = srcConsequence(s.name);
  const gap = (c && c.gap) || [];
  return gap.length
    ? `<span class="srcpick__badge srcpick__badge--warn" title="该表缺少当前模板需要的语义角色：${esc(gap.join('、'))}">缺 ${esc(gap.join('/'))}</span>`
    : `<span class="srcpick__badge srcpick__badge--ok" title="当前模板需要的语义角色齐备">同类</span>`;
}

/* ---------- 渲染 ---------- */
function srcPickMatch(s, ql) {
  if (!ql) return true;
  if (String(s.name).toLowerCase().includes(ql)) return true;
  if (String(s.cn || '').toLowerCase().includes(ql)) return true;
  if (String(s.target || '').toLowerCase().includes(ql)) return true;
  if (String(s.domain || '').toLowerCase().includes(ql)) return true;
  // 新增两个维度：按**数据源**搜（「ALEPH」「MaxCompute」）和按**源端表名**搜（holding / bib_record）
  if (String(s.dsLabel || '').toLowerCase().includes(ql)) return true;
  if (String(s.srcTable || '').toLowerCase().includes(ql)) return true;
  // 按字段名也能找到表：「哪张表有这个字段」（只有已配清洗任务的表有字段清单）
  return (s.fields || []).some(f =>
    String(f.name || '').toLowerCase().includes(ql) || String(f.cn || '').toLowerCase().includes(ql));
}
function srcPickRender() {
  const list = document.getElementById('srcpick-list');
  const qEl = document.getElementById('srcpick-q');
  if (!list || !qEl) return;
  const q = (qEl.value || '').trim();
  const ql = q.toLowerCase();
  const groups = srcPickCatalog();
  const total = groups.reduce((n, g) => n + g.list.length, 0);
  const META = (window.DF && DF.integration && DF.integration.STATUS_META) || {};
  SRCPICK_ROWS = [];
  let html = '';
  groups.forEach(g => {
    const hit = g.list.filter(s => srcPickMatch(s, ql));
    if (!hit.length) return;
    const ready = hit.filter(s => s.kind === 'ready').length;
    // 组标题右边报「可清洗/本组张数」：一眼看出这个数据源里有多少张能直接进清洗
    const tally = ready < hit.length ? `${ready}/${hit.length}` : String(hit.length);
    html += `<div class="srcpick__group"><span>${srcHi(g.label, q)}${g.ds ? `<em class="srcpick__ds">${esc(g.ds)}</em>` : ''}</span><span class="srcpick__group-n">${tally}</span></div>`;
    hit.forEach(s => {
      const idx = SRCPICK_ROWS.length;
      SRCPICK_ROWS.push(s);
      const cur = s.name === ACTIVE_SRC;
      const badge = srcPickBadge(s);
      const head = `<span class="srcpick__row1">${srcHi(s.name, q)}${cur ? '<span class="srcpick__cur">当前</span>' : ''}${badge}</span>`;
      const sub = `<span class="srcpick__row2">${srcHi(s.cn, q)} → ${srcHi(s.target || '—', q)}</span>`;
      let mid;
      if (s.kind === 'nc') {
        const st = (META[s.status] || {}).label || '';
        mid = `<span class="srcpick__conseq is-none">${esc(st)}${st ? ' · ' : ''}${esc(s.srcDb)}${s.srcTable ? '.' + esc(s.srcTable) : ''} · 需先建清洗任务</span>`;
      } else {
        // 当前表不展示「切换后果」：已经在它上面了，再谈"切换后"是误导 → 换成中性说明
        const ct = cur ? { cls: 'is-cur', text: '当前正在编辑' } : srcConsequenceText(srcConsequence(s.name));
        mid = `<span class="srcpick__conseq ${ct.cls}">${esc(ct.text)}</span>`;
      }
      html += `<div class="srcpick__item${cur ? ' is-current' : ''}${s.kind === 'nc' ? ' is-nc' : ''}" role="option"
        id="srcpick-opt-${idx}" data-idx="${idx}" data-name="${esc(s.name)}" data-kind="${s.kind}" aria-selected="${cur ? 'true' : 'false'}">
        <span class="srcpick__mark" aria-hidden="true">${cur ? '◉' : (s.kind === 'nc' ? '·' : '○')}</span>
        <span class="srcpick__body">${head}${sub}${mid}</span>
      </div>`;
    });
  });
  if (!SRCPICK_ROWS.length) {
    html = `<div class="srcpick__empty">没有匹配「${esc(q)}」的源表
      <span class="srcpick__empty-tip">试试表名（circ）、中文名（借阅）、数据源（ALEPH）或字段名（reader_id）</span></div>`;
  }
  list.innerHTML = html;
  const cnt = document.getElementById('srcpick-cnt');
  if (cnt) cnt.textContent = q ? `${SRCPICK_ROWS.length}/${total}` : `${total} 张`;
  // 默认把高亮落在「当前表」上：打开就能看到自己现在在哪、往下按一下就是邻居
  const curIdx = SRCPICK_ROWS.findIndex(s => s.name === ACTIVE_SRC);
  SRCPICK_IDX = curIdx >= 0 ? curIdx : 0;
  srcPickHighlight(true);
}
function srcPickHighlight(scroll) {
  const list = document.getElementById('srcpick-list');
  if (!list) return;
  [...list.querySelectorAll('.srcpick__item')].forEach(el => {
    const on = Number(el.dataset.idx) === SRCPICK_IDX;
    el.classList.toggle('is-hi', on);
    // 后果提示只在高亮行展开：列表保持干净，但「切过去的代价」一眼可见
    const cq = el.querySelector('.srcpick__conseq');
    if (cq) cq.classList.toggle('is-shown', on);
  });
  const qEl = document.getElementById('srcpick-q');
  if (qEl) qEl.setAttribute('aria-activedescendant', 'srcpick-opt-' + SRCPICK_IDX);
  const cur = list.querySelector('.srcpick__item.is-hi');
  if (cur && scroll && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
}
function srcPickMove(d) {
  const n = SRCPICK_ROWS.length;
  if (!n) return;
  SRCPICK_IDX = (SRCPICK_IDX + d + n) % n;
  srcPickHighlight(true);
}

/* ---------- 定位 ---------- */
function srcPickPosition() {
  const el = srcPickEl(), a = SRCPICK_ANCHOR;
  if (!el || !a || !a.getBoundingClientRect) return;
  const r = a.getBoundingClientRect();
  const W = el.offsetWidth || 372;
  const H = el.offsetHeight || 420;
  const pad = 12, gap = 6;
  let left = Math.max(pad, Math.min(r.left, window.innerWidth - W - pad));
  let top = r.bottom + gap;
  if (top + H > window.innerHeight - pad) {
    const above = r.top - H - gap;
    top = above >= pad ? above : Math.max(pad, window.innerHeight - H - pad);
  }
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
}

/* ---------- 开关 ---------- */
// 无参调用时的锚点兜底 —— 按「当前对象所在处优先」：
//   ① 面包屑第三段的表名触发器（#crumb-table）：表名最自然的位置，也是 P0 修的「死文本」
//   ② 左栏当前表卡片（#src-trigger）：字段列表的正上方
// ⚠ 2026-09-21：顶栏「📋 切换源表」按钮已下线（与左栏卡片、面包屑三处同功能 → 收口成两个召唤点）。
//   这里**不再**用 button[onclick*="openSourceSwitcher"] 反查 DOM —— 那个选择器在面包屑也做成
//   <button> 之后会命中两个元素，取到哪个完全依赖 DOM 顺序，太脆。
function srcPickDefaultAnchor() {
  return document.getElementById('crumb-table') || document.getElementById('src-trigger');
}
function openSrcPicker(anchor) {
  const a = (anchor && anchor.nodeType === 1) ? anchor : srcPickDefaultAnchor();
  const el = srcPickBuild();
  SRCPICK_ANCHOR = a || null;
  SRCPICK_CACHE = {};                       // 配置可能已改（撤销 / 改规则），后果必须重算
  const qEl = document.getElementById('srcpick-q');
  if (qEl) qEl.value = '';
  srcPickRender();
  el.classList.add('is-open');
  srcPickPosition();
  if (SRCPICK_ANCHOR && SRCPICK_ANCHOR.setAttribute) SRCPICK_ANCHOR.setAttribute('aria-expanded', 'true');
  if (qEl) requestAnimationFrame(() => { try { qEl.focus(); qEl.select(); } catch (e) {} });
  return el;
}
// 统一入口：面包屑表名（#crumb-table）与左栏当前表卡片（#src-trigger）都走这里 ——
// 传 this 则锚在调用元素下方；不传则按 srcPickDefaultAnchor() 兜底（面包屑优先）。
function openSourceSwitcher(anchor) { return openSrcPicker(anchor); }

function closeSrcPicker(focusBack) {
  const el = srcPickEl();
  if (el) el.classList.remove('is-open');
  if (SRCPICK_ANCHOR && SRCPICK_ANCHOR.setAttribute) {
    SRCPICK_ANCHOR.setAttribute('aria-expanded', 'false');
    if (focusBack) { try { SRCPICK_ANCHOR.focus(); } catch (e) {} }
  }
  SRCPICK_ANCHOR = null;
}

// 提交：真正切表交给 switchSource()（它自己负责 toast / recompute / 记历史）
function srcPickCommit(name) {
  const row = name ? SRCPICK_ROWS.find(r => r.name === name) : SRCPICK_ROWS[SRCPICK_IDX];
  const target = (row && row.name) || name || '';
  const el = srcPickEl();
  if (el) el.classList.remove('is-open');
  if (SRCPICK_ANCHOR && SRCPICK_ANCHOR.setAttribute) SRCPICK_ANCHOR.setAttribute('aria-expanded', 'false');
  SRCPICK_ANCHOR = null;
  if (!target) return;
  if (target === ACTIVE_SRC) { DF.app.toast(`当前编辑的就是 ${target}`, 'info', 1300); return; }
  // 未配清洗任务的表：**不做假切换**。假装切过去只会让左栏显示一张其实没规则的"当前表"，
  // 用户以为配好了 —— 所以这里明确说清它卡在哪、下一步该去哪。
  if (row && row.kind === 'nc') {
    DF.app.toast(`「${row.cn || target}」已在 ODS 同步，但还没有清洗任务 —— 先到「数据源管理 → 库表结构」或「ODS 数据表」为它建清洗任务`, 'warning', 3800);
    return;
  }
  switchSource(target);
}

/* ---------- 全局行为 ---------- */
// 点浮层外或点触发元素自己 = 关闭
document.addEventListener('mousedown', e => {
  if (!srcPickOpen()) return;
  const el = srcPickEl();
  if (el && el.contains(e.target)) return;
  if (SRCPICK_ANCHOR && SRCPICK_ANCHOR.contains && SRCPICK_ANCHOR.contains(e.target)) return;
  closeSrcPicker(false);
}, true);
// ⇧⌘K 唤起 / 收起（⌘K 已被「规则模板库」占用，故取同族的 ⇧⌘K）
document.addEventListener('keydown', e => {
  if (!((e.metaKey || e.ctrlKey) && e.shiftKey)) return;
  if (String(e.key).toLowerCase() !== 'k') return;
  e.preventDefault();
  if (srcPickOpen()) closeSrcPicker(true);
  // 走统一兜底（面包屑优先），不再硬写 #src-trigger —— 保持"三条路径一个解析规则"
  else openSrcPicker(srcPickDefaultAnchor());
});
// 浮层跟着触发元素走
window.addEventListener('resize', () => { if (srcPickOpen()) srcPickPosition(); });
window.addEventListener('scroll', () => { if (srcPickOpen()) srcPickPosition(); }, true);

// 把新快捷键登记进「? 快捷键帮助」（不改 cleaning.js，避免两份 SHORTCUTS 打架）
try {
  const i = SHORTCUTS.findIndex(r => /模板库/.test(r[0]));
  SHORTCUTS.splice(i < 0 ? SHORTCUTS.length : i + 1, 0, ['切换源表', ['⇧', '⌘', 'K']]);
} catch (e) { /* SHORTCUTS 结构变了也不影响主功能 */ }
