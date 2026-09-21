/* ============================================================
   数据集成 · 共享注册表（ODS 表级 + 源端表级）
   ------------------------------------------------------------
   为什么单独抽一个文件：
     02b-data-sources.html（数据源管理）只回答「数据源」这一层，
     但用户真正要的是「同步过来的表在 ODS 层长什么样、来自谁、还有哪些没同步」。
     02b 与 02c-ods-tables.html 都需要同一份事实源，硬编码两份必然漂移。
     所以这里定义 ODS_TABLES（表级唯一事实源），其余统计全部由它派生。

   ⚠ 两个「张数」千万别混：
     ODS_TABLES 的张数 = 「已经纳入同步任务的表」（含 pending：任务建了、数据还没落）
     dsSchema() 的张数 = 「源端库里一共几张表」= 已纳管的 + SRC_EXTRA 里尚未纳管的
     卡片角标与抽屉都同时显示这两个数，否则用户会问
     「ODS 1 张」到底是"源端只有 1 张表"还是"只同步了 1 张"。

   ⚠ 改这里要同步检查：
     - 02b 的「已同步表」角标 / 库表结构页签 / 同步任务页签
     - 02c 的 KPI、分组视图、未同步清单
     - verify-integration.js（断言会校验条数与派生一致性）
   ============================================================ */
(function () {
  if (!window.DF) window.DF = {};

  /* 同步状态口径（四档 + 一档"新发现"）——
     synced  已同步   ：ODS 有表、结构与源端一致
     syncing 同步中   ：正在跑，未落完
     pending 未同步   ：源端已探到，ODS 里还没有 → 就是用户问的「哪些表还没同步过来，是否要同步」
     failed  同步失败 ：有表但最近一次失败，需要人工介入
     schema  结构变更 ：ODS 有表，但源端字段变了，需确认后重跑 */
  const STATUS_META = {
    synced:  { label: '已同步',   cls: 'is-synced',  dot: 'ok',    order: 0 },
    syncing: { label: '同步中',   cls: 'is-syncing', dot: 'busy',  order: 1 },
    pending: { label: '未同步',   cls: 'is-pending', dot: 'idle',  order: 2 },
    failed:  { label: '同步失败', cls: 'is-failed',  dot: 'bad',   order: 3 },
    schema:  { label: '结构变更', cls: 'is-schema',  dot: 'warn',  order: 4 },
    /* 源端表级独有：源库里有这张表，但平台上还没建同步任务 */
    untracked: { label: '尚未纳管', cls: 'is-untracked', dot: 'off', order: 5 },
  };

  const SOURCE_LABEL = {
    'ds-001': 'MySQL · 汇文流通',
    'ds-002': 'MySQL · 汇文采访',
    'ds-003': 'Oracle · 汇文 ALEPH',
    'ds-006': '达梦 DM · 财务接口',
    'ds-012': 'MaxCompute · 复旦湖仓',
    'ds-014': 'Kafka · 借还事件流',
    'ds-018': 'Excel · 学期采购单',
    'ds-021': '汇文 · ALEPH 集成',
    'ds-022': 'MARC 21 · OCLC 收割',
    'ds-023': 'CNMARC · 国图收割',
    'ds-025': 'Z39.50 · NLC 联编',
    'ds-028': 'COUNTER · 电子资源',
  };

  /* 每条记录的字段说明：
     id        ODS 表在平台内的唯一键（沿用清洗页 SOURCES 的表名，保证两页对得上）
     cn        中文名（给业务看）
     domain    数据域（与数仓规划的业务过程矩阵同口径）
     src       来源数据源 id（→ DS_INSTANCES.id）＋源端库表名，回答「分别来自哪个数据源」
     rows      行数（数字，展示时走 fmtRows）
     fields    字段数
     freq      调度
     last      最近一次同步时间（pending 时为 null，表示从未同步）
     quality   最近一次质量分（null = 未跑过质量校验）
     tgt       落到 DWD 的目标表（"闭环"的下游锚点）
     note      异常/待办说明，pending/failed/schema 必须有 */
  const ODS_TABLES = [
    /* ---------- 流通域 ---------- */
    { id: 'ods_circ_loan_sync',      cn: '借阅流水',     domain: '流通',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'circulation_log',  rows: 13842110, fields: 11, freq: '每 5 分钟',   last: '2026-09-18 02:14', quality: 88.9, tgt: 'dwd_loan_detail',       status: 'synced' },
    { id: 'ods_circ_return_sync',    cn: '归还流水',     domain: '流通',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'return_log',       rows: 12908334, fields: 10, freq: '每 5 分钟',   last: '2026-09-18 02:14', quality: 92.4, tgt: 'dwd_loan_detail',       status: 'synced' },
    { id: 'ods_circ_renew_sync',     cn: '续借流水',     domain: '流通',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'renew_log',        rows: 4128907,  fields: 9,  freq: '每 15 分钟',  last: '2026-09-18 02:00', quality: 90.1, tgt: 'dwd_loan_detail',       status: 'synced' },
    { id: 'ods_circ_hold_sync',      cn: '预约记录',     domain: '流通',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'hold_request',     rows: 892341,   fields: 9,  freq: '每小时',      last: '2026-09-18 01:00', quality: 94.7, tgt: 'dwd_hold_detail',       status: 'synced' },
    { id: 'ods_circ_illsync',        cn: '馆际互借',     domain: '流通',  ds: 'ds-021', srcDb: 'aleph',       srcTable: 'ill_request',      rows: 128400,   fields: 12, freq: '每 30 分钟',  last: '2026-09-18 01:30', quality: 86.2, tgt: 'dwd_ill_detail',        status: 'synced' },
    { id: 'ods_circ_patron_visit',   cn: '到馆门禁客流', domain: '流通',  ds: 'ds-014', srcDb: 'loan_events', srcTable: 'gate_visit',       rows: 2841022,  fields: 7,  freq: '实时 CDC',    last: '2026-09-18 02:31', quality: null, tgt: 'dwd_visit_daily',       status: 'syncing' },
    { id: 'ods_circ_fine_sync',      cn: '罚款缴纳',     domain: '流通',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'fine_detail',      rows: null,     fields: 8,  freq: '每日 02:00',  last: null,               quality: null, tgt: 'dwd_fine_detail',       status: 'pending', note: '源端新探到，尚未建立同步任务' },
    { id: 'ods_circ_lost_report',    cn: '遗失赔偿登记', domain: '流通',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'lost_report',      rows: null,     fields: 10, freq: '每日 02:00',  last: null,               quality: null, tgt: 'dwd_lost_detail',       status: 'pending', note: '源端新探到，尚未建立同步任务' },

    /* ---------- 采访域 ---------- */
    { id: 'ods_acq_accept_sync',     cn: '验收记录',     domain: '采访',  ds: 'ds-002', srcDb: 'huiwen_acq',  srcTable: 'accept_log',       rows: 426118,   fields: 10, freq: '每日 02:30',  last: '2026-09-18 02:32', quality: 91.5, tgt: 'dwd_acq_accept',        status: 'synced' },
    { id: 'ods_acq_order_sync',      cn: '订购单',       domain: '采访',  ds: 'ds-002', srcDb: 'huiwen_acq',  srcTable: 'order_main',       rows: 892044,   fields: 14, freq: '每日 02:30',  last: '2026-09-18 02:33', quality: 93.8, tgt: 'dwd_acq_order',         status: 'synced' },
    { id: 'ods_acq_vendor_sync',     cn: '供应商主档',   domain: '采访',  ds: 'ds-002', srcDb: 'huiwen_acq',  srcTable: 'vendor',           rows: 1284,     fields: 16, freq: '每周一 03:00', last: '2026-09-15 03:02', quality: 98.1, tgt: 'dwd_dim_vendor',        status: 'synced' },
    { id: 'ods_acq_budget_sync',     cn: '经费预算',     domain: '采访',  ds: 'ds-006', srcDb: 'finance',     srcTable: 'budget_plan',      rows: null,     fields: 12, freq: '每月 1 日',   last: null,               quality: null, tgt: 'dwd_acq_budget',        status: 'pending', note: '需先授权 SELECT 该表（当前账号仅有视图权限）' },
    { id: 'ods_acq_purchase_excel',  cn: '学期采购单',   domain: '采访',  ds: 'ds-018', srcDb: '/upload',     srcTable: '2026-spring.xlsx', rows: 1284,     fields: 8,  freq: '手动',        last: '2026-09-15 16:20', quality: 96.0, tgt: 'dwd_acq_order',         status: 'synced' },

    /* ---------- 编目域 ---------- */
    { id: 'ods_cat_book_sync',       cn: '书目主档',     domain: '编目',  ds: 'ds-003', srcDb: 'aleph_prod',  srcTable: 'bib_record',       rows: 8241700,  fields: 18, freq: '每日 01:00',  last: '2026-09-18 01:12', quality: 89.3, tgt: 'dwd_dim_biblio',        status: 'synced' },
    { id: 'ods_cat_holding_sync',    cn: '馆藏复本',     domain: '编目',  ds: 'ds-003', srcDb: 'aleph_prod',  srcTable: 'holding',          rows: 18230450, fields: 13, freq: '每日 01:00',  last: '2026-09-18 01:20', quality: 90.6, tgt: 'dwd_dim_holding',       status: 'synced' },
    { id: 'ods_cat_marc_oclc',       cn: 'OCLC 联编收割', domain: '编目', ds: 'ds-022', srcDb: 'marc21_in',   srcTable: 'oclc_batch',       rows: 28400,    fields: 999, freq: '每周日 04:00', last: '2026-09-14 04:11', quality: null, tgt: 'dwd_dim_biblio',        status: 'syncing' },
    { id: 'ods_cat_authority_sync',  cn: '规范档',       domain: '编目',  ds: 'ds-025', srcDb: 'NLC',         srcTable: 'authority',        rows: null,     fields: 15, freq: '每周一 05:00', last: null,               quality: null, tgt: 'dwd_dim_authority',     status: 'pending', note: 'Z39.50 连接已通过，等待首次全量抽取' },
    { id: 'ods_cat_cnmarc_nlc',      cn: '国图书目',     domain: '编目',  ds: 'ds-023', srcDb: 'cnmarc_in',   srcTable: 'nlc_batch',        rows: 4200,     fields: 24, freq: '每日 05:00',  last: '2026-09-18 05:04', quality: 95.2, tgt: 'dwd_dim_biblio',        status: 'synced' },
    { id: 'ods_cat_book_schema',     cn: '书目主档·字段变更', domain: '编目', ds: 'ds-003', srcDb: 'aleph_prod', srcTable: 'bib_record_v2',   rows: 8241700,  fields: 21, freq: '每日 01:00',  last: '2026-09-17 01:10', quality: null, tgt: 'dwd_dim_biblio',        status: 'schema', note: '源端新增 3 个字段（marc_336/337/338），需确认后重跑' },

    /* ---------- 典藏域 ---------- */
    { id: 'ods_inv_stocktake_sync',  cn: '盘点记录',     domain: '典藏',  ds: 'ds-003', srcDb: 'aleph_prod',  srcTable: 'stocktake',        rows: 2043180,  fields: 8,  freq: '每日 06:00',  last: '2026-09-18 06:08', quality: 87.4, tgt: 'dwd_inv_stocktake',     status: 'synced' },
    { id: 'ods_inv_location_sync',   cn: '馆藏地主档',   domain: '典藏',  ds: 'ds-003', srcDb: 'aleph_prod',  srcTable: 'location',         rows: 342,      fields: 9,  freq: '每周一 03:00', last: '2026-09-15 03:05', quality: 99.0, tgt: 'dwd_dim_location',      status: 'synced' },
    { id: 'ods_inv_shelf_map',       cn: '排架清单',     domain: '典藏',  ds: 'ds-018', srcDb: '/upload',     srcTable: 'shelf_map.xlsx',   rows: null,     fields: 6,  freq: '手动',        last: null,               quality: null, tgt: 'dwd_inv_shelf',         status: 'failed',  note: '解析失败：表头缺失（第 1 行为标题行），需指定表头行号后重传' },

    /* ---------- 期刊域 ---------- */
    { id: 'ods_per_received_sync',   cn: '到刊登记',     domain: '期刊',  ds: 'ds-002', srcDb: 'huiwen_acq',  srcTable: 'serial_receive',   rows: 128420,   fields: 11, freq: '每日 02:30',  last: '2026-09-18 02:35', quality: 92.8, tgt: 'dwd_per_received',      status: 'synced' },
    { id: 'ods_per_subscribe_sync',  cn: '期刊订购',     domain: '期刊',  ds: 'ds-002', srcDb: 'huiwen_acq',  srcTable: 'serial_order',     rows: 8420,     fields: 13, freq: '每周一 03:10', last: '2026-09-15 03:12', quality: 94.4, tgt: 'dwd_per_subscribe',     status: 'synced' },

    /* ---------- 读者域 ---------- */
    { id: 'ods_patron_register_sync', cn: '读者办证',    domain: '读者',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'patron',           rows: 84210,    fields: 15, freq: '每 30 分钟',  last: '2026-09-18 02:30', quality: 91.7, tgt: 'dwd_dim_patron',        status: 'synced' },
    { id: 'ods_patron_card_sync',    cn: '借阅证',       domain: '读者',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'card',             rows: 128440,   fields: 9,  freq: '每 30 分钟',  last: '2026-09-18 02:30', quality: 96.3, tgt: 'dwd_dim_patron',        status: 'synced' },
    { id: 'ods_patron_type_sync',    cn: '读者类型码表', domain: '读者',  ds: 'ds-001', srcDb: 'huiwen_circ', srcTable: 'reader_type',      rows: null,     fields: 6,  freq: '每周一 03:20', last: null,               quality: null, tgt: 'dwd_dim_patron_type',   status: 'pending', note: '码表，建议与「读者办证」一并同步以免类型失配' },

    /* ---------- 电子资源域 ---------- */
    { id: 'ods_eres_holding_sync',   cn: '电子资源清单', domain: '电子资源', ds: 'ds-012', srcDb: 'fudan_ods', srcTable: 'eres_holding',     rows: 284100,   fields: 17, freq: '每日 07:00',  last: '2026-09-18 07:12', quality: 93.1, tgt: 'dwd_dim_eres',          status: 'synced' },
    { id: 'ods_eres_counter_r5',     cn: 'COUNTER 使用统计', domain: '电子资源', ds: 'ds-028', srcDb: 'counter_r5', srcTable: 'sus_r5',       rows: null,     fields: 21, freq: '每月 5 日',   last: null,               quality: null, tgt: 'dwd_eres_usage',        status: 'failed',  note: '认证失败（API Key 已过期），需在数据源里更新后重试' },
  ];

  /* ---------------- 源端库表清单（回答「库里一共几张、同步了几张」） ----------------
     这里只列「源端确实存在、但平台上还没建同步任务」的表。
     已纳管的表以 ODS_TABLES 里的 srcDb.srcTable 为准，不在这里重复列（dsSchema 会自动去重），
     否则两处各写一份必然漂移 —— 这也是之前抽屉里出现「ODS 1 张却列出 7 张无关表」的根因。
     rows = null 表示「源端已探到但还没做过全量统计」（未纳管的表本来就没抽过，行数只能估算）。 */
  const SRC_EXTRA = {
    'ds-001': { db: 'huiwen_circ', tables: [
      { name: 'sys_config',  cn: '系统参数表',  domain: '流通', rows: 386,      fields: 7 },
      { name: 'op_log',      cn: '操作日志',    domain: '流通', rows: 28410022, fields: 9 },
      { name: 'notice_msg',  cn: '通知消息',    domain: '流通', rows: 412840,   fields: 8 },
    ]},
    'ds-002': { db: 'huiwen_acq', tables: [
      { name: 'budget_detail', cn: '经费明细',  domain: '采访', rows: 128400, fields: 10 },
      { name: 'invoice',       cn: '发票记录',  domain: '采访', rows: 42610,  fields: 9 },
    ]},
    'ds-003': { db: 'aleph_prod', tables: [
      { name: 'item',        cn: '单册明细',     domain: '典藏', rows: 18230450, fields: 12 },
      { name: 'patron_aleph', cn: 'ALEPH 读者主档', domain: '读者', rows: 84210, fields: 14 },
      { name: 'course',      cn: '课程参考书',   domain: '典藏', rows: 12840,    fields: 7 },
    ]},
    'ds-006': { db: 'finance', tables: [
      { name: 'voucher', cn: '记账凭证', domain: '财务', rows: 284100, fields: 11 },
      { name: 'payment', cn: '付款单',   domain: '财务', rows: 41280,  fields: 9 },
    ]},
    'ds-012': { db: 'fudan_ods', tables: [
      { name: 'eres_package',        cn: '资源包主档',   domain: '电子资源', rows: 1284,    fields: 10 },
      { name: 'eres_platform',       cn: '平台清单',     domain: '电子资源', rows: 342,     fields: 8 },
      { name: 'eres_title',          cn: '电子题名清单', domain: '电子资源', rows: 284100,  fields: 14 },
      { name: 'eres_usage_month',    cn: '月度使用量',   domain: '电子资源', rows: 84120,   fields: 12 },
      { name: 'eres_holding_change', cn: '馆藏变更历史', domain: '电子资源', rows: 42610,   fields: 9 },
      { name: 'eres_order_price',    cn: '订购价格',     domain: '采访',     rows: 1284,    fields: 7 },
    ]},
    'ds-014': { db: 'loan_events', tables: [
      { name: 'event_dlq',       cn: '事件死信队列', domain: '流通', rows: 12840,   fields: 6 },
      { name: 'device_heartbeat', cn: '设备心跳',    domain: '流通', rows: 2841002, fields: 5 },
    ]},
    'ds-018': { db: '/upload', tables: [] },
    'ds-021': { db: 'aleph', tables: [
      { name: 'ill_reader', cn: '馆际读者',   domain: '流通', rows: 12840, fields: 9 },
      { name: 'ill_lender', cn: '出借馆清单', domain: '流通', rows: 86,    fields: 7 },
    ]},
    'ds-022': { db: 'marc21_in', tables: [] },
    'ds-023': { db: 'cnmarc_in', tables: [] },
    'ds-025': { db: 'NLC', tables: [] },
    'ds-028': { db: 'counter_r5', tables: [
      { name: 'tr_report', cn: 'TR 报告明细', domain: '电子资源', rows: null, fields: 12 },
      { name: 'dr_report', cn: 'DR 报告明细', domain: '电子资源', rows: null, fields: 12 },
    ]},

    /* 下面这些数据源目前一张表都还没同步到 ODS。
       同样要给「源端库表清单」——否则卡片只能说「ODS 0 张」，
       用户依然分不清是"库里没有表"还是"一张都没同步"。 */
    'ds-004': { db: 'subj_svc', tables: [
      { name: 'subject_guide',     cn: '学科指南',   domain: '学科服务', rows: 1284, fields: 9 },
      { name: 'consult_record',    cn: '咨询记录',   domain: '学科服务', rows: 8420, fields: 11 },
      { name: 'subject_librarian', cn: '学科馆员',   domain: '学科服务', rows: 86,   fields: 7 },
    ]},
    'ds-005': { db: 'lib_history', tables: [
      { name: 'hist_loan',   cn: '历史借阅明细', domain: '流通', rows: 28410022, fields: 12 },
      { name: 'hist_fine',   cn: '历史罚款',     domain: '流通', rows: 412840,   fields: 9 },
      { name: 'hist_reader', cn: '历史读者主档', domain: '读者', rows: 128400,   fields: 13 },
    ]},
    'ds-007': { db: 'recommend', tables: [
      { name: 'purchase_suggest', cn: '荐购记录', domain: '采访', rows: 84210,  fields: 8 },
      { name: 'review',           cn: '书评',     domain: '读者', rows: 128400, fields: 10 },
      { name: 'tag',              cn: '标签',     domain: '读者', rows: 4200,   fields: 5 },
    ]},
    'ds-008': { db: 'opac_idx', tables: [
      { name: 'bib_index',   cn: '书目检索索引', domain: '编目', rows: 8241700, fields: 14 },
      { name: 'facet_index', cn: '分面索引',     domain: '编目', rows: 4200,    fields: 6 },
    ]},
    'ds-009': { db: 'cache_hold', tables: [
      { name: 'hold_cache',    cn: '馆藏缓存', domain: '典藏', rows: 1200000, fields: 4 },
      { name: 'session_token', cn: '会话令牌', domain: '读者', rows: 42000,   fields: 5 },
    ]},
    'ds-010': { db: 'bib_search', tables: [
      { name: 'bib_doc',     cn: '书目文档',   domain: '编目', rows: 8241700,  fields: 22 },
      { name: 'holding_doc', cn: '馆藏文档',   domain: '典藏', rows: 18230450, fields: 16 },
      { name: 'search_log',  cn: '检索行为日志', domain: '检索', rows: 42100000, fields: 9 },
    ]},
    'ds-011': { db: 'ods', tables: [
      { name: 'ext_eres',       cn: '外部电子资源', domain: '电子资源', rows: 284100,  fields: 17 },
      { name: 'ext_ill',        cn: '外部馆际互借', domain: '流通',     rows: 128400,  fields: 12 },
      { name: 'ext_access_log', cn: '访问日志',     domain: '检索',     rows: 42100000, fields: 11 },
    ]},
    'ds-013': { db: 'analytics', tables: [
      { name: 'page_view',    cn: '页面访问', domain: '检索', rows: 284100022, fields: 11 },
      { name: 'search_log',   cn: '检索日志', domain: '检索', rows: 42100000,  fields: 9 },
      { name: 'click_stream', cn: '点击流',   domain: '检索', rows: 184000000, fields: 13 },
    ]},
    'ds-015': { db: 'notify', tables: [
      { name: 'notify_topic', cn: '通知主题', domain: '通知', rows: null, fields: 8 },
      { name: 'sms_topic',    cn: '短信主题', domain: '通知', rows: null, fields: 6 },
      { name: 'email_topic',  cn: '邮件主题', domain: '通知', rows: null, fields: 7 },
    ]},
    'ds-017': { db: 'fudan-covers', tables: [
      { name: 'cover_bucket', cn: '馆藏封面对象', domain: '典藏', rows: 3200000, fields: 5 },
    ]},
  };

  /* ---------------- 派生（唯一入口，别在页面里各算各的） ---------------- */

  /** 某数据源名下的 ODS 表 */
  function odsByDs(dsId) { return ODS_TABLES.filter(t => t.ds === dsId); }

  /** 按数据源聚合：{ [dsId]: { total, synced, syncing, pending, failed, schema, rows, fields } } */
  function statsByDs() {
    const out = {};
    ODS_TABLES.forEach(t => {
      const s = out[t.ds] || (out[t.ds] = { total: 0, synced: 0, syncing: 0, pending: 0, failed: 0, schema: 0, rows: 0, fields: 0 });
      s.total++;
      s[t.status] = (s[t.status] || 0) + 1;
      s.rows += (t.rows || 0);
      s.fields += (t.fields || 0);
    });
    return out;
  }

  /** 全局汇总 */
  function odsStats() {
    const s = { total: ODS_TABLES.length, synced: 0, syncing: 0, pending: 0, failed: 0, schema: 0, rows: 0, fields: 0, everSynced: 0 };
    ODS_TABLES.forEach(t => {
      s[t.status] = (s[t.status] || 0) + 1;
      s.rows += (t.rows || 0);
      s.fields += (t.fields || 0);
      if (t.last) s.everSynced++;
    });
    // 未完成口径：含 syncing。若把 syncing 排除在外，「未完成」筛选下点同步的瞬间
    // 行会消失，用户会以为按钮没反应；含进来才能看见 pending → syncing → synced 全程。
    s.needAction = s.pending + s.syncing + s.failed + s.schema;
    return s;
  }

  /**
   * 源端库表清单（源端「一共几张表」的唯一口径）。
   * = ODS_TABLES 里该数据源已纳管的源表（按 srcDb.srcTable 去重、同表多条任务合并）
   *   + SRC_EXTRA 里尚未纳管的表
   * 每行：{ db, name, cn, rows, fields, status, managed, odsId, ods[] }
   *   status='untracked' 表示源端有、平台没建任务（尚无 ODS 记录）
   */
  function dsSchema(dsId, dbFallback) {
    const extra = SRC_EXTRA[dsId] || { db: dbFallback || '—', tables: [] };
    const db = extra.db || dbFallback || '—';
    const order = { synced: 0, syncing: 1, schema: 2, failed: 3, pending: 4, untracked: 5 };
    const groups = new Map();
    odsByDs(dsId).forEach(t => {
      const key = t.srcTable;
      const g = groups.get(key) || { db: t.srcDb || db, name: t.srcTable, cn: t.cn, rows: t.rows, fields: t.fields, ods: [] };
      g.ods.push(t);
      if (t.rows != null) g.rows = t.rows;
      if (g.fields == null) g.fields = t.fields;
      groups.set(key, g);
    });
    const rows = [...groups.values()].map(g => {
      // 同一张源表挂多条任务（如 bib_record 同时有「已同步」和「结构变更」）时，
      // 以最"好"的那条为主线状态，其余在详情里列出，避免同一张表在列表里出现两行。
      const primary = g.ods.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))[0];
      return { db: g.db, name: g.name, cn: g.cn, rows: g.rows, fields: g.fields,
               managed: true, odsId: g.ods.length === 1 ? primary.id : null, ods: g.ods, status: primary.status };
    });
    (extra.tables || []).forEach(x => {
      if (groups.has(x.name)) return;                     // 已纳管的不重复列
      rows.push({ db, name: x.name, cn: x.cn, domain: x.domain, rows: x.rows, fields: x.fields,
                  managed: false, odsId: null, ods: [], status: 'untracked' });
    });
    rows.sort((a, b) => (order[a.status] - order[b.status]) || String(a.name).localeCompare(String(b.name)));
    return { ds: dsId, db, rows };
  }

  /** 源端表级统计：{ db, total, synced, queue, untracked, unsynced } */
  function dsSchemaStats(dsId, dbFallback) {
    const sc = dsSchema(dsId, dbFallback);
    const s = { db: sc.db, total: sc.rows.length, synced: 0, queue: 0, untracked: 0 };
    sc.rows.forEach(r => {
      if (r.status === 'synced') s.synced++;
      else if (r.status === 'untracked') s.untracked++;
      else s.queue++;                                     // 已建任务但数据未落（pending/syncing/failed/schema）
    });
    s.unsynced = s.total - s.synced;
    return s;
  }

  /** 一个数据源的一句话同步摘要，例如「9 张表 · 7 已同步 · 1 待同步 · 1 失败」 */
  function dsSummary(dsId) {
    const st = statsByDs()[dsId];
    if (!st) return '暂无同步表';
    const parts = [`${st.total} 张表`];
    if (st.synced) parts.push(`${st.synced} 已同步`);
    if (st.syncing) parts.push(`${st.syncing} 同步中`);
    if (st.pending) parts.push(`${st.pending} 未同步`);
    if (st.failed) parts.push(`${st.failed} 失败`);
    if (st.schema) parts.push(`${st.schema} 待确认`);
    return parts.join(' · ');
  }

  /** 行数格式化：与清洗页同口径（万 / 亿） */
  function fmtRows(n) {
    if (n == null) return '—';
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + ' 万';
    return String(n);
  }
  function fmtExact(n) { return n == null ? '—' : n.toLocaleString('en-US'); }
  function fmtBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function statusMeta(s) { return STATUS_META[s] || STATUS_META.pending; }
  function sourceLabel(dsId) { return SOURCE_LABEL[dsId] || dsId; }

  /** 未同步/异常清单（02c 的「待处理」视图 & 02b 的同步页签共用） */
  function needActionTables() {
    return ODS_TABLES.filter(t => t.status !== 'synced' && t.status !== 'syncing');
  }

  /* ---------------- 状态变更（两页共用，避免各写一份） ----------------
     原型没有后端，用 localStorage 记「用户手动同步过哪些表」，
     这样从 02b 点同步、切到 02c 再回来，状态是连续的。 */
  const OV_KEY = 'df_ods_overrides';
  const ENROLL_KEY = 'df_ods_enrolled';

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(OV_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) { return {}; }
  }
  function persist() {
    try {
      const out = {};
      ODS_TABLES.forEach(t => { if (t._touched) out[t.id] = { status: t.status, last: t.last, rows: t.rows, quality: t.quality }; });
      localStorage.setItem(OV_KEY, JSON.stringify(out));
    } catch (e) { /* 隐私模式下写不了，忽略 */ }
  }
  function loadEnrolled() {
    try { return JSON.parse(localStorage.getItem(ENROLL_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function saveEnrolled(list) {
    try { localStorage.setItem(ENROLL_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
  }
  function applyOverrides() {
    // 先把「用户后来纳入同步清单的源端表」还原回来（它们不在 ODS_TABLES 字面量里），
    // 再叠加手动同步过的时间/行数，否则刷新一次刚纳入的表就凭空消失。
    loadEnrolled().forEach(r => {
      if (!ODS_TABLES.some(t => t.id === r.id)) ODS_TABLES.push({ ...r, _touched: true, _enrolled: true });
    });
    const ov = loadOverrides();
    ODS_TABLES.forEach(t => {
      const o = ov[t.id];
      if (!o) return;
      t.status = o.status; t.last = o.last; t.rows = o.rows; t.quality = o.quality;
      t._touched = true;
    });
  }
  applyOverrides();

  const _listeners = [];
  function onChange(cb) { _listeners.push(cb); }
  function emit() { _listeners.forEach(cb => { try { cb(); } catch (e) { /* 单个页面报错不影响其他订阅者 */ } }); }

  /** 改某张 ODS 表的状态（唯一写入口） */
  function setStatus(id, status, patch) {
    const t = ODS_TABLES.find(x => x.id === id);
    if (!t) return null;
    t.status = status;
    if (patch) Object.assign(t, patch);
    t._touched = true;
    persist(); emit();
    return t;
  }

  /** 触发一次同步：pending/failed/schema → syncing →（2s 后）synced / failed。
      返回 Promise，方便断言 await。
      ⚠ 2026-09-21 起改为**委托任务运行**：表级「立即同步」与任务级「立即运行」
        走同一条路径，否则会出现「任务列表说失败、ODS 列表说已同步」的两套事实。
        没有对应任务（历史脏数据）时才退回原地直改状态。 */
  function runSync(id, delay) {
    const task = taskOfOdsTable(id);
    if (task) return runTask(task.id, delay).then(() => ODS_TABLES.find(x => x.id === id) || null);
    const t = setStatus(id, 'syncing');
    if (!t) return Promise.resolve(null);
    return new Promise(res => {
      setTimeout(() => {
        setStatus(id, 'synced', {
          last: fmtDT(new Date()),
          rows: t.rows || Math.floor(2000 + Math.random() * 900000),
          quality: t.quality || Math.round((85 + Math.random() * 13) * 10) / 10,
          note: undefined,
        });
        res(t);
      }, delay == null ? 1600 : delay);
    });
  }

  /** 批量同步，串行推进（原型里够用；真后端会是并发任务队列） */
  function runSyncBatch(ids) {
    return ids.reduce((p, id) => p.then(() => runSync(id)), Promise.resolve());
  }

  /** 把源端「尚未纳管」的表纳入同步清单：新建一条 pending 的 ODS 记录并持久化。
      tgtId 可选 —— 用户在建任务时给目标表起了别的名字，就按他起的名字落。 */
  function enrollSourceTable(dsId, name, tgtId) {
    const extra = SRC_EXTRA[dsId];
    if (!extra) return null;
    if (ODS_TABLES.some(t => t.ds === dsId && t.srcTable === name)) return null;
    const x = (extra.tables || []).find(t => t.name === name);
    if (!x) return null;
    const row = {
      id: tgtId || ('ods_' + dsId.replace(/[^0-9a-z]/gi, '') + '_' + String(name).replace(/[^0-9a-z_]/gi, '_')),
      cn: x.cn, domain: x.domain || '待归类',
      ds: dsId, srcDb: extra.db, srcTable: name,
      rows: null, fields: x.fields || null, freq: '每日 02:00', last: null,
      quality: null, tgt: null, status: 'pending',
      note: '刚纳入同步清单，等待首次同步',
      _touched: true, _enrolled: true,
    };
    ODS_TABLES.push(row);
    const list = loadEnrolled();
    list.push({ id: row.id, cn: row.cn, domain: row.domain, ds: row.ds, srcDb: row.srcDb, srcTable: row.srcTable,
                rows: null, fields: row.fields, freq: row.freq, last: null, quality: null, tgt: null,
                status: 'pending', note: row.note });
    saveEnrolled(list);
    persist(); emit();
    return row;
  }

  /** 跳到 ODS 全表视图并带上筛选（两页之间的闭环入口） */
  function openOdsPage(dsId, status) {
    const qs = [];
    if (dsId) qs.push('ds=' + encodeURIComponent(dsId));
    if (status) qs.push('status=' + encodeURIComponent(status));
    location.href = '02c-ods-tables.html' + (qs.length ? '?' + qs.join('&') : '');
  }

  /* ============================================================
     同步任务（任务配置 + 运行实例）· 2026-09-21 新增
     ------------------------------------------------------------
     为什么补这一层：
       之前 02b 抽屉的「同步任务」页签只是把 ODS 表换个表头再列一遍，
       「新建同步任务」按钮只弹一句「原型示意」—— 而
       「源表 → 目标表 → 字段映射 → 同步策略 → 调度」恰恰是数据集成的正中央。
       这里把 task（配置，改一次下次运行生效）与 instance（一次运行的记录：
       状态 / 耗时 / 行数 / 脏数据 / 失败原因）补上，
       运行监控、事件流、成功率全部由实例派生，不再写死。

     ⚠ 一条任务可覆盖多张表（task.tables[]），但**一张表同时只属于一条任务**，
        否则「这张表是哪个任务在同步」就说不清了。
     ⚠ 任务失败**必须可解释**：只由 task.blocker（结构变更 / 认证权限 / 解析失败）触发。
        绝不 Math.random() 抽奖 —— 随机失败在产品原型里是负资产，没人能复现、没法演示。
     ============================================================ */
  const TASK_KEY = 'df_sync_tasks';
  const TASK_VER = 1;
  const INST_LIMIT = 14;               // 每任务只留最近 N 条实例，避免 localStorage 越写越大

  let SYNC_TASKS = [];
  let NO_TASK = [];                    // 被显式删掉任务、且不希望被自动兜底重建的 ODS 表 id

  const CYCLE_META = {
    realtime: { label: '实时',   unit: 'CDC 持续抽取' },
    minute:   { label: '分钟级', unit: '分钟' },
    hour:     { label: '小时级', unit: '小时' },
    day:      { label: '每天',   unit: '天' },
    week:     { label: '每周',   unit: '周' },
    month:    { label: '每月',   unit: '月' },
    manual:   { label: '手动',   unit: '不调度' },
  };
  const DOW_CN = ['', '一', '二', '三', '四', '五', '六', '日'];

  const BLOCKER_META = {
    schema: { label: '结构变更', fix: '确认结构变更并继续', tone: 'warn' },
    auth:   { label: '认证 / 权限', fix: '更新凭据后重试',  tone: 'bad' },
    parse:  { label: '解析失败', fix: '修正解析设置并重试', tone: 'bad' },
  };
  /* 哪些表天生「跑不通」—— 这是原型里唯一允许失败的地方，且每条都带可读原因。
     用户在任务详情里修掉它（点一下）就能重跑成功 → 失败可达、也可闭环。 */
  const BLOCKER_OF = {
    ods_inv_shelf_map:   { type: 'parse',  msg: '解析失败：表头缺失（第 1 行为标题行），需指定表头行号后重传' },
    ods_eres_counter_r5: { type: 'auth',   msg: 'COUNTER R5 接口认证失败（API Key 已过期）' },
    ods_cat_book_schema: { type: 'schema', msg: '源端新增 3 个字段（marc_336/337/338），字段映射未覆盖' },
    ods_acq_budget_sync: { type: 'auth',   msg: '源端账号缺少该表的 SELECT 权限（当前仅有视图权限）' },
  };

  /* --------- 小工具 --------- */
  function p2(n) { return String(n).padStart(2, '0'); }
  function fmtDT(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }
  function shiftDT(s, dd, dm) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return s;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    d.setDate(d.getDate() + (dd || 0));
    d.setMinutes(d.getMinutes() + (dm || 0));
    return fmtDT(d);
  }
  function tsOf(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
  }
  function fmtDur(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return ms + ' ms';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';
    const m = Math.floor(s / 60), ss = s % 60;
    return ss ? `${m} 分 ${ss} 秒` : `${m} 分钟`;
  }

  /* --------- 调度周期：与现有 freq 文案双向可译（种子任务沿用既有调度，不另起一套） --------- */
  function parseSchedule(freq) {
    const f = String(freq || '').trim();
    if (!f || f === '手动') return { cycle: 'manual' };
    if (/实时/.test(f)) return { cycle: 'realtime' };
    let m = f.match(/每\s*(\d+)\s*分钟/);
    if (m) return { cycle: 'minute', every: +m[1] };
    if (/每小时/.test(f)) return { cycle: 'hour', every: 1 };
    m = f.match(/每(?:周|星期)([一二三四五六日天])\s*(\d{1,2}):(\d{2})/);
    if (m) return { cycle: 'week', dow: '一二三四五六日天'.indexOf(m[1]) + 1, at: p2(m[2]) + ':' + m[3] };
    m = f.match(/每日\s*(\d{1,2}):(\d{2})/);
    if (m) return { cycle: 'day', at: p2(m[1]) + ':' + m[2] };
    m = f.match(/每月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/);
    if (m) return { cycle: 'month', dom: +m[1], at: m[2] ? p2(m[2]) + ':' + m[3] : '00:00' };
    return { cycle: 'manual' };
  }
  function scheduleLabel(sc) {
    if (!sc) return '—';
    switch (sc.cycle) {
      case 'realtime': return '实时 CDC';
      case 'minute':   return `每 ${sc.every || 1} 分钟`;
      case 'hour':     return (sc.every > 1 ? `每 ${sc.every} 小时` : '每小时');
      case 'day':      return `每天 ${sc.at || '02:00'}`;
      case 'week':     return `每周${DOW_CN[sc.dow || 1] || '一'} ${sc.at || '03:00'}`;
      case 'month':    return `每月 ${sc.dom || 1} 日 ${sc.at || '00:00'}`;
      default:         return '手动触发';
    }
  }

  /* --------- 字段映射：类型自动映射 + 冲突判据 --------- */
  const TYPE_MAP = {
    STRING: 'STRING', VARCHAR: 'STRING', CHAR: 'STRING', TEXT: 'STRING', JSON: 'STRING',
    INT: 'BIGINT', BIGINT: 'BIGINT', SMALLINT: 'INT',
    DECIMAL: 'DECIMAL(18,2)', DOUBLE: 'DOUBLE', FLOAT: 'DOUBLE',
    DATE: 'DATE', DATETIME: 'TIMESTAMP', TIMESTAMP: 'TIMESTAMP', BOOLEAN: 'BOOLEAN',
  };
  const NUMERIC_T = ['BIGINT', 'INT', 'DOUBLE', 'DECIMAL(18,2)'];
  const TYPE_CHOICES = ['STRING', 'BIGINT', 'INT', 'DOUBLE', 'DECIMAL(18,2)', 'DATE', 'TIMESTAMP', 'BOOLEAN'];

  /** 类型冲突判据：目标类型与源类型不一致时给「会丢什么」而不是干巴巴一句不兼容 */
  function typeConflict(srcType, tgtType) {
    const s = TYPE_MAP[srcType] || 'STRING';
    if (!tgtType || s === tgtType) return null;
    const sNum = NUMERIC_T.indexOf(s) >= 0, tNum = NUMERIC_T.indexOf(tgtType) >= 0;
    if (sNum && tgtType === 'STRING') return { level: 'warn',  msg: `数值 → 字符串：可写入，但精度与前导零交由下游处理，建议保持 ${s}` };
    if (!sNum && tNum)               return { level: 'error', msg: `文本 → ${tgtType}：非数字值会被整行拒绝，建议先在清洗页改造或改回 STRING` };
    if (sNum && tNum)                return { level: 'warn',  msg: `${s} → ${tgtType} 会截断小数位` };
    return { level: 'warn', msg: `${s} → ${tgtType} 需要显式转换` };
  }

  /* 字段名池 —— ⚠ 这是**示例字段**，不是源端真实 schema。
     文件类数据源有真实解析结果（ds._parse.fields），那里不走这个池子。
     UI 上必须显式标注「示例字段」，否则就会重演「凭空列 7 张表」那类问题。 */
  const FIELD_POOL = {
    '流通': ['loan_id', 'reader_id', 'item_barcode', 'loan_date', 'due_date', 'return_date', 'renew_cnt', 'fine_amt', 'circ_status', 'oper_id', 'sync_time', 'branch_code', 'loan_type', 'media_type'],
    '采访': ['order_id', 'vendor_code', 'title', 'isbn', 'price', 'quantity', 'order_date', 'arrive_date', 'fund_code', 'currency', 'invoice_no', 'order_status', 'operator', 'accept_id', 'sync_time', 'budget_code'],
    '编目': ['bib_id', 'isbn', 'title', 'author', 'publisher', 'pub_year', 'language', 'marc_type', 'class_no', 'holding_id', 'barcode', 'location', 'volume', 'copy_no', 'call_no', 'update_time', 'cataloger', 'source_flag'],
    '典藏': ['inventory_id', 'item_id', 'location_code', 'shelf_no', 'barcode', 'item_status', 'check_date', 'operator', 'sync_time', 'call_no'],
    '期刊': ['serial_id', 'issn', 'title', 'issue_no', 'year', 'volume', 'arrive_date', 'vendor_code', 'price', 'frequency', 'order_status', 'sync_time', 'order_id'],
    '读者': ['reader_id', 'card_no', 'reader_name', 'reader_type', 'gender', 'dept', 'phone', 'email', 'reg_date', 'expire_date', 'card_status', 'balance', 'id_type', 'sync_time'],
    '电子资源': ['resource_id', 'platform', 'package', 'title', 'issn', 'eissn', 'holding_status', 'usage_month', 'requests', 'sessions', 'searches', 'downloads', 'price', 'cover_url', 'access_url', 'sync_time', 'order_id'],
    '财务': ['voucher_id', 'payment_id', 'budget_code', 'amount', 'currency', 'post_date', 'voucher_status', 'invoice_no', 'subject', 'order_id', 'sync_time'],
    '检索': ['log_id', 'reader_id', 'query_text', 'result_cnt', 'click_cnt', 'log_time', 'channel', 'device', 'ip_addr', 'sync_time', 'session_id', 'page_id', 'stay_ms'],
    '通知': ['msg_id', 'topic', 'channel', 'title', 'content', 'send_time', 'send_status', 'receiver', 'sync_time'],
    '学科服务': ['guide_id', 'subject', 'librarian', 'consult_id', 'reader_id', 'consult_time', 'consult_type', 'content', 'sync_time', 'status'],
    '待归类': ['id', 'name', 'code', 'value', 'create_time', 'update_time', 'status', 'remark'],
  };
  function srcFieldNames(t) {
    const pool = FIELD_POOL[t.domain] || FIELD_POOL['待归类'];
    const n = Math.max(1, t.fields || 6);
    const out = pool.slice(0, n);
    for (let i = out.length; i < n; i++) out.push('ext_col_' + p2(i + 1));
    return out;
  }
  function guessSrcType(name) {
    if (/(_date|_time|date$|time$)/.test(name)) return 'DATETIME';
    if (/(_amt|_price|price|amount|balance|fee|cost)/.test(name)) return 'DECIMAL';
    if (/(_cnt|_cnt$|count|_no$|qty|quantity|year|volume|_ms$|stay_ms)/.test(name)) return 'INT';
    return 'VARCHAR';
  }
  /** 生成一份「按名匹配」的映射 —— 向导第 3 步与种子任务共用 */
  function autoMapping(names, types) {
    return (names || []).map((nm, i) => {
      const srcType = (types && types[i]) || guessSrcType(nm);
      return { src: nm, srcType, tgt: nm, tgtType: TYPE_MAP[srcType] || 'STRING', on: true, def: '' };
    });
  }

  /* --------- 任务查询 --------- */
  function syncTasksByDs(dsId) { return SYNC_TASKS.filter(t => !t._deleted && t.ds === dsId); }
  function taskOfOdsTable(odsId) {
    return SYNC_TASKS.find(t => !t._deleted && t.tables.some(x => x.odsId === odsId)) || null;
  }
  function latestInst(task) {
    if (!task || !task.instances || !task.instances.length) return null;
    /* 实例数组已是「旧 → 新」，但保险起见按 seq 取最大 —— 同一分钟内的两次运行
       时间戳完全相同，只比 at 会取错（曾把刚成功的读成上一次失败的）。 */
    return task.instances.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)).pop();
  }
  /** 任务级统计（「同步任务」页签顶部四档就用它） */
  function syncTaskStats(dsId) {
    const list = dsId ? syncTasksByDs(dsId) : SYNC_TASKS.filter(t => !t._deleted);
    const s = { total: list.length, enabled: 0, paused: 0, ok: 0, failed: 0, running: 0, never: 0, blocked: 0 };
    list.forEach(t => {
      t.enabled ? s.enabled++ : s.paused++;
      if (t.blocker) s.blocked++;
      const i = latestInst(t);
      if (!i) s.never++;
      else if (i.status === 'success') s.ok++;
      else if (i.status === 'failed') s.failed++;
      else s.running++;
    });
    return s;
  }
  function allInstances(dsId) {
    const out = [];
    (dsId ? syncTasksByDs(dsId) : SYNC_TASKS.filter(t => !t._deleted)).forEach(t =>
      (t.instances || []).forEach(i => out.push({ ...i, taskId: t.id, taskName: t.name, dsId: t.ds, tables: t.tables.length })));
    return out;
  }
  /** 运行监控的唯一口径：窗口内的运行数 / 成功 / 失败 / 成功率 / 写入行数 */
  function instanceStats(dsId, days) {
    const win = days || 7;
    const since = Date.now() - win * 86400000;
    const all = allInstances(dsId);
    const inWin = all.filter(i => tsOf(i.at) >= since);
    const ok = inWin.filter(i => i.status === 'success').length;
    const bad = inWin.filter(i => i.status === 'failed').length;
    const running = inWin.filter(i => i.status === 'running').length;
    return {
      win, all: all.length, total: inWin.length, ok, failed: bad, running,
      rate: (ok + bad) ? Math.round(ok / (ok + bad) * 1000) / 10 : null,
      rows: inWin.reduce((n, i) => n + (i.rows || 0), 0),
      dirty: inWin.reduce((n, i) => n + (i.dirty || 0), 0),
      list: inWin,
    };
  }
  /** 最近 N 天按天分桶（监控页的柱状图） */
  function dailyBuckets(dsId, days) {
    const n = days || 7;
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base); d.setDate(d.getDate() - i);
      out.push({ key: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, label: `${d.getMonth() + 1}/${d.getDate()}`, rows: 0, n: 0, failed: 0 });
    }
    const idx = {}; out.forEach(b => { idx[b.key] = b; });
    allInstances(dsId).forEach(i => {
      const b = idx[String(i.at).slice(0, 10)];
      if (!b) return;
      b.n++;
      if (i.status === 'failed') b.failed++;
      else if (i.status === 'success') b.rows += (i.rows || 0);
    });
    return out;
  }
  function recentInstances(dsId, limit) {
    return allInstances(dsId)
      .sort((a, b) => (tsOf(b.at) - tsOf(a.at)) || ((b.seq || 0) - (a.seq || 0)))
      .slice(0, limit || 8);
  }

  /* --------- 持久化 --------- */
  function loadTaskStore() {
    try {
      const raw = localStorage.getItem(TASK_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.v !== TASK_VER || !Array.isArray(o.tasks)) return null;
      return o;
    } catch (e) { return null; }
  }
  function persistTasks() {
    try { localStorage.setItem(TASK_KEY, JSON.stringify({ v: TASK_VER, tasks: SYNC_TASKS, noTask: NO_TASK })); }
    catch (e) { /* 隐私模式写不了，忽略 */ }
  }

  /* --------- 种子：让既有 29 张 ODS 表背后都有任务与实例 ---------
     不这样做的话，「同步任务」页签一打开就是空的 —— 用户会以为功能又没做。 */
  function seedTasks() {
    ODS_TABLES.forEach((t, i) => {
      const sc = parseSchedule(t.freq);
      const blocker = BLOCKER_OF[t.id] || null;
      const task = {
        id: 'st-' + p2(i + 1) + '-' + String(t.id).replace(/^ods_/, '').slice(0, 14),
        name: t.cn + ' 同步',
        ds: t.ds,
        enabled: t.status !== 'failed',          // 连续失败 → 调度自动暂停，等人工介入（真实产品行为）
        _auto: true,
        createdAt: shiftDT(t.last || '2026-09-18 02:00', -30),
        tables: [{
          srcDb: t.srcDb, srcTable: t.srcTable, cn: t.cn,
          odsId: t.id, tgtTable: t.id, rows: t.rows, fields: t.fields,
          map: autoMapping(srcFieldNames(t)),
        }],
        strategy: {
          mode: t.freq === '实时 CDC' || /实时/.test(t.freq) ? 'increment' : 'full',
          incCol: /实时/.test(t.freq) ? 'sync_time' : '',
          writeMode: t.id === 'ods_acq_purchase_excel' ? 'overwrite' : 'overwrite',
        },
        schedule: Object.assign({ concurrency: 4, dirtyLimit: 100, retry: 2 }, sc),
        blocker,
        instances: [],
      };
      task.instances = mkSeedInstances(task, t, blocker);
      SYNC_TASKS.push(task);
    });
  }

  function mkSeedInstances(task, t, blocker) {
    const out = [];
    const base = t.last;
    const mk = (seq, at, status, rows, dirty, ms, err) =>
      ({ id: task.id + '-i' + seq, seq, status, at, ms, rows, dirty, err: err || null });
    const msOf = (k) => 54000 + (t.fields || 6) * 900 + k * 6400;
    const dirtyOf = (k) => ((t.fields || 6) + k * 3) % 7;
    if (!base) return out;                                  // pending：任务建了，还没跑过

    if (t.status === 'syncing') {
      out.push(mk(3, fmtDT(new Date()), 'running', 0, 0, 0, null));
      out.push(mk(2, shiftDT(base, -1), 'success', Math.round((t.rows || 0) * 0.97), dirtyOf(2), msOf(2)));
      out.push(mk(1, shiftDT(base, -2), 'success', Math.round((t.rows || 0) * 0.95), dirtyOf(1), msOf(1)));
    } else if (t.status === 'failed' || t.status === 'schema') {
      out.push(mk(3, base, 'failed', 0, 0, 8000 + (t.fields || 6) * 400, blocker ? blocker.msg : '运行失败'));
      if (t.rows != null) {
        out.push(mk(2, shiftDT(base, -1), 'success', Math.round(t.rows * 0.99), dirtyOf(2), msOf(2)));
        out.push(mk(1, shiftDT(base, -2), 'success', Math.round(t.rows * 0.98), dirtyOf(1), msOf(1)));
      }
    } else {
      out.push(mk(3, base, 'success', t.rows, dirtyOf(3), msOf(3)));
      out.push(mk(2, shiftDT(base, -1), 'success', Math.round((t.rows || 0) * 0.97), dirtyOf(2), msOf(2)));
      out.push(mk(1, shiftDT(base, -2), 'success', Math.round((t.rows || 0) * 0.95), dirtyOf(1), msOf(1)));
    }
    /* ⚠ 实例数组统一「旧 → 新」升序：runTask 是 push 到尾部，
        种子若反过来存，最新实例就变成了数组头，同分钟内还会因时间戳相同而排序不稳
        （曾把「已成功」读成「失败」，见最新实例取错的那次）。 */
    return out.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }

  /** 兜底：任何一张 ODS 表都不该「没有任务」——历史数据 / 刚纳入的表都补一条默认任务 */
  function ensureTasksForOds() {
    ODS_TABLES.forEach(t => {
      if (taskOfOdsTable(t.id)) return;
      if (NO_TASK.indexOf(t.id) >= 0) return;
      const sc = parseSchedule(t.freq);
      SYNC_TASKS.push({
        id: 'st-' + String(t.id).replace(/^ods_/, '').slice(0, 22),
        name: t.cn + ' 同步',
        ds: t.ds,
        enabled: true,
        _auto: true,
        createdAt: fmtDT(new Date()),
        tables: [{ srcDb: t.srcDb, srcTable: t.srcTable, cn: t.cn, odsId: t.id, tgtTable: t.id, rows: t.rows, fields: t.fields, map: autoMapping(srcFieldNames(t)) }],
        strategy: { mode: 'full', incCol: '', writeMode: 'overwrite' },
        schedule: Object.assign({ concurrency: 4, dirtyLimit: 100, retry: 2 }, sc),
        blocker: BLOCKER_OF[t.id] || null,
        instances: [],
      });
    });
  }

  /* --------- 任务写操作 --------- */
  function _trimInstances(task) {
    if (task.instances.length > INST_LIMIT) task.instances = task.instances.slice(-INST_LIMIT);
  }

  /** 建任务：源端「尚未纳管」的表会顺手纳入同步清单，ODS 层立刻出现一张 pending 表 */
  function createSyncTask(cfg) {
    if (!cfg || !cfg.ds || !(cfg.tables || []).length) return null;
    const tables = [];
    cfg.tables.forEach(tb => {
      let ods = ODS_TABLES.find(x => x.ds === cfg.ds && x.srcTable === tb.srcTable);
      if (!ods) ods = enrollSourceTable(cfg.ds, tb.srcTable, tb.tgtTable);
      if (!ods) return;
      const dup = taskOfOdsTable(ods.id);
      if (dup) { dup.__skip = true; return; }
      // 这张表原来只有「自动兜底任务」→ 撤掉，改由本次配置接管，避免一表两任务
      for (let i = SYNC_TASKS.length - 1; i >= 0; i--) {
        const t = SYNC_TASKS[i];
        if (t._auto && t.tables.length === 1 && t.tables[0].odsId === ods.id) SYNC_TASKS.splice(i, 1);
      }
      tables.push({
        srcDb: ods.srcDb, srcTable: tb.srcTable, cn: ods.cn,
        odsId: ods.id, tgtTable: tb.tgtTable || ods.id, rows: ods.rows, fields: ods.fields,
        map: tb.map && tb.map.length ? tb.map : autoMapping(srcFieldNames(ods)),
      });
    });
    if (!tables.length) return null;
    const task = {
      id: 'st-u' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36),
      name: cfg.name || (tables.length === 1 ? tables[0].cn + ' 同步' : `${tables.length} 张表批量同步`),
      ds: cfg.ds,
      enabled: cfg.enabled !== false,
      _auto: false,
      createdAt: fmtDT(new Date()),
      tables,
      strategy: Object.assign({ mode: 'full', incCol: '', writeMode: 'overwrite' }, cfg.strategy || {}),
      schedule: Object.assign({ cycle: 'day', at: '02:00', concurrency: 4, dirtyLimit: 100, retry: 2 }, cfg.schedule || {}),
      blocker: null,
      instances: [],
    };
    SYNC_TASKS.push(task);
    persistTasks(); emit();
    return task;
  }

  function deleteSyncTask(id) {
    const i = SYNC_TASKS.findIndex(t => t.id === id);
    if (i < 0) return false;
    const task = SYNC_TASKS[i];
    task.tables.forEach(tb => { if (NO_TASK.indexOf(tb.odsId) < 0) NO_TASK.push(tb.odsId); });
    SYNC_TASKS.splice(i, 1);
    persistTasks(); emit();
    return true;
  }
  function toggleSyncTask(id) {
    const t = SYNC_TASKS.find(x => x.id === id);
    if (!t) return null;
    t.enabled = !t.enabled;
    persistTasks(); emit();
    return t;
  }
  /** 解除阻塞（结构变更确认 / 凭据更新 / 解析修正）→ 之后就能重跑成功 */
  function clearTaskBlocker(id) {
    const t = SYNC_TASKS.find(x => x.id === id);
    if (!t || !t.blocker) return null;
    const was = t.blocker;
    t.blocker = null;
    t.enabled = true;
    persistTasks(); emit();
    return was;
  }

  /** 运行一条任务：running →（延时后）success；有 blocker 则 → failed 并写明原因。
      成功/失败都会回写所辖 ODS 表状态，所以任务列表与 ODS 列表永远说同一件事。 */
  function runTask(id, delay) {
    const task = SYNC_TASKS.find(x => x.id === id);
    if (!task || task._deleted) return Promise.resolve(null);
    const seq = task.instances.length ? Math.max(...task.instances.map(i => i.seq || 0)) + 1 : 1;
    const inst = { id: task.id + '-i' + seq, seq, status: 'running', at: fmtDT(new Date()), ms: 0, rows: 0, dirty: 0, err: null };
    task.instances.push(inst); _trimInstances(task);
    task.tables.forEach(tb => { if (ODS_TABLES.some(x => x.id === tb.odsId)) setStatus(tb.odsId, 'syncing'); });
    persistTasks(); emit();

    return new Promise(res => {
      setTimeout(() => {
        if (task.blocker) {
          inst.status = 'failed';
          inst.err = task.blocker.msg;
          inst.ms = 6000 + (task.tables[0].fields || 6) * 400;
          const st = task.blocker.type === 'schema' ? 'schema' : 'failed';
          task.tables.forEach(tb => {
            if (ODS_TABLES.some(x => x.id === tb.odsId)) setStatus(tb.odsId, st, { note: task.blocker.msg });
          });
          if (task.blocker.type === 'auth' || task.blocker.type === 'parse') task.enabled = false;
        } else {
          inst.status = 'success';
          let total = 0;
          task.tables.forEach(tb => {
            const o = ODS_TABLES.find(x => x.id === tb.odsId);
            const rows = (o && o.rows) || tb.rows || (20000 + Math.round(Math.random() * 300000));
            total += rows;
            tb.rows = rows;
            if (o) setStatus(o.id, 'synced', { last: inst.at, rows, quality: o.quality || Math.round((88 + Math.random() * 11) * 10) / 10, note: undefined });
          });
          inst.rows = total;
          inst.dirty = task.tables.length + (task.tables[0].fields || 6) % 5;
          inst.ms = 22000 + task.tables.length * 8000 + (task.tables[0].fields || 6) * 900;
        }
        persistTasks(); emit();
        res(task);
      }, delay == null ? 1500 : delay);
    });
  }
  /** 批量运行（串行，原型够用）；resolve 里回报成功 / 失败条数，不再无脑说「全部完成」 */
  function runTaskBatch(ids, delay) {
    const out = { ok: 0, failed: 0, tasks: [] };
    return ids.reduce((p, id) => p.then(() => runTask(id, delay).then(t => {
      if (!t) return;
      out.tasks.push(t);
      if (latestInst(t) && latestInst(t).status === 'failed') out.failed++; else out.ok++;
    })), Promise.resolve()).then(() => out);
  }

  (function bootTasks() {
    const store = loadTaskStore();
    if (store) { SYNC_TASKS.push(...store.tasks); NO_TASK = store.noTask || []; }
    else seedTasks();
    ensureTasksForOds();
  })();

  window.DF.integration = {
    ODS_TABLES, STATUS_META, SOURCE_LABEL, SRC_EXTRA,
    odsByDs, statsByDs, odsStats, dsSummary, needActionTables,
    dsSchema, dsSchemaStats, enrollSourceTable,
    fmtRows, fmtExact, fmtBytes, statusMeta, sourceLabel,
    setStatus, runSync, runSyncBatch, onChange, openOdsPage,
    /* 同步任务 */
    SYNC_TASKS, CYCLE_META, BLOCKER_META, TYPE_MAP, TYPE_CHOICES, DOW_CN,
    syncTasksByDs, taskOfOdsTable, syncTaskStats, latestInst,
    allInstances, instanceStats, dailyBuckets, recentInstances,
    createSyncTask, deleteSyncTask, toggleSyncTask, clearTaskBlocker,
    runTask, runTaskBatch,
    parseSchedule, scheduleLabel, fmtDT, fmtDur, typeConflict, autoMapping,
    srcFieldNames, guessSrcType, ensureTasksForOds,
  };
})();
