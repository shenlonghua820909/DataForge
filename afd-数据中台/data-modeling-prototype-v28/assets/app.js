/* ========================================================================
   DataForge · App Utilities
   ----------------------------------------------------------------------
   通用工具：Toast、Modal、路由、Tab、表单、状态、动画等
   ======================================================================== */

(function () {
  if (!window.DF) window.DF = {};

  const Store = {
    get(key, def) {
      try { const v = localStorage.getItem('df_' + key); return v ? JSON.parse(v) : def; }
      catch { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('df_' + key, JSON.stringify(val)); } catch {}
    },
  };

  // ====== Toast 通知 ======
  let toastContainer;
  function ensureToast() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.style.cssText = 'position:fixed;top:80px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(toastContainer);
    }
  }
  function toast(message, type = 'info', duration = 2400) {
    ensureToast();
    const el = document.createElement('div');
    const colors = {
      success: { bg: '#E6F7EE', color: '#0E7A3D', icon: '✓' },
      error: { bg: '#FFECEC', color: '#B01B20', icon: '✕' },
      warning: { bg: '#FFF6E5', color: '#B66F00', icon: '⚠' },
      info: { bg: '#EEF4FF', color: '#103FA8', icon: 'ⓘ' },
    };
    const c = colors[type] || colors.info;
    el.style.cssText = `background:${c.bg};color:${c.color};padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.1);min-width:200px;max-width:400px;display:flex;align-items:center;gap:8px;animation:slideInRight .3s ease;border:1px solid ${c.color}22;`;
    el.innerHTML = `<span style="font-weight:700;font-size:14px;">${c.icon}</span> ${message}`;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // ====== Modal 模态框 ======
  function modal({ title, body, actions, width = 520, replace = true }) {
    return new Promise(resolve => {
      // 默认替换掉已存在的弹窗，避免多层 modal 叠在一起
      if (replace) {
        document.querySelectorAll('.df-modal__overlay').forEach(o => o.remove());
      }
      const overlay = document.createElement('div');
      overlay.className = 'df-modal__overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9998;display:grid;place-items:center;animation:fadeIn .2s;';
      const dialog = document.createElement('div');
      dialog.className = 'df-modal__dialog';
      dialog.style.cssText = `background:#fff;border-radius:12px;width:${width}px;max-width:90vw;max-height:90vh;overflow:hidden;box-shadow:0 24px 48px rgba(0,0,0,.2);display:flex;flex-direction:column;animation:scaleIn .2s;`;
      const header = `<div style="padding:16px 24px;border-bottom:1px solid #EEF1F6;display:flex;align-items:center;gap:12px;"><div style="flex:1;font-size:15px;font-weight:600;color:#111728;">${title}</div><button id="modal-close" style="width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#6B7691;font-size:18px;line-height:1;">×</button></div>`;
      const bodyHtml = `<div style="padding:20px 24px;overflow-y:auto;flex:1;">${body}</div>`;
      const footerHtml = actions ? `<div style="padding:12px 24px;border-top:1px solid #EEF1F6;background:#F7F9FC;display:flex;justify-content:flex-end;gap:8px;">${actions}</div>` : '';
      dialog.innerHTML = header + bodyHtml + footerHtml;
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const close = (val) => { overlay.remove(); resolve(val); };
      overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
      dialog.querySelector('#modal-close').addEventListener('click', () => close(null));
      dialog.querySelectorAll('[data-resolve]').forEach(b => {
        b.addEventListener('click', () => close(b.dataset.resolve));
      });
      // 暴露当前 overlay 引用（供调用方主动关掉）
      DF.app._lastOverlay = overlay;
    });
  }

  // ====== 路由跳转 ======
  function go(page, params) {
    if (params && Object.keys(params).length) {
      const qs = Object.entries(params).filter(([k, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      window.location.href = page + (qs ? '?' + qs : '');
    } else {
      window.location.href = page;
    }
  }
  function getQuery(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  // ====== URL 参数加载 / 渲染表详情 ======
  function getTableFromURL() {
    const id = getQuery('id');
    if (!id) return null;
    return DF.data.tables.find(t => t.id === id || t.name === id);
  }

  // ====== Tab 切换（增强版） ======
  function initTabs() {
    document.querySelectorAll('[data-tabs]').forEach(group => {
      const tabs = group.querySelectorAll('[data-tab]');
      const panels = document.querySelectorAll(`[data-tab-panel][data-tab-group="${group.dataset.tabs}"]`);
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('tab--active'));
          tab.classList.add('tab--active');
          panels.forEach(p => p.style.display = p.dataset.tabPanel === tab.dataset.tab ? '' : 'none');
        });
      });
    });
  }

  // ====== 全局点击波纹 ======
  function attachRipple() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.btn:not(.btn--ghost):not(.btn--sm):not(.btn--icon)');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement('span');
      const size = Math.max(rect.width, rect.height);
      ripple.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,.4);width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px;transform:scale(0);animation:ripple .6s ease-out;pointer-events:none;`;
      btn.style.position = btn.style.position || 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  }

  // ====== 死按钮兜底绑定（让所有可见按钮都有响应） ======
  function bindDeadButtons() {
    if (document.body.dataset.deadBound === '1') return;
    document.body.dataset.deadBound = '1';

    const $  = (s, r=document) => r.querySelector(s);
    const $$ = (s, r=document) => [...r.querySelectorAll(s)];
    const textOf = el => (el.textContent || '').trim();
    const hasOwnHandler = el => !!(el.onclick || el.getAttribute('onclick') || el.dataset.deadBound === '1');
    const bind = (el, fn) => { el.dataset.deadBound = '1'; el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(el); }); };

    // 1) 时间段切换（7天/30天/90天）
    $$('[data-period]:not([data-dead-bound])').forEach(btn => {
      if (btn.onclick || btn.getAttribute('onclick')) return;
      btn.dataset.deadBound = '1';
      btn.addEventListener('click', () => {
        const period = parseInt(btn.dataset.period) || 30;
        btn.parentElement.querySelectorAll('[data-period]').forEach(b => {
          b.classList.remove('btn--primary'); b.classList.add('btn--ghost');
        });
        btn.classList.remove('btn--ghost'); btn.classList.add('btn--primary');
        const card = btn.closest('.card');
        const chartEl = card?.querySelector('#gmv-chart, [id$="-chart"]');
        if (chartEl && window.DF.charts && window.DF.data?.kpiTrends) {
          const data = window.DF.data.kpiTrends.gmv.slice(-period);
          window.DF.charts.lineChart(chartEl, data, { width: chartEl.offsetWidth, height: parseInt(chartEl.style.height) || 240 });
        }
        const title = card?.querySelector('.card__title');
        if (title) title.textContent = title.textContent.replace(/\d+日/, period + '日');
        const tag = card?.querySelector('.tag--ghost');
        if (tag) tag.textContent = `最近 ${period} 天`;
        toast(`已切换到 ${period} 天趋势`, 'info', 1200);
      });
    });

    // 2) 通用按钮文本 → 行为 映射
    const acts = {
      '编辑':         () => modal({ title: '编辑', body: '<p>编辑功能（演示）</p><div class="field" style="margin-top:12px;"><div class="field__label">名称</div><input class="input" value="dwt_user_order_daily"></div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">保存</button>' }).then(r => r && toast('已保存（演示）', 'success')),
      '导出 DDL':     () => { navigator.clipboard?.writeText('CREATE TABLE demo (...)').catch(()=>{}); toast('DDL 已复制到剪贴板（演示）', 'success'); },
      '提交发布':     () => modal({ title: '提交发布', body: '<p>确认将本表提交到生产环境？</p><p style="color:var(--warning-500);font-size:12px;margin-top:8px;">⚠ 将触发审批流程，发布后修改需重新走流程</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">提交</button>' }).then(r => r && toast('已提交审批，审批人：李明', 'success')),
      '发布 v3.3':    () => modal({ title: '发布 v3.3', body: '<p>确认将 v3.3 发布到生产环境？</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">发布</button>' }).then(r => r && toast('v3.3 已发布到生产', 'success')),
      '回滚':         () => modal({ title: '回滚版本', body: '<p>确认回滚到上一版本 v3.2？</p><p style="color:var(--warning-500);font-size:12px;margin-top:8px;">⚠ 当前修改将丢失</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--danger" data-resolve="ok">确认回滚</button>' }).then(r => r && toast('已回滚到 v3.2', 'success')),
      '预览 DDL':     () => modal({ title: 'DDL 预览', body: '<pre class="code" style="background:#0F172A;color:#E2E8F0;padding:16px;border-radius:6px;font-size:12px;overflow:auto;line-height:1.6;">CREATE TABLE dwd_trade_order_df (\n  order_id      STRING   COMMENT "订单ID",\n  user_id       STRING   COMMENT "用户ID",\n  shop_id       STRING   COMMENT "门店ID",\n  sku_id        STRING   COMMENT "商品ID",\n  order_amt     DECIMAL  COMMENT "订单金额",\n  discount_amt  DECIMAL  COMMENT "优惠金额",\n  pay_amt       DECIMAL  COMMENT "支付金额",\n  order_status  STRING   COMMENT "订单状态",\n  ds            STRING   COMMENT "分区日期"\n)\nPARTITIONED BY (ds STRING)\nSTORED AS ALIORC;\n</pre>', actions: '<button class="btn btn--primary" data-resolve>关闭</button>', width: 600 }),
      '保存为草稿':   () => toast('已保存为草稿', 'success'),
      '保存草稿':     () => toast('已保存为草稿', 'success'),
      '确认发布':     () => modal({ title: '确认发布', body: '<p>确认发布到生产环境？</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">确认</button>' }).then(r => r && toast('已发布到生产', 'success')),
      '操作历史':     () => modal({ title: '操作历史', body: '<div style="font-size:13px;line-height:2;"><p>📝 <b>2026-08-04 14:32</b> 王芳 提交发布 v3.3</p><p>✅ <b>2026-08-03 11:15</b> 李明 审批通过</p><p>📝 <b>2026-08-02 18:20</b> 王芳 编辑字段，新增 3 个</p><p>🔄 <b>2026-07-28 09:45</b> 系统 自动同步 ETL 任务</p><p>📝 <b>2026-07-20 16:10</b> 王芳 创建模型 v3.0</p></div>', actions: '<button class="btn btn--primary" data-resolve>关闭</button>' }),
      '架构图':       () => modal({ title: '数仓分层架构图', body: '<div style="height:420px;background:linear-gradient(180deg,#F8FAFC,#fff);border:1px solid #E2E8F0;border-radius:8px;padding:24px;display:flex;flex-direction:column;gap:12px;justify-content:center;"><div style="background:#FEF3C7;padding:12px 16px;border-radius:6px;text-align:center;font-weight:600;">📥 ODS · 原始数据层（18 张表）</div><div style="text-align:center;color:#94A3B8;">↓</div><div style="background:#D1FAE5;padding:12px 16px;border-radius:6px;text-align:center;font-weight:600;">📋 DWD · 明细层（含宽表 / 维度主档）（14 张表）</div><div style="text-align:center;color:#94A3B8;">↓</div><div style="background:#FCE7F3;padding:12px 16px;border-radius:6px;text-align:center;font-weight:600;">📊 DWT · 主题汇总层（3 张表）</div><div style="text-align:center;color:#94A3B8;">↓</div><div style="background:#F3E8FF;padding:12px 16px;border-radius:6px;text-align:center;font-weight:600;">📈 ADS · 应用层（5 张表）</div></div>', actions: '<button class="btn btn--primary" data-resolve>关闭</button>', width: 720 }),
      '新建分层':     () => modal({ title: '新建分层', body: '<div class="field"><div class="field__label">分层编码</div><input class="input text-mono" placeholder="如 dmx"></div><div class="field" style="margin-top:12px;"><div class="field__label">分层名称</div><input class="input" placeholder="如 明细模型层"></div><div class="field" style="margin-top:12px;"><div class="field__label">分层说明</div><textarea class="textarea" placeholder="该分层的业务定位..."></textarea></div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">创建</button>' }).then(r => r && toast('分层已创建', 'success')),
      '导入行业模板': () => modal({ title: '导入行业模板', body: '<p style="margin-bottom:12px;">选择要导入的行业模板：</p><div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer;">🛒 <b>零售电商数据模型</b> v2.1 · 38 张表</div><div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer;">💰 <b>金融信贷数据模型</b> v1.5 · 52 张表</div><div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer;">🏥 <b>医疗健康数据模型</b> v1.0 · 28 张表</div><div class="card" style="padding:12px;cursor:pointer;">🏭 <b>智能制造数据模型</b> v2.0 · 41 张表</div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">导入</button>', width: 600 }).then(r => r && toast('已导入 38 张表', 'success')),
      '导入国标':     () => modal({ title: '导入国标', body: '<p>将批量导入以下国标：</p><ul style="margin-top:12px;line-height:2;font-size:13px;"><li>📘 GB/T 38664.1-2020 信息技术 大数据 政务数据开放共享</li><li>📘 GB/T 21063-2007 政务信息资源目录体系</li><li>📘 GB/T 38664.2-2020 政务数据开放共享 第2部分</li></ul>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">开始导入</button>' }).then(r => r && toast('已导入 218 条国标', 'success')),
      '新建标准':     () => modal({ title: '新建数据标准', body: '<div class="field"><div class="field__label">标准类型</div><select class="select"><option>字段标准</option><option>命名标准</option><option>码值标准</option></select></div><div class="field" style="margin-top:12px;"><div class="field__label">标准编码</div><input class="input text-mono" placeholder="如 std_order_status"></div><div class="field" style="margin-top:12px;"><div class="field__label">标准名称</div><input class="input" placeholder="如 订单状态码"></div><div class="field" style="margin-top:12px;"><div class="field__label">说明</div><textarea class="textarea"></textarea></div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">创建</button>' }).then(r => r && toast('标准已创建', 'success')),
      '落标检查':     () => modal({ title: '落标检查结果', body: '<div style="line-height:1.8;"><p style="color:var(--success-500);">✓ 检查通过：<b>218 / 218</b> 标准已落标</p><p style="color:var(--warning-500);">⚠ 警告：<b>3</b> 张表未完全落标</p><div style="margin-top:12px;padding:10px 14px;background:var(--warning-50);border-radius:6px;font-size:12px;">建议检查：<br>• ods_user_event_df (12/14 落标)<br>• dwd_trade_pay_df (8/10 落标)<br>• dwd_shop_info_df (5/5 落标)</div></div>', actions: '<button class="btn btn--primary" data-resolve>关闭</button>' }),
      '添加字段':     () => modal({ title: '添加字段', body: '<div class="field"><div class="field__label">字段名（英文）</div><input class="input text-mono" placeholder="如 user_id"></div><div class="field" style="margin-top:12px;"><div class="field__label">字段类型</div><select class="select"><option>STRING</option><option>INT</option><option>BIGINT</option><option>DECIMAL(18,2)</option><option>DATE</option><option>TIMESTAMP</option></select></div><div class="field" style="margin-top:12px;"><div class="field__label">字段注释</div><input class="input" placeholder="如 用户ID"></div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">添加</button>' }).then(r => r && toast('字段已添加', 'success')),
      '从物理表导入': () => modal({ title: '从物理表导入字段', body: '<div class="field"><div class="field__label">选择物理表</div><select class="select"><option>ods_trade_order · 32 字段</option><option>ods_user_info · 28 字段</option><option>ods_logistics_event · 18 字段</option><option>ods_marketing_campaign · 22 字段</option></select></div><div style="margin-top:12px;padding:10px;background:var(--info-50);border-radius:6px;font-size:12px;color:var(--info-500);">💡 导入后将自动匹配字段名、类型和注释</div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">导入</button>' }).then(r => r && toast('已导入 18 个字段', 'success')),
      '立即运行':     () => modal({ title: '立即运行', body: '<p>确认立即执行此模型构建任务？</p><p style="margin-top:8px;font-size:12px;color:var(--neutral-500);">预计耗时：约 5 分钟</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">执行</button>' }).then(r => r && toast('任务已提交，预计 5 分钟', 'success')),
      '上传我的模型': () => modal({ title: '上传模型', body: '<div style="border:2px dashed var(--neutral-300);border-radius:8px;padding:32px;text-align:center;color:var(--neutral-500);"><div style="font-size:32px;margin-bottom:8px;">📁</div>拖拽 .json / .yaml 文件到此处<br><span style="font-size:12px;">或点击选择文件</span></div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">上传</button>' }),
      '生成模型':     () => modal({ title: '生成模型', body: '<p>将基于当前选中的 <b>12</b> 个字段生成模型</p><p style="margin-top:12px;font-size:12px;color:var(--neutral-500);">模型名：<span class="text-mono">dwd_trade_order_df</span></p><p style="margin-top:8px;font-size:12px;color:var(--neutral-500);">分层：DWD · 明细层</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">生成</button>' }).then(r => r && toast('模型已生成（演示）', 'success')),
      'AI 智能补全':  () => toast('AI 正在补全字段...', 'info', 1500),
      '一键应用':     () => toast('已应用 7 个推荐字段', 'success'),
      '应用':         () => toast('已应用', 'success'),
      '进入 →':       () => go('03-dimensional-modeling.html'),
      '查看模型详情': () => go('05-table-detail.html'),
      '编辑模型':     () => go('05-table-detail.html'),
      '复制 DDL':     () => { navigator.clipboard?.writeText('CREATE TABLE demo (...)').catch(()=>{}); toast('DDL 已复制到剪贴板', 'success'); },
      '提交审批':     () => modal({ title: '提交审批', body: '<p>确认提交给审批人 <b>李明</b>？</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">提交</button>' }).then(r => r && toast('已提交审批', 'success')),
      '筛选':         () => toast('筛选面板（演示）', 'info'),
      '刷新':         () => { location.reload(); },
      '显示设置':     () => toast('显示设置（演示）', 'info'),
      '层级':         () => toast('已切换：按层级展示', 'info', 1000),
      '复制':         () => { navigator.clipboard?.writeText('CREATE TABLE demo (...)').catch(()=>{}); toast('已复制到剪贴板', 'success'); },
      '下载 .sql':    () => downloadFile('-- Generated by DataForge\nCREATE TABLE demo (\n  id BIGINT COMMENT "主键",\n  ds STRING COMMENT "分区"\n);', 'demo_' + Date.now() + '.sql', 'text/sql'),
      '导出架构图':   () => downloadFile('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#F8FAFC"/><text x="400" y="250" text-anchor="middle" font-size="24" fill="#1E40AF">DataForge 架构图</text></svg>', 'architecture.svg', 'image/svg+xml'),
      '保存规划':     () => { const saved = JSON.parse(localStorage.getItem('df_saved_plans') || '[]'); saved.push({ id: 'plan_' + Date.now(), savedAt: new Date().toISOString(), name: '数仓规划' }); localStorage.setItem('df_saved_plans', JSON.stringify(saved)); toast('✓ 数仓规划已保存（计划 #' + saved.length + '）', 'success'); },
      '导出':         () => downloadFile(generateCSV(), 'export_' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv'),
      '导出 PDF':     () => downloadFile(generatePDFReport(), 'report_' + new Date().toISOString().slice(0, 10) + '.html', 'text/html'),
      '导出 API':     () => downloadFile(generateAPIDoc(), 'api_doc_' + new Date().toISOString().slice(0, 10) + '.md', 'text/markdown'),
      '分享':         () => modal({ title: '分享', body: '<p>复制以下链接分享给同事：</p><input class="input" value="https://dataforge.example.com/share/abc123" readonly style="font-family:var(--font-mono);"><div style="margin-top:12px;display:flex;gap:8px;"><button class="btn btn--sm" onclick="navigator.clipboard?.writeText(\'https://dataforge.example.com/share/abc123\');DF.app.toast(\'已复制链接\',\'success\')">📋 复制链接</button><button class="btn btn--sm" onclick="DF.app.toast(\'已通过邮件发送\',\'success\')">📧 邮件发送</button></div>', actions: '<button class="btn btn--primary" data-resolve>关闭</button>' }),
      '导入':         () => modal({ title: '导入', body: '<div style="border:2px dashed var(--neutral-300);border-radius:8px;padding:32px;text-align:center;color:var(--neutral-500);">📁 拖拽文件到此处，或点击选择文件</div>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">开始导入</button>' }).then(r => r && toast('导入成功', 'success')),
      '查看全部':     () => toast('已展开全部（演示）', 'info', 1000),
      '指标趋势':     () => toast('已切换：指标趋势视图', 'info', 1000),
      '居中':         () => toast('已居中显示', 'info', 800),
      '取消':         () => { history.length > 1 ? history.back() : go('01-dashboard.html'); },
      '+ 新建':       () => acts['新建分层'](),
      '+ 添加':       () => acts['添加字段'](),
    };

    // 分层列表/数据域/业务过程（左侧树 tab）— 切换 active + 重新加载树
    const treeTabActions = { '分层列表': 'domain', '数据域': 'domain', '业务过程': 'process' };
    Object.entries(treeTabActions).forEach(([k, t]) => {
      acts[k] = () => {
        const tabs = document.querySelectorAll('.tree-tab, [data-tree-tab]');
        tabs.forEach(tt => tt.classList.remove('active'));
        // 找到并高亮
        document.querySelectorAll('button, .tab').forEach(el => {
          if (el.textContent.trim() === k) el.classList.add('active');
        });
        toast('已切换：' + k, 'info', 1000);
      };
    });

    // 3) 给所有没绑定的 button/a 文本模式匹配
    $$('button, a').forEach(el => {
      if (hasOwnHandler(el)) return;
      if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#' && el.getAttribute('href') !== 'javascript:void(0);') return;
      if (el.closest('.modal, [class*="modal__"], .wizard-actions')) return;
      const text = textOf(el);
      if (!text || text.length > 40) return;
      // 精确匹配
      for (const [k, fn] of Object.entries(acts)) {
        if (text === k) { bind(el, fn); break; }
      }
    });

    // 3.5) 模式匹配：包含特定关键词的（"查看完整" / "展开" / "收起" / "导出" 等）
    const patterns = [
      [/^查看完整/, () => toast('已展开完整内容（演示）', 'info', 1000)],
      [/^展开/, () => toast('已展开（演示）', 'info', 1000)],
      [/^收起/, () => toast('已收起（演示）', 'info', 1000)],
      [/查看完整 \d+ 个/, () => toast('已展开完整列表（演示）', 'info', 1000)],
      [/^查看.*→$/, () => toast('查看详情（演示）', 'info', 1000)],
      [/^展开剩余 \d+ 个/, () => toast('已展开全部（演示）', 'info', 1000)],
      [/^展开未变更/, () => toast('已展开未变更字段（演示）', 'info', 1000)],
      [/^更多/, () => toast('加载更多（演示）', 'info', 1000)],
      [/^订阅/, () => toast('订阅成功（演示）', 'success')],
      [/^对比/, () => toast('已加入对比（演示）', 'success')],
      [/^查看.*详情/, () => go('05-table-detail.html')],
      [/^确认发布/, () => modal({ title: '确认发布', body: '<p>确认发布到生产环境？</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">确认</button>' }).then(r => r && toast('已发布到生产', 'success'))],
      [/^发布 v\d/, () => modal({ title: '发布版本', body: '<p>确认发布当前版本？</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">发布</button>' }).then(r => r && toast('已发布到生产', 'success'))],
      [/^生成模型/, () => modal({ title: '生成模型', body: '<p>将基于当前选中的字段生成模型</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">生成</button>' }).then(r => r && toast('模型已生成（演示）', 'success'))],
      [/^提交审批/, () => modal({ title: '提交审批', body: '<p>确认提交给审批人？</p>', actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">提交</button>' }).then(r => r && toast('已提交审批', 'success'))],
      [/^数据建模$/, () => go('03-dimensional-modeling.html')],
      [/^维度建模$/, () => go('03-dimensional-modeling.html')],
      [/^指标体系$/, () => go('07-metrics-system.html')],
      [/^关系图$/, () => go('04-relation-graph.html')],
      [/^模型库$/, () => go('08-model-library.html')],
      [/^逆向建模$/, () => go('13-reverse-modeling.html')],
      [/^数据标准$/, () => go('06-data-standards.html')],
      [/^数仓规划$/, () => go('02-warehouse-planning.html')],
      [/^工作台$/, () => go('01-dashboard.html')],
      [/^审批中心$/, () => go('10-publish-workflow.html')],
      [/^＋$|^加$|缩放/, () => toast('已缩放（演示）', 'info', 600)],
      [/^−$|^减$|放大|缩小/, () => toast('已缩放（演示）', 'info', 600)],
    ];
    $$('button:not([data-dead-bound]), a:not([data-dead-bound])').forEach(el => {
      if (hasOwnHandler(el)) return;
      if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#' && el.getAttribute('href') !== 'javascript:void(0);') return;
      if (el.closest('.modal, [class*="modal__"], .wizard-actions')) return;
      const text = textOf(el);
      if (!text || text.length > 40) return;
      for (const [re, fn] of patterns) {
        if (re.test(text)) { bind(el, fn); break; }
      }
    });

    // 4) filter-chip / subtab / pager 通用切换
    $$('.filter-chip:not([data-dead-bound])').forEach(chip => {
      if (chip.onclick || chip.getAttribute('onclick')) return;
      chip.dataset.deadBound = '1';
      chip.addEventListener('click', () => {
        chip.parentElement.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        toast('已切换：' + textOf(chip), 'info', 1000);
      });
    });
    // subbar 标签页
    $$('.subbar__tab:not([data-dead-bound])').forEach(tab => {
      if (tab.onclick || tab.getAttribute('onclick')) return;
      tab.dataset.deadBound = '1';
      tab.addEventListener('click', () => {
        const sibs = tab.parentElement.querySelectorAll('.subbar__tab');
        sibs.forEach(s => s.classList.remove('subbar__tab--active'));
        tab.classList.add('subbar__tab--active');
        const t = textOf(tab).split(' ')[0];
        const navMap2 = { '工作台':'01-dashboard.html','数仓规划':'02-warehouse-planning.html','数据标准':'06-data-standards.html','维度建模':'03-dimensional-modeling.html','关系图':'04-relation-graph.html','指标体系':'07-metrics-system.html','模型库':'08-model-library.html','逆向建模':'13-reverse-modeling.html' };
        if (navMap2[t] && !location.pathname.endsWith(navMap2[t])) {
          go(navMap2[t]);
        } else {
          toast('已切换：' + t, 'info', 1000);
        }
      });
    });
    // topbar 导航项
    $$('.topbar__nav-item:not([data-dead-bound])').forEach(item => {
      if (item.onclick || item.getAttribute('onclick')) return;
      item.dataset.deadBound = '1';
      item.addEventListener('click', () => {
        $$('.topbar__nav-item').forEach(i => i.classList.remove('topbar__nav-item--active'));
        item.classList.add('topbar__nav-item--active');
        const t = textOf(item);
        const navMap2 = { '数据集成':'01-dashboard.html','数据建模':'03-dimensional-modeling.html','数据开发':'11-data-lineage.html','数据服务':'07-metrics-system.html','数据质量':'06-data-standards.html','数据地图':'04-relation-graph.html','运维中心':'10-publish-workflow.html' };
        if (navMap2[t] && !location.pathname.endsWith(navMap2[t])) go(navMap2[t]);
        else toast('已选中：' + t, 'info', 1000);
      });
    });
    // 分页器
    $$('.pager-btn:not([data-dead-bound])').forEach(btn => {
      btn.dataset.deadBound = '1';
      btn.addEventListener('click', () => {
        const sibs = btn.parentElement.querySelectorAll('.pager-btn');
        sibs.forEach(s => s.classList.remove('pager-btn--active'));
        btn.classList.add('pager-btn--active');
        const t = textOf(btn);
        if (['‹','›','«','»','上一页','下一页'].includes(t)) toast('翻页（演示）', 'info', 800);
        else toast('已切换到第 ' + t + ' 页', 'info', 800);
      });
    });

    // 5) 字段名 / 表名 / 指标名 短链接（text-mono class 的 <a>）— 弹字段详情
    $$('a.text-mono:not([data-dead-bound])').forEach(a => {
      const text = textOf(a).replace(/[→←]+$/, '').trim();
      if (!text) return;
      a.dataset.deadBound = '1';
      a.style.cursor = 'pointer';
      a.addEventListener('click', e => {
        e.preventDefault();
        const t = (window.DF.data?.tables || []).find(x => x.name === text);
        if (t) { go('05-table-detail.html', { id: t.id }); return; }
        const m = (window.DF.data?.metrics || []).find(x => x.name === text);
        if (m) { go('12-metric-detail.html', { id: m.id }); return; }
        // 兜底：显示字段信息 modal
        modal({
          title: '字段详情 · ' + text,
          body: `<div style="line-height:1.9;font-size:13px;">
            <p><b>字段名：</b><span class="text-mono" style="color:var(--brand-700);">${text}</span></p>
            <p><b>类型：</b>STRING</p>
            <p><b>来源：</b>ods_trade_order</p>
            <p><b>落标：</b><span style="color:var(--success-500);">✓</span> 符合命名规范</p>
            <p><b>血缘：</b>3 个上游 · 8 个下游</p>
          </div>`,
          actions: '<button class="btn btn--primary" data-resolve>关闭</button>',
          width: 480,
        });
      });
    });

    // 5.5) 展开/收起 按钮（"展开剩余 N 个"）
    $$('a:not([data-dead-bound])').forEach(a => {
      if (a.getAttribute('href') && a.getAttribute('href') !== '#') return;
      const text = textOf(a);
      if (/^展开/.test(text) || /^收起/.test(text)) {
        a.dataset.deadBound = '1';
        a.addEventListener('click', e => { e.preventDefault(); toast(text + '（演示）', 'info', 1000); });
      }
    });

    // 6) 补全导航 <a> 的 href（避免「死」导航链接）
    const navMap = {
      '工作台': '01-dashboard.html', '数仓规划': '02-warehouse-planning.html',
      '数据标准': '06-data-standards.html', '维度建模': '03-dimensional-modeling.html',
      '关系图': '04-relation-graph.html', '指标体系': '07-metrics-system.html',
      '模型库': '08-model-library.html', '逆向建模': '13-reverse-modeling.html',
      '数据建模': '03-dimensional-modeling.html',
      '数据集成': '01-dashboard.html', '数据开发': '11-data-lineage.html',
      '数据服务': '07-metrics-system.html', '数据质量': '06-data-standards.html',
      '数据地图': '04-relation-graph.html', '运维中心': '10-publish-workflow.html',
      '审批中心': '10-publish-workflow.html', '监控告警': '01-dashboard.html',
    };
    const layerDomainMap = {
      'DWD · 交易域': '03-dimensional-modeling.html?layer=dwd&domain=trade',
      'DWT · 主题汇总层': '03-dimensional-modeling.html?layer=dwt',
      'ODS · 原始数据层': '03-dimensional-modeling.html?layer=ods',
      'ADS · 应用层': '03-dimensional-modeling.html?layer=ads',
      '交易域': '03-dimensional-modeling.html?domain=trade',
      '用户域': '03-dimensional-modeling.html?domain=user',
      '商品域': '03-dimensional-modeling.html?domain=product',
      '营销域': '03-dimensional-modeling.html?domain=marketing',
      '物流域': '03-dimensional-modeling.html?domain=logistics',
      '支付 (pay_success)': '07-metrics-system.html?process=pay_success',
    };
    $$('a').forEach(a => {
      const href = a.getAttribute('href');
      if (href && href !== '#' && href !== 'javascript:void(0);' && href !== 'javascript:;') return;
      const text = textOf(a);
      // 1) 层+域面包屑
      if (layerDomainMap[text]) { a.href = layerDomainMap[text]; return; }
      // 2) 主导航
      for (const [k, page] of Object.entries(navMap)) {
        if (text === k || text.startsWith(k + ' ')) { a.href = page; return; }
      }
      // 3) 表名 → 跳详情
      const tMatch = text.match(/^([a-z]+_[a-z_]+_(?:df|di))$/);
      if (tMatch && window.DF.data?.tables) {
        const t = window.DF.data.tables.find(x => x.name === tMatch[1]);
        if (t) { a.href = `05-table-detail.html?id=${t.id}`; return; }
      }
      // 4) 指标名 → 跳详情
      if (window.DF.data?.metrics) {
        const m = window.DF.data.metrics.find(x => x.name === text);
        if (m) { a.href = `12-metric-detail.html?id=${m.id}`; return; }
      }
    });

    // 7) 业务过程 / 域的子链接（带"()"的）
    $$('a:not([data-dead-bound])').forEach(a => {
      if (a.getAttribute('href') && a.getAttribute('href') !== '#') return;
      const text = textOf(a);
      if (/^[\u4e00-\u9fa5]+\s*\(/.test(text)) {
        a.dataset.deadBound = '1';
        a.addEventListener('click', e => { e.preventDefault(); toast('已切换业务过程：' + text, 'info', 1000); });
      }
    });

    // 8) 模型库卡片 / 行业模板卡片（点击进详情）
    $$('.lib-card:not([data-dead-bound])').forEach(card => {
      card.dataset.deadBound = '1';
      const nameEl = card.querySelector('div[style*="font-weight: 600"]') || card.children[1]?.children[0];
      const name = nameEl ? textOf(nameEl) : '未命名模型';
      const tagEl = card.querySelector('.lib-tag');
      const tag = tagEl ? textOf(tagEl) : '';
      const desc = card.querySelectorAll('div[style*="line-height: 1.5"]')[0];
      const descText = desc ? textOf(desc) : '';
      const versionTag = card.querySelector('.tag--ghost');
      const version = versionTag ? textOf(versionTag) : '';
      const refs = (card.querySelector('span:not([class*=tag])')?.textContent || '').trim() || '—';
      const modelCount = (card.querySelector('.tag--brand, .tag--success, .tag--warning, .tag--info, .tag--danger')?.textContent || '').trim() || '—';
      // 收藏状态
      const favKey = 'fav_model_' + name;
      const isFav = DF.app.Store.get(favKey) === '1';
      card.addEventListener('click', () => {
        showModelDetail({ name, tag, version, refs, desc: descText, modelCount, isFav, favKey });
      });
    });
  }

  // ============ 模型详情弹窗 ============
  function showModelDetail(m) {
    // 根据 m.name 动态派发各业务域（数字图书馆）
    const domainProfiles = {
      '书目核心数据模型': {
        domains: [
          { k: '书目域', icon: '📕', n: 28, sample: 'ods_bib_record · dwd_bib_unified · ads_bib_search_index' },
          { k: '期刊域', icon: '📰', n: 18, sample: 'dwd_per_title · dwd_per_volume · dwt_per_yearly' },
          { k: '作者域', icon: '✍️', n: 16, sample: 'dwd_author · dwd_author_work · dwt_author_h_index' },
          { k: '出版机构域', icon: '🏢', n: 12, sample: 'dwd_publisher · dwd_pub_book_year · dwt_pub_ranking' },
          { k: '主题分类域', icon: '🏷️', n: 12, sample: 'dwd_subject_heading · dwd_clc_tree · dwt_subject_hot' },
        ],
        ddl: `-- 书目核心数据模型 ${m.version}
-- 基于 MARC21 / CNMARC / Dublin Core / CALIS 编目标准
-- Generated by DataForge ${new Date().toISOString().slice(0,10)}

CREATE TABLE ods_bib_record (
  bib_id        STRING   COMMENT '书目记录 ID',
  isbn          STRING   COMMENT 'ISBN（13 位）',
  issn          STRING   COMMENT 'ISSN',
  title         STRING   COMMENT '正题名',
  title_alt     STRING   COMMENT '并列题名 / 副题名',
  author        STRING   COMMENT '主要责任者',
  publisher     STRING   COMMENT '出版者',
  pub_year      INT      COMMENT '出版年',
  language      STRING   COMMENT '语种（ISO 639）',
  clc_code      STRING   COMMENT '中图分类号',
  subject       STRING   COMMENT '主题词',
  marc_xml      STRING   COMMENT 'MARC21 原始记录',
  ds            STRING   COMMENT '数据日期'
) PARTITIONED BY (ds STRING);

-- ... (共 86 张表，包含 0XX 控制 / 1XX 主要款目 / 2XX 题名 / 6XX 主题 / 7XX 责任者)`
      },
      '馆藏典藏核心模型': {
        domains: [
          { k: '馆藏主档', icon: '📚', n: 22, sample: 'ods_hold_item · dwd_hold_unified · dwt_hold_status' },
          { k: '复本架位', icon: '🗄️', n: 16, sample: 'dwd_callno · dwd_hold_location · dwt_hold_distribution' },
          { k: '剔旧注销', icon: '♻️', n: 12, sample: 'ods_hold_weeding · dwd_hold_lost · dwt_hold_loss_rate' },
          { k: '典藏统计', icon: '📊', n: 8, sample: 'dwt_hold_yearly · dwt_hold_by_subject · ads_hold_dashboard' },
          { k: '馆藏评估', icon: '⭐', n: 6, sample: 'dwt_collection_eval · ads_collection_gap · dwt_collection_depth' },
        ],
        ddl: `-- 馆藏典藏核心模型 ${m.version}
-- 基于 MARC Holdings 852-878 / CALIS 馆藏规范
-- Generated by DataForge ${new Date().toISOString().slice(0,10)}

CREATE TABLE ods_hold_item (
  hold_id       STRING   COMMENT '馆藏单册 ID',
  bib_id        STRING   COMMENT '书目记录 ID',
  barcode       STRING   COMMENT '条形码',
  call_no       STRING   COMMENT '索书号',
  location_code STRING   COMMENT '馆藏地代码',
  status        STRING   COMMENT '在馆/借出/注销',
  price         DECIMAL(18,2) COMMENT '单价',
  accession_dt  DATE     COMMENT '入藏日期',
  source        STRING   COMMENT '来源（采购/捐赠/调拨）',
  ds            STRING   COMMENT '数据日期'
) PARTITIONED BY (ds STRING);

-- ... (共 64 张表，含 852 馆藏地 / 853-865 编目 / 866 文本 / 876 单件)`
      },
      '流通借阅服务模型': {
        domains: [
          { k: '借还事务', icon: '🔄', n: 18, sample: 'ods_loan_trans · dwd_loan_circ · dwt_loan_daily' },
          { k: '预约预借', icon: '⏰', n: 10, sample: 'ods_reservation · dwd_resv_queue · dwt_resv_wait_time' },
          { k: '违章罚款', icon: '⚠️', n: 8, sample: 'ods_violation · dwd_fine_trans · dwt_overdue_stats' },
          { k: '到馆服务', icon: '🚶', n: 6, sample: 'ods_gate_log · dwd_visit_daily · dwt_visitor_profile' },
        ],
        ddl: `-- 流通借阅服务模型 ${m.version}
-- Generated by DataForge ${new Date().toISOString().slice(0,10)}

CREATE TABLE ods_loan_trans (
  loan_id       STRING   COMMENT '借阅流水 ID',
  hold_id       STRING   COMMENT '馆藏单册 ID',
  reader_id     STRING   COMMENT '读者证号',
  loan_dt       TIMESTAMP COMMENT '借出时间',
  due_dt        DATE     COMMENT '应还日期',
  return_dt     TIMESTAMP COMMENT '实际归还时间',
  renew_cnt     INT      COMMENT '续借次数',
  loan_type     STRING   COMMENT '借阅类型',
  ds            STRING   COMMENT '数据日期'
) PARTITIONED BY (ds STRING);

-- ... (共 42 张表)`
      },
      '学科服务分析模型': {
        domains: [
          { k: '学科评估', icon: '🎓', n: 14, sample: 'dwt_esi_subject · dwt_incites_kpi · ads_subject_radar' },
          { k: '读者画像', icon: '👤', n: 16, sample: 'dwd_patron_profile · dwd_patron_behavior · dwt_patron_segment' },
          { k: '阅读推广', icon: '📖', n: 12, sample: 'ods_promotion · dwd_borrow_topics · dwt_book_recommend' },
          { k: '学科馆员', icon: '👨‍🏫', n: 8, sample: 'dwd_liaison · dwd_service_record · dwt_liaison_kpi' },
          { k: '科研支持', icon: '🔬', n: 6, sample: 'ods_factcheck_req · dwd_cited_ref · dwt_esi_h_index' },
        ],
        ddl: `-- 学科服务分析模型 ${m.version}
-- 对接复旦 16 大学科门类
-- Generated by DataForge ${new Date().toISOString().slice(0,10)}

CREATE TABLE dwt_esi_subject (
  subject_code  STRING   COMMENT 'ESI 学科代码',
  subject_name  STRING   COMMENT '学科名称（中文）',
  paper_cnt     INT      COMMENT '论文数',
  citation_cnt  BIGINT   COMMENT '被引次数',
  top_pct       DECIMAL(5,2) COMMENT 'Top 百分比',
  ds            STRING   COMMENT '数据日期'
) PARTITIONED BY (ds STRING);

-- ... (共 56 张表)`
      },
    };
    // 通用 fallback
    const profile = domainProfiles[m.name] || {
      domains: [
        { k: '主域', icon: '📦', n: 24, sample: 'ods_main_record · dwd_main_unified · dwt_main_daily' },
        { k: '维度域', icon: '🧊', n: 18, sample: 'dwd_main_entity · dwd_dwd_ext · dwt_dwd_summary' },
        { k: '事务域', icon: '🔁', n: 14, sample: 'ods_main_trans · dwd_trans_cleaned · dwt_trans_agg' },
        { k: '指标域', icon: '📊', n: 12, sample: 'dwt_kpi_daily · dwt_kpi_weekly · ads_kpi_dashboard' },
        { k: '应用域', icon: '🚀', n: 8, sample: 'ads_app_view · ads_app_summary · ads_app_export' },
      ],
      ddl: `-- ${m.name} ${m.version}\n-- Generated by DataForge ${new Date().toISOString().slice(0,10)}\n\nCREATE TABLE dwd_main_unified (\n  id            STRING   COMMENT '主键 ID',\n  created_at    TIMESTAMP COMMENT '创建时间',\n  ds            STRING   COMMENT '数据日期'\n);\n\n-- ... (共 ${m.modelCount} 张表)`
    };

    const domainRows = profile.domains.map(d => `
      <tr><td>${d.icon} ${d.k}</td><td class="text-mono">${d.n}</td><td class="text-mono" style="color:var(--brand-700);">${d.sample}</td><td><span class="pill pill--auto">${d.n}/${d.n}</span></td></tr>
    `).join('');

    const body = `
      <div style="font-size:13px;line-height:1.7;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:14px;">
          <div><span style="color:var(--neutral-500);">模板名称：</span><b>${m.name}</b></div>
          <div><span style="color:var(--neutral-500);">业务分类：</span>${m.tag}</div>
          <div><span style="color:var(--neutral-500);">版本：</span><span class="text-mono">${m.version}</span></div>
          <div><span style="color:var(--neutral-500);">引用次数：</span><b style="color:var(--brand-500);">${m.refs}</b></div>
        </div>
        <div style="padding:10px 14px;background:#F0F9FF;border-left:3px solid var(--brand-500);border-radius:4px;color:var(--neutral-700);margin-bottom:14px;">${m.desc}</div>
        <div style="margin-bottom:8px;font-weight:600;color:var(--neutral-700);display:flex;align-items:center;gap:8px;">
          📦 模型内容 <span style="font-weight:400;color:var(--neutral-500);font-size:11px;">${profile.domains.length} 主题域 · ${m.modelCount} · 86 核心表 · 18 衍生指标</span>
        </div>
        <table class="field" style="width:100%;font-size:12px;">
          <thead><tr><th>主题域</th><th style="width:60px;">实体数</th><th>核心表</th><th style="width:90px;">落标</th></tr></thead>
          <tbody>${domainRows}</tbody>
        </table>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn--primary btn--sm" id="btn-import-wizard">📥 一键导入本馆</button>
          <button class="btn btn--sm" id="btn-model-er">👁 预览模型结构</button>
          <button class="btn btn--sm" id="btn-fav-toggle">${m.isFav ? '★ 已收藏' : '⭐ 收藏'}</button>
          <button class="btn btn--sm" id="btn-download-ddl">⬇ 下载 DDL</button>
        </div>
        <div id="model-extra-area" style="margin-top:14px;"></div>
      </div>`;
    modal({ title: '📦 ' + m.name + ' · 模型详情', body, width: 760 });
    // 绑定按钮
    setTimeout(() => {
      const close = () => document.querySelector('.df-modal__overlay')?.remove();
      document.getElementById('btn-import-wizard')?.addEventListener('click', () => {
        close();
        showImportWizard(m);
      });
      document.getElementById('btn-model-er')?.addEventListener('click', () => {
        close();
        showModelER(m);
      });
      document.getElementById('btn-fav-toggle')?.addEventListener('click', () => {
        const newFav = !DF.app.Store.get(m.favKey);
        DF.app.Store.set(m.favKey, newFav ? '1' : '0');
        const btn = document.getElementById('btn-fav-toggle');
        if (btn) btn.innerHTML = newFav ? '★ 已收藏' : '⭐ 收藏';
        toast(newFav ? '已收藏到「我的模型库」' : '已取消收藏', 'success', 1500);
      });
      document.getElementById('btn-download-ddl')?.addEventListener('click', () => {
        const ddl = profile.ddl;
        navigator.clipboard?.writeText(ddl).catch(()=>{});
        toast('DDL 已复制到剪贴板（' + (ddl.length + 8000) + ' 字符）', 'success');
      });
    }, 30);
  }

  // ============ ER 图：预览模型结构 ============
  function showModelER(m) {
    // 根据模型名派发不同的数字图书馆业务 ER
    const erProfiles = {
      '书目核心数据模型': {
        title: '书目核心 ER：书目 ↔ 作者 ↔ 出版 ↔ 主题',
        domains: [
          { name: '书目域', color: '#FEE2E2', border: '#EF4444', icon: '📕', tables: [
            { id: 'ods_bib',   name: 'ods_bib_record',     layer: 'ODS', fields: 17, refs: 'MARC21 原始记录' },
            { id: 'dwd_bib',   name: 'dwd_bib_unified',    layer: 'DWD', fields: 17, refs: '统一书目明细' },
            { id: 'dwt_bib',   name: 'dwt_bib_dim',        layer: 'DWT', fields: 12, refs: '书目维度汇总' },
            { id: 'ads_bib',   name: 'ads_bib_search_idx', layer: 'ADS', fields: 12, refs: '检索索引' },
          ]},
          { name: '作者域', color: '#FEF3C7', border: '#F59E0B', icon: '✍️', tables: [
            { id: 'dwd_aut',  name: 'dwd_author',         layer: 'DWD', fields: 12, refs: '作者主档' },
            { id: 'dwd_aw',   name: 'dwd_author_work',    layer: 'DWD', fields: 12, refs: '作者-作品' },
            { id: 'dwt_hidx', name: 'dwt_author_h_index', layer: 'DWT', fields: 12, refs: 'H 指数/被引' },
          ]},
          { name: '出版机构', color: '#DBEAFE', border: '#3B82F6', icon: '🏢', tables: [
            { id: 'dwd_pub', name: 'dwd_publisher',      layer: 'DWD', fields: 10, refs: '出版社主档' },
            { id: 'dwd_pby', name: 'dwd_pub_book_year',  layer: 'DWD', fields: 10, refs: '出版社-年度' },
          ]},
          { name: '主题分类', color: '#D1FAE5', border: '#10B981', icon: '🏷️', tables: [
            { id: 'dwd_sub', name: 'dwd_subject_heading', layer: 'DWD', fields: 11, refs: '主题词主档' },
            { id: 'dwd_clc', name: 'dwd_clc_tree',       layer: 'DWD', fields: 11, refs: '中图法树' },
            { id: 'dwt_sub', name: 'dwt_subject_hot',    layer: 'DWT', fields: 11, refs: '热门主题' },
          ]},
          { name: '期刊域', color: '#F3E8FF', border: '#8B5CF6', icon: '📰', tables: [
            { id: 'dwd_per', name: 'dwd_per_title',     layer: 'DWD', fields: 13, refs: '期刊主刊' },
            { id: 'dwd_pv',  name: 'dwd_per_volume',    layer: 'DWD', fields: 13, refs: '期刊卷期' },
            { id: 'dwt_py',  name: 'dwt_per_yearly',    layer: 'DWT', fields: 13, refs: '期刊年度' },
          ]},
        ],
        relations: [
          { from: 'dwd_bib',  to: 'ods_bib',   label: 'FK bib_id' },
          { from: 'dwt_bib',  to: 'dwd_bib',   label: 'FK bib_id' },
          { from: 'ads_bib',  to: 'dwt_bib',   label: 'FK bib_id' },
          { from: 'dwd_aw',   to: 'ods_bib',   label: 'FK bib_id' },
          { from: 'dwd_aw',   to: 'dwd_aut',   label: 'FK author_id' },
          { from: 'dwt_hidx', to: 'dwd_aw',    label: 'FK author_id' },
          { from: 'dwd_pby',  to: 'dwd_pub',   label: 'FK pub_id' },
          { from: 'dwd_pby',  to: 'ods_bib',   label: 'FK bib_id' },
          { from: 'dwt_bib',  to: 'dwd_sub',   label: 'FK subject_id' },
          { from: 'dwt_bib',  to: 'dwd_clc',   label: 'FK clc_code' },
          { from: 'dwd_pv',   to: 'dwd_per',   label: 'FK per_id' },
          { from: 'dwt_py',   to: 'dwd_pv',    label: 'FK per_id' },
          { from: 'ads_bib',  to: 'dwd_sub',   label: 'FK subject_id' },
          { from: 'ads_bib',  to: 'dwd_aut',   label: 'FK author_id' },
        ],
      },
      '馆藏典藏核心模型': {
        title: '馆藏典藏 ER：馆藏 ↔ 书目 ↔ 架位 ↔ 剔旧',
        domains: [
          { name: '馆藏主档', color: '#FEE2E2', border: '#EF4444', icon: '📚', tables: [
            { id: 'ods_hold', name: 'ods_hold_item',     layer: 'ODS', fields: 13, refs: '馆藏单册' },
            { id: 'dwd_hold', name: 'dwd_hold_unified',  layer: 'DWD', fields: 13, refs: '统一馆藏' },
            { id: 'dwt_hs',   name: 'dwt_hold_status',   layer: 'DWT', fields: 13, refs: '馆藏状态' },
          ]},
          { name: '复本架位', color: '#FEF3C7', border: '#F59E0B', icon: '🗄️', tables: [
            { id: 'dwd_loc', name: 'dwd_callno',         layer: 'DWD', fields: 10, refs: '索书号主档' },
            { id: 'dwd_hl',  name: 'dwd_hold_location',  layer: 'DWD', fields: 10, refs: '架位分布' },
            { id: 'dwt_hd',  name: 'dwt_hold_dist',      layer: 'DWT', fields: 10, refs: '馆藏分布' },
          ]},
          { name: '剔旧注销', color: '#DBEAFE', border: '#3B82F6', icon: '♻️', tables: [
            { id: 'ods_hwd', name: 'ods_hold_weeding',  layer: 'ODS', fields: 10, refs: '剔旧记录' },
            { id: 'dwd_hl2', name: 'dwd_hold_lost',     layer: 'DWD', fields: 10, refs: '遗失注销' },
            { id: 'dwt_lr',  name: 'dwt_hold_loss_rate', layer: 'DWT', fields: 10, refs: '损失率' },
          ]},
          { name: '馆藏评估', color: '#D1FAE5', border: '#10B981', icon: '⭐', tables: [
            { id: 'dwt_ce',  name: 'dwt_collection_eval', layer: 'DWT', fields: 10, refs: '馆藏评估' },
            { id: 'ads_cg',  name: 'ads_collection_gap',  layer: 'ADS', fields: 10, refs: '馆藏缺口' },
          ]},
        ],
        relations: [
          { from: 'dwd_hold', to: 'ods_hold', label: 'FK hold_id' },
          { from: 'dwt_hs',   to: 'dwd_hold', label: 'FK hold_id' },
          { from: 'dwd_hl',   to: 'ods_hold', label: 'FK hold_id' },
          { from: 'dwd_hl',   to: 'dwd_loc',  label: 'FK callno' },
          { from: 'dwt_hd',   to: 'dwd_hl',   label: 'FK loc_code' },
          { from: 'ods_hwd',  to: 'ods_hold', label: 'FK hold_id' },
          { from: 'dwd_hl2',  to: 'ods_hold', label: 'FK hold_id' },
          { from: 'dwt_lr',   to: 'dwd_hl2',  label: 'FK year' },
          { from: 'dwt_ce',   to: 'dwt_hd',   label: 'FK loc_code' },
          { from: 'ads_cg',   to: 'dwt_ce',   label: 'FK subject' },
        ],
      },
      '流通借阅服务模型': {
        title: '流通借阅 ER：借还 ↔ 馆藏 ↔ 读者 ↔ 预约',
        domains: [
          { name: '借还事务', color: '#FEE2E2', border: '#EF4444', icon: '🔄', tables: [
            { id: 'ods_ln',   name: 'ods_loan_trans',  layer: 'ODS', fields: 12, refs: '借还流水' },
            { id: 'dwd_ln',   name: 'dwd_loan_circ',   layer: 'DWD', fields: 12, refs: '流通明细' },
            { id: 'dwt_lnd',  name: 'dwt_loan_daily',  layer: 'DWT', fields: 12, refs: '日借还量' },
          ]},
          { name: '预约预借', color: '#FEF3C7', border: '#F59E0B', icon: '⏰', tables: [
            { id: 'ods_rsv',  name: 'ods_reservation',     layer: 'ODS', fields: 11, refs: '预约记录' },
            { id: 'dwd_rsq',  name: 'dwd_resv_queue',      layer: 'DWD', fields: 11, refs: '预约排队' },
            { id: 'dwt_rwt',  name: 'dwt_resv_wait_time',  layer: 'DWT', fields: 11, refs: '等待时长' },
          ]},
          { name: '违章罚款', color: '#DBEAFE', border: '#3B82F6', icon: '⚠️', tables: [
            { id: 'ods_vio', name: 'ods_violation',     layer: 'ODS', fields: 11, refs: '违章记录' },
            { id: 'dwd_fin', name: 'dwd_fine_trans',    layer: 'DWD', fields: 11, refs: '罚款流水' },
            { id: 'dwt_os',  name: 'dwt_overdue_stats', layer: 'DWT', fields: 11, refs: '逾期统计' },
          ]},
          { name: '到馆服务', color: '#D1FAE5', border: '#10B981', icon: '🚶', tables: [
            { id: 'ods_gt', name: 'ods_gate_log',     layer: 'ODS', fields: 10, refs: '门禁日志' },
            { id: 'dwd_vd', name: 'dwd_visit_daily',  layer: 'DWD', fields: 10, refs: '到馆日表' },
            { id: 'dwt_vp', name: 'dwt_visitor_profile', layer: 'DWT', fields: 10, refs: '读者画像' },
          ]},
        ],
        relations: [
          { from: 'dwd_ln',  to: 'ods_ln',   label: 'FK loan_id' },
          { from: 'dwt_lnd', to: 'dwd_ln',   label: 'FK loan_id' },
          { from: 'dwd_rsq', to: 'ods_rsv',  label: 'FK resv_id' },
          { from: 'dwt_rwt', to: 'dwd_rsq',  label: 'FK resv_id' },
          { from: 'dwd_fin', to: 'ods_vio',  label: 'FK vio_id' },
          { from: 'dwt_os',  to: 'dwd_fin',  label: 'FK year' },
          { from: 'dwd_vd',  to: 'ods_gt',   label: 'FK gate_id' },
          { from: 'dwt_vp',  to: 'dwd_vd',   label: 'FK reader_id' },
          { from: 'dwt_lnd', to: 'dwt_vp',   label: 'FK reader_id' },
        ],
      },
      '学科服务分析模型': {
        title: '学科服务 ER：学科 ↔ 读者 ↔ 推广 ↔ 馆员',
        domains: [
          { name: '学科评估', color: '#FEE2E2', border: '#EF4444', icon: '🎓', tables: [
            { id: 'dwt_esi', name: 'dwt_esi_subject', layer: 'DWT', fields: 11, refs: 'ESI 学科' },
            { id: 'dwt_inc', name: 'dwt_incites_kpi', layer: 'DWT', fields: 11, refs: 'Incites 指标' },
            { id: 'ads_sr',  name: 'ads_subject_radar', layer: 'ADS', fields: 11, refs: '学科雷达' },
          ]},
          { name: '读者画像', color: '#FEF3C7', border: '#F59E0B', icon: '👤', tables: [
            { id: 'dwd_pp',  name: 'dwd_patron_profile', layer: 'DWD', fields: 12, refs: '读者主档' },
            { id: 'dwd_pb',  name: 'dwd_patron_behavior', layer: 'DWD', fields: 12, refs: '行为明细' },
            { id: 'dwt_psg', name: 'dwt_patron_segment', layer: 'DWT', fields: 12, refs: '读者分群' },
          ]},
          { name: '阅读推广', color: '#DBEAFE', border: '#3B82F6', icon: '📖', tables: [
            { id: 'ods_prm', name: 'ods_promotion',     layer: 'ODS', fields: 22, refs: '推广活动' },
            { id: 'dwd_bt',  name: 'dwd_borrow_topics', layer: 'DWD', fields: 22, refs: '借阅主题' },
            { id: 'dwt_br',  name: 'dwt_book_recommend', layer: 'DWT', fields: 22, refs: '图书推荐' },
          ]},
          { name: '学科馆员', color: '#D1FAE5', border: '#10B981', icon: '👨‍🏫', tables: [
            { id: 'dwd_lia', name: 'dwd_liaison',       layer: 'DWD', fields: 10, refs: '馆员主档' },
            { id: 'dwd_svr', name: 'dwd_service_record', layer: 'DWD', fields: 10, refs: '服务记录' },
            { id: 'dwt_lk',  name: 'dwt_liaison_kpi',   layer: 'DWT', fields: 10, refs: '馆员 KPI' },
          ]},
        ],
        relations: [
          { from: 'dwt_inc', to: 'dwt_esi',  label: 'FK subject' },
          { from: 'ads_sr',  to: 'dwt_inc',  label: 'FK subject' },
          { from: 'dwd_pb',  to: 'dwd_pp',   label: 'FK patron' },
          { from: 'dwt_psg', to: 'dwd_pb',   label: 'FK patron' },
          { from: 'dwt_br',  to: 'dwd_bt',   label: 'FK topic' },
          { from: 'dwd_bt',  to: 'ods_prm',  label: 'FK prom_id' },
          { from: 'dwd_svr', to: 'dwd_lia',  label: 'FK liaison' },
          { from: 'dwt_lk',  to: 'dwd_svr',  label: 'FK liaison' },
        ],
      },
    };
    const erCfg = erProfiles[m.name] || erProfiles['书目核心数据模型'];
    const domains = erCfg.domains;
    const relations = erCfg.relations;

    // ============ 垂直 swimlane 布局 ============
    // 5 个域从上到下垂直堆叠，每域内表格水平排开
    // 域间留 50px 通道专门放 FK 标签——标签永远不进节点区域
    const nodeW = 188, nodeH = 54, nodeGap = 32;
    const swimlaneH = 86, channelH = 56;   // swimlane 高度 + 域间通道高度
    const topPad = 24, leftPad = 32;        // SVG 顶部 / 左侧 padding
    const labelW = 200;                     // 左侧"域 swimlane 标题"区域宽度

    // 计算 svg 总尺寸
    let maxTablesInDomain = 0;
    domains.forEach(d => { maxTablesInDomain = Math.max(maxTablesInDomain, d.tables.length); });
    const tableAreaW = maxTablesInDomain * nodeW + (maxTablesInDomain - 1) * nodeGap;
    const svgW = leftPad + labelW + tableAreaW + 40;
    const svgH = topPad + domains.length * swimlaneH + (domains.length - 1) * channelH + 20;

    // 节点位置：按 swimlane 域索引分配 y，域内按表索引分配 x
    const nodes = {};
    domains.forEach((d, di) => {
      const swimlaneTop = topPad + di * (swimlaneH + channelH);
      d.tables.forEach((t, ti) => {
        const x = leftPad + labelW + ti * (nodeW + nodeGap);
        const y = swimlaneTop + (swimlaneH - nodeH) / 2;
        nodes[t.id] = { ...t, domain: d, di, ti, x, y };
      });
    });

    // 颜色工具
    const layerColor = l => ({ODS:'#FEF3C7',DWD:'#D1FAE5',DWT:'#FCE7F3',ADS:'#F3E8FF'})[l] || '#F1F5F9';
    const layerText = l => ({ODS:'#92400E',DWD:'#065F46',DWT:'#9F1239',ADS:'#6B21A8'})[l] || '#475569';

    let svgContent = '';
    // SVG 阴影 filter（让 FK 标签浮起）
    svgContent += `<defs>
      <filter id="er-label-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.22"/>
      </filter>
    </defs>`;

    // 画 swimlane 背景（每个域一条横向 swimlane）
    domains.forEach((d, di) => {
      const swimlaneTop = topPad + di * (swimlaneH + channelH);
      // swimlane 矩形（整条横向背景）
      svgContent += `<rect x="0" y="${swimlaneTop}" width="${svgW}" height="${swimlaneH}" fill="${d.color}" opacity="0.4"/>`;
      // swimlane 顶部细线（强化边界）
      svgContent += `<line x1="0" y1="${swimlaneTop}" x2="${svgW}" y2="${swimlaneTop}" stroke="${d.border}" stroke-width="1" opacity="0.4"/>`;
      svgContent += `<line x1="0" y1="${swimlaneTop + swimlaneH}" x2="${svgW}" y2="${swimlaneTop + swimlaneH}" stroke="${d.border}" stroke-width="1" opacity="0.4"/>`;
      // 左侧"域 swimlane 标签"（垂直排版）
      svgContent += `<text x="18" y="${swimlaneTop + swimlaneH/2 + 5}" font-size="14" font-weight="700" fill="${d.border}" font-family="system-ui, -apple-system, sans-serif">${d.icon} ${d.name}</text>`;
      svgContent += `<text x="18" y="${swimlaneTop + swimlaneH/2 + 22}" font-size="10" font-weight="500" fill="${d.border}" opacity="0.75" font-family="system-ui, -apple-system, sans-serif">${d.tables.length} 张表</text>`;
    });

    // 收集 FK 标签（最后画在所有节点之上）
    const fkLabels = [];
    // 关系连线（实线 + 加粗 + 颜色按源域）
    relations.forEach(r => {
      const a = nodes[r.from], b = nodes[r.to];
      if (!a || !b) return;
      // 起点：从 a 节点底部中心出发；终点：b 节点顶部中心进入
      // 如果 a 在 b 上方（a.di < b.di），从 a 底部垂直向下到 b 顶部
      // 如果 a 在 b 下方（a.di > b.di），从 a 顶部垂直向上到 b 底部
      // 相同 swimlane（a.di == b.di）水平连接
      const lineColor = a.domain.border;
      let ax, ay, bx, by;
      if (a.di < b.di) {
        // a 在上方：a 底部 → b 顶部
        ax = a.x + nodeW/2; ay = a.y + nodeH;
        bx = b.x + nodeW/2; by = b.y;
      } else if (a.di > b.di) {
        // a 在下方：a 顶部 → b 底部
        ax = a.x + nodeW/2; ay = a.y;
        bx = b.x + nodeW/2; by = b.y + nodeH;
      } else {
        // 同行：a 右 → b 左
        ax = a.x + nodeW; ay = a.y + nodeH/2;
        bx = b.x;        by = b.y + nodeH/2;
      }
      // 画连线（垂直/水平 直线 或 直角折线）
      let pathD;
      if (Math.abs(ax - bx) < 1) {
        // 纯垂直线
        pathD = `M ${ax} ${ay} L ${bx} ${by}`;
      } else if (a.di === b.di) {
        // 同行水平线
        pathD = `M ${ax} ${ay} L ${bx} ${by}`;
      } else {
        // 跨 swimlane：用直角折线（在通道中点处转弯）
        const midY = (ay + by) / 2;
        pathD = `M ${ax} ${ay} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${by}`;
      }
      svgContent += `<path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2" opacity="0.9"/>`;
      // 起点小圆点
      svgContent += `<circle cx="${ax}" cy="${ay}" r="3.5" fill="${lineColor}"/>`;
      // 终点箭头（三角，朝向 by 方向）
      const endAngle = Math.atan2(by - ay, bx - ax);
      const arrowSize = 7;
      const leftAngle = endAngle + Math.PI * 0.85;
      const rightAngle = endAngle - Math.PI * 0.85;
      const lx = bx + arrowSize * 0.6 * Math.cos(leftAngle);
      const ly = by + arrowSize * 0.6 * Math.sin(leftAngle);
      const rx = bx + arrowSize * 0.6 * Math.cos(rightAngle);
      const ry = by + arrowSize * 0.6 * Math.sin(rightAngle);
      svgContent += `<polygon points="${bx},${by} ${lx},${ly} ${rx},${ry}" fill="${lineColor}"/>`;
      // FK 标签位置：在 swimlane 之间的通道中点处
      // 用 min(a.di, b.di) 和 max 之间那条通道放标签（避免跨多 swimlane 时的标签错位）
      const minDi = Math.min(a.di, b.di);
      const labelY = a.di === b.di
        ? ay
        : topPad + (minDi + 1) * swimlaneH + minDi * channelH + channelH / 2;
      const labelX = (ax + bx) / 2;
      fkLabels.push({ x: labelX, y: labelY, label: r.label, color: lineColor });
    });

    // 节点（在 FK 标签之前画，所以标签浮在节点之上）
    Object.values(nodes).forEach(n => {
      svgContent += `
        <g class="er-node" data-node="${n.id}" style="cursor:pointer;">
          <rect x="${n.x}" y="${n.y}" width="${nodeW}" height="${nodeH}" rx="8" fill="#fff" stroke="${n.domain.border}" stroke-width="1.8"/>
          <rect x="${n.x}" y="${n.y}" width="6" height="${nodeH}" rx="3" fill="${n.domain.border}"/>
          <text x="${n.x + 14}" y="${n.y + 18}" font-size="11" font-weight="600" fill="#0F172A" font-family="monospace">${n.name}</text>
          <text x="${n.x + 14}" y="${n.y + 32}" font-size="9" fill="#64748B">${n.refs}</text>
          <rect x="${n.x + 14}" y="${n.y + 38}" width="32" height="12" rx="2" fill="${layerColor(n.layer)}"/>
          <text x="${n.x + 30}" y="${n.y + 47}" text-anchor="middle" font-size="8" font-weight="700" fill="${layerText(n.layer)}">${n.layer}</text>
          <text x="${n.x + 50}" y="${n.y + 47}" font-size="8" fill="#94A3B8">${n.fields} 字段</text>
        </g>`;
    });

    // FK 标签（最后画，悬浮于所有节点之上）
    // 由于 swimlane 布局下，标签 y 永远在 swimlane 之间的通道里（channelH=56），
    // 不会落在任何节点 y 范围内，因此不会被遮挡
    fkLabels.forEach(fk => {
      const w = 78, h = 18;
      svgContent += `<g filter="url(#er-label-shadow)">
        <rect x="${fk.x - w/2}" y="${fk.y - h/2}" width="${w}" height="${h}" rx="4" fill="#fff" stroke="${fk.color}" stroke-width="1.3"/>
        <text x="${fk.x}" y="${fk.y + 3}" text-anchor="middle" font-size="10" fill="${fk.color}" font-weight="700" font-family="monospace">${fk.label}</text>
      </g>`;
    });

    // 右侧详情面板：列出所有表（可点击高亮）
    const tableList = domains.map(d => `
      <div style="margin-bottom:10px;">
        <div style="font-size:11px;font-weight:600;color:${d.border};margin-bottom:4px;">${d.icon} ${d.name} · ${d.tables.length} 表</div>
        ${d.tables.map(t => `<div class="er-tbl-item" data-node="${t.id}" style="font-size:11px;padding:4px 8px;background:#F8FAFC;border:1px solid ${d.border}33;border-radius:4px;margin-bottom:2px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
          <span class="text-mono" style="color:var(--brand-700);font-weight:500;">${t.name}</span>
          <span style="color:${layerText(t.layer)};font-size:9px;font-weight:600;">${t.layer}</span>
        </div>`).join('')}
      </div>
    `).join('');

    const body = `
      <div style="display:grid;grid-template-columns:1fr 240px;gap:14px;height:720px;">
        <div style="overflow:auto;border:1px solid var(--neutral-200);border-radius:8px;background:#FAFBFC;position:relative;">
          <div style="position:sticky;top:0;background:#fff;border-bottom:1px solid var(--neutral-200);padding:6px 12px;font-size:11px;color:var(--neutral-500);z-index:1;display:flex;gap:12px;align-items:center;">
            <span>📊 ${erCfg.title || ('ER 图：<b>' + m.name + '</b>')}（${domains.length} 主题域 · ${Object.keys(nodes).length} 表 · ${relations.length} FK 关系）</span>
            <span style="margin-left:auto;display:flex;gap:4px;align-items:center;">
              <span style="color:var(--neutral-400);">悬停表节点查看字段</span>
              <span style="width:1px;height:14px;background:var(--neutral-200);margin:0 4px;"></span>
              <button class="btn btn--sm" id="er-zoom-out" style="padding:2px 8px;font-size:11px;line-height:1;">−</button>
              <span id="er-zoom-level" style="font-size:11px;color:var(--neutral-700);font-family:monospace;min-width:36px;text-align:center;">100%</span>
              <button class="btn btn--sm" id="er-zoom-in"  style="padding:2px 8px;font-size:11px;line-height:1;">+</button>
              <button class="btn btn--sm" id="er-zoom-fit" style="padding:2px 8px;font-size:11px;line-height:1;">适配</button>
            </span>
          </div>
          <div id="er-canvas" style="position:relative;overflow:hidden;background:#FAFBFC;">
            <svg id="er-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="display:block;transform-origin:0 0;transition:transform .15s;">${svgContent}</svg>
          </div>
        </div>
        <div style="overflow:auto;padding-right:4px;">
          <div style="font-size:11px;font-weight:600;color:var(--neutral-700);margin-bottom:8px;">📋 表清单</div>
          ${tableList}
          <div style="margin-top:10px;padding:8px 10px;background:#FEF3C7;border-radius:4px;font-size:10px;color:#92400E;line-height:1.6;">
            <b>图例：</b><br>
            <span style="display:inline-block;width:8px;height:8px;background:#FEF3C7;border:1px solid #92400E;border-radius:2px;margin-right:3px;"></span>ODS 原始数据 &nbsp;
            <span style="display:inline-block;width:8px;height:8px;background:#D1FAE5;border:1px solid #065F46;border-radius:2px;margin-right:3px;"></span>DWD 明细/主档 &nbsp;
            <span style="display:inline-block;width:8px;height:8px;background:#FCE7F3;border:1px solid #9F1239;border-radius:2px;margin-right:3px;"></span>DWT 主题汇总 &nbsp;
            <span style="display:inline-block;width:8px;height:8px;background:#F3E8FF;border:1px solid #6B21A8;border-radius:2px;margin-right:3px;"></span>ADS 应用
          </div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:space-between;align-items:center;">
        <div style="font-size:11px;color:var(--neutral-500);">💡 提示：此 ER 图仅作结构预览，实际导入时表会按选中规则创建。</div>
        <div>
          <button class="btn btn--sm" id="btn-er-back">← 返回详情</button>
          <button class="btn btn--primary btn--sm" id="btn-er-import">📥 开始导入本馆</button>
        </div>
      </div>
    `;
    modal({ title: '🗺️ ' + m.name + ' · 模型结构预览（ER 图）', body, width: 1400 });
    // 绑定：返回 / 开始导入 / 节点高亮 / 缩放
    setTimeout(() => {
      const close = () => document.querySelector('.df-modal__close')?.click();
      document.getElementById('btn-er-back')?.addEventListener('click', () => { close(); showModelDetail(m); });
      document.getElementById('btn-er-import')?.addEventListener('click', () => { close(); showImportWizard(m); });

      // 缩放控件
      const svg = document.getElementById('er-svg');
      const canvas = document.getElementById('er-canvas');
      const zoomLabel = document.getElementById('er-zoom-level');
      let zoom = 1;
      function applyZoom(z) {
        zoom = Math.max(0.4, Math.min(2.0, z));
        svg.style.transform = `scale(${zoom})`;
        zoomLabel.textContent = Math.round(zoom * 100) + '%';
      }
      document.getElementById('er-zoom-in')?.addEventListener('click', () => applyZoom(zoom + 0.15));
      document.getElementById('er-zoom-out')?.addEventListener('click', () => applyZoom(zoom - 0.15));
      document.getElementById('er-zoom-fit')?.addEventListener('click', () => {
        const cw = canvas.clientWidth - 24, ch = canvas.clientHeight - 24;
        const z = Math.min(cw / svgW, ch / svgH, 1);
        applyZoom(z);
        svg.style.marginLeft = Math.max(0, (cw - svgW * z) / 2) + 'px';
        svg.style.marginTop  = '0px';
      });
      // 鼠标滚轮缩放
      canvas.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        applyZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
      }, { passive: false });
      // 默认自适应：让 svg 一开始就在容器内完整显示
      requestAnimationFrame(() => {
        document.getElementById('er-zoom-fit')?.click();
      });
      // ER 节点高亮
      document.querySelectorAll('.er-tbl-item').forEach(item => {
        item.addEventListener('mouseenter', () => {
          const id = item.dataset.node;
          document.querySelectorAll('.er-node').forEach(g => {
            const r = g.querySelector('rect');
            if (r) r.setAttribute('stroke-width', g.dataset.node === id ? '3' : '1.5');
          });
        });
        item.addEventListener('mouseleave', () => {
          document.querySelectorAll('.er-node rect').forEach(r => r.setAttribute('stroke-width', '1.5'));
        });
      });
      document.querySelectorAll('.er-node').forEach(g => {
        g.addEventListener('mouseenter', () => {
          const id = g.dataset.node;
          const t = document.querySelector(`.er-tbl-item[data-node="${id}"]`);
          if (t) { t.style.background = '#DBEAFE'; t.style.fontWeight = '600'; }
        });
        g.addEventListener('mouseleave', () => {
          document.querySelectorAll('.er-tbl-item').forEach(t => { t.style.background = '#F8FAFC'; t.style.fontWeight = ''; });
        });
        g.addEventListener('click', () => {
          const id = g.dataset.node;
          const n = nodes[id];
          if (!n) return;
          const fieldsList = generateMockFields(n);
          // 子级弹窗，不替换 ER 弹窗（用户可关闭字段详情后回到 ER 图）
          modal({ title: '📋 ' + n.name + ' · 字段详情', body: fieldsList, width: 800, replace: false });
        });
      });
    }, 50);
  }

  // 模拟生成表的字段详情（数字图书馆业务字段）
  function generateMockFields(t) {
    const common = [
      { code: 'id', cn: '主键 ID', type: 'BIGINT', req: true, pk: true },
      { code: 'created_at', cn: '创建时间', type: 'TIMESTAMP', req: true, pk: false },
      { code: 'updated_at', cn: '更新时间', type: 'TIMESTAMP', req: true, pk: false },
      { code: 'ds', cn: '数据日期', type: 'STRING', req: true, pk: false },
    ];
    const custom = [];
    // 书目域
    if (t.id === 'ods_bib' || t.id === 'dwd_bib') {
      custom.push(
        { code: 'bib_id', cn: '书目记录 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_bib_id' },
        { code: 'isbn', cn: 'ISBN（13 位）', type: 'STRING(13)', req: false, pk: false, std: 'std_isbn' },
        { code: 'issn', cn: 'ISSN', type: 'STRING(8)', req: false, pk: false, std: 'std_issn' },
        { code: 'title', cn: '正题名', type: 'STRING(500)', req: true, pk: false },
        { code: 'title_alt', cn: '并列题名 / 副题名', type: 'STRING(500)', req: false, pk: false },
        { code: 'author', cn: '主要责任者', type: 'STRING(200)', req: false, pk: false, std: 'std_author' },
        { code: 'publisher', cn: '出版者', type: 'STRING(200)', req: false, pk: false, std: 'std_publisher' },
        { code: 'pub_year', cn: '出版年', type: 'INT', req: false, pk: false },
        { code: 'language', cn: '语种（ISO 639）', type: 'CODE', req: false, pk: false, std: 'std_language_iso639' },
        { code: 'clc_code', cn: '中图分类号', type: 'STRING(20)', req: false, pk: false, std: 'std_clc' },
        { code: 'subject', cn: '主题词', type: 'STRING(500)', req: false, pk: false, std: 'std_subject' },
        { code: 'marc_xml', cn: 'MARC21 原始记录', type: 'TEXT', req: false, pk: false },
        { code: 'doc_type', cn: '文献类型', type: 'CODE', req: true, pk: false, std: 'std_doc_type' },
      );
    } else if (t.id === 'dwt_bib' || t.id === 'ads_bib') {
      custom.push(
        { code: 'bib_id', cn: '书目记录 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_bib_id' },
        { code: 'title', cn: '题名', type: 'STRING(500)', req: true, pk: false },
        { code: 'author', cn: '责任者', type: 'STRING(200)', req: false, pk: false },
        { code: 'clc_code', cn: '中图分类号', type: 'STRING(20)', req: false, pk: false },
        { code: 'subject', cn: '主题词', type: 'STRING(500)', req: false, pk: false },
        { code: 'loan_cnt_30d', cn: '近 30 天借阅次数', type: 'INT', req: false, pk: false },
        { code: 'resv_cnt', cn: '预约次数', type: 'INT', req: false, pk: false },
        { code: 'recommend_score', cn: '推荐分', type: 'DECIMAL(8,4)', req: false, pk: false },
      );
    // 作者域
    } else if (t.id === 'dwd_aut' || t.id === 'dwd_aw' || t.id === 'dwt_hidx') {
      custom.push(
        { code: 'author_id', cn: '作者 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_author_id' },
        { code: 'author_name', cn: '作者姓名', type: 'STRING(100)', req: true, pk: false },
        { code: 'author_alt', cn: '姓名变体', type: 'STRING(500)', req: false, pk: false },
        { code: 'country', cn: '国别', type: 'CODE', req: false, pk: false, std: 'std_country_iso3166' },
        { code: 'birth_year', cn: '生年', type: 'INT', req: false, pk: false },
        { code: 'h_index', cn: 'H 指数', type: 'INT', req: false, pk: false },
        { code: 'work_cnt', cn: '作品数', type: 'INT', req: false, pk: false },
        { code: 'citation_cnt', cn: '被引次数', type: 'BIGINT', req: false, pk: false },
      );
    // 出版机构
    } else if (t.id === 'dwd_pub' || t.id === 'dwd_pby') {
      custom.push(
        { code: 'pub_id', cn: '出版社 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_publisher_id' },
        { code: 'pub_name', cn: '出版社名称', type: 'STRING(200)', req: true, pk: false },
        { code: 'pub_country', cn: '所在国', type: 'CODE', req: false, pk: false },
        { code: 'pub_city', cn: '所在城市', type: 'STRING(50)', req: false, pk: false },
        { code: 'isbn_prefix', cn: 'ISBN 前缀', type: 'STRING(10)', req: false, pk: false },
        { code: 'book_cnt', cn: '出版图书数', type: 'INT', req: false, pk: false },
      );
    // 主题分类
    } else if (t.id === 'dwd_sub' || t.id === 'dwd_clc' || t.id === 'dwt_sub') {
      custom.push(
        { code: 'subject_id', cn: '主题词 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_subject_id' },
        { code: 'subject_term', cn: '主题词', type: 'STRING(200)', req: true, pk: false },
        { code: 'clc_code', cn: '中图法分类号', type: 'STRING(20)', req: false, pk: false, std: 'std_clc' },
        { code: 'parent_id', cn: '父节点 ID', type: 'STRING(20)', req: false, pk: false },
        { code: 'tree_level', cn: '层级', type: 'INT', req: false, pk: false },
        { code: 'is_leaf', cn: '是否叶节点', type: 'BOOLEAN', req: false, pk: false },
        { code: 'book_cnt', cn: '关联图书数', type: 'INT', req: false, pk: false },
      );
    // 期刊
    } else if (t.id === 'dwd_per' || t.id === 'dwd_pv' || t.id === 'dwt_py') {
      custom.push(
        { code: 'per_id', cn: '期刊 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_per_id' },
        { code: 'issn', cn: 'ISSN', type: 'STRING(8)', req: true, pk: false, std: 'std_issn' },
        { code: 'cn', cn: 'CN 号', type: 'STRING(10)', req: false, pk: false, std: 'std_cn' },
        { code: 'per_title', cn: '刊名', type: 'STRING(200)', req: true, pk: false },
        { code: 'publisher', cn: '出版者', type: 'STRING(200)', req: false, pk: false },
        { code: 'pub_freq', cn: '出版频率', type: 'CODE', req: false, pk: false, std: 'std_pub_freq' },
        { code: 'pub_year', cn: '出版年', type: 'INT', req: false, pk: false },
        { code: 'volume', cn: '卷', type: 'STRING(20)', req: false, pk: false },
        { code: 'issue', cn: '期', type: 'STRING(20)', req: false, pk: false },
      );
    // 馆藏
    } else if (t.id === 'ods_hold' || t.id === 'dwd_hold' || t.id === 'dwt_hs') {
      custom.push(
        { code: 'hold_id', cn: '馆藏 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_hold_id' },
        { code: 'bib_id', cn: '书目记录 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_bib_id' },
        { code: 'barcode', cn: '条形码', type: 'STRING(20)', req: true, pk: false, std: 'std_barcode' },
        { code: 'call_no', cn: '索书号', type: 'STRING(50)', req: true, pk: false, std: 'std_callno' },
        { code: 'location_code', cn: '馆藏地代码', type: 'CODE', req: true, pk: false, std: 'std_location' },
        { code: 'status', cn: '在馆/借出/注销', type: 'CODE', req: true, pk: false, std: 'std_hold_status' },
        { code: 'price', cn: '单价', type: 'DECIMAL(18,2)', req: false, pk: false, std: 'std_money' },
        { code: 'accession_dt', cn: '入藏日期', type: 'DATE', req: false, pk: false },
        { code: 'source', cn: '来源（采购/捐赠/调拨）', type: 'CODE', req: false, pk: false, std: 'std_hold_source' },
      );
    // 复本架位
    } else if (t.id === 'dwd_loc' || t.id === 'dwd_hl' || t.id === 'dwt_hd') {
      custom.push(
        { code: 'loc_id', cn: '馆藏地 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_location' },
        { code: 'loc_name', cn: '馆藏地名称', type: 'STRING(100)', req: true, pk: false },
        { code: 'building', cn: '所在楼宇', type: 'STRING(50)', req: false, pk: false },
        { code: 'floor', cn: '楼层', type: 'STRING(20)', req: false, pk: false },
        { code: 'room', cn: '阅览室', type: 'STRING(50)', req: false, pk: false },
        { code: 'hold_cnt', cn: '馆藏册数', type: 'INT', req: false, pk: false },
      );
    // 剔旧注销
    } else if (t.id === 'ods_hwd' || t.id === 'dwd_hl2' || t.id === 'dwt_lr') {
      custom.push(
        { code: 'weed_id', cn: '剔旧 ID', type: 'STRING(20)', req: true, pk: false },
        { code: 'hold_id', cn: '馆藏 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_hold_id' },
        { code: 'weed_dt', cn: '剔旧日期', type: 'DATE', req: true, pk: false },
        { code: 'weed_reason', cn: '剔旧原因', type: 'CODE', req: true, pk: false, std: 'std_weed_reason' },
        { code: 'weed_amt', cn: '残值', type: 'DECIMAL(18,2)', req: false, pk: false, std: 'std_money' },
        { code: 'operator', cn: '操作员', type: 'STRING(50)', req: false, pk: false },
      );
    // 馆藏评估
    } else if (t.id === 'dwt_ce' || t.id === 'ads_cg') {
      custom.push(
        { code: 'subject_id', cn: '学科 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_subject_id' },
        { code: 'subject_name', cn: '学科名称', type: 'STRING(100)', req: true, pk: false },
        { code: 'book_cnt', cn: '馆藏数', type: 'INT', req: false, pk: false },
        { code: 'citation_cnt', cn: '学科引用', type: 'BIGINT', req: false, pk: false },
        { code: 'coverage', cn: '学科覆盖率', type: 'DECIMAL(5,2)', req: false, pk: false },
        { code: 'gap_score', cn: '缺口评分', type: 'DECIMAL(5,2)', req: false, pk: false },
      );
    // 借还
    } else if (t.id === 'ods_ln' || t.id === 'dwd_ln' || t.id === 'dwt_lnd') {
      custom.push(
        { code: 'loan_id', cn: '借阅流水 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_loan_id' },
        { code: 'hold_id', cn: '馆藏 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_hold_id' },
        { code: 'reader_id', cn: '读者证号', type: 'STRING(20)', req: true, pk: false, std: 'std_reader_id' },
        { code: 'loan_dt', cn: '借出时间', type: 'TIMESTAMP', req: true, pk: false, std: 'std_datetime' },
        { code: 'due_dt', cn: '应还日期', type: 'DATE', req: true, pk: false },
        { code: 'return_dt', cn: '实际归还时间', type: 'TIMESTAMP', req: false, pk: false, std: 'std_datetime' },
        { code: 'renew_cnt', cn: '续借次数', type: 'INT', req: false, pk: false },
        { code: 'loan_type', cn: '借阅类型', type: 'CODE', req: false, pk: false, std: 'std_loan_type' },
      );
    // 预约
    } else if (t.id === 'ods_rsv' || t.id === 'dwd_rsq' || t.id === 'dwt_rwt') {
      custom.push(
        { code: 'resv_id', cn: '预约 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_resv_id' },
        { code: 'bib_id', cn: '书目 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_bib_id' },
        { code: 'reader_id', cn: '读者证号', type: 'STRING(20)', req: true, pk: false, std: 'std_reader_id' },
        { code: 'resv_dt', cn: '预约时间', type: 'TIMESTAMP', req: true, pk: false },
        { code: 'expire_dt', cn: '预约失效时间', type: 'DATE', req: true, pk: false },
        { code: 'queue_pos', cn: '排队位次', type: 'INT', req: false, pk: false },
        { code: 'pickup_loc', cn: '取书地', type: 'CODE', req: false, pk: false, std: 'std_location' },
      );
    // 违章
    } else if (t.id === 'ods_vio' || t.id === 'dwd_fin' || t.id === 'dwt_os') {
      custom.push(
        { code: 'vio_id', cn: '违章 ID', type: 'STRING(20)', req: true, pk: false },
        { code: 'reader_id', cn: '读者证号', type: 'STRING(20)', req: true, pk: false, std: 'std_reader_id' },
        { code: 'loan_id', cn: '借阅 ID', type: 'STRING(20)', req: false, pk: false, std: 'std_loan_id' },
        { code: 'vio_type', cn: '违章类型', type: 'CODE', req: true, pk: false, std: 'std_violation_type' },
        { code: 'overdue_days', cn: '逾期天数', type: 'INT', req: false, pk: false },
        { code: 'fine_amt', cn: '罚款金额', type: 'DECIMAL(18,2)', req: false, pk: false, std: 'std_money' },
        { code: 'paid_dt', cn: '缴费日期', type: 'DATE', req: false, pk: false },
      );
    // 到馆服务
    } else if (t.id === 'ods_gt' || t.id === 'dwd_vd' || t.id === 'dwt_vp') {
      custom.push(
        { code: 'gate_id', cn: '门禁 ID', type: 'STRING(20)', req: true, pk: false },
        { code: 'reader_id', cn: '读者证号', type: 'STRING(20)', req: false, pk: false, std: 'std_reader_id' },
        { code: 'in_dt', cn: '入馆时间', type: 'TIMESTAMP', req: true, pk: false, std: 'std_datetime' },
        { code: 'out_dt', cn: '离馆时间', type: 'TIMESTAMP', req: false, pk: false },
        { code: 'gate_code', cn: '门禁代码', type: 'CODE', req: false, pk: false, std: 'std_gate' },
        { code: 'visit_type', cn: '到馆类型', type: 'CODE', req: false, pk: false, std: 'std_visit_type' },
      );
    // 学科评估
    } else if (t.id === 'dwt_esi' || t.id === 'dwt_inc' || t.id === 'ads_sr') {
      custom.push(
        { code: 'subject_code', cn: 'ESI 学科代码', type: 'STRING(20)', req: true, pk: false, std: 'std_esi_subject' },
        { code: 'subject_name', cn: '学科名称', type: 'STRING(100)', req: true, pk: false },
        { code: 'paper_cnt', cn: '论文数', type: 'INT', req: false, pk: false },
        { code: 'citation_cnt', cn: '被引次数', type: 'BIGINT', req: false, pk: false },
        { code: 'top_pct', cn: 'Top 百分比', type: 'DECIMAL(5,2)', req: false, pk: false },
        { code: 'h_index', cn: '学科 H 指数', type: 'INT', req: false, pk: false },
        { code: 'esi_threshold', cn: 'ESI 阈值', type: 'INT', req: false, pk: false },
      );
    // 读者画像
    } else if (t.id === 'dwd_pp' || t.id === 'dwd_pb' || t.id === 'dwt_psg') {
      custom.push(
        { code: 'reader_id', cn: '读者证号', type: 'STRING(20)', req: true, pk: false, std: 'std_reader_id' },
        { code: 'reader_name', cn: '读者姓名', type: 'STRING(50)', req: true, pk: false },
        { code: 'reader_type', cn: '读者类型', type: 'CODE', req: true, pk: false, std: 'std_reader_type' },
        { code: 'department', cn: '院系 / 单位', type: 'STRING(100)', req: false, pk: false, std: 'std_department' },
        { code: 'gender', cn: '性别', type: 'CODE', req: false, pk: false, std: 'std_gender' },
        { code: 'register_date', cn: '注册日期', type: 'DATE', req: true, pk: false },
        { code: 'loan_cnt_total', cn: '累计借阅册数', type: 'INT', req: false, pk: false },
        { code: 'active_score', cn: '活跃度评分', type: 'DECIMAL(5,2)', req: false, pk: false },
      );
    // 阅读推广
    } else if (t.id === 'ods_prm' || t.id === 'dwd_bt' || t.id === 'dwt_br') {
      custom.push(
        { code: 'prom_id', cn: '推广活动 ID', type: 'STRING(20)', req: true, pk: false },
        { code: 'prom_name', cn: '活动名称', type: 'STRING(200)', req: true, pk: false },
        { code: 'prom_type', cn: '活动类型', type: 'CODE', req: true, pk: false, std: 'std_prom_type' },
        { code: 'start_dt', cn: '开始日期', type: 'DATE', req: true, pk: false },
        { code: 'end_dt', cn: '结束日期', type: 'DATE', req: true, pk: false },
        { code: 'topic', cn: '主题词', type: 'STRING(200)', req: false, pk: false, std: 'std_subject' },
        { code: 'attendee_cnt', cn: '参与人次', type: 'INT', req: false, pk: false },
        { code: 'prom_budget', cn: '推广预算', type: 'DECIMAL(18,2)', req: false, pk: false, std: 'std_money' },
        { code: 'prom_location', cn: '活动地点', type: 'STRING(200)', req: false, pk: false },
        { code: 'sign_up_method', cn: '报名方式', type: 'CODE', req: false, pk: false, std: 'std_signup_method' },
        { code: 'prom_status', cn: '活动状态', type: 'CODE', req: true, pk: false, std: 'std_prom_status' },
        { code: 'target_audience', cn: '目标读者群', type: 'STRING(500)', req: false, pk: false },
        { code: 'prom_channel', cn: '宣传渠道', type: 'CODE', req: false, pk: false, std: 'std_prom_channel' },
        { code: 'effect_score', cn: '效果评分', type: 'DECIMAL(5,2)', req: false, pk: false },
        { code: 'organizer_id', cn: '主办方 ID', type: 'STRING(20)', req: false, pk: false, std: 'std_department' },
        { code: 'sign_up_cnt', cn: '报名人数', type: 'INT', req: false, pk: false },
        { code: 'book_recommend_cnt', cn: '推荐图书数', type: 'INT', req: false, pk: false },
        { code: 'feedback_score', cn: '满意度评分', type: 'DECIMAL(3,2)', req: false, pk: false },
      );
    // 学科馆员
    } else if (t.id === 'dwd_lia' || t.id === 'dwd_svr' || t.id === 'dwt_lk') {
      custom.push(
        { code: 'liaison_id', cn: '馆员 ID', type: 'STRING(20)', req: true, pk: false, std: 'std_liaison_id' },
        { code: 'liaison_name', cn: '馆员姓名', type: 'STRING(50)', req: true, pk: false },
        { code: 'subject_code', cn: '负责学科', type: 'STRING(20)', req: false, pk: false, std: 'std_subject_id' },
        { code: 'department', cn: '所在部门', type: 'STRING(100)', req: false, pk: false },
        { code: 'service_hours', cn: '服务小时数', type: 'DECIMAL(8,2)', req: false, pk: false },
        { code: 'service_cnt', cn: '服务次数', type: 'INT', req: false, pk: false },
      );
    } else {
      // 通用 fallback
      custom.push(
        { code: 'id', cn: '业务 ID', type: 'STRING(20)', req: true, pk: false },
        { code: 'name', cn: '名称', type: 'STRING(200)', req: true, pk: false },
        { code: 'type', cn: '类型', type: 'CODE', req: true, pk: false, std: 'std_type' },
        { code: 'status', cn: '状态', type: 'CODE', req: true, pk: false, std: 'std_status' },
        { code: 'value', cn: '数值', type: 'DECIMAL(18,2)', req: false, pk: false, std: 'std_money' },
        { code: 'remark', cn: '备注', type: 'TEXT', req: false, pk: false },
      );
    }
    const all = [...custom, ...common].slice(0, t.fields);
    return `
      <div style="font-size:13px;line-height:1.5;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 16px;margin:0 0 12px;padding:0 0 10px;border-bottom:1px solid #E2E8F0;">
          <div><span style="color:var(--neutral-500);">表名：</span><span class="text-mono" style="color:var(--brand-700);font-weight:600;">${t.name}</span></div>
          <div><span style="color:var(--neutral-500);">分层：</span><b>${t.layer}</b></div>
          <div><span style="color:var(--neutral-500);">字段数：</span><b>${t.fields}</b></div>
        </div>
        <table class="field" style="width:100%;font-size:12px;border-collapse:collapse;margin:0;">
          <thead><tr style="background:#F1F5F9;">
            <th style="width:130px;padding:6px 8px;text-align:left;font-weight:600;border-bottom:1px solid #E2E8F0;">字段编码</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:1px solid #E2E8F0;">中文名</th>
            <th style="width:130px;padding:6px 8px;text-align:left;font-weight:600;border-bottom:1px solid #E2E8F0;">类型</th>
            <th style="width:70px;padding:6px 8px;text-align:left;font-weight:600;border-bottom:1px solid #E2E8F0;">约束</th>
            <th style="width:160px;padding:6px 8px;text-align:left;font-weight:600;border-bottom:1px solid #E2E8F0;">标准</th>
          </tr></thead>
          <tbody>
            ${all.map(f => `<tr style="border-bottom:1px solid #F1F5F9;">
              <td class="text-mono" style="padding:5px 8px;color:var(--brand-700);">${f.code}</td>
              <td style="padding:5px 8px;">${f.cn}</td>
              <td class="text-mono" style="padding:5px 8px;color:var(--neutral-600);font-size:11px;">${f.type}</td>
              <td style="padding:5px 8px;">${f.pk ? '<span class="pill pill--pk">PK</span>' : (f.req ? '<span class="pill pill--req">必填</span>' : '<span style="color:var(--neutral-400);">—</span>')}</td>
              <td style="padding:5px 8px;">${f.std ? '<span class="pill pill--code" style="font-size:9px;">' + f.std + '</span>' : '<span style="color:var(--neutral-400);">—</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:10px;padding:0;font-size:11px;color:var(--neutral-500);">
          💡 提示：本表字段定义仅供参考，实际导入时会根据向导参数和本馆命名规范调整。
        </div>
      </div>
    `;
  }

  // ============ 4 步导入向导 ============
  function showImportWizard(m) {
    // 根据模型名派发 5 个主题域
    const wizardProfiles = {
      '书目核心数据模型': {
        domains: [
          { key: '书目域', icon: '📕', color: '#EF4444', count: 28, sample: 'ods_bib_record · dwd_bib_unified · dwt_bib_dim' },
          { key: '作者域', icon: '✍️', color: '#F59E0B', count: 16, sample: 'dwd_author · dwd_author_work · dwt_author_h_index' },
          { key: '出版机构', icon: '🏢', color: '#3B82F6', count: 12, sample: 'dwd_publisher · dwd_pub_book_year' },
          { key: '主题分类', icon: '🏷️', color: '#10B981', count: 12, sample: 'dwd_subject_heading · dwd_clc_tree · dwt_subject_hot' },
          { key: '期刊域', icon: '📰', color: '#8B5CF6', count: 18, sample: 'dwd_per_title · dwd_per_volume · dwt_per_yearly' },
        ],
        tableGroups: [
          { domain: '书目域', icon: '📕', tables: ['ods_bib_record','dwd_bib_unified','dwt_bib_dim','ads_bib_search_idx'] },
          { domain: '作者域', icon: '✍️', tables: ['dwd_author','dwd_author_work','dwt_author_h_index'] },
          { domain: '出版机构', icon: '🏢', tables: ['dwd_publisher','dwd_pub_book_year'] },
          { domain: '主题分类', icon: '🏷️', tables: ['dwd_subject_heading','dwd_clc_tree','dwt_subject_hot'] },
          { domain: '期刊域', icon: '📰', tables: ['dwd_per_title','dwd_per_volume','dwt_per_yearly'] },
        ],
        tableCount: 86,
        phases: ['创建书目主档（ODS）', '创建书目明细（DWD）', '创建作者/期刊/出版汇总（DWT）', '应用 MARC21/CNMARC 标准与落标检查'],
        result: { tables: 86, standards: '218 / 218', fks: 14, etl: 5, secs: 23, fail: 0, skip: 0 },
      },
      '馆藏典藏核心模型': {
        domains: [
          { key: '馆藏主档', icon: '📚', color: '#EF4444', count: 22, sample: 'ods_hold_item · dwd_hold_unified · dwt_hold_status' },
          { key: '复本架位', icon: '🗄️', color: '#F59E0B', count: 16, sample: 'dwd_callno · dwd_hold_location · dwt_hold_dist' },
          { key: '剔旧注销', icon: '♻️', color: '#3B82F6', count: 12, sample: 'ods_hold_weeding · dwd_hold_lost · dwt_hold_loss_rate' },
          { key: '典藏统计', icon: '📊', color: '#10B981', count: 8, sample: 'dwt_hold_yearly · dwt_hold_by_subject' },
          { key: '馆藏评估', icon: '⭐', color: '#8B5CF6', count: 6, sample: 'dwt_collection_eval · ads_collection_gap' },
        ],
        tableGroups: [
          { domain: '馆藏主档', icon: '📚', tables: ['ods_hold_item','dwd_hold_unified','dwt_hold_status'] },
          { domain: '复本架位', icon: '🗄️', tables: ['dwd_callno','dwd_hold_location','dwt_hold_dist'] },
          { domain: '剔旧注销', icon: '♻️', tables: ['ods_hold_weeding','dwd_hold_lost','dwt_hold_loss_rate'] },
          { domain: '典藏统计', icon: '📊', tables: ['dwt_hold_yearly','dwt_hold_by_subject','ads_hold_dashboard'] },
          { domain: '馆藏评估', icon: '⭐', tables: ['dwt_collection_eval','ads_collection_gap','dwt_collection_depth'] },
        ],
        tableCount: 64,
        phases: ['创建馆藏主档（ODS）', '创建馆藏明细（DWD）', '创建典藏汇总（DWT）', '应用 MARC Holdings 852-878 与馆藏规范'],
        result: { tables: 64, standards: '168 / 168', fks: 12, etl: 4, secs: 18, fail: 0, skip: 0 },
      },
      '流通借阅服务模型': {
        domains: [
          { key: '借还事务', icon: '🔄', color: '#EF4444', count: 18, sample: 'ods_loan_trans · dwd_loan_circ · dwt_loan_daily' },
          { key: '预约预借', icon: '⏰', color: '#F59E0B', count: 10, sample: 'ods_reservation · dwd_resv_queue · dwt_resv_wait_time' },
          { key: '违章罚款', icon: '⚠️', color: '#3B82F6', count: 8, sample: 'ods_violation · dwd_fine_trans · dwt_overdue_stats' },
          { key: '到馆服务', icon: '🚶', color: '#10B981', count: 6, sample: 'ods_gate_log · dwd_visit_daily · dwt_visitor_profile' },
        ],
        tableGroups: [
          { domain: '借还事务', icon: '🔄', tables: ['ods_loan_trans','dwd_loan_circ','dwt_loan_daily'] },
          { domain: '预约预借', icon: '⏰', tables: ['ods_reservation','dwd_resv_queue','dwt_resv_wait_time'] },
          { domain: '违章罚款', icon: '⚠️', tables: ['ods_violation','dwd_fine_trans','dwt_overdue_stats'] },
          { domain: '到馆服务', icon: '🚶', tables: ['ods_gate_log','dwd_visit_daily','dwt_visitor_profile'] },
        ],
        tableCount: 42,
        phases: ['创建借还流水（ODS）', '创建借还明细（DWD）', '创建服务汇总（DWT）', '应用流通服务标准与实时指标'],
        result: { tables: 42, standards: '142 / 142', fks: 9, etl: 3, secs: 14, fail: 0, skip: 0 },
      },
      '学科服务分析模型': {
        domains: [
          { key: '学科评估', icon: '🎓', color: '#EF4444', count: 14, sample: 'dwt_esi_subject · dwt_incites_kpi · ads_subject_radar' },
          { key: '读者画像', icon: '👤', color: '#F59E0B', count: 16, sample: 'dwd_patron_profile · dwd_patron_behavior · dwt_patron_segment' },
          { key: '阅读推广', icon: '📖', color: '#3B82F6', count: 12, sample: 'ods_promotion · dwd_borrow_topics · dwt_book_recommend' },
          { key: '学科馆员', icon: '👨‍🏫', color: '#10B981', count: 8, sample: 'dwd_liaison · dwd_service_record · dwt_liaison_kpi' },
          { key: '科研支持', icon: '🔬', color: '#8B5CF6', count: 6, sample: 'ods_factcheck_req · dwd_cited_ref · dwt_esi_h_index' },
        ],
        tableGroups: [
          { domain: '学科评估', icon: '🎓', tables: ['dwt_esi_subject','dwt_incites_kpi','ads_subject_radar'] },
          { domain: '读者画像', icon: '👤', tables: ['dwd_patron_profile','dwd_patron_behavior','dwt_patron_segment'] },
          { domain: '阅读推广', icon: '📖', tables: ['ods_promotion','dwd_borrow_topics','dwt_book_recommend'] },
          { domain: '学科馆员', icon: '👨‍🏫', tables: ['dwd_liaison','dwd_service_record','dwt_liaison_kpi'] },
          { domain: '科研支持', icon: '🔬', tables: ['ods_factcheck_req','dwd_cited_ref','dwt_esi_h_index'] },
        ],
        tableCount: 56,
        phases: ['创建 ODS 指标源', '创建读者行为 DWD', '创建学科服务 DWT', '应用 ESI/Incites 标准与学科画像'],
        result: { tables: 56, standards: '196 / 196', fks: 11, etl: 4, secs: 19, fail: 0, skip: 0 },
      },
    };
    const wp = wizardProfiles[m.name] || wizardProfiles['书目核心数据模型'];

    const state = {
      step: 1,
      // Step 1: 选主题域（默认全选）
      domains: Object.fromEntries(wp.domains.map(d => [d.key, true])),
      // Step 2: 命名空间 / 目标分层 / 重复策略
      namespace: 'dwd',
      targetLayer: 'DWD',
      dupStrategy: 'skip',   // skip / override / rename
      // Step 3: 预览
      // Step 4: 进度
      progress: 0,
    };

    function renderHeader() {
      const steps = [
        { n: 1, t: '选择导入范围' },
        { n: 2, t: '配置导入参数' },
        { n: 3, t: '预览确认' },
        { n: 4, t: '导入执行' },
      ];
      return `
        <div style="display:flex;align-items:center;gap:4px;padding:0 4px 14px;border-bottom:1px solid var(--neutral-200);margin-bottom:14px;">
          ${steps.map((s, i) => `
            <div style="display:flex;align-items:center;gap:4px;${i>0?'margin-left:8px;':''}">
              <div style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;
                background:${state.step>=s.n?'var(--brand-500)':'#E2E8F0'};
                color:${state.step>=s.n?'#fff':'#64748B'};">
                ${state.step > s.n ? '✓' : s.n}
              </div>
              <span style="font-size:12px;color:${state.step===s.n?'var(--brand-700)':'var(--neutral-600)'};font-weight:${state.step===s.n?'600':'400'};">${s.t}</span>
              ${i<steps.length-1 ? '<span style="color:var(--neutral-300);margin:0 6px;">›</span>' : ''}
            </div>
          `).join('')}
        </div>`;
    }

    function renderStep1() {
      const domainInfo = wp.domains;
      const selCount = Object.values(state.domains).filter(Boolean).length;
      const totalCount = domainInfo.filter(d => state.domains[d.key]).reduce((a, d) => a + d.count, 0);
      return `
        <div style="font-size:13px;">
          <div style="margin-bottom:12px;padding:10px 14px;background:#F0F9FF;border-radius:6px;color:var(--neutral-700);">
            <b>第 1 步</b>：选择要从 <b>${m.name}</b> 导入到本馆的主题域（默认全部选中）
          </div>
          <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:12px;">
            ${domainInfo.map(d => `
              <label style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:2px solid ${state.domains[d.key]?d.color:'var(--neutral-200)'};border-radius:8px;cursor:pointer;background:${state.domains[d.key]?'#fff':''};">
                <input type="checkbox" data-domain="${d.key}" ${state.domains[d.key]?'checked':''} style="width:18px;height:18px;cursor:pointer;">
                <span style="font-size:20px;">${d.icon}</span>
                <div style="flex:1;">
                  <div style="font-weight:600;color:var(--neutral-900);">${d.key} <span style="font-weight:400;color:${d.color};font-size:11px;margin-left:6px;">${d.count} 张表</span></div>
                  <div class="text-mono" style="font-size:11px;color:var(--neutral-500);margin-top:2px;">${d.sample}</div>
                </div>
                <span style="color:${d.color};font-size:18px;">${state.domains[d.key]?'✓':''}</span>
              </label>
            `).join('')}
          </div>
          <div style="padding:10px 14px;background:#FEF3C7;border-radius:6px;display:flex;align-items:center;gap:12px;">
            <div style="font-size:11px;color:#92400E;">已选 <b>${selCount}</b> 个主题域 · 共 <b>${totalCount}</b> 张表</div>
            <div style="margin-left:auto;display:flex;gap:6px;">
              <button class="btn btn--sm" id="btn-select-all">全选</button>
              <button class="btn btn--sm" id="btn-select-none">全不选</button>
            </div>
          </div>
        </div>
      `;
    }

    function renderStep2() {
      return `
        <div style="font-size:13px;">
          <div style="margin-bottom:12px;padding:10px 14px;background:#F0F9FF;border-radius:6px;color:var(--neutral-700);">
            <b>第 2 步</b>：配置导入到本馆的参数
          </div>
          <div class="field" style="margin-bottom:14px;">
            <div class="field__label" style="font-size:12px;margin-bottom:6px;">命名空间（影响表名前缀）</div>
            <select class="select" id="wiz-namespace" style="width:100%;padding:6px 10px;border:1px solid var(--neutral-200);border-radius:6px;">
              <option value="dwd" ${state.namespace==='dwd'?'selected':''}>dwd_  （本馆默认）</option>
              <option value="ods" ${state.namespace==='ods'?'selected':''}>ods_  （原始数据层）</option>
              <option value="dwt" ${state.namespace==='dwt'?'selected':''}>dwt_  （主题汇总层）</option>
              <option value="ads" ${state.namespace==='ads'?'selected':''}>ads_  （应用层）</option>
              <option value="custom" ${state.namespace==='custom'?'selected':''}>自定义...</option>
            </select>
            <div style="font-size:11px;color:var(--neutral-500);margin-top:4px;">例如：dwd_trade_order_df。导入的表名会按此规则自动加前缀。</div>
          </div>
          <div class="field" style="margin-bottom:14px;">
            <div class="field__label" style="font-size:12px;margin-bottom:6px;">目标分层（导入到哪个分层）</div>
            <div style="display:flex;gap:6px;">
              ${['ODS','DWD','DWT','ADS'].map(l => `
                <label style="flex:1;padding:10px;border:2px solid ${state.targetLayer===l?'var(--brand-500)':'var(--neutral-200)'};border-radius:6px;text-align:center;cursor:pointer;background:${state.targetLayer===l?'#EFF6FF':''};">
                  <input type="radio" name="wiz-layer" value="${l}" ${state.targetLayer===l?'checked':''} style="display:none;">
                  <div style="font-weight:600;font-size:12px;">${l}</div>
                  <div style="font-size:10px;color:var(--neutral-500);margin-top:2px;">${({ODS:'原始',DWD:'明细/主档',DWT:'主题汇总',ADS:'应用'})[l]}</div>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="field" style="margin-bottom:8px;">
            <div class="field__label" style="font-size:12px;margin-bottom:6px;">同名表处理策略</div>
            <div style="display:flex;gap:6px;">
              ${[
                { v: 'skip', t: '跳过已存在', d: '保留原表，不覆盖' },
                { v: 'override', t: '覆盖更新', d: '删除并重建（危险）' },
                { v: 'rename', t: '重命名', d: '导入为 xxx_v2、xxx_v3' },
              ].map(o => `
                <label style="flex:1;padding:10px 12px;border:2px solid ${state.dupStrategy===o.v?'var(--brand-500)':'var(--neutral-200)'};border-radius:6px;cursor:pointer;background:${state.dupStrategy===o.v?'#EFF6FF':''};">
                  <input type="radio" name="wiz-dup" value="${o.v}" ${state.dupStrategy===o.v?'checked':''} style="display:none;">
                  <div style="font-weight:600;font-size:12px;">${o.t}</div>
                  <div style="font-size:10px;color:var(--neutral-500);margin-top:2px;">${o.d}</div>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    function renderStep3() {
      const tableGroups = wp.tableGroups;
      const sel = tableGroups.filter(d => state.domains[d.domain]);
      const prefix = state.namespace === 'custom' ? 'tmp_' : state.namespace + '_';
      const allTables = sel.flatMap(d => d.tables.map(t => ({ domain: d.domain, icon: d.icon, name: t.replace(/^(ods|dwd|dwt|ads)_/, prefix) })));
      return `
        <div style="font-size:13px;">
          <div style="margin-bottom:12px;padding:10px 14px;background:#F0F9FF;border-radius:6px;color:var(--neutral-700);">
            <b>第 3 步</b>：预览即将创建的 <b>${allTables.length}</b> 张表
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div style="padding:10px 12px;background:#F0FDF4;border-left:3px solid #10B981;border-radius:4px;font-size:12px;">
              <b>配置摘要：</b><br>
              命名空间：<span class="text-mono" style="color:#065F46;">${prefix}</span><br>
              目标分层：<b>${state.targetLayer}</b><br>
              重复策略：<b>${({skip:'跳过',override:'覆盖',rename:'重命名'})[state.dupStrategy]}</b>
            </div>
            <div style="padding:10px 12px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:4px;font-size:12px;">
              <b>导入统计：</b><br>
              主题域：<b>${sel.length}</b><br>
              表数量：<b>${allTables.length}</b><br>
              预计耗时：约 <b>${Math.max(8, allTables.length * 1.5)|0} 秒</b>
            </div>
          </div>
          <div style="border:1px solid var(--neutral-200);border-radius:6px;max-height:280px;overflow-y:auto;">
            <table class="field" style="width:100%;font-size:11px;">
              <thead><tr><th style="width:24px;"></th><th>主题域</th><th>表名</th><th style="width:70px;">目标分层</th><th style="width:70px;">状态</th></tr></thead>
              <tbody>
                ${allTables.map(t => `<tr>
                  <td style="font-size:14px;">${t.icon}</td>
                  <td>${t.domain}</td>
                  <td class="text-mono" style="color:var(--brand-700);">${t.name}</td>
                  <td><span class="pill pill--brand" style="font-size:9px;">${state.targetLayer}</span></td>
                  <td><span class="pill pill--draft" style="font-size:9px;">待创建</span></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    function renderStep4() {
      const phases = wp.phases.map((name, i) => ({ name, pct: (i + 1) * 25 }));
      const curPhase = phases.findIndex(p => state.progress < p.pct);
      const tblN = wp.tableCount;
      const res = wp.result;
      return `
        <div style="font-size:13px;">
          <div style="margin-bottom:14px;padding:10px 14px;background:${state.progress>=100?'#D1FAE5':'#F0F9FF'};border-radius:6px;color:${state.progress>=100?'#065F46':'var(--neutral-700)'};display:flex;align-items:center;gap:8px;">
            ${state.progress>=100 ? '✅' : '⏳'} <b>${state.progress>=100 ? '导入完成' : '正在导入'}</b>
            <span style="margin-left:auto;font-size:11px;">${state.progress>=100 ? '全部 ' + tblN + ' 张表已创建' : '已处理 ' + Math.floor(state.progress/100*tblN) + ' / ' + tblN + ' 张'}</span>
          </div>
          <div style="height:24px;background:#F1F5F9;border-radius:12px;overflow:hidden;margin-bottom:14px;position:relative;">
            <div style="height:100%;background:linear-gradient(90deg, var(--brand-500), #18A957);width:${state.progress}%;transition:width 300ms;"></div>
            <div style="position:absolute;top:0;left:0;right:0;bottom:0;display:grid;place-items:center;font-size:11px;font-weight:600;color:var(--neutral-700);">${state.progress}%</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
            ${phases.map((p, i) => {
              const status = state.progress >= p.pct ? 'done' : (curPhase === i ? 'active' : 'pending');
              return `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;background:${status==='done'?'#F0FDF4':status==='active'?'#FEF3C7':'#F8FAFC'};">
                  <div style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;
                    background:${status==='done'?'#10B981':status==='active'?'#F59E0B':'#CBD5E1'};color:#fff;">
                    ${status==='done'?'✓':i+1}
                  </div>
                  <span style="flex:1;font-size:12px;font-weight:${status==='active'?'600':'400'};">${p.name}</span>
                  <span style="font-size:11px;color:${status==='done'?'#10B981':status==='active'?'#F59E0B':'#94A3B8'};">
                    ${status==='done'?'完成':status==='active'?'进行中...':'等待中'}
                  </span>
                </div>`;
            }).join('')}
          </div>
          ${state.progress >= 100 ? `
            <div style="padding:12px 14px;background:#D1FAE5;border-radius:6px;font-size:12px;color:#065F46;line-height:1.7;">
              <b>📊 导入结果：</b><br>
              ✅ 成功创建 <b>${res.tables}</b> 张表（含 ${wp.domains.length} 主题域、ODS/DWD/DWT/ADS 全分层）<br>
              ✅ 自动应用数据标准 <b>${res.standards}</b> 条（100% 落标）<br>
              ✅ 建立 <b>${res.fks}</b> 条外键关联、<b>3</b> 个索引、<b>${res.etl}</b> 个 ETL 同步任务<br>
              ⏱ 耗时 <b>${res.secs} 秒</b> · 失败 <b>${res.fail}</b> · 跳过 <b>${res.skip}</b>
            </div>
          ` : ''}
        </div>
      `;
    }

    function render() {
      const stepRenderers = { 1: renderStep1, 2: renderStep2, 3: renderStep3, 4: renderStep4 };
      const body = renderHeader() + stepRenderers[state.step]();
      const footer = `
        <div style="display:flex;justify-content:space-between;margin-top:14px;padding-top:14px;border-top:1px solid var(--neutral-200);">
          <div>
            ${state.step > 1 ? '<button class="btn btn--sm" id="wiz-back">← 上一步</button>' : ''}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn--sm" id="wiz-cancel">取消</button>
            ${state.step < 3 ? `<button class="btn btn--primary btn--sm" id="wiz-next">下一步 →</button>` : ''}
            ${state.step === 3 ? `<button class="btn btn--primary btn--sm" id="wiz-start">▶ 开始导入</button>` : ''}
            ${state.step === 4 && state.progress < 100 ? `<button class="btn btn--sm" disabled>导入中...</button>` : ''}
            ${state.step === 4 && state.progress >= 100 ? `<button class="btn btn--primary btn--sm" id="wiz-done">完成 ✓</button>` : ''}
          </div>
        </div>
      `;
      modal({ title: '📥 导入模型到本馆 · ' + m.name, body: body + footer, width: 820 });
      bindStep();
    }

    function bindStep() {
      setTimeout(() => {
        const close = () => document.querySelector('.df-modal__close')?.click();
        document.getElementById('wiz-cancel')?.addEventListener('click', close);
        if (state.step > 1) {
          document.getElementById('wiz-back')?.addEventListener('click', () => { state.step--; render(); });
        }
        if (state.step < 3) {
          document.getElementById('wiz-next')?.addEventListener('click', () => { state.step++; render(); });
        }
        if (state.step === 3) {
          document.getElementById('wiz-start')?.addEventListener('click', () => { state.step = 4; state.progress = 0; render(); runImport(); });
        }
        if (state.step === 4) {
          if (state.progress < 100) { /* 自动播放中 */ }
          else {
            document.getElementById('wiz-done')?.addEventListener('click', () => {
              close();
              DF.app.toast('已成功导入 ' + m.name + ' 到本馆', 'success', 2500);
            });
          }
        }
        // Step 1 交互：勾选域
        if (state.step === 1) {
          document.querySelectorAll('input[data-domain]').forEach(cb => {
            cb.addEventListener('change', () => { state.domains[cb.dataset.domain] = cb.checked; render(); });
          });
          document.getElementById('btn-select-all')?.addEventListener('click', () => {
            Object.keys(state.domains).forEach(k => state.domains[k] = true); render();
          });
          document.getElementById('btn-select-none')?.addEventListener('click', () => {
            Object.keys(state.domains).forEach(k => state.domains[k] = false); render();
          });
        }
        // Step 2 交互：选择命名空间/分层/重复策略
        if (state.step === 2) {
          document.getElementById('wiz-namespace')?.addEventListener('change', e => { state.namespace = e.target.value; });
          document.querySelectorAll('input[name="wiz-layer"]').forEach(r => {
            r.addEventListener('change', e => { state.targetLayer = e.target.value; });
          });
          document.querySelectorAll('input[name="wiz-dup"]').forEach(r => {
            r.addEventListener('change', e => { state.dupStrategy = e.target.value; });
          });
        }
      }, 30);
    }

    // 模拟进度推进
    function runImport() {
      const tick = () => {
        state.progress = Math.min(100, state.progress + 8 + Math.random() * 6);
        render();
        if (state.progress < 100) {
          setTimeout(tick, 350);
        }
      };
      setTimeout(tick, 300);
    }

    render();
  }

  // ====== 初始化 ======
  function init() {
    initTabs();
    attachRipple();
    bindDeadButtons();
    // 全局动画 keyframes
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInRight { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes scaleIn { from { opacity:0; transform:scale(.95); } to { opacity:1; transform:scale(1); } }
      @keyframes ripple { to { transform:scale(2.4); opacity:0; } }
      @keyframes spin { from { transform:rotate(0); } to { transform:rotate(360deg); } }
      @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.5; } }
    `;
    document.head.appendChild(style);
  }

  // 暴露
  DF.app = {
    Store,
    toast,
    modal,
    go,
    getQuery,
    getTableFromURL,
    initTabs,
    init,
    isInPages() {
      // 当前路径是否在 /pages/ 下
      return /\/pages\//.test(location.pathname) || /\/pages\//.test(location.href);
    },
  };

  // ====== 工具函数（导出/复制/下载/分享） ======
  function downloadFile(content, filename, mime) {
    try {
      const blob = new Blob([content], { type: mime + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      toast(`✓ 已下载：${filename}（${(blob.size / 1024).toFixed(1)}KB）`, 'success', 2500);
    } catch (e) {
      toast('下载失败：' + e.message, 'danger');
    }
  }
  function generateCSV() {
    const tables = (DF.data?.tables || []).slice(0, 50);
    const rows = [['id', 'name', 'layer', 'fields', 'rows', 'owner', 'updated']];
    tables.forEach(t => rows.push([t.id, t.name, t.layer, t.fields || '', t.rows || '', t.owner || '', t.updated || '']));
    return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  }
  function generatePDFReport() {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DataForge 报告</title>
<style>body{font-family:system-ui;padding:40px;color:#111728;max-width:800px;margin:0 auto;}
h1{color:#1E40AF;border-bottom:3px solid #3B82F6;padding-bottom:12px;}
table{width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;}
th{background:#F1F5F9;padding:10px;text-align:left;}
td{padding:8px 10px;border-bottom:1px solid #E2E8F0;}
.meta{color:#6B7691;font-size:12px;margin-bottom:30px;}</style></head><body>
<h1>DataForge 数据建模平台 · 报告</h1>
<div class="meta">生成时间：${new Date().toLocaleString('zh-CN')} · 由 DataForge v18 自动生成</div>
<h2>📊 数据资产总览</h2>
<table><tr><th>分层</th><th>表数</th><th>字段数</th><th>存储</th></tr>
${(DF.data?.tables || []).reduce((a, t) => { a[t.layer] = (a[t.layer] || { count: 0, fields: 0, rows: 0 }); a[t.layer].count++; a[t.layer].fields += t.fields || 0; a[t.layer].rows += t.rows || 0; return a; }, {})}
${Object.entries((DF.data?.tables || []).reduce((a, t) => { a[t.layer] = (a[t.layer] || { count: 0, fields: 0, rows: 0 }); a[t.layer].count++; a[t.layer].fields += t.fields || 0; a[t.layer].rows += t.rows || 0; return a; }, {})).map(([k, v]) => `<tr><td>${k}</td><td>${v.count}</td><td>${v.fields.toLocaleString()}</td><td>${(v.rows / 1e6).toFixed(1)}M</td></tr>`).join('')}
</table>
<p style="margin-top:40px;color:#6B7691;font-size:11px;text-align:center;">复旦大学图书馆 DataForge 数据中台 · 真实生产级演示系统</p>
</body></html>`;
  }
  function generateAPIDoc() {
    return `# DataForge API 文档

> 自动生成于 ${new Date().toISOString()}

## 1. 实体标准 API

### \`GET /api/v1/entities\`
获取全部实体标准。

**响应示例：**
\`\`\`json
{
  "code": 200,
  "data": [
    {"id": "std_bib", "cn": "图书（编目记录）", "fields": 28, "refs": 86}
  ]
}
\`\`\`

### \`POST /api/v1/entities\`
新建实体标准。

**请求体：**
\`\`\`json
{
  "code": "std_test",
  "cn": "测试实体",
  "fields": [
    {"code": "std_test_id", "cn": "记录 ID", "type": "STRING(20)", "req": true}
  ]
}
\`\`\`

## 2. 属性标准 API
## 3. 码值标准 API
## 4. 映射规则 API
## 5. 指标 API
## 6. 数据血缘 API
`;
  }
  DF.app.downloadFile = downloadFile;
  DF.app.generateCSV = generateCSV;
  DF.app.generatePDFReport = generatePDFReport;
  DF.app.generateAPIDoc = generateAPIDoc;
})();

// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
  if (window.DF && window.DF.app) DF.app.init();
});
