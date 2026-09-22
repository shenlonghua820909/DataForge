/* ==========================================================================
   建清洗任务 · cleaning-task-create —— 把「这张表还没有清洗任务」变成一个真能走通的入口
   --------------------------------------------------------------------------
   为什么需要它（2026-09-21）：
     02b「数据源管理 → 库表结构」和 02c「ODS 数据表」上的【去清洗】是按
     `status === 'synced'` 判的 —— 只要表同步过来了就给这个入口。
     但"有没有清洗任务"是**清洗侧的事实**（cleaning.js 的 SOURCES），两边根本不是一回事：
       29 张已同步表里只有 10 张有清洗任务 → 19 个入口里 **9 个是死胡同**：
       点过去勉强带上了 ?table=，但清洗页不认（SOURCES 里没有它）→ 停在默认表，
       只弹一句"还没有清洗任务"，左栏和面包屑纹丝不动。用户原话：
       「跳转过来当前 ODS 源表不是这张表，然后左边选择这张表，表名后面还是【未配清洗任务】，
         这个链路逻辑对吗？ODS 里没有清洗任务」

   两步收口：
     A. 入口不再说谎 —— 02b/02c 改问 DF.integration.hasCleaningTask(id)（唯一判据）：
        有任务显示【去清洗】，没任务显示【＋ 建清洗任务】并带 intent=create。
     B. 建任务真闭环 —— 就是本文件：
        · 清洗页收到 ?table=<ods_id>&intent=create（或在源表浮层里点了一张 nc 表）
          → 弹出「建清洗任务」确认框（预览：来源、识别到的语义角色、将生成的流水线）
        · 确认 → 用平台的**同一套事实**生成初始任务，不新造一份假数据：
            字段清单 = DF.integration.srcFieldNames()（按数据域推荐字段池 —— 02b 的
                       「新建同步任务」向导第 3 步用的就是它，同一张源表两边字段一致）
            字段类型 = DF.integration.guessSrcType()
            语义角色 = 按字段名推断（pk / readerKey / syncTime / dates / numerics / status）
            样例行   = 按角色生成带"脏值"的演示数据（与既有 10 张源表同款口径：
                       日期列混 2026/08/01 · 2026-8-2 · 13-08-2026 · NULL · / 等）
        · 写进 localStorage（df-cleaning-created）+ SOURCES → 切到这张表 → 直接开始配置。
        ⚠ 必须落 localStorage：不留的话，建完→去 02c 核对→再回来就没了，
          02c 又会说「＋ 建清洗任务」—— 那是**新的谎**，比死胡同更糟。

   ⚠ 加载位置（pages/15-data-cleaning.html）：cleaning.js → integration-data.js → **本文件** → src-picker.js。
     必须在 src-picker.js 之前（重建 SOURCES 后浮层才认得这些表），
     必须在页尾那段 ?table= 内联脚本之前（否则直达找不到刚建的表）。
   ========================================================================== */
(function () {
  const I = window.DF && window.DF.integration;
  if (!I) return;                                    // 注册表没加载 → 本模块整体不生效（页面不残废）

  /* ---------- 字段中文名：先查表，查不到就退回字段名本身（不编造） ---------- */
  const CN_DICT = {
    loan_id: '借阅流水号', reader_id: '读者证号', reader_no: '读者证号', item_barcode: '馆藏条码',
    loan_date: '借出日期', due_date: '应还日期', return_date: '归还日期', renew_cnt: '续借次数',
    fine_amt: '罚款金额', circ_status: '在借状态', oper_id: '操作员', sync_time: '同步时间',
    branch_code: '馆代码', loan_type: '借阅类型', media_type: '载体类型',
    order_id: '订购单号', vendor_code: '书商代码', title: '题名', isbn: 'ISBN', price: '单价',
    quantity: '数量', order_date: '订购日期', arrive_date: '到货/到刊日期', fund_code: '经费代码',
    currency: '币种', invoice_no: '发票号', order_status: '订购状态', operator: '操作员',
    accept_id: '验收单号', budget_code: '预算代码',
    bib_id: '书目 ID', author: '著者', publisher: '出版社', pub_year: '出版年', language: '语种',
    marc_type: 'MARC 类型', class_no: '分类号', holding_id: '馆藏 ID', barcode: '条码',
    location: '馆藏地', volume: '卷册', copy_no: '复本号', call_no: '索书号',
    update_time: '更新时间', cataloger: '编目员', source_flag: '来源标识',
    inventory_id: '盘点单号', item_id: '册 ID', location_code: '馆藏地代码', shelf_no: '架位号',
    item_status: '册状态', check_date: '盘点日期',
    serial_id: '期刊 ID', issn: 'ISSN', issue_no: '期号', year: '年份', frequency: '出版频率',
    card_no: '读者证号', reader_name: '读者姓名', reader_type: '读者类型', gender: '性别',
    dept: '单位/院系', phone: '电话', email: '邮箱', reg_date: '办证日期', expire_date: '有效期至',
    card_status: '证件状态', balance: '账户余额', id_type: '证件类型',
    resource_id: '资源 ID', platform: '平台', package: '资源包', eissn: '电子 ISSN',
    holding_status: '馆藏状态', usage_month: '使用月份', requests: '请求数', sessions: '会话数',
    searches: '检索次数', downloads: '下载量', cover_url: '封面地址', access_url: '访问地址',
    voucher_id: '凭证 ID', payment_id: '付款单号', amount: '金额', post_date: '记账日期',
    voucher_status: '凭证状态', subject: '主题',
    log_id: '日志 ID', query_text: '检索词', result_cnt: '结果数', click_cnt: '点击数',
    log_time: '日志时间', channel: '渠道', device: '设备', ip_addr: 'IP 地址',
    session_id: '会话 ID', page_id: '页面 ID', stay_ms: '停留毫秒',
    msg_id: '消息 ID', topic: '主题', content: '内容', send_time: '发送时间',
    send_status: '发送状态', receiver: '接收人',
    guide_id: '指南 ID', librarian: '学科馆员', consult_id: '咨询 ID', consult_time: '咨询时间',
    consult_type: '咨询类型', status: '状态', name: '名称', code: '编码', value: '取值',
    create_time: '创建时间', remark: '备注', id: 'ID',
  };
  function cnOf(n) {
    if (CN_DICT[n]) return CN_DICT[n];
    const m = /^ext_col_(\d+)$/.exec(String(n));
    return m ? `扩展字段 ${m[1]}` : String(n);        // 兜底：原样返回，不编一个假中文名
  }

  /* ---------- 语义角色推断 ----------
     角色是模板适配的抓手（fieldResolver 按角色把模板里的字段名换成这张表的真字段名）。
     判据一律是**字段名形态**，不猜业务含义 —— 猜不出来就留空，让"不适用"如实体现在适配日志里，
     这跟「缺 读者键」的既有徽标口径一致（宁可显式缺，不要静默错配）。 */
  function inferRoles(names) {
    const find = re => names.find(n => re.test(n));
    const roles = {};
    const pk = names.find(n => /_id$/.test(n) && !/reader|patron|card|holding|item|accept/.test(n)) || names[0];
    if (pk) roles.pk = pk;
    const rk = find(/^(reader|patron|card|user)/);
    if (rk) roles.readerKey = rk;
    const st = find(/^sync_time$/) || find(/(update|etl|load|create|send|log|check|post|arrive|loan|reg|expire|consult|usage|due|return|order|pub)_(date|time|month|year)$/);
    if (st && /sync_time|update_time/.test(st)) roles.syncTime = st;
    const dates = names.filter(n => /(_date|_time|date$|_day$|_month$|year$)/.test(n) && n !== roles.syncTime);
    if (dates.length) roles.dates = dates.slice(0, 4);
    const numerics = names.filter(n =>
      /(amt|amount|price|fee|cost|balance|cnt|count|qty|quantity|volume|requests|sessions|searches|downloads|score|rate|_ms$|year$)/.test(n));
    if (numerics.length) roles.numerics = numerics.slice(0, 4);
    const status = find(/(status|state|flag|_type$|_level$|marc_type)/);
    if (status && status !== rk && status !== roles.syncTime) roles.status = status;
    return roles;
  }

  /* ---------- 样例行：与既有 10 张源表同款"脏值"口径 ----------
     这不是造假：演示数据的价值就在于让清洗步骤有活可干（日期混格式、数值带 ¥/空格/字母、
     空值占位符、完全重复行）。生成规则对所有新建任务一致、可复现。 */
  const SAMPLE_N = 12;
  const DATE_DIRT = ['2026/08/01', '2026-8-2', '13-08-2026', '20260804', '2026/8/5', '',
                     'NULL', '/', '2026-08-15', '-', '--', '08-09-2026'];
  const NUM_DIRT = ['0', '¥0', ' 2', 'abc', '12.50', '3.80', '¥18.20', ' 1', '', 'NULL', '0', '¥5.00'];
  const ST_DIRT = ['Y', 'N', 'y', 'n', '1', '0', '  Y  ', 'N', '', 'Y', 'N', '空'];
  const TEXT_BUCKET = {
    title: ['图书馆学导论', '数字资源建设', '文献计量分析', '高校图书馆治理'],
    name: ['华东地区', '松江校区', '文理分馆', '密集书库'],
    content: ['您借阅的图书即将到期，请及时归还', '预约到馆通知', '续借成功通知'],
    email: ['reader', 'patron', 'student', 'staff'],
    phone: ['13800138', '13900139', '13700137', '13600136'],
    url: ['https://example.org/res/', 'https://example.org/cover/'],
  };
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  function textOf(n, i) {
    for (const k of Object.keys(TEXT_BUCKET)) {
      if (new RegExp(k).test(n)) {
        const v = TEXT_BUCKET[k][i % TEXT_BUCKET[k].length];
        return /url/.test(k) ? v + (i + 1) : (/email/.test(k) ? `${v}${i + 1}@exlib.cn` : `${v} ${i + 1}`);
      }
    }
    if (/isbn/.test(n)) return `978-7-${pad(100 + i)}-0000-${i % 10}`;
    if (/issn/.test(n)) return `1000-${pad(100 + i)}`;
    if (/(_code|_no$|class_no|call_no|shelf_no|location|dept|currency|language|gender|operator|cataloger|receiver|channel|device|platform)/.test(n)) {
      return ['A01', 'B02', 'C03', 'D04'][i % 4] + (i % 3 === 0 ? ' ' : '');   // 留一处带尾空格
    }
    if (/ip_addr/.test(n)) return `10.20.${i}.${100 + i}`;
    if (/_(id|key)$/.test(n)) return `${String(n).replace(/_id$/, '').slice(0, 3).toUpperCase()}2026${pad(i, 4)}`;
    return i % 7 === 0 ? '' : `样本值 ${i + 1}`;
  }
  function generateRows(spec) {
    const roles = spec.roles, names = spec.fields.map(f => f.name);
    const dateSet = new Set(roles.dates || []);
    const numSet = new Set(roles.numerics || []);
    const pkPrefix = String(roles.pk || 'id').replace(/_id$/, '').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'ID';
    const rows = [];
    for (let i = 0; i < SAMPLE_N; i++) {
      const r = {};
      names.forEach(n => {
        if (n === roles.syncTime) { r[n] = `2026-08-${pad(13 + (i % 3))} 02:11:${pad(i)}`; return; }
        if (dateSet.has(n)) { r[n] = DATE_DIRT[i % DATE_DIRT.length]; return; }
        if (numSet.has(n)) { r[n] = NUM_DIRT[i % NUM_DIRT.length]; return; }
        if (n === roles.status) { r[n] = ST_DIRT[i % ST_DIRT.length]; return; }
        if (n === roles.pk) { r[n] = `${pkPrefix}2026${pad(i + 8, 5)}`; return; }
        if (n === roles.readerKey) { r[n] = i === 1 ? ' R20260031' : `R2026${pad(i + 12, 4)}`; return; }
        r[n] = textOf(n, i);
      });
      rows.push(r);
    }
    rows[2] = Object.assign({}, rows[0]);          // 第 3 行 = 第 1 行的完全重复 → 给「去重」步留活干
    return rows;
  }

  /* ---------- 提案：把一张 ODS 表变成一份「清洗任务规格」 ---------- */
  function propose(odsId) {
    const t = (I.ODS_TABLES || []).find(x => x.id === odsId);
    if (!t) return null;
    // 与 02b 同步任务向导同一份字段事实（按 domain 的字段池 × 该表字段数）。
    // ⚠ 必须封顶：ODS 注册表里 ods_cat_marc_oclc 的 fields 写的是 999（源端元数据没探明），
    //   照抄会生成 999 个字段的演示表。24 已经覆盖真实最大值（ods_cat_cnmarc_nlc = 24）。
    const declared = Math.max(1, Number(t.fields) || 6);
    const names = I.srcFieldNames({ domain: t.domain, fields: Math.min(declared, 24) });
    const fields = names.map(n => ({ name: n, srcType: I.guessSrcType(n), cn: cnOf(n) }));
    const domainCn = { 流通: '流通', 采访: '采访', 编目: '编目', 典藏: '典藏', 期刊: '期刊', 读者: '读者', 电子资源: '电子资源' };
    const spec = {
      id: t.id, cn: t.cn, domain: t.domain || '待归类', tgt: t.tgt,
      ds: t.ds, srcDb: t.srcDb, srcTable: t.srcTable,
      taskCode: 'clean_' + t.id.replace(/_sync$/, ''),
      taskName: (t.cn || t.id) + '清洗',
      dbLabel: (I.SOURCE_LABEL || {})[t.ds] || t.srcDb,
      srcRows: t.rows, freq: t.freq, last: t.last,
      roles: {}, fields: [], rows: [],
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      _domainCn: domainCn[t.domain] || t.domain || '待归类',
    };
    spec.roles = inferRoles(names);
    spec.fields = fields;
    spec.rows = generateRows(spec);
    return spec;
  }

  /* ---------- 注册：把规格变成 cleaning.js 认得的 SOURCES 条目 ---------- */
  function register(spec) {
    if (typeof SOURCES === 'undefined' || !spec || !spec.id) return false;
    SOURCES[spec.id] = {
      name: spec.id, cn: spec.cn, domain: spec.domain, target: spec.tgt,
      taskCode: spec.taskCode, taskName: spec.taskName,
      src: { db: spec.dbLabel, schema: spec.srcDb, rows: spec.srcRows, syncAt: (spec.last || '').slice(5, 16) },
      roles: spec.roles, fields: spec.fields, rows: spec.rows,
      created: true,                               // 标记：这张表的任务是在原型里"现建"的
    };
    return true;
  }

  /* ---------- 启动：把 localStorage 里已建的任务重建回 SOURCES（跨页面/跨刷新不丢） ---------- */
  const persisted = (typeof I.createdTasks === 'function' ? I.createdTasks() : []);
  let restored = 0;
  persisted.forEach(sp => { if (register(sp)) restored++; });

  /* ---------- 确认弹窗 ---------- */
  const ROLE_CN = { pk: '业务主键', readerKey: '读者键', syncTime: '同步时间', dates: '日期', numerics: '数值', status: '状态' };
  const ROLE_KEYS_FOR_UI = ['pk', 'readerKey', 'syncTime', 'dates', 'numerics', 'status'];
  function roleChips(roles) {
    const out = [];
    ROLE_KEYS_FOR_UI.forEach(k => {
      const v = roles[k];
      const list = Array.isArray(v) ? v : (v ? [v] : []);
      if (!list.length) return;
      out.push(`<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;`
        + `background:var(--brand-50,#EEF4FF);color:var(--brand-600,#103FA8);font-size:11.5px;font-weight:600;">`
        + `${ROLE_CN[k]}<span style="font-family:ui-monospace,Menlo,monospace;font-weight:400;">${esc(list.join(' / '))}</span></span>`);
    });
    return out.join(' ') || '<span style="color:var(--warning-700,#B66F00);">未能按字段名识别到语义角色 —— 模板会逐条报「不适用」，需人工确认</span>';
  }

  function dialogBody(spec) {
    const miss = ROLE_KEYS_FOR_UI.filter(k => {
      const v = spec.roles[k];
      return !(Array.isArray(v) ? v.length : v);
    });
    const sameKind = (I.ODS_TABLES || []).filter(x => x.domain === spec.domain && x.clean && x.id !== spec.id);
    const row = (k, v) => `<div style="display:flex;gap:10px;padding:3px 0;"><span style="flex:0 0 84px;color:#6B7691;">${k}</span><span>${v}</span></div>`;
    return `
      <div style="font-size:13px;color:#3A4356;line-height:1.75;">
        <p style="margin:0 0 14px;">「<b>${esc(spec.cn)}</b>」<span style="font-family:ui-monospace,Menlo,monospace;color:#6B7691;">${esc(spec.id)}</span>
          已同步到 ODS，但清洗侧还没有它的任务。确认后按<b>推荐模板</b>生成一条初始流水线。</p>
        <div style="border:1px solid #E6EAF2;border-radius:10px;padding:12px 14px;background:#F8FAFD;">
          ${row('源端位置', `<span style="font-family:ui-monospace,Menlo,monospace;">${esc(spec.srcDb)}.${esc(spec.srcTable)}</span>`)}
          ${row('数据源', `${esc(spec.dbLabel)}${spec.freq ? ` · 调度 ${esc(spec.freq)}` : ''}`)}
          ${row('落库目标', `<span style="font-family:ui-monospace,Menlo,monospace;">${esc(spec.tgt || '—')}</span>`)}
          ${row('字段', `识别到 <b>${spec.fields.length}</b> 个字段（按「${esc(spec._domainCn)}」数据域的推荐字段池生成，与「新建同步任务」向导同一份来源）`)}
          ${row('语义角色', roleChips(spec.roles))}
          ${row('推荐模板', sameKind.length
            ? `与 <b>${esc(sameKind[0].cn)}</b>（${esc(sameKind[0].id)}）同类 → 直接复用它的整套清洗规则`
            : '该数据域还没有已配任务的表可参照 → 用平台内置的通用模板')}
        </div>
        ${miss.length ? `<p style="margin:12px 0 0;color:var(--warning-700,#B66F00);font-size:12px;">
          ⚠ 这张表没有「${miss.map(k => ROLE_CN[k]).join('、')}」角色的字段 —— 相关规则会记入「不适用清单」交由人工确认，不会被静默丢弃。</p>` : ''}
        <p style="margin:12px 0 0;color:#6B7691;font-size:12px;">
          初始流水线：字段映射 → 字段清理 → 码值映射 → 类型转换 → 日期标准化 → 去重 → 质量校验（脱敏默认关闭）。
          样例行是演示数据（12 行，含混格式日期 / ¥ 金额 / 空值占位符 / 一条完全重复行），用来预览规则效果，不是源端真实数据。</p>
      </div>`;
  }

  /* 状态闸门：数据还没落到 ODS，就没有东西可洗 ——
     给 pending/syncing 的表开「建清洗任务」等于又造一个死胡同（建完也没数据可预览）。
     这两档一律挡住，并说清先去做什么。synced / schema / failed 都有表，可以建。 */
  const NOT_READY = {
    pending: '这张表还没同步到 ODS（源端已探到、数据尚未落库）—— 先到「ODS 数据表」完成首次同步，再建清洗任务',
    syncing: '这张表正在同步中 —— 等数据落库完成后再为它建清洗任务（现在建了也没有数据可洗）',
  };
  function openDialog(odsId, opts) {
    const t0 = (I.ODS_TABLES || []).find(x => x.id === odsId);
    if (t0 && NOT_READY[t0.status]) {
      DF.app.toast(NOT_READY[t0.status], 'warning', 4200);
      return null;
    }
    const spec = propose(odsId);
    if (!spec) {
      DF.app.toast(`找不到 ${odsId} 的 ODS 登记信息，无法建清洗任务`, 'warning', 3000);
      return null;
    }
    const btn = 'padding:7px 14px;border-radius:8px;font-size:13px;cursor:pointer;';
    const pr = DF.app.modal({
      title: '建清洗任务',
      width: 560,
      body: dialogBody(spec),
      actions: `<button data-resolve style="${btn}border:1px solid #D7DEEA;background:#fff;color:#3A4356;">取消</button>`
        + `<button data-resolve="ok" style="${btn}border:none;background:var(--brand-500,#2E5BFF);color:#fff;font-weight:600;">创建并开始配置</button>`,
    });
    // Esc 关闭：app.js 的通用 modal 只认「点遮罩 / 点 ×」，没接键盘。
    // 建任务弹窗是"落在页面上就弹出来"的，用户第一反应就是 Esc → 必须能关，
    // 否则浮层挡着整页、点哪都没反应（看起来像卡死）。走 #modal-close 是为了让它
    // 正常 resolve，不留下悬空的 Promise。
    const ov = DF.app._lastOverlay;
    if (ov) {
      const onKey = e => {
        if (e.key !== 'Escape') return;
        document.removeEventListener('keydown', onKey, true);
        const x = ov.querySelector('#modal-close');
        if (x) x.click(); else ov.remove();
      };
      document.addEventListener('keydown', onKey, true);
      pr.then(() => document.removeEventListener('keydown', onKey, true));
    }
    return pr.then(r => (r === 'ok' ? create(odsId, opts) : null));
  }

  /* ---------- 创建 ---------- */
  function create(odsId, opts) {
    const t0 = (I.ODS_TABLES || []).find(x => x.id === odsId);
    if (t0 && NOT_READY[t0.status]) { DF.app.toast(NOT_READY[t0.status], 'warning', 4200); return null; }
    const spec = propose(odsId);
    if (!spec) { DF.app.toast(`找不到 ${odsId} 的 ODS 登记信息，无法建清洗任务`, 'warning', 3000); return null; }
    if (typeof SOURCES !== 'undefined' && SOURCES[odsId]) {
      // 已经建过了（比如两个入口都点了）→ 直接切过去，不重复建
      if (typeof switchSource === 'function') switchSource(odsId);
      return SOURCES[odsId];
    }
    register(spec);
    if (typeof I.markCleaningTask === 'function') I.markCleaningTask(spec);   // 写 localStorage + 通知订阅者
    // 按「推荐模板」起初始流水线：先把每步配置恢复成 recommend()，再让 switchSource 去适配这张表
    // （switchSource 在没有该表缓存时会调 adaptPipeline —— 正好就是"按推荐模板适配"的语义）
    try {
      if (typeof pipeline !== 'undefined' && Array.isArray(pipeline)) {
        pipeline.forEach(s => { if (typeof s.recommend === 'function') s.config = s.recommend(); });
      }
      if (typeof SRC_PIPE_CACHE !== 'undefined' && SRC_PIPE_CACHE) delete SRC_PIPE_CACHE[odsId];
    } catch (e) { /* 缓存结构变了也不影响主流程 */ }
    if (typeof switchSource === 'function') switchSource(odsId);
    DF.app.toast(`已为「${spec.cn}」建清洗任务 ${spec.taskCode} —— 按推荐模板生成 ${spec.fields.length} 个字段的初始流水线，可直接开始配置`, 'success', 4200);
    return SOURCES[odsId];
  }

  /* ---------- 对外接口 ---------- */
  window.DF.cleaningTask = {
    propose, create, openDialog, register,
    restoredCount: () => restored,
    persisted: () => (typeof I.createdTasks === 'function' ? I.createdTasks() : []),
  };
})();
