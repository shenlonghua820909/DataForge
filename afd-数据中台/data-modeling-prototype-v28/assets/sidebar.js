// ============ 共享左侧 Sidebar 组件 ============
// 用法: 任何页面 body 顶部 <div id="df-sidebar-mount"></div> 即自动注入
// 注入后会在 body 加上 .has-sidebar 类，自动调整布局

(function() {
  // 菜单项数据：每页 { key, label, count, href, group, pageKey }
  // 用根相对路径（/pages/XX.html），任何位置都能正确解析
  const HR = (p) => '/pages/' + p;
  const INDEX = '/index.html';

  const MENU = [
    { key: 'index', label: '工作台', icon: '🏠', href: INDEX, group: null },
    { group: 'data-integration', icon: '🔌', label: '数据集成', items: [
      { key: 'data-source', label: '数据源', count: 28, href: HR('02b-data-sources.html') },
      { key: 'data-cleaning', label: '数据清洗', count: 12, href: HR('15-data-cleaning.html') },
      { key: 'sync-task', label: '同步任务', count: 186, href: 'javascript:void(0);', action: 'showSyncTasks' },
      { key: 'realtime', label: '实时同步', count: 28, href: 'javascript:void(0);', action: 'showRealtimeSync' },
    ]},
    { group: 'data-standards', icon: '📋', label: '数据标准', items: [
      { key: '06-data-standards', label: '标准总览', count: 218, href: HR('06-data-standards.html') },
      { key: '06a-entity-standards', label: '· 实体标准', count: 12, href: HR('06a-entity-standards.html'), isSub: true },
      { key: '06b-attribute-standards', label: '· 属性标准', count: 186, href: HR('06b-attribute-standards.html'), isSub: true },
      { key: '06c-code-standards', label: '· 码值标准', count: 186, href: HR('06c-code-standards.html'), isSub: true },
      { key: '06d-mapping-rules', label: '· 映射规则', count: 86, href: HR('06d-mapping-rules.html'), isSub: true },
    ]},
    { group: 'data-modeling', icon: '🏗️', label: '数据建模', items: [
      { key: '02-warehouse-planning', label: '数仓规划', count: 5, href: HR('02-warehouse-planning.html') },
      { key: '03-dimensional-modeling', label: '维度建模', count: 342, href: HR('03-dimensional-modeling.html') },
      { key: '04-relation-graph', label: '关系图', href: HR('04-relation-graph.html') },
      { key: '13-reverse-modeling', label: '逆向建模', href: HR('13-reverse-modeling.html') },
    ]},
    { group: 'data-dev', icon: '⚙️', label: '数据开发', items: [
      { key: '11-data-lineage', label: '数据血缘', href: HR('11-data-lineage.html') },
      { key: '09-version-compare', label: '版本对比', href: HR('09-version-compare.html') },
      { key: 'task-orch', label: '任务编排', count: 86, href: 'javascript:void(0);', action: 'showTaskOrch' },
      { key: 'function', label: '函数计算', count: 34, href: 'javascript:void(0);', action: 'showFunctions' },
    ]},
    { group: 'data-service', icon: '📊', label: '数据服务', items: [
      { key: '07-metrics-system', label: '指标体系', count: 87, href: HR('07-metrics-system.html') },
      { key: 'api-mgmt', label: 'API 管理', count: 52, href: 'javascript:void(0);', action: 'showAPIMgmt' },
      { key: 'data-dl', label: '数据下载', href: 'javascript:void(0);', action: 'showDataDownload' },
    ]},
    { group: 'data-quality', icon: '🛡️', label: '数据质量', items: [
      { key: 'quality-mon', label: '质量监控', count: 142, href: 'javascript:void(0);', action: 'showQualityMonitor' },
      { key: 'alert', label: '告警中心', count: 5, href: 'javascript:void(0);', action: 'showAlertCenter' },
    ]},
    { group: 'data-map', icon: '🗺️', label: '数据地图', items: [
      { key: '08-model-library', label: '模型库', href: HR('08-model-library.html') },
      { key: 'search', label: '全局检索', href: 'javascript:void(0);', action: 'showGlobalSearch' },
      { key: 'catalog', label: '资产目录', href: 'javascript:void(0);', action: 'showAssetCatalog' },
    ]},
    { group: 'ops', icon: '🔧', label: '运维中心', items: [
      { key: '10-publish-workflow', label: '发布工作流', href: HR('10-publish-workflow.html') },
      { key: 'sched-monitor', label: '调度监控', count: 42, href: 'javascript:void(0);', action: 'showScheduleMonitor' },
      { key: 'audit', label: '操作审计', href: 'javascript:void(0);', action: 'showAuditLog' },
    ]},
  ];

  function renderHTML() {
    let html = `<aside class="sidebar" id="df-sidebar">
      <div class="sidebar__brand" onclick="DF.app.go('${INDEX}')" style="cursor:pointer;">
        <div class="sidebar__logo">DF</div>
        <div class="sidebar__brand-text">
          DataForge
          <small>智能数据建模平台</small>
        </div>
      </div>
      <nav class="sidebar__menu">`;
    MENU.forEach(m => {
      if (!m.group) {
        // 顶部工作台独立项
        html += `<a class="menu-item" href="${m.href}" data-key="${m.key}">
          <span>${m.icon}</span><span>${m.label}</span>
        </a>`;
      } else {
        html += `<div class="menu-group" data-key="${m.group}">
          <div class="menu-group__title" onclick="DF.sidebar.toggle(this)">
            <span class="menu-group__icon">${m.icon}</span>
            <span>${m.label}</span>
            <span class="arrow">▸</span>
          </div>
          <div class="menu-group__items">`;
        m.items.forEach(it => {
          const cnt = it.count ? `<span class="count">${it.count}</span>` : '';
          const actionAttr = it.action ? `data-action="${it.action}"` : '';
          html += `<a class="menu-item" href="${it.href}" data-page="${it.key}" ${actionAttr}>
            <span>${it.label}</span>${cnt}
          </a>`;
        });
        html += `</div></div>`;
      }
    });
    html += `</nav>
      <div class="sidebar__footer" onclick="DF.app.toast('用户中心 - 演示中','info')" style="cursor:pointer;">
        <div class="avatar avatar--blue">王</div>
        <div>
          <div style="color:#E2E8F0; font-size: 12px;">王芳</div>
          <div style="color:#64748B; font-size: 10px;">数据架构组 · 管理员</div>
        </div>
      </div>
    </aside>`;
    return html;
  }

  // ============ Sidebar API ============
  DF.sidebar = {
    mounted: false,
    currentPage: '',
    activeGroup: 'data-standards',  // 数据标准组默认展开

    init() {
      // 推断当前页
      const path = location.pathname;
      const file = path.split('/').pop() || 'index.html';
      this.currentPage = file.replace('.html', '');

      // 注入
      const mount = document.getElementById('df-sidebar-mount');
      if (mount) {
        mount.outerHTML = renderHTML();
      } else {
        const tmp = document.createElement('div');
        tmp.innerHTML = renderHTML();
        document.body.insertBefore(tmp.firstChild, document.body.firstChild);
      }

      // body 加 has-sidebar 类
      document.body.classList.add('has-sidebar');

      // 包装 main 元素
      this._wrapMain();

      // 高亮当前菜单
      this._highlight();

      // 绑定 action 子菜单
      this._bindActions();

      this.mounted = true;
    },

    _bindActions() {
      document.querySelectorAll('.menu-item[data-action]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const act = el.dataset.action;
          if (this[act] && typeof this[act] === 'function') {
            this[act]();
          }
        });
      });
    },

    _wrapMain() {
      const sidebar = document.getElementById('df-sidebar');
      if (!sidebar) return;
      if (document.querySelector('.df-app')) return;

      // 找到 sidebar 之后的所有 body 子元素
      const wrap = document.createElement('div');
      wrap.className = 'main-content';
      let el = sidebar.nextSibling;
      while (el) {
        const next = el.nextSibling;
        wrap.appendChild(el);
        el = next;
      }
      const app = document.createElement('div');
      app.className = 'df-app';
      document.body.appendChild(app);
      app.appendChild(sidebar);
      app.appendChild(wrap);
    },

    _highlight() {
      const item = document.querySelector(`.menu-item[data-page="${this.currentPage}"]`);
      if (item) {
        item.classList.add('active');
        const group = item.closest('.menu-group');
        if (group) group.classList.add('open');
      } else if (this.currentPage === 'index' || this.currentPage === '') {
        const home = document.querySelector('.menu-item[data-key="index"]');
        if (home) home.classList.add('active');
      } else {
        const group = document.querySelector(`.menu-group[data-key="${this.activeGroup}"]`);
        if (group) group.classList.add('open');
      }
    },

    toggle(titleEl) {
      const group = titleEl.closest('.menu-group');
      if (group) group.classList.toggle('open');
    },

    // ============ 子菜单 13 个死链真实化 ============
    // 工具
    _sidebarModal(title, body, width = 720) {
      DF.app.modal({ title, body, width });
    },
    showDataSources() {
      const list = [
        { icon: '🗄️', name: 'MySQL 复旦流通', type: 'RDBMS', status: 'running', count: '12.5M 行', last: '2 分钟前' },
        { icon: '🗄️', name: 'Oracle 汇文 ALEPH', type: 'RDBMS', status: 'running', count: '8.2M 行', last: '5 分钟前' },
        { icon: '📊', name: 'Hive 数仓 ODS', type: '数据仓库', status: 'running', count: '184M 行', last: '10 分钟前' },
        { icon: '🔍', name: 'Elasticsearch 检索', type: '搜索引擎', status: 'running', count: '8.5M 文档', last: '1 分钟前' },
        { icon: '📁', name: 'MARC 21 文件交换', type: 'FTP', status: 'syncing', count: '2,840 文件', last: '30 分钟前' },
        { icon: '🌐', name: 'CALIS 馆际互借 API', type: 'REST API', status: 'running', count: '实时', last: '5 秒前' },
        { icon: '📡', name: 'OAI-PMH 元数据收割', type: 'OAI-PMH', status: 'running', count: '1.2M 记录', last: '4 小时前' },
        { icon: '☁️', name: '阿里云 OSS 对象存储', type: 'OSS', status: 'running', count: '3.2 TB', last: '8 分钟前' },
      ];
      const body = `
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:13px;">
          <div>共 <b>42</b> 个数据源，<b style="color:#10B981;">38</b> 运行中，<b style="color:#F59E0B;">3</b> 同步中，<b style="color:#EF4444;">1</b> 异常</div>
          <button class="btn btn--primary btn--sm" onclick="DF.app.toast('已打开新增数据源向导','info')">+ 新增数据源</button>
        </div>
        <div style="max-height:400px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          ${list.map(s => `
            <div style="padding:12px 14px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:12px;">
              <div style="font-size:20px;">${s.icon}</div>
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;color:#111728;">${s.name}</div>
                <div style="font-size:11px;color:#6B7691;margin-top:2px;">${s.type} · ${s.count} · ${s.last}</div>
              </div>
              <span class="pill pill--${s.status === 'running' ? 'green' : 'amber'}" style="font-size:11px;">${s.status === 'running' ? '运行中' : '同步中'}</span>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('🔌 数据源管理', body, 760);
    },
    showSyncTasks() {
      const tasks = [
        { name: 'ods_bib_record 全量同步', src: 'MySQL 汇文', tgt: 'Hive ODS', freq: '每日 02:00', status: 'success', duration: '12 分钟', rows: '184,720' },
        { name: 'ods_loan_trans 增量同步', src: 'MySQL 流通', tgt: 'Hive ODS', freq: '每 5 分钟', status: 'running', duration: '进行中', rows: '8,932' },
        { name: 'MARC 21 文件导入', src: 'FTP 服务器', tgt: 'Hive ODS', freq: '每 4 小时', status: 'success', duration: '3 分钟', rows: '2,840' },
        { name: 'CALIS 馆际互借同步', src: 'CALIS API', tgt: 'MySQL 复旦', freq: '每 15 分钟', status: 'success', duration: '< 1 秒', rows: '128' },
        { name: 'OAI-PMH 元数据收割', src: 'OAI 服务器', tgt: 'Hive ODS', freq: '每日 06:00', status: 'failed', duration: '超时 30 分钟', rows: '0' },
        { name: '电子资源 COUNTER 统计', src: '电子资源平台', tgt: 'ES', freq: '每日 03:00', status: 'success', duration: '8 分钟', rows: '5,280' },
      ];
      const body = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
          <div style="padding:10px;background:#D1FAE5;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#10B981;">172</div><div style="font-size:11px;color:#6B7691;">成功</div></div>
          <div style="padding:10px;background:#FEF3C7;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#F59E0B;">8</div><div style="font-size:11px;color:#6B7691;">运行中</div></div>
          <div style="padding:10px;background:#FEE2E2;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#EF4444;">3</div><div style="font-size:11px;color:#6B7691;">失败</div></div>
          <div style="padding:10px;background:#F0F9FF;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#1E40AF;">3</div><div style="font-size:11px;color:#6B7691;">暂停</div></div>
        </div>
        <div style="max-height:380px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          ${tasks.map(t => `
            <div style="padding:10px 14px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:500;">${t.name}</div>
                <div style="font-size:11px;color:#6B7691;margin-top:2px;">${t.src} → ${t.tgt} · ${t.freq}</div>
              </div>
              <div style="text-align:right;font-size:11px;color:#6B7691;">
                <div>${t.duration} · ${t.rows} 行</div>
              </div>
              <span class="pill pill--${t.status === 'success' ? 'green' : t.status === 'running' ? 'amber' : 'danger'}" style="font-size:11px;">${t.status === 'success' ? '成功' : t.status === 'running' ? '运行中' : '失败'}</span>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('🔄 同步任务', body, 760);
    },
    showRealtimeSync() {
      const body = `
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">实时同步任务通过 CDC（Change Data Capture）监听源库 binlog 增量变更，秒级同步到下游：</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="padding:14px;background:#F0F9FF;border-radius:6px;text-align:center;">
            <div style="font-size:24px;margin-bottom:4px;">📡</div>
            <div style="font-size:18px;font-weight:600;color:#1E40AF;">28</div>
            <div style="font-size:11px;color:#6B7691;">实时任务</div>
          </div>
          <div style="padding:14px;background:#D1FAE5;border-radius:6px;text-align:center;">
            <div style="font-size:24px;margin-bottom:4px;">⚡</div>
            <div style="font-size:18px;font-weight:600;color:#10B981;">~1.2s</div>
            <div style="font-size:11px;color:#6B7691;">平均延迟</div>
          </div>
          <div style="padding:14px;background:#FEF3C7;border-radius:6px;text-align:center;">
            <div style="font-size:24px;margin-bottom:4px;">📈</div>
            <div style="font-size:18px;font-weight:600;color:#F59E0B;">12.5k</div>
            <div style="font-size:11px;color:#6B7691;">事件/秒</div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">活跃 CDC 通道</div>
        <div style="border:1px solid #E2E8F0;border-radius:6px;padding:14px;">
          ${Array.from({length: 4}, (_, i) => `
            <div style="padding:8px 0;${i > 0 ? 'border-top:1px solid #F1F5F9;' : ''}">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                <span><b>${['MySQL-汇文流通 → Hive ODS','Oracle-ALEPH 编目 → Hive ODS','MySQL-读者库 → ES 检索','Oracle-馆藏 → ES 检索'][i]}</b></span>
                <span style="color:#10B981;">运行中</span>
              </div>
              <div style="background:#E2E8F0;border-radius:2px;height:4px;overflow:hidden;">
                <div style="width:${[87, 65, 92, 73][i]}%;height:100%;background:linear-gradient(90deg,#3B82F6,#1E40AF);"></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('⚡ 实时同步', body, 700);
    },
    showTaskOrch() {
      const body = `
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">DAG 任务编排 — 86 个调度任务按依赖关系自动执行：</div>
        <div style="background:#FAFBFC;border:1px solid #E2E8F0;border-radius:6px;padding:16px;">
          <svg width="640" height="280" viewBox="0 0 640 280">
            <defs>
              <marker id="orch-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#94A3B8"/></marker>
            </defs>
            <line x1="120" y1="40" x2="120" y2="240" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4 4"/>
            <line x1="320" y1="40" x2="320" y2="240" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4 4"/>
            <line x1="520" y1="40" x2="520" y2="240" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4 4"/>
            <text x="120" y="20" text-anchor="middle" font-size="11" font-weight="600" fill="#6B7691">ODS 原始数据层</text>
            <text x="320" y="20" text-anchor="middle" font-size="11" font-weight="600" fill="#6B7691">DWD 明细层</text>
            <text x="520" y="20" text-anchor="middle" font-size="11" font-weight="600" fill="#6B7691">DWT 主题汇总层</text>
            ${[
              {x:80, y:50, w:80, h:32, label:'ods_bib_record', c:'#FEF3C7', s:'#92400E'},
              {x:80, y:100, w:80, h:32, label:'ods_loan_trans', c:'#FEF3C7', s:'#92400E'},
              {x:80, y:150, w:80, h:32, label:'ods_patron_info', c:'#FEF3C7', s:'#92400E'},
              {x:80, y:200, w:80, h:32, label:'ods_hold_item', c:'#FEF3C7', s:'#92400E'},
              {x:280, y:75, w:80, h:32, label:'dwd_bib_unified', c:'#D1FAE5', s:'#065F46'},
              {x:280, y:150, w:80, h:32, label:'dwd_loan_circ', c:'#D1FAE5', s:'#065F46'},
              {x:280, y:200, w:80, h:32, label:'dwd_patron_beh', c:'#D1FAE5', s:'#065F46'},
              {x:480, y:100, w:80, h:32, label:'dwt_bib_dim', c:'#FCE7F3', s:'#9F1239'},
              {x:480, y:200, w:80, h:32, label:'dwt_loan_daily', c:'#FCE7F3', s:'#9F1239'},
            ].map(n => `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="${n.c}" stroke="${n.s}" stroke-width="1.2"/><text x="${n.x + n.w/2}" y="${n.y + n.h/2 + 4}" text-anchor="middle" font-size="10" font-weight="500" fill="${n.s}">${n.label}</text>`).join('')}
            ${['M 160 66 L 280 91','M 160 116 L 280 91','M 160 116 L 280 166','M 160 166 L 280 166','M 160 166 L 280 216','M 160 216 L 280 216','M 360 91 L 480 116','M 360 166 L 480 116','M 360 216 L 480 216'].map(d => `<path d="${d}" stroke="#94A3B8" stroke-width="1" fill="none" marker-end="url(#orch-arrow)"/>`).join('')}
          </svg>
        </div>
        <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn btn--sm" onclick="DF.app.toast('已生成调度日历','info')">📅 调度日历</button>
          <button class="btn btn--primary btn--sm" onclick="DF.app.toast('✓ 任务编排已保存','success')">💾 保存编排</button>
        </div>
      `;
      this._sidebarModal('⚙️ 任务编排', body, 720);
    },
    showFunctions() {
      const fns = [
        { name: 'STRING_CLEAN', desc: '去除字符串首尾空格、全角转半角', group: '字符串', usage: '128k' },
        { name: 'ISBN_CHECK', desc: 'ISBN-13 校验位计算 + 格式标准化', group: '校验', usage: '86k' },
        { name: 'MARC_PARSE', desc: 'MARC21 / CNMARC XML 解析为字段', group: '解析', usage: '64k' },
        { name: 'CN_ROMANIZE', desc: '中文姓名 → 拼音 (Hanyu Pinyin)', group: '转换', usage: '42k' },
        { name: 'CLS_LOOKUP', desc: '中图法分类号查表补全', group: '查找', usage: '38k' },
        { name: 'CALIS_FORMAT', desc: 'CALIS 馆际互借 ISO 10160 报文格式化', group: '协议', usage: '12k' },
      ];
      const body = `
        <div style="margin-bottom:12px;font-size:13px;color:#475569;">共 <b>34</b> 个内置函数，按分组：字符串 / 校验 / 解析 / 转换 / 查找 / 协议</div>
        <div style="max-height:400px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          ${fns.map(f => `
            <div style="padding:12px 14px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:12px;">
              <span class="pill pill--code">${f.group}</span>
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;color:#1E40AF;" class="text-mono">${f.name}</div>
                <div style="font-size:11px;color:#6B7691;margin-top:2px;">${f.desc}</div>
              </div>
              <div style="text-align:right;font-size:11px;color:#6B7691;">${f.usage} 调用</div>
              <button class="btn btn--sm" style="font-size:11px;padding:3px 8px;" onclick="DF.app.toast('已插入函数 ${f.name}','success')">插入</button>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('ƒ 函数计算', body, 720);
    },
    showAPIMgmt() {
      const apis = [
        { name: '/api/v1/bib/search', desc: '书目全文检索', calls: '128k/日', latency: '128ms', status: 'ok' },
        { name: '/api/v1/loan/checkout', desc: '借出登记', calls: '8.2k/日', latency: '186ms', status: 'ok' },
        { name: '/api/v1/patron/profile', desc: '读者画像', calls: '42k/日', latency: '95ms', status: 'ok' },
        { name: '/api/v1/ill/request', desc: '馆际互借请求', calls: '284/日', latency: '342ms', status: 'ok' },
        { name: '/api/v1/hold/transfer', desc: '馆藏调拨', calls: '1.2k/日', latency: '208ms', status: 'ok' },
        { name: '/api/v1/recommend', desc: '个性化推荐', calls: '86k/日', latency: '184ms', status: 'degraded' },
      ];
      const body = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="padding:10px;background:#F0F9FF;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#1E40AF;">52</div><div style="font-size:11px;color:#6B7691;">API 数量</div></div>
          <div style="padding:10px;background:#D1FAE5;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#10B981;">99.4%</div><div style="font-size:11px;color:#6B7691;">SLA 达成</div></div>
          <div style="padding:10px;background:#FEF3C7;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#F59E0B;">182ms</div><div style="font-size:11px;color:#6B7691;">平均延迟</div></div>
        </div>
        <div style="max-height:380px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          ${apis.map(a => `
            <div style="padding:10px 14px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px;">
              <div style="font-size:12px;font-weight:600;color:#1E40AF;" class="text-mono">${a.name}</div>
              <div style="flex:1;font-size:12px;">${a.desc}</div>
              <div style="font-size:11px;color:#6B7691;">${a.calls}</div>
              <div style="font-size:11px;color:#6B7691;">${a.latency}</div>
              <span class="pill pill--${a.status === 'ok' ? 'green' : 'amber'}" style="font-size:10px;">${a.status === 'ok' ? '正常' : '降级'}</span>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('🔌 API 管理', body, 760);
    },
    showDataDownload() {
      const body = `
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">数据下载中心 — 提供多种格式数据导出：</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
          ${[
            { icon: '📊', name: '借阅数据', desc: '近 30 天借还记录', size: '12.4 MB', rows: '89,632' },
            { icon: '👤', name: '读者画像', desc: '读者分群 + 活跃度', size: '8.2 MB', rows: '42,180' },
            { icon: '📚', name: '馆藏清单', desc: '完整馆藏单册', size: '24.8 MB', rows: '184,720' },
            { icon: '📈', name: '指标快照', desc: '87 个指标月报', size: '2.1 MB', rows: '87' },
            { icon: '🏷️', name: '主题词表', desc: 'CALIS + 本馆扩展', size: '5.6 MB', rows: '12,480' },
            { icon: '🔗', name: '馆际互借', desc: 'CALIS 互借记录', size: '1.8 MB', rows: '1,284' },
          ].map(d => `
            <div style="padding:14px;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;" onclick="DF.app.toast('✓ 已开始下载：${d.name}.csv (${d.size})','success',3000)">
              <div style="font-size:24px;margin-bottom:6px;">${d.icon}</div>
              <div style="font-size:13px;font-weight:600;">${d.name}</div>
              <div style="font-size:11px;color:#6B7691;margin:4px 0;">${d.desc}</div>
              <div style="display:flex;justify-content:space-between;font-size:11px;color:#94A3B8;">
                <span>${d.rows} 行</span><span>${d.size}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('📥 数据下载', body, 640);
    },
    showQualityMonitor() {
      const body = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="padding:12px;background:#D1FAE5;border-radius:6px;text-align:center;"><div style="font-size:20px;font-weight:600;color:#10B981;">96.8%</div><div style="font-size:11px;color:#6B7691;">完整率</div></div>
          <div style="padding:12px;background:#D1FAE5;border-radius:6px;text-align:center;"><div style="font-size:20px;font-weight:600;color:#10B981;">99.2%</div><div style="font-size:11px;color:#6B7691;">准确率</div></div>
          <div style="padding:12px;background:#FEF3C7;border-radius:6px;text-align:center;"><div style="font-size:20px;font-weight:600;color:#F59E0B;">0.8%</div><div style="font-size:11px;color:#6B7691;">重复率</div></div>
          <div style="padding:12px;background:#FEF3C7;border-radius:6px;text-align:center;"><div style="font-size:20px;font-weight:600;color:#F59E0B;">86</div><div style="font-size:11px;color:#6B7691;">未达标规则</div></div>
        </div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">📋 实时监控规则</div>
        <div style="max-height:300px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          ${[
            { table: 'ods_bib_record', rule: 'ISBN 格式校验', pass: '99.8%', fail: '420' },
            { table: 'ods_loan_trans', rule: '读者证号存在性', pass: '99.2%', fail: '720' },
            { table: 'ods_patron_info', rule: '手机号格式', pass: '98.6%', fail: '584' },
            { table: 'dwd_bib_unified', rule: '题名非空', pass: '100%', fail: '0' },
            { table: 'dwt_loan_daily', rule: '借还数量 = sum(loan_trans)', pass: '100%', fail: '0' },
            { table: 'dwd_hold_location', rule: '索书号规范', pass: '84.2%', fail: '12,432' },
          ].map(r => `
            <div style="padding:10px 14px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px;">
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:500;">${r.rule}</div>
                <div style="font-size:11px;color:#94A3B8;" class="text-mono">${r.table}</div>
              </div>
              <div style="text-align:right;font-size:12px;">
                <div style="color:${parseFloat(r.pass) >= 99 ? '#10B981' : '#F59E0B'};font-weight:600;">${r.pass}</div>
                <div style="font-size:11px;color:#94A3B8;">${r.fail} 异常</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('🛡️ 质量监控', body, 760);
    },
    showAlertCenter() {
      // 复用 01 页面那个
      if (typeof showAlertCenter === 'function') { showAlertCenter(); return; }
      DF.app.toast('告警中心：共 5 条未处理告警', 'warning');
    },
    showGlobalSearch() {
      const body = `
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">全局检索覆盖范围：</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="padding:14px;background:#F0F9FF;border-radius:6px;text-align:center;">
            <div style="font-size:24px;font-weight:600;color:#1E40AF;">218</div>
            <div style="font-size:12px;color:#6B7691;margin-top:4px;">📋 数据标准</div>
          </div>
          <div style="padding:14px;background:#D1FAE5;border-radius:6px;text-align:center;">
            <div style="font-size:24px;font-weight:600;color:#10B981;">342</div>
            <div style="font-size:12px;color:#6B7691;margin-top:4px;">📊 数据表</div>
          </div>
          <div style="padding:14px;background:#FCE7F3;border-radius:6px;text-align:center;">
            <div style="font-size:24px;font-weight:600;color:#9F1239;">87</div>
            <div style="font-size:12px;color:#6B7691;margin-top:4px;">📈 指标</div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🔍 快速入口</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button class="btn" onclick="DF.app.go('/pages/06-data-standards.html')" style="justify-content:flex-start;">📋 数据标准中心</button>
          <button class="btn" onclick="DF.app.go('/pages/08-model-library.html')" style="justify-content:flex-start;">🏗️ 模型库</button>
          <button class="btn" onclick="DF.app.go('/pages/03-dimensional-modeling.html')" style="justify-content:flex-start;">📊 数据表</button>
          <button class="btn" onclick="DF.app.go('/pages/07-metrics-system.html')" style="justify-content:flex-start;">📈 指标体系</button>
        </div>
        <div style="margin-top:14px;padding:10px 12px;background:#F0F9FF;border-radius:6px;font-size:12px;color:#1E40AF;">
          💡 提示：在任何页面按 <kbd>⌘K</kbd> 唤起全局搜索面板。
        </div>
      `;
      this._sidebarModal('🔍 全局检索', body, 640);
    },
    showAssetCatalog() {
      const cats = [
        { icon: '📊', name: '数据表', count: '342', desc: 'ODS/DWD/DWT/ADS' },
        { icon: '📋', name: '数据标准', count: '218', desc: '实体/属性/码值/映射' },
        { icon: '📈', name: '指标', count: '87', desc: '原子/派生/复合' },
        { icon: '🏷️', name: '标签', count: '128', desc: '读者分群/学科/资源' },
        { icon: '📁', name: '文件', count: '2,840', desc: 'MARC 交换 / 报告' },
        { icon: '🔌', name: 'API', count: '52', desc: 'REST API / SDK' },
      ];
      const body = `
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">数据资产目录：分类浏览全馆数据资产</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
          ${cats.map(c => `
            <div style="padding:14px;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;text-align:center;" onclick="DF.app.toast('已打开：${c.name} 目录','info')">
              <div style="font-size:32px;margin-bottom:6px;">${c.icon}</div>
              <div style="font-size:18px;font-weight:600;color:#1E40AF;">${c.count}</div>
              <div style="font-size:13px;font-weight:500;margin-top:4px;">${c.name}</div>
              <div style="font-size:11px;color:#94A3B8;margin-top:2px;">${c.desc}</div>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('🗺️ 资产目录', body, 640);
    },
    showScheduleMonitor() {
      const body = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="padding:10px;background:#D1FAE5;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#10B981;">178</div><div style="font-size:11px;color:#6B7691;">已运行</div></div>
          <div style="padding:10px;background:#FEF3C7;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#F59E0B;">8</div><div style="font-size:11px;color:#6B7691;">排队中</div></div>
          <div style="padding:10px;background:#F0F9FF;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#1E40AF;">42</div><div style="font-size:11px;color:#6B7691;">今日计划</div></div>
          <div style="padding:10px;background:#FEE2E2;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:600;color:#EF4444;">3</div><div style="font-size:11px;color:#6B7691;">失败</div></div>
        </div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">⏰ 今日调度时间线</div>
        <div style="background:#FAFBFC;border:1px solid #E2E8F0;border-radius:6px;padding:14px;">
          ${[
            { time: '00:30', task: 'ods_loan_trans 增量', status: 'success', dur: '2 分' },
            { time: '02:00', task: 'ods_bib_record 全量', status: 'success', dur: '12 分' },
            { time: '03:00', task: '电子资源 COUNTER 统计', status: 'success', dur: '8 分' },
            { time: '06:00', task: 'OAI-PMH 元数据收割', status: 'failed', dur: '超时 30 分' },
            { time: '08:30', task: 'dwd_bib_unified 整合', status: 'running', dur: '进行中' },
            { time: '12:00', task: 'dwt_loan_daily 汇总', status: 'pending', dur: '待执行' },
            { time: '18:00', task: 'dwt_ill_kpi 汇总', status: 'pending', dur: '待执行' },
          ].map(t => `
            <div style="display:flex;align-items:center;gap:12px;padding:6px 0;${t !== undefined ? '' : ''}">
              <span style="width:50px;font-size:12px;color:#6B7691;" class="text-mono">${t.time}</span>
              <span style="flex:1;font-size:12px;">${t.task}</span>
              <span style="font-size:11px;color:#6B7691;">${t.dur}</span>
              <span class="pill pill--${t.status === 'success' ? 'green' : t.status === 'running' ? 'amber' : t.status === 'failed' ? 'danger' : 'code'}" style="font-size:10px;">${t.status === 'success' ? '成功' : t.status === 'running' ? '运行中' : t.status === 'failed' ? '失败' : '待执行'}</span>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('⏰ 调度监控', body, 760);
    },
    showAuditLog() {
      const logs = [
        { who: '王芳', av: '王', action: '发布模型 dwt_bib_dim v4.2', target: 'dwt_bib_dim', time: '今天 09:30', ip: '10.0.12.42' },
        { who: '李明', av: '李', action: '审核通过 std_author_name v2.1', target: 'std_author_name', time: '今天 08:45', ip: '10.0.12.58' },
        { who: '陈刚', av: '陈', action: '新建数据标准 std_publisher_country', target: 'std_publisher_country', time: '昨天 18:20', ip: '10.0.12.41' },
        { who: '张明', av: '张', action: '提交映射规则 MARC21 020', target: 'std_bib_isbn', time: '昨天 16:10', ip: '10.0.12.62' },
        { who: '系统', av: 'DF', action: 'ETL 任务 dwd_bib_unified 全量同步', target: 'dwd_bib_unified', time: '昨天 02:15', ip: 'system' },
        { who: '冯老师', av: '冯', action: '导出数据 借阅记录_202608', target: 'ods_loan_trans', time: '前天 17:00', ip: '10.0.12.85' },
        { who: '林华', av: '林', action: '登录系统', target: '—', time: '前天 09:00', ip: '10.0.12.71' },
        { who: '吴敏', av: '吴', action: '查询读者 P00284672', target: 'ods_patron_info', time: '3 天前 14:22', ip: '10.0.12.78' },
      ];
      const body = `
        <div style="font-size:13px;color:#475569;margin-bottom:12px;">近 7 天操作审计 · 共 <b>1,284</b> 条记录</div>
        <div style="max-height:420px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          ${logs.map(l => `
            <div style="padding:10px 14px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:10px;">
              <div class="avatar avatar--blue" style="width:28px;height:28px;font-size:12px;">${l.av}</div>
              <div style="flex:1;">
                <div style="font-size:13px;"><b>${l.who}</b> ${l.action}</div>
                <div style="font-size:11px;color:#6B7691;margin-top:2px;">目标：<span class="text-mono">${l.target}</span> · IP ${l.ip}</div>
              </div>
              <div style="font-size:11px;color:#94A3B8;">${l.time}</div>
            </div>
          `).join('')}
        </div>
      `;
      this._sidebarModal('📋 操作审计', body, 760);
    },
  };
})();

