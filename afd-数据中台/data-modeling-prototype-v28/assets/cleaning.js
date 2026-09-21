/* =====================================================================
 * ODS 数据清洗 · 可视化编排（规则引擎真实执行）
 * 分层语义：ODS 原始层（客户业务系统同步） → 本页清洗标准化 → DWD 明细层
 * 设计约束：每一条可视化配置都必须能被 JS 引擎真实执行，并且一一落到生成的
 *          SQL 上；预览表列头 / 质量指标 / SQL 三者由同一份列计划推导，不写死。
 * ===================================================================== */

/* =====================================================================
 * 第 3 档 · 工程化与规模化
 *   ① SQL 方言（Hive / Spark / MySQL / Doris）+ 复制 / 下载
 *   ② 质量规则可配置（规则 + 阈值 + 告警 / 阻断 / 继续）
 *   ③ 脏数据分流表（失败行落 <目标表>_dirty，含失败原因与血缘）
 *   ④ 采样与生产分离（采样徽标 + 全量试跑 + 行数上限保护）
 *   ⑤ 任务配置与调度（增量 / 全量、分区、bizdate 变量、周期依赖）+ 版本 diff 与回滚
 * ===================================================================== */

// ===== 任务配置：驱动 SQL 的源表 / 目标表 / 分区 / 调度变量 =====
let TASK = {
  code: 'clean_ods_circ_loan',
  name: '流通借阅流水清洗',
  sourceTable: 'ods_circ_loan_sync',
  targetTable: 'dwd_circ_loan_di',
  writeMode: 'overwrite',            // overwrite（覆盖当日分区） | append（追加）
  partitionField: 'dt',
  bizdateVar: 'bizdate',
  upstream: ['ods_circ_loan_sync'],
  cycle: 'daily',                    // daily | hourly
  cycleTime: '02:30',
  retry: 3,
  owner: '沈龙华',
};
const dirtyTableName = () => TASK.targetTable + '_dirty';

// ===== 运行模式：采样（12 行，默认） / 全量（分块真实执行） =====
let RUNMODE = 'sample';              // sample | full
let FULL_N = 0;                      // 本次全量实际载入的行数
let FULL_STATS = null;               // 全量试跑的耗时与分步记录
const FULL_LIMIT = 1000000;          // 行数上限保护（超过需二次确认）
const PREVIEW_CAP = 200;             // 全量模式下预览表只渲染前 N 行（指标仍统计全量）

// =====================================================================
// SQL 方言：四种引擎在哪几个地方真的不一样
//   1) 覆盖写入与分区语法   2) 日期解析 / 格式化的函数与格式串风格
//   3) 正则运算符与提取函数 4) 字符串长度 / 分词函数
//   5) CAST 目标类型名      6) 调度变量的写法与日期运算
// =====================================================================
const DIALECTS = {
  hive: {
    key: 'hive', name: 'Hive', ver: '2.x / 3.x', fmtStyle: 'java',
    len: 'LENGTH', regexOp: 'RLIKE', stringType: 'STRING',
    note: '日期用 Java 格式串；分词取数组下标；正则用 RLIKE',
    castType: t => t,
    toDate: (e, p) => `TO_DATE(FROM_UNIXTIME(UNIX_TIMESTAMP(${e}, '${p}')))`,
    toDateISO: e => `TO_DATE(${e})`,
    dateFmt: (e, p) => `DATE_FORMAT(${e}, '${p}')`,
    splitPart: (e, sep, n) => `SPLIT(${e}, '${sep}')[${n - 1}]`,
    regexExtract: (e, p, g) => `REGEXP_EXTRACT(${e}, '${p}', ${g})`,
    varRef: n => '${' + n + '}',
    varLit: n => "'${" + n + "}'",
    dayBefore: v => `DATE_SUB('${v}', 1)`,
    overwriteHeader: (t, pf, pv) => `INSERT OVERWRITE TABLE ${t} PARTITION (${pf} = '${pv}')`,
    partitionInProjection: false,
  },
  spark: {
    key: 'spark', name: 'Spark SQL', ver: '3.x', fmtStyle: 'java',
    len: 'LENGTH', regexOp: 'RLIKE', stringType: 'STRING',
    note: 'TO_DATE 可直接带格式串；SPLIT_PART 与 REGEXP_EXTRACT 为原生函数',
    castType: t => t,
    toDate: (e, p) => `TO_DATE(${e}, '${p}')`,
    toDateISO: e => `TO_DATE(${e})`,
    dateFmt: (e, p) => `DATE_FORMAT(${e}, '${p}')`,
    splitPart: (e, sep, n) => `SPLIT_PART(${e}, '${sep}', ${n})`,
    regexExtract: (e, p, g) => `REGEXP_EXTRACT(${e}, '${p}', ${g})`,
    varRef: n => '${' + n + '}',
    varLit: n => "'${" + n + "}'",
    dayBefore: v => `DATE_SUB('${v}', 1)`,
    overwriteHeader: (t, pf, pv) => `INSERT OVERWRITE TABLE ${t} PARTITION (${pf} = '${pv}')`,
    partitionInProjection: false,
  },
  mysql: {
    key: 'mysql', name: 'MySQL', ver: '8.0', fmtStyle: 'mysql',
    len: 'CHAR_LENGTH', regexOp: 'REGEXP', stringType: 'CHAR',
    note: '无 INSERT OVERWRITE，覆盖语义需先删分区；CAST 目标为 SIGNED；分组提取用 REGEXP_SUBSTR',
    castType: t => (t === 'INT' || t === 'BIGINT') ? 'SIGNED' : t,
    toDate: (e, p) => `STR_TO_DATE(${e}, '${p}')`,
    toDateISO: e => `STR_TO_DATE(${e}, '%Y-%m-%d')`,
    dateFmt: (e, p) => `DATE_FORMAT(${e}, '${p}')`,
    splitPart: (e, sep, n) => `SUBSTRING_INDEX(SUBSTRING_INDEX(${e}, '${sep}', ${n}), '${sep}', -1)`,
    regexExtract: null,   // 见 genSQL：改用 REGEXP_SUBSTR + 捕获组重写
    regexSubstr: (e, p) => `REGEXP_SUBSTR(${e}, '${p}')`,
    varRef: n => '@' + n,
    varLit: n => '@' + n,
    dayBefore: v => `DATE_SUB(${v}, INTERVAL 1 DAY)`,
    overwriteHeader: (t, pf, pv) => `INSERT INTO ${t} (${pf}, …) SELECT ${pv} AS ${pf}, …`,   // 实际投影由 genSQL 拼
    partitionInProjection: true,
  },
  doris: {
    key: 'doris', name: 'Doris', ver: '2.x', fmtStyle: 'mysql',
    len: 'CHAR_LENGTH', regexOp: 'REGEXP', stringType: 'CHAR',
    note: 'MySQL 协议，支持 SPLIT_PART；INSERT 分区靠目标表动态分区或预先 ADD PARTITION',
    castType: t => t,
    toDate: (e, p) => `STR_TO_DATE(${e}, '${p}')`,
    toDateISO: e => `STR_TO_DATE(${e}, '%Y-%m-%d')`,
    dateFmt: (e, p) => `DATE_FORMAT(${e}, '${p}')`,
    splitPart: (e, sep, n) => `SPLIT_PART(${e}, '${sep}', ${n})`,
    regexExtract: null,
    regexSubstr: (e, p) => `REGEXP_EXTRACT(${e}, '${p}')`,
    varRef: n => '@' + n,
    varLit: n => '@' + n,
    dayBefore: v => `DAYS_SUB(${v}, 1)`,
    overwriteHeader: (t, pf, pv) => `INSERT INTO ${t} PARTITION (${pf} = '${pv}')`,
    partitionInProjection: true,
  },
};
let DIALECT = 'hive';
const D = () => DIALECTS[DIALECT];

// 规范格式串一律写 Java 风格，落到 MySQL 方言时再翻译
function dpat(canon) {
  if (D().fmtStyle === 'java') return canon;
  return canon.replace(/yyyy/g, '%Y').replace(/MM/g, '%m').replace(/dd/g, '%d');
}

// ===== 版本管理：快照 = 流水线配置 + 任务配置 + 方言，可 diff、可回滚 =====
const VER_KEY = 'df-cleaning-versions';
let VERSIONS = [];
function tsNow() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function snapshot() {
  return {
    pipeline: clone(pipeline.map(s => ({ id: s.id, enabled: s.enabled, config: s.config }))),
    task: clone(TASK), dialect: DIALECT, src: ACTIVE_SRC,
  };
}
function loadVersions() {
  try { VERSIONS = JSON.parse(localStorage.getItem(VER_KEY) || '[]') || []; } catch (e) { VERSIONS = []; }
  return VERSIONS;
}
function persistVersions() {
  try { localStorage.setItem(VER_KEY, JSON.stringify(VERSIONS)); } catch (e) { /* 无痕模式等场景忽略 */ }
}
// 递归对比两份配置，返回真实差异（增 / 删 / 改 分别标注）
function diffObjects(a, b, path, out) {
  path = path || '';
  out = out || [];
  const isObj = v => v && typeof v === 'object';
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    keys.forEach(k => diffObjects(a[k], b[k], path ? path + '.' + k : k, out));
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const kind = a === undefined ? 'add' : b === undefined ? 'del' : 'mod';
    out.push({ path, kind, from: a, to: b });
  }
  return out;
}
const fmtVal = v => v === undefined ? '—' : (v === null ? 'NULL' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));


// =====================================================================
// 同类源表注册表
//   「同类」的判据不是表名长得像，而是 roles（语义角色）一致：
//     模板里引用的其实是「主键 / 读者键 / 日期字段 / 数值字段 / 状态字段 / 同步时间」，
//     批处理时再按每张表自己的 roles 解析成真实字段名 —— 同一套规则才能安全地套到多张表上。
//   不一致的地方不会被悄悄吞掉：解析不到的角色会作为「不适用项」显式上报。
// =====================================================================
const ROLE_LABEL = {
  pk: '业务主键', readerKey: '读者键', syncTime: '同步时间',
  dates: '日期字段', numerics: '数值字段', status: '状态/码值字段',
};

const SOURCES = {
  ods_circ_loan_sync: {
    name: 'ods_circ_loan_sync', cn: '流通借阅流水', domain: '流通业务',
    target: 'dwd_circ_loan_di', taskCode: 'clean_ods_circ_loan', taskName: '流通借阅流水清洗',
    src: { db: 'MySQL 5.7', schema: 'finlib_v3', rows: 1284730, syncAt: '08-13 02:11' },
    roles: { pk: 'loan_id', readerKey: 'reader_id', syncTime: 'sync_time', dates: ['loan_date', 'return_date'], numerics: ['borrow_cnt', 'fine_amt'], status: 'circ_status' },
    fields: [
      { name: 'loan_id',     srcType: 'VARCHAR', cn: '借阅流水号' },
      { name: 'reader_id',   srcType: 'VARCHAR', cn: '读者证号' },
      { name: 'loan_date',   srcType: 'VARCHAR', cn: '借出日期' },
      { name: 'return_date', srcType: 'VARCHAR', cn: '归还日期' },
      { name: 'borrow_cnt',  srcType: 'VARCHAR', cn: '续借次数' },
      { name: 'fine_amt',    srcType: 'VARCHAR', cn: '罚款金额' },
      { name: 'circ_status', srcType: 'CHAR',    cn: '在借状态' },
      { name: 'sync_time',   srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { loan_id: 'LN20260801001', reader_id: 'R20260012',  loan_date: '2026/08/01', return_date: '2026-08-15', borrow_cnt: '0',  fine_amt: '0',      circ_status: 'N', sync_time: '2026-08-13 02:11:05' },
      { loan_id: 'LN20260801002', reader_id: ' R20260031', loan_date: '2026/8/2',   return_date: '/',          borrow_cnt: '2',  fine_amt: '¥0',     circ_status: 'Y', sync_time: '2026-08-13 02:11:05' },
      { loan_id: 'LN20260803007', reader_id: 'R20260058',  loan_date: '13-08-2026', return_date: '2026/8/20',  borrow_cnt: ' 1', fine_amt: '12.50',  circ_status: 'Y', sync_time: '2026-08-13 02:11:06' },
      { loan_id: 'LN20260804011', reader_id: 'R20260077',  loan_date: '20260804',   return_date: 'NULL',       borrow_cnt: '0',  fine_amt: '0',      circ_status: 'N', sync_time: '2026-08-13 02:11:06' },
      { loan_id: 'LN20260805003', reader_id: 'R20260093',  loan_date: '2026-8-5',   return_date: '2026/09/01', borrow_cnt: '3',  fine_amt: '¥5.00',  circ_status: 'Y', sync_time: '2026-08-13 02:11:07' },
      { loan_id: 'LN20260805003', reader_id: 'R20260093',  loan_date: '2026-08-05', return_date: '2026/09/01', borrow_cnt: '3',  fine_amt: '¥5.00',  circ_status: 'Y', sync_time: '2026-08-13 02:11:07' },
      { loan_id: 'LN20260806019', reader_id: 'R20260102',  loan_date: '2026/08/06', return_date: '/',          borrow_cnt: '1',  fine_amt: '¥0.00',  circ_status: 'Y', sync_time: '2026-08-13 02:11:08' },
      { loan_id: 'LN20260807022', reader_id: 'R20260115',  loan_date: '2026/08/07', return_date: '2026-08-21', borrow_cnt: '0',  fine_amt: '0',      circ_status: 'N', sync_time: '2026-08-13 02:11:08' },
      { loan_id: 'LN20260807022', reader_id: 'R20260115',  loan_date: '2026/8/7',   return_date: '2026-08-21', borrow_cnt: '0',  fine_amt: '0',      circ_status: 'n', sync_time: '2026-08-14 02:11:02' },
      { loan_id: 'LN20260808008', reader_id: 'R20260131',  loan_date: '08-09-2026', return_date: 'NULL',       borrow_cnt: ' 2', fine_amt: '¥18.20', circ_status: 'Y', sync_time: '2026-08-13 02:11:09' },
      { loan_id: 'LN20260809014', reader_id: 'R20260146',  loan_date: '2026/08/09', return_date: '2026/8/30',  borrow_cnt: 'abc', fine_amt: '3.80',  circ_status: 'Y', sync_time: '2026-08-13 02:11:10' },
      { loan_id: 'LN20260801002', reader_id: ' R20260031', loan_date: '2026/8/2',   return_date: '/',          borrow_cnt: '2',  fine_amt: '¥0',     circ_status: 'Y', sync_time: '2026-08-13 02:11:05' },
    ],
  },

  ods_circ_return_sync: {
    name: 'ods_circ_return_sync', cn: '流通归还流水', domain: '流通业务',
    target: 'dwd_circ_return_di', taskCode: 'clean_ods_circ_return', taskName: '流通归还流水清洗',
    src: { db: 'MySQL 5.7', schema: 'finlib_v3', rows: 964218, syncAt: '08-13 02:12' },
    roles: { pk: 'return_id', readerKey: 'reader_id', syncTime: 'sync_time', dates: ['return_date'], numerics: ['over_days', 'fine_amt'], status: null },
    fields: [
      { name: 'return_id',   srcType: 'VARCHAR', cn: '归还流水号' },
      { name: 'loan_id',     srcType: 'VARCHAR', cn: '借阅流水号' },
      { name: 'reader_id',   srcType: 'VARCHAR', cn: '读者证号' },
      { name: 'return_date', srcType: 'VARCHAR', cn: '归还日期' },
      { name: 'over_days',   srcType: 'VARCHAR', cn: '逾期天数' },
      { name: 'fine_amt',    srcType: 'VARCHAR', cn: '罚款金额' },
      { name: 'sync_time',   srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { return_id: 'RT20260801001', loan_id: 'LN20260801001', reader_id: 'R20260012',  return_date: '2026/08/15', over_days: '0',   fine_amt: '0',      sync_time: '2026-08-13 02:12:05' },
      { return_id: 'RT20260802002', loan_id: 'LN20260801002', reader_id: ' R20260031', return_date: '2026/8/16',  over_days: ' 2',  fine_amt: '¥0',     sync_time: '2026-08-13 02:12:05' },
      { return_id: 'RT20260803003', loan_id: 'LN20260803007', reader_id: 'R20260058',  return_date: '13-08-2026', over_days: '5',   fine_amt: '12.50',  sync_time: '2026-08-13 02:12:06' },
      { return_id: 'RT20260804004', loan_id: 'LN20260804011', reader_id: 'R20260077',  return_date: '/',          over_days: '0',   fine_amt: '0',      sync_time: '2026-08-13 02:12:06' },
      { return_id: 'RT20260805005', loan_id: 'LN20260805003', reader_id: 'R20260093',  return_date: '2026/09/01', over_days: '3',   fine_amt: '¥5.00',  sync_time: '2026-08-13 02:12:07' },
      { return_id: 'RT20260805005', loan_id: 'LN20260805003', reader_id: 'R20260093',  return_date: '2026/09/01', over_days: '3',   fine_amt: '¥5.00',  sync_time: '2026-08-13 02:12:07' },
      { return_id: 'RT20260806006', loan_id: 'LN20260806019', reader_id: 'R20260102',  return_date: '2026/08/20', over_days: '1',   fine_amt: '¥0.00',  sync_time: '2026-08-13 02:12:08' },
      { return_id: 'RT20260807007', loan_id: 'LN20260807022', reader_id: 'R20260115',  return_date: '2026-08-21', over_days: '0',   fine_amt: '0',      sync_time: '2026-08-13 02:12:08' },
      { return_id: 'RT20260808008', loan_id: 'LN20260808008', reader_id: 'R20260131',  return_date: '08-09-2026', over_days: ' 2',  fine_amt: '¥18.20', sync_time: '2026-08-13 02:12:09' },
      { return_id: 'RT20260809009', loan_id: 'LN20260809014', reader_id: 'R20260146',  return_date: '2026/8/30',  over_days: 'abc', fine_amt: '3.80',   sync_time: '2026-08-13 02:12:10' },
    ],
  },

  ods_circ_renew_sync: {
    name: 'ods_circ_renew_sync', cn: '流通续借流水', domain: '流通业务',
    target: 'dwd_circ_renew_di', taskCode: 'clean_ods_circ_renew', taskName: '流通续借流水清洗',
    src: { db: 'MySQL 5.7', schema: 'finlib_v3', rows: 213905, syncAt: '08-13 02:12' },
    roles: { pk: 'renew_id', readerKey: 'reader_id', syncTime: 'sync_time', dates: ['renew_date'], numerics: ['renew_cnt'], status: 'channel_code' },
    fields: [
      { name: 'renew_id',      srcType: 'VARCHAR', cn: '续借流水号' },
      { name: 'loan_id',       srcType: 'VARCHAR', cn: '借阅流水号' },
      { name: 'reader_id',     srcType: 'VARCHAR', cn: '读者证号' },
      { name: 'renew_date',    srcType: 'VARCHAR', cn: '续借日期' },
      { name: 'renew_cnt',     srcType: 'VARCHAR', cn: '累计续借次数' },
      { name: 'channel_code',  srcType: 'CHAR',    cn: '办理渠道' },
      { name: 'sync_time',     srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { renew_id: 'RN20260801001', loan_id: 'LN20260801001', reader_id: 'R20260012',  renew_date: '2026/08/10', renew_cnt: '1',   channel_code: 'WEB', sync_time: '2026-08-13 02:12:20' },
      { renew_id: 'RN20260802002', loan_id: 'LN20260801002', reader_id: ' R20260031', renew_date: '2026/8/11',  renew_cnt: ' 2',  channel_code: 'web', sync_time: '2026-08-13 02:12:20' },
      { renew_id: 'RN20260803003', loan_id: 'LN20260803007', reader_id: 'R20260058',  renew_date: '12-08-2026', renew_cnt: '1',   channel_code: 'APP', sync_time: '2026-08-13 02:12:21' },
      { renew_id: 'RN20260804004', loan_id: 'LN20260804011', reader_id: 'R20260077',  renew_date: '/',          renew_cnt: '0',   channel_code: 'Web', sync_time: '2026-08-13 02:12:21' },
      { renew_id: 'RN20260805005', loan_id: 'LN20260805003', reader_id: 'R20260093',  renew_date: '2026/08/12', renew_cnt: '2',   channel_code: 'APP', sync_time: '2026-08-13 02:12:22' },
      { renew_id: 'RN20260805005', loan_id: 'LN20260805003', reader_id: 'R20260093',  renew_date: '2026/08/12', renew_cnt: '2',   channel_code: 'APP', sync_time: '2026-08-13 02:12:22' },
      { renew_id: 'RN20260806006', loan_id: 'LN20260806019', reader_id: 'R20260102',  renew_date: '2026/08/13', renew_cnt: '1',   channel_code: 'app', sync_time: '2026-08-13 02:12:23' },
      { renew_id: 'RN20260807007', loan_id: 'LN20260807022', reader_id: 'R20260115',  renew_date: '2026-08-14', renew_cnt: '0',   channel_code: 'WEB', sync_time: '2026-08-13 02:12:23' },
      { renew_id: 'RN20260808008', loan_id: 'LN20260808008', reader_id: 'R20260131',  renew_date: '01-09-2026', renew_cnt: 'x1',  channel_code: 'WEB', sync_time: '2026-08-13 02:12:24' },
      { renew_id: 'RN20260809009', loan_id: 'LN20260809014', reader_id: 'R20260146',  renew_date: '2026/8/30',  renew_cnt: '3',   channel_code: 'APP', sync_time: '2026-08-13 02:12:25' },
    ],
  },

  ods_circ_hold_sync: {
    name: 'ods_circ_hold_sync', cn: '流通预约流水', domain: '流通业务',
    target: 'dwd_circ_hold_di', taskCode: 'clean_ods_circ_hold', taskName: '流通预约流水清洗',
    src: { db: 'MySQL 5.7', schema: 'finlib_v3', rows: 58210, syncAt: '08-13 02:13' },
    roles: { pk: 'hold_id', readerKey: 'reader_id', syncTime: 'sync_time', dates: ['hold_date', 'expire_date'], numerics: ['queue_no'], status: 'hold_status' },
    fields: [
      { name: 'hold_id',     srcType: 'VARCHAR', cn: '预约流水号' },
      { name: 'reader_id',   srcType: 'VARCHAR', cn: '读者证号' },
      { name: 'title_no',    srcType: 'VARCHAR', cn: '书目控制号' },
      { name: 'hold_date',   srcType: 'VARCHAR', cn: '预约日期' },
      { name: 'expire_date', srcType: 'VARCHAR', cn: '取书截止日' },
      { name: 'queue_no',    srcType: 'VARCHAR', cn: '排队序号' },
      { name: 'hold_status', srcType: 'CHAR',    cn: '预约状态' },
      { name: 'pickup_dept', srcType: 'VARCHAR', cn: '取书地点' },
      { name: 'sync_time',   srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { hold_id: 'HD20260801001', reader_id: 'R20260115',  title_no: 'T0004391', hold_date: '2026/08/01', expire_date: '2026-08-08', queue_no: '1',   hold_status: 'W', pickup_dept: 'D01', sync_time: '2026-08-13 02:13:01' },
      { hold_id: 'HD20260802002', reader_id: ' R20260031', title_no: 'T0005120', hold_date: '2026/8/2',   expire_date: '2026-08-09', queue_no: ' 2',  hold_status: 'w', pickup_dept: 'D02', sync_time: '2026-08-13 02:13:01' },
      { hold_id: 'HD20260803003', reader_id: 'R20260058',  title_no: 'T0007788', hold_date: '13-08-2026', expire_date: '2026/8/20', queue_no: '1',   hold_status: 'P', pickup_dept: 'D02', sync_time: '2026-08-13 02:13:02' },
      { hold_id: 'HD20260804004', reader_id: 'R20260077',  title_no: 'T0008123', hold_date: '/',          expire_date: 'NULL',       queue_no: '0',   hold_status: 'C', pickup_dept: 'D03', sync_time: '2026-08-13 02:13:02' },
      { hold_id: 'HD20260805005', reader_id: 'R20260093',  title_no: 'T0009902', hold_date: '2026-8-5',   expire_date: '2026/09/01', queue_no: '4',   hold_status: 'W', pickup_dept: 'D03', sync_time: '2026-08-13 02:13:03' },
      { hold_id: 'HD20260805005', reader_id: 'R20260093',  title_no: 'T0009902', hold_date: '2026-08-05', expire_date: '2026/09/01', queue_no: '4',   hold_status: 'W', pickup_dept: 'D03', sync_time: '2026-08-13 02:13:03' },
      { hold_id: 'HD20260806006', reader_id: 'R20260102',  title_no: 'T0010233', hold_date: '2026/08/06', expire_date: '/',          queue_no: '1',   hold_status: 'P', pickup_dept: 'D01', sync_time: '2026-08-13 02:13:04' },
      { hold_id: 'HD20260807007', reader_id: 'R20260115',  title_no: 'T0004391', hold_date: '2026-08-07', expire_date: '2026-08-21', queue_no: '0',   hold_status: 'C', pickup_dept: 'D01', sync_time: '2026-08-13 02:13:04' },
      { hold_id: 'HD20260808008', reader_id: 'R20260131',  title_no: 'T0011445', hold_date: '08-09-2026', expire_date: 'NULL',       queue_no: ' 2',  hold_status: 'W', pickup_dept: 'D04', sync_time: '2026-08-13 02:13:05' },
      { hold_id: 'HD20260809009', reader_id: 'R20260146',  title_no: 'T0012001', hold_date: '2026/08/09', expire_date: '2026/8/30',  queue_no: 'xy',  hold_status: 'P', pickup_dept: 'D04', sync_time: '2026-08-13 02:13:06' },
    ],
  },

  // ===== 跨业务域：采访 / 编目 / 典藏 / 期刊 / 读者 / 馆际互借 =====
  // ⚠ 这 6 张与现有 4 张流通表的差别：
  //   - 主键形态跨域（采访 AC、编目 ISBN 13 位、典藏 ST、期刊 IS、读者 R、馆际 IL）——
  //     pkShape() 已支持任意「字母前缀 + 数字」pattern，无需新增解析逻辑；
  //   - 仅馆际互借设 readerKey，其余 5 张没有「借书的读者」概念；
  //     跨域批处理时 `usedRoles().readerKey` 触发的步骤（join / map）会被 `roleGapLabels()` 标为
  //     "缺角色"，并在批处理时被显式跳过 —— 演示「模板跨域降级」的对照视图。
  //   - 每张都含典型脏数据形态（重复键、空值占位、大小写混写、日期歧义），与现有 4 张
  //     演示能力一致，确保每张表独立选下都有事干。

  ods_acq_accept_sync: {
    name: 'ods_acq_accept_sync', cn: '图书验收流水', domain: '采访业务',
    target: 'dwd_acq_accept_di', taskCode: 'clean_ods_acq_accept', taskName: '图书验收流水清洗',
    src: { db: 'MySQL 5.7', schema: 'acqlib_v2', rows: 87412, syncAt: '08-13 02:14' },
    roles: { pk: 'accept_id', readerKey: null, syncTime: 'sync_time', dates: ['accept_date'], numerics: ['qty', 'unit_price'], status: 'accept_status' },
    fields: [
      { name: 'accept_id',    srcType: 'VARCHAR', cn: '验收单号' },
      { name: 'isbn',         srcType: 'VARCHAR', cn: 'ISBN' },
      { name: 'accept_date',  srcType: 'VARCHAR', cn: '验收日期' },
      { name: 'qty',          srcType: 'VARCHAR', cn: '验收数量' },
      { name: 'unit_price',   srcType: 'VARCHAR', cn: '单价' },
      { name: 'supplier_id',  srcType: 'VARCHAR', cn: '供应商代码' },
      { name: 'acceptor_id',  srcType: 'VARCHAR', cn: '验收员' },
      { name: 'accept_status',srcType: 'CHAR',    cn: '验收结果' },
      { name: 'sync_time',    srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { accept_id: 'AC20260801001', isbn: '9787121000001', accept_date: '2026/08/01', qty: '5',  unit_price: '¥58.00',  supplier_id: 'S01', acceptor_id: 'U03', accept_status: 'Q', sync_time: '2026-08-13 02:14:01' },
      { accept_id: 'AC20260802002', isbn: '9787121000018', accept_date: '2026/8/2',   qty: ' 3', unit_price: '42',     supplier_id: 's01', acceptor_id: 'U03', accept_status: 'PASS', sync_time: '2026-08-13 02:14:01' },
      { accept_id: 'AC20260803003', isbn: '9787121000025', accept_date: '13-08-2026', qty: 'abc',unit_price: '88.00',  supplier_id: 'S02', acceptor_id: 'U05', accept_status: 'P', sync_time: '2026-08-13 02:14:02' },
      { accept_id: 'AC20260804004', isbn: '/',            accept_date: '20260804',   qty: '0',  unit_price: '0',      supplier_id: 'S03', acceptor_id: 'U05', accept_status: 'FAIL', sync_time: '2026-08-13 02:14:02' },
      { accept_id: 'AC20260805005', isbn: '9787121000032', accept_date: '2026-8-5',   qty: '2',  unit_price: '¥35.50',  supplier_id: 'S03', acceptor_id: 'U03', accept_status: 'p', sync_time: '2026-08-13 02:14:03' },
      { accept_id: 'AC20260805005', isbn: '9787121000032', accept_date: '2026-08-05', qty: '2',  unit_price: '¥35.50',  supplier_id: 'S03', acceptor_id: 'U03', accept_status: 'p', sync_time: '2026-08-13 02:14:03' },
      { accept_id: 'AC20260806006', isbn: '9787121000049', accept_date: '/',          qty: '1',  unit_price: 'NULL',    supplier_id: 'S04', acceptor_id: 'U07', accept_status: 'Q', sync_time: '2026-08-13 02:14:04' },
      { accept_id: 'AC20260807007', isbn: '9787121000056', accept_date: '2026/08/07', qty: '7',  unit_price: '¥28.00',  supplier_id: 'S04', acceptor_id: 'U07', accept_status: 'PASS', sync_time: '2026-08-13 02:14:04' },
      { accept_id: 'AC20260808008', isbn: '9787121000063', accept_date: '2026/8/8',   qty: '10', unit_price: '¥120.00', supplier_id: 'S05', acceptor_id: 'U09', accept_status: 'P', sync_time: '2026-08-13 02:14:05' },
      { accept_id: 'AC20260809009', isbn: '9787121000070', accept_date: '08-09-2026', qty: '4',  unit_price: '¥45.00',  supplier_id: 'S05', acceptor_id: 'U09', accept_status: 'FAIL', sync_time: '2026-08-13 02:14:05' },
      { accept_id: 'AC20260810010', isbn: '9787121000087', accept_date: '2026/08/10', qty: ' 6', unit_price: '¥66.00',  supplier_id: 'S06', acceptor_id: 'U11', accept_status: 'Q', sync_time: '2026-08-13 02:14:06' },
      { accept_id: 'AC20260801001', isbn: '9787121000001', accept_date: '2026/08/01', qty: '5',  unit_price: '¥58.00',  supplier_id: 'S01', acceptor_id: 'U03', accept_status: 'Q', sync_time: '2026-08-13 02:14:01' },
    ],
  },

  ods_cat_book_sync: {
    name: 'ods_cat_book_sync', cn: '图书编目流水', domain: '编目业务',
    target: 'dwd_cat_book_di', taskCode: 'clean_ods_cat_book', taskName: '图书编目流水清洗',
    src: { db: 'MySQL 5.7', schema: 'catlib_v2', rows: 156320, syncAt: '08-13 02:15' },
    roles: { pk: 'book_id', readerKey: null, syncTime: 'sync_time', dates: ['pub_date', 'cat_date'], numerics: [], status: null },
    fields: [
      { name: 'book_id',    srcType: 'VARCHAR', cn: '编目记录号' },
      { name: 'isbn',       srcType: 'VARCHAR', cn: 'ISBN' },
      { name: 'title',      srcType: 'VARCHAR', cn: '题名' },
      { name: 'author',     srcType: 'VARCHAR', cn: '作者' },
      { name: 'publisher',  srcType: 'VARCHAR', cn: '出版社' },
      { name: 'pub_date',   srcType: 'VARCHAR', cn: '出版日期' },
      { name: 'cat_date',   srcType: 'VARCHAR', cn: '编目日期' },
      { name: 'cataloguer', srcType: 'VARCHAR', cn: '编目员' },
      { name: 'sync_time',  srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { book_id: 'BK20260801001', isbn: '9787121000001', title: '深入理解计算机系统', author: 'Bryant',    publisher: '机械工业出版社', pub_date: '2026/03/01', cat_date: '2026-08-01', cataloguer: 'C01', sync_time: '2026-08-13 02:15:01' },
      { book_id: 'BK20260802002', isbn: '9787121000018', title: '算法导论',         author: 'Cormen',    publisher: 'MIT Press',     pub_date: '2026/4/15', cat_date: '2026/8/2', cataloguer: 'C01', sync_time: '2026-08-13 02:15:01' },
      { book_id: 'BK20260803003', isbn: '9787121000025', title: '设计模式',         author: 'Gamma',      publisher: 'Addison-Wesley',pub_date: '15-04-2026', cat_date: '13-08-2026', cataloguer: 'C02', sync_time: '2026-08-13 02:15:02' },
      { book_id: 'BK20260804004', isbn: '/',            title: 'NULL',             author: 'NULL',       publisher: 'NULL',          pub_date: 'NULL',    cat_date: '20260804', cataloguer: 'C02', sync_time: '2026-08-13 02:15:02' },
      { book_id: 'BK20260805005', isbn: '9787121000032', title: '代码大全',         author: 'McConnell',  publisher: 'Microsoft Press',pub_date: '2026-8-5', cat_date: '2026-08-05', cataloguer: 'C03', sync_time: '2026-08-13 02:15:03' },
      { book_id: 'BK20260805005', isbn: '9787121000032', title: '代码大全',         author: 'McConnell',  publisher: 'Microsoft Press',pub_date: '2026-08-05',cat_date: '2026-08-05', cataloguer: 'C03', sync_time: '2026-08-13 02:15:03' },
      { book_id: 'BK20260806006', isbn: '9787121000049', title: 'UNIX 编程艺术',   author: 'Raymond',    publisher: 'O\'Reilly',      pub_date: '/',       cat_date: '2026/08/06', cataloguer: 'C03', sync_time: '2026-08-13 02:15:04' },
      { book_id: 'BK20260807007', isbn: '9787121000056', title: '重构',             author: 'Fowler',     publisher: 'Addison-Wesley',pub_date: '2026/08/07',cat_date: '/',         cataloguer: 'C04', sync_time: '2026-08-13 02:15:04' },
      { book_id: 'BK20260808008', isbn: '9787121000063', title: '代码整洁之道',     author: 'Martin',     publisher: 'Prentice Hall', pub_date: '08-09-2026',cat_date: '2026/8/8',  cataloguer: 'C04', sync_time: '2026-08-13 02:15:05' },
      { book_id: 'BK20260809009', isbn: '9787121000070', title: '人月神话',         author: 'Brooks',     publisher: 'Addison-Wesley',pub_date: '2026/08/09',cat_date: '2026-08-09', cataloguer: 'C05', sync_time: '2026-08-13 02:15:05' },
      { book_id: 'BK20260810010', isbn: '9787121000087', title: '计算机网络',       author: 'Tanenbaum',  publisher: 'Prentice Hall', pub_date: '2026/8/10', cat_date: '2026-08-10', cataloguer: 'C05', sync_time: '2026-08-13 02:15:06' },
      { book_id: 'BK20260801001', isbn: '9787121000001', title: '深入理解计算机系统', author: 'Bryant',    publisher: '机械工业出版社', pub_date: '2026/03/01', cat_date: '2026-08-01', cataloguer: 'C01', sync_time: '2026-08-13 02:15:01' },
    ],
  },

  ods_inv_stocktake_sync: {
    name: 'ods_inv_stocktake_sync', cn: '馆藏盘点流水', domain: '典藏业务',
    target: 'dwd_inv_stocktake_di', taskCode: 'clean_ods_inv_stocktake', taskName: '馆藏盘点流水清洗',
    src: { db: 'MySQL 5.7', schema: 'invlib_v2', rows: 423180, syncAt: '08-13 02:16' },
    roles: { pk: 'stocktake_id', readerKey: null, syncTime: 'sync_time', dates: ['scan_time'], numerics: [], status: 'result' },
    fields: [
      { name: 'stocktake_id', srcType: 'VARCHAR', cn: '盘点单号' },
      { name: 'barcode',      srcType: 'VARCHAR', cn: '条形码' },
      { name: 'location_code',srcType: 'VARCHAR', cn: '索书号/位置' },
      { name: 'result',       srcType: 'CHAR',    cn: '盘点结果' },
      { name: 'scan_time',    srcType: 'VARCHAR', cn: '扫描时间' },
      { name: 'operator_id',  srcType: 'VARCHAR', cn: '盘点员' },
      { name: 'sync_time',    srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { stocktake_id: 'ST20260801001', barcode: 'BC00000001', location_code: 'I-3-12-A', result: 'OK', scan_time: '2026/08/01 09:12', operator_id: 'O01', sync_time: '2026-08-13 02:16:01' },
      { stocktake_id: 'ST20260802002', barcode: 'BC00000002', location_code: 'I-3-12-B', result: 'ok', scan_time: '2026/8/2 10:05',  operator_id: 'O01', sync_time: '2026-08-13 02:16:01' },
      { stocktake_id: 'ST20260803003', barcode: 'BC00000003', location_code: '/',       result: 'MISS', scan_time: '13-08-2026', operator_id: 'O02', sync_time: '2026-08-13 02:16:02' },
      { stocktake_id: 'ST20260804004', barcode: 'NULL',     location_code: 'II-1-05-A', result: 'DAMAGE', scan_time: 'NULL', operator_id: 'O02', sync_time: '2026-08-13 02:16:02' },
      { stocktake_id: 'ST20260805005', barcode: 'BC00000005', location_code: 'II-2-08-C', result: 'OK', scan_time: '2026-8-5 14:22', operator_id: 'O03', sync_time: '2026-08-13 02:16:03' },
      { stocktake_id: 'ST20260805005', barcode: 'BC00000005', location_code: 'II-2-08-C', result: 'OK', scan_time: '2026-08-05 14:22', operator_id: 'O03', sync_time: '2026-08-13 02:16:03' },
      { stocktake_id: 'ST20260806006', barcode: 'BC00000006', location_code: 'III-1-01-A', result: 'ok', scan_time: '/', operator_id: 'O03', sync_time: '2026-08-13 02:16:04' },
      { stocktake_id: 'ST20260807007', barcode: 'BC00000007', location_code: 'III-2-04-B', result: 'OK', scan_time: '2026/08/07 08:30', operator_id: 'O04', sync_time: '2026-08-13 02:16:04' },
      { stocktake_id: 'ST20260808008', barcode: 'BC00000008', location_code: 'IV-1-02-A', result: 'MISS', scan_time: '2026/8/8 16:45', operator_id: 'O04', sync_time: '2026-08-13 02:16:05' },
      { stocktake_id: 'ST20260809009', barcode: 'BC00000009', location_code: 'IV-2-09-C', result: 'DAMAGE', scan_time: '08-09-2026', operator_id: 'O05', sync_time: '2026-08-13 02:16:05' },
      { stocktake_id: 'ST20260810010', barcode: 'BC00000010', location_code: 'V-1-03-B', result: 'OK', scan_time: '2026/08/10 11:18', operator_id: 'O05', sync_time: '2026-08-13 02:16:06' },
      { stocktake_id: 'ST20260801001', barcode: 'BC00000001', location_code: 'I-3-12-A', result: 'OK', scan_time: '2026/08/01 09:12', operator_id: 'O01', sync_time: '2026-08-13 02:16:01' },
    ],
  },

  ods_per_received_sync: {
    name: 'ods_per_received_sync', cn: '期刊到刊流水', domain: '期刊业务',
    target: 'dwd_per_received_di', taskCode: 'clean_ods_per_received', taskName: '期刊到刊流水清洗',
    src: { db: 'MySQL 5.7', schema: 'perlib_v2', rows: 32150, syncAt: '08-13 02:17' },
    roles: { pk: 'per_id', readerKey: null, syncTime: 'sync_time', dates: ['received_date'], numerics: ['price'], status: null },
    fields: [
      { name: 'per_id',         srcType: 'VARCHAR', cn: '到刊单号' },
      { name: 'issn',           srcType: 'VARCHAR', cn: 'ISSN' },
      { name: 'vol_no',         srcType: 'VARCHAR', cn: '卷号' },
      { name: 'issue_no',       srcType: 'VARCHAR', cn: '期号' },
      { name: 'received_date',  srcType: 'VARCHAR', cn: '到刊日期' },
      { name: 'price',          srcType: 'VARCHAR', cn: '单价' },
      { name: 'vendor_id',      srcType: 'VARCHAR', cn: '供应商' },
      { name: 'sync_time',      srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { per_id: 'IS20260801001', issn: '1000-0001', vol_no: 'V42', issue_no: '08',  received_date: '2026/08/01', price: '¥25.00',  vendor_id: 'P01', sync_time: '2026-08-13 02:17:01' },
      { per_id: 'IS20260802002', issn: '1000-0002', vol_no: 'V31', issue_no: '07',  received_date: '2026/8/2',  price: '35',     vendor_id: 'P01', sync_time: '2026-08-13 02:17:01' },
      { per_id: 'IS20260803003', issn: '1000-0003', vol_no: 'V22', issue_no: '06',  received_date: '13-08-2026', price: '¥18.50',  vendor_id: 'P02', sync_time: '2026-08-13 02:17:02' },
      { per_id: 'IS20260804004', issn: 'NULL',     vol_no: 'V13', issue_no: 'NULL', received_date: '20260804', price: '0',      vendor_id: 'P02', sync_time: '2026-08-13 02:17:02' },
      { per_id: 'IS20260805005', issn: '1000-0005', vol_no: 'V04', issue_no: '05',  received_date: '2026-8-5',  price: '¥40.00',  vendor_id: 'P03', sync_time: '2026-08-13 02:17:03' },
      { per_id: 'IS20260805005', issn: '1000-0005', vol_no: 'V04', issue_no: '05',  received_date: '2026-08-05', price: '¥40.00',  vendor_id: 'P03', sync_time: '2026-08-13 02:17:03' },
      { per_id: 'IS20260806006', issn: '1000-0006', vol_no: 'V88', issue_no: '04',  received_date: '/',          price: 'NULL',    vendor_id: 'P03', sync_time: '2026-08-13 02:17:04' },
      { per_id: 'IS20260807007', issn: '1000-0007', vol_no: 'V76', issue_no: '03',  received_date: '2026/08/07', price: '¥22.00',  vendor_id: 'P04', sync_time: '2026-08-13 02:17:04' },
      { per_id: 'IS20260808008', issn: '1000-0008', vol_no: 'V65', issue_no: '02',  received_date: '2026/8/8',   price: '¥30.00',  vendor_id: 'P04', sync_time: '2026-08-13 02:17:05' },
      { per_id: 'IS20260809009', issn: '1000-0009', vol_no: 'V54', issue_no: '01',  received_date: '08-09-2026', price: '¥28.00',  vendor_id: 'P05', sync_time: '2026-08-13 02:17:05' },
      { per_id: 'IS20260810010', issn: '1000-0010', vol_no: 'V43', issue_no: '12',  received_date: '2026/08/10', price: 'abc',     vendor_id: 'P05', sync_time: '2026-08-13 02:17:06' },
      { per_id: 'IS20260801001', issn: '1000-0001', vol_no: 'V42', issue_no: '08',  received_date: '2026/08/01', price: '¥25.00',  vendor_id: 'P01', sync_time: '2026-08-13 02:17:01' },
    ],
  },

  ods_patron_register_sync: {
    name: 'ods_patron_register_sync', cn: '读者办证流水', domain: '读者业务',
    target: 'dwd_patron_register_di', taskCode: 'clean_ods_patron_register', taskName: '读者办证流水清洗',
    src: { db: 'MySQL 5.7', schema: 'patronlib_v2', rows: 24567, syncAt: '08-13 02:18' },
    roles: { pk: 'register_id', readerKey: null, syncTime: 'sync_time', dates: ['birthday', 'register_date'], numerics: [], status: 'card_type' },
    fields: [
      { name: 'register_id',   srcType: 'VARCHAR', cn: '办证流水号' },
      { name: 'reader_id',     srcType: 'VARCHAR', cn: '读者证号' },
      { name: 'name',          srcType: 'VARCHAR', cn: '姓名' },
      { name: 'gender',        srcType: 'CHAR',    cn: '性别' },
      { name: 'birthday',      srcType: 'VARCHAR', cn: '出生日期' },
      { name: 'dept_code',     srcType: 'VARCHAR', cn: '所属单位' },
      { name: 'register_date', srcType: 'VARCHAR', cn: '办证日期' },
      { name: 'card_type',     srcType: 'CHAR',    cn: '证件类型' },
      { name: 'sync_time',     srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { register_id: 'RG20260801001', reader_id: 'R20260012', name: '张伟华', gender: 'M', birthday: '1990/05/12', dept_code: 'D01', register_date: '2026/08/01', card_type: 'T',   sync_time: '2026-08-13 02:18:01' },
      { register_id: 'RG20260802002', reader_id: ' R20260031', name: ' 李明远', gender: 'M', birthday: '1992/8/20',  dept_code: 'D02', register_date: '2026/8/2',  card_type: 'teacher', sync_time: '2026-08-13 02:18:01' },
      { register_id: 'RG20260803003', reader_id: 'R20260058', name: '王芳',   gender: 'F', birthday: '12-03-1995', dept_code: 'D02', register_date: '13-08-2026', card_type: 'S', sync_time: '2026-08-13 02:18:02' },
      { register_id: 'RG20260804004', reader_id: 'R20260077', name: 'NULL',   gender: 'NULL', birthday: 'NULL', dept_code: 'D03', register_date: 'NULL',    card_type: 'NULL', sync_time: '2026-08-13 02:18:02' },
      { register_id: 'RG20260805005', reader_id: 'R20260093', name: '刘婷婷', gender: 'F', birthday: '1996-8-5',  dept_code: 'D03', register_date: '2026-08-05', card_type: 's',   sync_time: '2026-08-13 02:18:03' },
      { register_id: 'RG20260805005', reader_id: 'R20260093', name: '刘婷婷', gender: 'F', birthday: '1996-08-05', dept_code: 'D03', register_date: '2026-08-05', card_type: 's', sync_time: '2026-08-13 02:18:03' },
      { register_id: 'RG20260806006', reader_id: 'R20260102', name: '陈杰',   gender: 'M', birthday: '/',         dept_code: 'D01', register_date: '/',         card_type: 'T',   sync_time: '2026-08-13 02:18:04' },
      { register_id: 'RG20260807007', reader_id: 'R20260115', name: ' ',      gender: 'F', birthday: '1997/09/03', dept_code: 'D04', register_date: '2026/08/07', card_type: 'V',   sync_time: '2026-08-13 02:18:04' },
      { register_id: 'RG20260808008', reader_id: 'R20260131', name: '赵磊',   gender: 'M', birthday: '1998-10-15', dept_code: 'NULL',  register_date: '2026/8/8',  card_type: 'G',   sync_time: '2026-08-13 02:18:05' },
      { register_id: 'RG20260809009', reader_id: 'R20260146', name: '孙玥',   gender: 'F', birthday: '1999-12-08', dept_code: 'D02', register_date: '08-09-2026', card_type: 'S',  sync_time: '2026-08-13 02:18:05' },
      { register_id: 'RG20260810010', reader_id: 'R20260160', name: '周昊',   gender: 'M', birthday: '2000-01-30', dept_code: 'D04', register_date: '2026/08/10', card_type: 'T',  sync_time: '2026-08-13 02:18:06' },
      { register_id: 'RG20260801001', reader_id: 'R20260012', name: '张伟华', gender: 'M', birthday: '1990/05/12', dept_code: 'D01', register_date: '2026/08/01', card_type: 'T',   sync_time: '2026-08-13 02:18:01' },
    ],
  },

  ods_circ_illsync: {
    name: 'ods_circ_illsync', cn: '馆际互借流水', domain: '流通业务',
    target: 'dwd_circ_ill_di', taskCode: 'clean_ods_circ_ill', taskName: '馆际互借流水清洗',
    src: { db: 'MySQL 5.7', schema: 'finlib_v3', rows: 12890, syncAt: '08-13 02:19' },
    roles: { pk: 'ill_id', readerKey: 'reader_id', syncTime: 'sync_time', dates: ['request_date', 'supply_date', 'due_date'], numerics: ['fee'], status: 'ill_status' },
    fields: [
      { name: 'ill_id',       srcType: 'VARCHAR', cn: '馆际互借单号' },
      { name: 'reader_id',    srcType: 'VARCHAR', cn: '读者证号' },
      { name: 'partner_lib',  srcType: 'VARCHAR', cn: '协作馆' },
      { name: 'request_date', srcType: 'VARCHAR', cn: '申请日期' },
      { name: 'supply_date',  srcType: 'VARCHAR', cn: '到书日期' },
      { name: 'due_date',     srcType: 'VARCHAR', cn: '应还日期' },
      { name: 'fee',          srcType: 'VARCHAR', cn: '费用' },
      { name: 'ill_status',   srcType: 'CHAR',    cn: '互借状态' },
      { name: 'sync_time',    srcType: 'DATETIME', cn: '同步时间' },
    ],
    rows: [
      { ill_id: 'IL20260801001', reader_id: 'R20260012',  partner_lib: '上海图书馆', request_date: '2026/08/01', supply_date: '2026/08/05', due_date: '2026-08-22', fee: '¥15.00', ill_status: 'F', sync_time: '2026-08-13 02:19:01' },
      { ill_id: 'IL20260802002', reader_id: ' R20260031', partner_lib: '复旦图书馆', request_date: '2026/8/2',   supply_date: '2026/8/6',   due_date: '/',         fee: '0',     ill_status: 'I', sync_time: '2026-08-13 02:19:01' },
      { ill_id: 'IL20260803003', reader_id: 'R20260058',  partner_lib: '交大图书馆', request_date: '13-08-2026', supply_date: '2026-08-10', due_date: '2026/8/28', fee: '¥20.00', ill_status: 'F', sync_time: '2026-08-13 02:19:02' },
      { ill_id: 'IL20260804004', reader_id: 'R20260077',  partner_lib: '上海图书馆', request_date: 'NULL',      supply_date: 'NULL',      due_date: 'NULL',     fee: '0',     ill_status: 'R', sync_time: '2026-08-13 02:19:02' },
      { ill_id: 'IL20260805005', reader_id: 'R20260093',  partner_lib: '清华图书馆', request_date: '2026-8-5',   supply_date: '2026-08-15', due_date: '2026-09-01', fee: '¥25.00', ill_status: 'F', sync_time: '2026-08-13 02:19:03' },
      { ill_id: 'IL20260805005', reader_id: 'R20260093',  partner_lib: '清华图书馆', request_date: '2026-08-05', supply_date: '2026-08-15', due_date: '2026-09-01', fee: '¥25.00', ill_status: 'F', sync_time: '2026-08-13 02:19:03' },
      { ill_id: 'IL20260806006', reader_id: 'R20260102',  partner_lib: '复旦图书馆', request_date: '/',         supply_date: '/',          due_date: '2026-08-25', fee: 'NULL',  ill_status: 'i', sync_time: '2026-08-13 02:19:04' },
      { ill_id: 'IL20260807007', reader_id: 'R20260115',  partner_lib: '北大图书馆', request_date: '2026/08/07', supply_date: '2026-08-18', due_date: '2026-09-03', fee: '¥30.00', ill_status: 'F', sync_time: '2026-08-13 02:19:04' },
      { ill_id: 'IL20260808008', reader_id: 'R20260131',  partner_lib: '上海图书馆', request_date: '2026/8/8',   supply_date: '08-09-2026', due_date: '2026/9/2',  fee: '¥18.00', ill_status: 'f', sync_time: '2026-08-13 02:19:05' },
      { ill_id: 'IL20260809009', reader_id: 'R20260146',  partner_lib: '交大图书馆', request_date: '2026/08/09', supply_date: '2026-08-20', due_date: '08-09-2026',fee: 'abc',   ill_status: 'F', sync_time: '2026-08-13 02:19:05' },
      { ill_id: 'IL20260810010', reader_id: 'R20260160',  partner_lib: '清华图书馆', request_date: '2026/08/10', supply_date: '2026-08-22', due_date: '2026-09-10', fee: '¥40.00', ill_status: 'F', sync_time: '2026-08-13 02:19:06' },
      { ill_id: 'IL20260801001', reader_id: 'R20260012',  partner_lib: '上海图书馆', request_date: '2026/08/01', supply_date: '2026/08/05', due_date: '2026-08-22', fee: '¥15.00', ill_status: 'F', sync_time: '2026-08-13 02:19:01' },
    ],
  },
};

// ===== 当前活动源表：单表模式下 FIELDS / RAW_ROWS 指向它 =====
//   保留这两个名字（而非全部改成 SOURCES[x].fields），是为了让「配置 → 预览 → SQL」
//   的全部既有链路原样复用；切表只是把绑定换一个源，语义完全等价。
let ACTIVE_SRC = 'ods_circ_loan_sync';
let FIELDS = SOURCES[ACTIVE_SRC].fields;
let RAW_ROWS = SOURCES[ACTIVE_SRC].rows;
const activeSource = () => SOURCES[ACTIVE_SRC];
const activeRoles = () => SOURCES[ACTIVE_SRC].roles;
// 「日期标准化」合规的列 = 语义角色里标记为日期的字段（roles.dates）。
// ⚠ roles 里存的是**源字段名**，而这些字段可能已被「字段映射」重命名（如 reader_id→reader_no），
//   所以必须先过一遍 renames 再比对，否则重命名后的日期列会被误判成非日期列。
// ⚠ 之前这里没有这道闸：面板把 planColumns 的**全部源列**都列成「参与标准化的字段」，
//   用户勾上「读者证号」后 parseDate('R20260012') 一律返回 null → 整列被写成 NULL，
//   数据静默丢失；而且因为预览与 SQL 一起错，指标上看不出任何异常。
function roleColsOf(kind) {
  // ⚠ `pipeline` 是 const，而 recommend() 正是在 `const pipeline = DEFAULT_ORDER.map(...)`
  //   的构造过程中被调用的（见下方构造处）—— 那一刻它还在 TDZ 里，直接 find 会抛
  //   ReferenceError: Cannot access 'pipeline' before initialization，
  //   结果是整份流水线构造失败、页面空白。所以这里对「构造期拿不到映射」做降级：
  //   按源字段名返回，构造完成后再调用就能拿到重命名后的名字。
  let renames = {};
  try {
    const m = pipeline.find(s => s.id === 'map');
    renames = (m && m.config && m.config.renames) || {};
  } catch (e) { renames = {}; }
  return (activeRoles()[kind] || []).map(n => renames[n] || n);
}
// roles 缺该角色时（无角色信息的表）返回 true，退化为不限制，保持旧行为不误伤。
function isDateColName(name) {
  const ok = roleColsOf('dates');
  return ok.length === 0 || ok.includes(name);
}
// 稳定行标识：字段重命名 / 关联 / 派生之后仍能回溯到原始采样行，用于「变化单元格」比对
Object.values(SOURCES).forEach(s => s.rows.forEach((r, i) => { r.__rid = i; }));
// 采样行里的主键形态（前缀 + 数字宽度），全量放大时按原形态补零，保证样本与全量同构
function pkShape() {
  const v = String((RAW_ROWS.find(r => r[activeRoles().pk]) || {})[activeRoles().pk] || 'LN00000000000');
  const m = /^([A-Za-z]*)(\d+)$/.exec(v);
  return m ? { prefix: m[1], width: m[2].length } : { prefix: '', width: 11 };
}
function bindSource(name) {
  if (!SOURCES[name]) return false;
  ACTIVE_SRC = name;
  FIELDS = SOURCES[name].fields;
  RAW_ROWS = SOURCES[name].rows;
  FULL_CACHE = null; FULL_N = 0; FULL_STATS = null; RUNMODE = 'sample';
  return true;
}

// ===== DWD 层维表 / 主档（供「多表关联」步骤使用，均为已清洗的主档数据）=====
const LOOKUP_TABLES = {
  dwd_patron: {
    name: 'dwd_patron', cn: '读者主档', key: 'reader_no',
    desc: '读者证号 → 姓名 / 类型 / 单位代码',
    fields: [
      { name: 'reader_no',   type: 'VARCHAR', cn: '读者证号' },
      { name: 'patron_name', type: 'VARCHAR', cn: '读者姓名' },
      { name: 'patron_type', type: 'VARCHAR', cn: '读者类型' },
      { name: 'dept_code',   type: 'VARCHAR', cn: '单位代码' },
    ],
    rows: [
      { reader_no: 'R20260012', patron_name: '张伟华', patron_type: '教师',   dept_code: 'D01' },
      { reader_no: 'R20260031', patron_name: '李明远', patron_type: '研究生', dept_code: 'D02' },
      { reader_no: 'R20260058', patron_name: '王芳',   patron_type: '本科生', dept_code: 'D02' },
      { reader_no: 'R20260093', patron_name: '陈杰',   patron_type: '教师',   dept_code: 'D03' },
      { reader_no: 'R20260115', patron_name: '刘婷婷', patron_type: '本科生', dept_code: 'D01' },
      { reader_no: 'R20260146', patron_name: '赵强',   patron_type: '研究生', dept_code: 'D04' },
      // R20260077 / R20260102 / R20260131 故意缺失 → 演示关联未命中与命中率
    ],
  },
  dwd_org_dept: {
    name: 'dwd_org_dept', cn: '单位院系主档', key: 'dept_code',
    desc: '单位代码 → 院系名称',
    fields: [
      { name: 'dept_code', type: 'VARCHAR', cn: '单位代码' },
      { name: 'dept_name', type: 'VARCHAR', cn: '院系名称' },
    ],
    rows: [
      { dept_code: 'D01', dept_name: '中文系' },
      { dept_code: 'D02', dept_name: '历史系' },
      { dept_code: 'D03', dept_name: '图书馆' },
      { dept_code: 'D04', dept_name: '信息管理系' },
    ],
  },
};

// ===== 通用工具 =====
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eqConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const warn = (m, t) => DF.app.toast(m, t || 'warning', 2600);

// MD5：与生成的 SQL 中 MD5() 保持一致（脱敏哈希模式），UTF-8 编码后摘要
function md5(str) {
  const utf8 = unescape(encodeURIComponent(String(str)));
  const rl = (n, c) => (n << c) | (n >>> (32 - c));
  const au = (x, y) => { const l = (x & 0xFFFF) + (y & 0xFFFF); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF); };
  const cmn = (q, a, b, x, s, t) => au(rl(au(au(a, q), au(x, t)), s), b);
  const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
  const n = utf8.length, x = new Array((((n + 8) >> 6) + 1) * 16).fill(0);
  for (let i = 0; i < n; i++) x[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
  x[n >> 2] |= 0x80 << ((n % 4) * 8);
  x[(((n + 8) >> 6) * 16) + 14] = n * 8;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[i + 0], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417); c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101); c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i + 0], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690); c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784); c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353); c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i + 0], 11, -358537222); c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835); c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i + 0], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415); c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606); c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744); c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379); c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od);
  }
  const hx = n2 => { let s = ''; for (let i = 0; i < 4; i++) s += ('0' + ((n2 >> (i * 8)) & 0xFF).toString(16)).slice(-2); return s; };
  return hx(a) + hx(b) + hx(c) + hx(d);
}

// ===== 日期格式识别与归一 =====
// 分类用于「智能探测」与「日期标准化」面板的实时统计，不再是写死的标签
function classifyDate(v) {
  const t = String(v ?? '').trim();
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(t)) return { key: 'ymdSlash', label: 'YYYY/MM/DD 斜杠式', ambiguous: false };
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t))   return { key: 'ymdHyphen', label: 'YYYY-M-D 短横线',   ambiguous: false };
  if (/^\d{8}$/.test(t))                   return { key: 'compact',   label: 'YYYYMMDD 紧凑式',   ambiguous: false };
  const m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return { key: 'dmy', label: 'DD-MM-YYYY 英式', ambiguous: (+m[1] <= 12 && +m[2] <= 12), sample: t };
  return { key: 'unknown', label: '无法识别', ambiguous: false };
}
// 找一条「只有一个可行解」的 d1-d2-yyyy 样本（如 13-08-2026，13 不可能是月份），
// 用于在配置面板里点明「口径只裁决歧义值」。不写这句，用户选了另一个口径却发现这些值没变，
// 会以为单选坏了 —— 这正是上线前需要靠文案消除的误解。
function uniqueDmySample() {
  for (const r of RAW_ROWS) {
    for (const f of FIELDS) {
      const t = String(r[f.name] ?? '').trim();
      const m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
      if (!m) continue;
      const [, a, b, y] = m;
      const asDay = fmtYMD(y, b, a), asMonth = fmtYMD(y, a, b);
      if ((asDay && asMonth) || (!asDay && !asMonth)) continue;   // 歧义值 / 两者都不可行，跳过
      return { raw: t, iso: asDay || asMonth, side: asDay ? '日在前' : '月在前' };
    }
  }
  return null;
}
// 用「业务日期不应晚于该行同步时间」这条硬约束来辅助判断口径。
// ⚠ 当两个口径在数值上都「能解析」时，只有业务约束能分出高下。这是回答用户
//   「弹窗里展示的日期样例不对」的实证依据：某些值在某个口径下会得到物理上不可能的日期
//   （例如 08-09-2026 按「日在前」解成 2026-09-08，却晚于该行 sync_time 2026-08-13）。
function syncISO(v) {
  const t = String(v ?? '').trim();
  return parseDate(t.slice(0, 10), true) || parseDate(t.slice(0, 8), true) || null;
}
function conventionCheck() {
  const r = activeRoles();
  const syncF = r.syncTime;
  const dateFs = roleColsOf('dates');
  if (!syncF || !dateFs.length) return null;
  let badDay = 0, badMon = 0, total = 0;
  const samples = [];
  for (const row of RAW_ROWS) {
    const s = syncISO(row[syncF]);
    if (!s) continue;
    for (const f of dateFs) {
      const t = String(row[f] ?? '').trim();
      if (!/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(t)) continue;   // 只看有歧义潜力的 d1-d2-yyyy 写法
      const dD = parseDate(t, true), dM = parseDate(t, false);
      if (!dD && !dM) continue;
      total++;
      if (dD && dD > s) badDay++;
      if (dM && dM > s) badMon++;
      if (dD !== dM && samples.length < 2) samples.push({ raw: t, field: f, day: dD, month: dM, sync: s });
    }
  }
  return total ? { badDay, badMon, total, samples, syncF } : null;
}
// dayFirst=true → 按 DD-MM-YYYY 解释；false → 按 MM-DD-YYYY 解释
// ⚠ 口径只用来裁决「日月都能解释」的歧义值（如 08-09-2026），不能用来裁决「只有一个可行解」的值。
//   例如 13-08-2026 里的 13 不可能是月份，无论选哪个口径都只能解为 2026-08-13。
//   早期实现直接拿首选口径去解析：一旦选「月在前」，这类值会被判为非法月份 → 整列变 NULL，
//   静默丢数据；而且因为 SQL 侧同样只发单分支，预览与 SQL 会「一致地错」，看指标也看不出异常。
//   所以这里必须先试首选口径，不可行再退回另一解，两种都不可行才算「无法解析」。
function parseDate(v, dayFirst) {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === '') return null;
  let m;
  if (m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)) return fmtYMD(m[1], m[2], m[3]);
  if (m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))   return fmtYMD(m[1], m[2], m[3]);
  if (m = t.match(/^(\d{4})(\d{2})(\d{2})$/))         return fmtYMD(m[1], m[2], m[3]);
  if (m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)) {
    const [, a, b, y] = m;
    const asDayFirst = fmtYMD(y, b, a);     // 日在前：a=日、b=月 → 13-08-2026 → 2026-08-13
    const asMonthFirst = fmtYMD(y, a, b);   // 月在前：a=月、b=日 → 08-09-2026 → 2026-08-09
    const pref = dayFirst === false ? asMonthFirst : asDayFirst;
    const alt = dayFirst === false ? asDayFirst : asMonthFirst;
    return pref || alt || null;
  }
  return null;
}
function fmtYMD(y, mo, d) {
  mo = +mo; d = +d;
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// 空值占位符（清洗步骤可配）
const NULL_TOKENS_DEFAULT = 'NULL,/,-,--,空';

// =====================================================================
// 清洗流水线定义
//   每个步骤 = { id, name, icon, desc, recommend(), config, run(rows, step) }
//   recommend() 返回该步骤的「智能推荐」配置，用于「恢复推荐」一键回滚。
//   run() 必须是纯函数：读 step.config，返回 { rows, stat, ...metrics }。
// =====================================================================
// =====================================================================
// 质量规则（对齐 DataWorks DQC 的「规则 + 阈值 + 不达标动作」三段式）
//   规则类型：唯一性 / 非空率 / 值域 / 数值区间 / 格式 / 自定义断言
//   阈值：通过率百分比；不达标动作：告警(warn) / 阻断(block) / 继续(continue)
//   全部指标由 run() 在真实行集上算出，阈值与动作只影响判定，不影响数字
// =====================================================================
const QUALITY_RULE_TYPES = [
  { key: 'unique',  label: '唯一性',     hint: '按字段求唯一率（去重后应达 100%）' },
  { key: 'notnull', label: '非空率',     hint: '字段非空占比' },
  { key: 'enum',    label: '值域',       hint: '取值必须落在白名单内' },
  { key: 'range',   label: '数值区间',   hint: '数值须落在 [min, max] 内' },
  { key: 'regex',   label: '格式',       hint: '取值须匹配正则的占比' },
  { key: 'custom',  label: '自定义断言', hint: '字段 运算符 常量，支持 IS NULL / 比较 / 包含' },
];
const QUALITY_ACTIONS = [
  { key: 'block',    label: '阻断', hint: '不达标即判定任务失败，不写入目标表' },
  { key: 'warn',     label: '告警', hint: '不达标只告警，仍写入目标表' },
  { key: 'continue', label: '继续', hint: '仅记录，不影响写入' },
];
const Q_OPS = ['>', '>=', '<', '<=', '=', '!=', 'CONTAINS', 'IS NULL', 'IS NOT NULL'];
let qRuleSeq = 0;
function newRule(type, field, extra) {
  qRuleSeq++;
  return Object.assign({
    id: 'qr' + qRuleSeq, type, field: field || '', enabled: true,
    threshold: 100, action: 'warn',
    values: '', min: '', max: '', pattern: '', op: 'IS NOT NULL', value: '',
  }, extra || {});
}
const qNum = v => { if (v === '' || v === null || v === undefined) return NaN; const n = Number(String(v).replace(/[¥,\s]/g, '')); return isNaN(n) ? NaN : n; };
function qRuleLabel(r) {
  const t = QUALITY_RULE_TYPES.find(x => x.key === r.type) || { label: r.type };
  const f = r.field || '（未选字段）';
  if (r.type === 'enum') return `${t.label}(${f} ∈ ${r.values || '空'})`;
  const rmin = (r.min === '' || r.min == null) ? '−∞' : r.min;
  const rmax = (r.max === '' || r.max == null) ? '+∞' : r.max;
  if (r.type === 'range') return `${t.label}(${f} ∈ [${rmin}, ${rmax}])`;
  if (r.type === 'regex') return `${t.label}(${f} ~ ${r.pattern || '空'})`;
  if (r.type === 'custom') return `${t.label}(${f} ${r.op} ${r.op.includes('NULL') ? '' : (r.value || '空')})`;
  return `${t.label}(${f})`;
}
// 规则求值：返回真实通过率与违规样本，不做任何估算
// ⚠⚠ 结果对象归一化入口：必须把规则的 action 带进结果里！
//   门禁判定（quality.run 的 blocked / blockers）、顶栏阻断清单、质量面板横幅、
//   SQL 头部的「已被阻断」提示 —— 全都读 res.action。曾经因为结果里没有这个字段，
//   「阻断」这一档动作判定恒为 false（配置能看到、却永不生效），属于静默失效。
//   所有结果对象只在这个包装函数里产出，避免再有第二处漏字段。
function evalQualityRule(r, rows, cols) {
  return Object.assign({ action: r.action, field: r.field, type: r.type }, evalQualityRuleRaw(r, rows, cols));
}
function evalQualityRuleRaw(r, rows, cols) {
  const names = cols.map(c => c.name);
  const total = rows.length;
  let pass = 0;
  const samples = [];
  if (!total || !r.field || !names.includes(r.field)) {
    return { rule: r, total, violations: total, rate: 0, passed: false, unmet: true, samples: [] };
  }
  const re = r.type === 'regex' && r.pattern ? (() => { try { return new RegExp(r.pattern); } catch (e) { return null; } })() : null;
  if (r.type === 'regex' && !re) return { rule: r, total, violations: total, rate: 0, passed: false, unmet: true, samples: [] };

  if (r.type === 'unique') {
    const seen = new Map();
    rows.forEach(row => {
      const k = String(row[r.field] ?? '∅');
      seen.set(k, (seen.get(k) || 0) + 1);
    });
    const dupRows = [...seen.values()].filter(v => v > 1).reduce((a, v) => a + v, 0);
    pass = total - dupRows;
    if (dupRows) rows.filter(row => seen.get(String(row[r.field] ?? '∅')) > 1).slice(0, 3).forEach(row => samples.push(String(row[r.field])));
    return finish();
  }
  rows.forEach(row => {
    const v = row[r.field];
    const s = v == null ? null : String(v);
    let ok;
    if (r.type === 'notnull') ok = s !== null && s !== '';
    else if (r.type === 'enum') ok = s !== null && String(r.values || '').split(',').map(x => x.trim()).filter(Boolean).includes(s);
    else if (r.type === 'range') {
      const n = qNum(s);
      ok = !isNaN(n) && (r.min === '' || n >= Number(r.min)) && (r.max === '' || n <= Number(r.max));
    } else if (r.type === 'regex') ok = s !== null && re.test(s);
    else if (r.type === 'custom') {
      const n = qNum(s), c = qNum(r.value);
      switch (r.op) {
        case 'IS NULL': ok = s === null || s === ''; break;
        case 'IS NOT NULL': ok = s !== null && s !== ''; break;
        case 'CONTAINS': ok = s !== null && s.includes(String(r.value)); break;
        case '=': ok = !isNaN(n) && !isNaN(c) ? n === c : String(s) === String(r.value); break;
        case '!=': ok = !isNaN(n) && !isNaN(c) ? n !== c : String(s) !== String(r.value); break;
        case '>': ok = !isNaN(n) && n > c; break;
        case '>=': ok = !isNaN(n) && n >= c; break;
        case '<': ok = !isNaN(n) && n < c; break;
        case '<=': ok = !isNaN(n) && n <= c; break;
        default: ok = true;
      }
    } else ok = true;
    if (ok) pass++;
    else if (samples.length < 3) samples.push(s === null ? 'NULL' : s);
  });
  return finish();

  function finish() {
    const rate = total ? (pass / total) * 100 : 100;
    return { rule: r, total, violations: total - pass, rate, passed: rate >= Number(r.threshold), unmet: false, samples };
  }
}
function evaluateQualityRules(rows, rules, cols) {
  return (rules || []).filter(r => r.enabled).map(r => evalQualityRule(r, rows, cols));
}

/* =====================================================================
   码值映射：「实际生效」的映射块 —— 一个字段只取**第一组**
   ---------------------------------------------------------------------
   预览（step.run）与生成的 SQL（genSQL）必须共用这一个判据。
   原来两处各写一遍：run 里是 `for (const m of maps)` 遍历全部、并且就地改写
   nr[m.field]，于是同一字段配了第二组时，第二组读到的是第一组**写下的值**
   （链式叠加）；genSQL 里是 `maps.find(x => x.field === c.name)` 只取第一条。
   结果：预览列与 SQL 列静默不一致，未匹配策略（others）也各管一份，连下游的
   enum 质量门禁都会对同一个字段给出相反结论 —— 全程 0 报错。
   去重在这里再做一次（不只靠界面拦），因为旧版本存下来的配置、导入的配置里
   可能已经带着重复项。
   ===================================================================== */
function effectiveMaps(cfg) {
  const out = [];
  const seen = new Set();
  ((cfg && cfg.maps) || []).forEach(m => {
    if (!m || !m.field || seen.has(m.field)) return;
    seen.add(m.field);
    out.push(m);
  });
  return out;
}
/** 判一个映射块是不是「重复的、不生效的那一块」（同字段的第二次及以后出现） */
function isRedundantMap(cfg, i) {
  const maps = (cfg && cfg.maps) || [];
  const m = maps[i];
  if (!m || !m.field) return false;
  return maps.findIndex(x => x && x.field === m.field) !== i;
}

const STEP_SPECS = [
  {
    id: 'map', name: '字段映射', icon: '🔗',
    desc: '重命名 / 排除字段，输出 DWD 规范字段名',
    recommend: () => ({ renames: { reader_id: 'reader_no' }, drop: [] }),
    run(rows, step) {
      const renames = step.config.renames || {};
      const drop = step.config.drop || [];
      let dropped = 0;
      const out = rows.map(r => {
        const nr = {};
        for (const k of Object.keys(r)) {
          if (k.startsWith('__')) { nr[k] = r[k]; continue; }
          if (drop.includes(k)) { dropped++; continue; }
          nr[renames[k] || k] = r[k];
        }
        return nr;
      });
      const rn = Object.keys(renames).filter(k => renames[k] !== k).length;
      return { rows: out, stat: `重命名 ${rn} · 排除 ${drop.length}`, renamed: rn, excluded: drop.length };
    },
  },
  {
    id: 'clean', name: '字段清理', icon: '🧹',
    desc: '全列 TRIM；空串 / "NULL" / "/" 等占位符归一为 NULL',
    recommend: () => ({ trim: true, nullNormalize: true, nullTokens: NULL_TOKENS_DEFAULT }),
    run(rows, step) {
      const trim = step.config.trim !== false;
      const nullNormalize = step.config.nullNormalize === true;
      const toks = String(step.config.nullTokens || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      let changed = 0, nulled = 0;
      const out = rows.map(r => {
        const nr = { ...r };
        for (const k of Object.keys(nr)) {
          if (k.startsWith('__')) continue;
          const v = nr[k];
          if (typeof v !== 'string') continue;
          let nv = trim ? v.trim() : v;
          if (nullNormalize && (nv === '' || toks.includes(nv.toUpperCase()))) { nv = null; nulled++; }
          if (nv !== v) { nr[k] = nv; changed++; }
        }
        return nr;
      });
      return { rows: out, stat: `清理 ${changed} 处${nulled ? ` · 归空 ${nulled}` : ''}`, changed, nulled };
    },
  },
  {
    id: 'codemap', name: '码值映射', icon: '🏷️',
    desc: '枚举码值翻译为业务可读值（如 Y/N → 在借/已还）',
    recommend: () => ({ maps: [{ field: 'circ_status', pairs: [{ from: 'Y', to: '在借' }, { from: 'N', to: '已还' }], others: 'keep', defaultValue: '未知' }] }),
    run(rows, step) {
      /* ⚠ 只跑**生效的**映射块（同字段取第一组）—— 与 genSQL() 共用 effectiveMaps()。
         之前这里遍历全部块并就地改写 nr[m.field]，同一字段配两组时会链式叠加，
         而 SQL 只取第一条 → 预览与 SQL 静默不一致。 */
      const maps = effectiveMaps(step.config);
      const dropped = ((step.config && step.config.maps) || []).length - maps.length;
      let hit = 0, miss = 0;
      const out = rows.map(r => {
        const nr = { ...r };
        for (const m of maps) {
          const v = nr[m.field];
          if (v == null) continue;
          const p = (m.pairs || []).find(x => String(x.from) === String(v));
          if (p) { nr[m.field] = p.to; hit++; }
          else {
            miss++;
            if (m.others === 'null') nr[m.field] = null;
            else if (m.others === 'default') nr[m.field] = m.defaultValue === '' || m.defaultValue == null ? '未知' : m.defaultValue;
          }
        }
        return nr;
      });
      const total = hit + miss;
      const base = total ? `映射命中 ${hit}/${total}` : '未配置';
      /* 命中率的分母是「行 × 生效字段」，不是「行 × 配置块」—— 后者在配了多块时会把
         分母虚增。另有重复块时把数量说出来，不静默吞掉。 */
      return {
        rows: out, stat: dropped ? `${base} · ${dropped} 组重复未生效` : base,
        mapped: hit, unmatched: miss, dropped,
      };
    },
  },
  {
    id: 'cast', name: '类型转换', icon: '🔢',
    desc: '字符串 → 数值类型，失败按策略处理（置 NULL / 默认值 / 丢弃行）',
    recommend: () => ({ casts: { borrow_cnt: 'INT', fine_amt: 'DECIMAL(10,2)' }, onFail: 'null', defaultValue: '' }),
    run(rows, step) {
      const casts = step.config.casts || {};
      const onFail = step.config.onFail || 'null';
      // ⚠ 转 DATE 的口径必须与「日期标准化」共用同一份配置。
      //   这里曾经写死 true（日在前）：用户在日期步骤里选了「月在前」，同一列在类型转换里
      //   仍按日在前解释 —— 两个步骤对同一列给出互相矛盾的结果，取决于谁在后面跑，全程不报错。
      const dateStep = pipeline.find(s => s.id === 'date');
      const dayFirst = !dateStep || dateStep.config.dayFirst !== false;
      let ok = 0, fail = 0, dropped = 0;
      const out = [];
      for (const r of rows) {
        const nr = { ...r };
        let rowDrop = false;
        for (const col of Object.keys(casts)) {
          const type = casts[col];
          const v = nr[col];
          if (v == null) continue;
          const s = String(v).replace(/[¥,\s]/g, '');
          let nv = null;
          if (type === 'INT' || type === 'BIGINT') { if (/^-?\d+$/.test(s)) nv = type === 'INT' ? parseInt(s, 10) : s; }
          else if (type === 'DECIMAL(10,2)') { if (/^-?\d+(\.\d+)?$/.test(s)) nv = parseFloat(s).toFixed(2); }
          else if (type === 'DATE') { nv = parseDate(v, dayFirst); }
          if (nv == null) {
            fail++;
            nr.__fail = { ...(nr.__fail || {}), [col]: v };
            if (onFail === 'default') nr[col] = defaultFor(type, step.config.defaultValue);
            else if (onFail === 'skip') rowDrop = true;
            else nr[col] = null;
          } else { nr[col] = nv; ok++; }
        }
        if (rowDrop) { dropped++; continue; }
        out.push(nr);
      }
      const failedCount = out.filter(r => r.__fail && Object.keys(r.__fail).length).length;
      return { rows: out, stat: `转换 ${ok} 格${fail ? ` · 失败 ${fail}` : ''}${dropped ? ` · 丢弃 ${dropped} 行` : ''}`,
               ok, fail, dropped, failedCount, removed: dropped };
    },
  },
  {
    id: 'date', name: '日期标准化', icon: '📅',
    desc: '多格式归一为 YYYY-MM-DD，无法解析的值置 NULL',
    // 推荐列取自语义角色（roles.dates），不再写死 ['loan_date','return_date']：
    // 否则切到只有 return_date 的归还表，推荐配置里仍带着不存在的 loan_date（配置悬空、静默失效）
    recommend: () => ({ cols: roleColsOf('dates'), target: 'YYYY-MM-DD', dayFirst: false }),
    run(rows, step) {
      // ⚠ 最后一道闸：只处理真正的日期列。非日期列一旦进入 cols，parseDate 对每个值都返回 null，
      //   整列会被静默写成 NULL —— 数据丢了、失败明细里只有零星几行、质量指标看不出任何异常。
      //   这里与 setDateCol 的拦截、genSQL 的投影判据是同一套 predicate，三者必须一致，
      //   否则会出现「预览与 SQL 不一致」这种更难发现的错。
      const configured = step.config.cols || [];
      const cols = configured.filter(isDateColName);
      const skipped = configured.filter(c => !cols.includes(c));
      const dayFirst = step.config.dayFirst !== false;
      let ok = 0, fail = 0;
      const out = rows.map(r => {
        const nr = { ...r };
        for (const c of cols) {
          const v = nr[c];
          if (v == null) continue;
          const nv = parseDate(v, dayFirst);
          if (nv == null) { fail++; nr.__fail = { ...(nr.__fail || {}), [c]: v }; nr[c] = null; }
          else { nr[c] = nv; ok++; }
        }
        return nr;
      });
      const failedCount = out.filter(r => r.__fail && Object.keys(r.__fail).length).length;
      return { rows: out, stat: `归一 ${ok} 格${fail ? ` · 失败 ${fail}` : ''}${skipped.length ? ` · 已跳过非日期列 ${skipped.join('/')}` : ''}`, ok, fail, failedCount, skipped };
    },
  },
  {
    id: 'dedup', name: '数据去重', icon: '🧬',
    desc: '按业务主键去重，保留同步时间最新的一条',
    recommend: () => ({ keys: ['loan_id'], keep: 'latest', orderBy: 'sync_time' }),
    run(rows, step) {
      const keys = (step.config.keys || []).filter(Boolean);
      const orderBy = step.config.orderBy;
      if (!keys.length) return { rows, stat: '未配置去重键' };
      const keyOf = r => keys.map(k => String(r[k] ?? '∅')).join('§');
      const best = new Map();
      for (const r of rows) {
        const k = keyOf(r);
        if (!best.has(k)) { best.set(k, r); continue; }
        const cur = best.get(k);
        const cmp = String(r[orderBy] ?? '').localeCompare(String(cur[orderBy] ?? ''));
        if (step.config.keep === 'latest' ? cmp > 0 : cmp < 0) best.set(k, r);
      }
      const kept = new Set(best.values());
      const removed = rows.length - best.size;
      return { rows: rows.filter(r => kept.has(r)), stat: removed ? `去重 ${removed} 行` : '无重复', removed };
    },
  },
  {
    id: 'join', name: '多表关联', icon: '🧩',
    desc: '关联 DWD 维表/主档，把编码翻译为业务字段，生成宽表',
    recommend: () => ({ joins: [
      { id: 'j1', type: 'left', table: 'dwd_patron',   leftKey: 'reader_no', rightKey: 'reader_no', fields: ['patron_name', 'patron_type', 'dept_code'] },
      { id: 'j2', type: 'left', table: 'dwd_org_dept', leftKey: 'dept_code', rightKey: 'dept_code', fields: ['dept_name'] },
    ] }),
    run(rows, step) {
      const joins = step.config.joins || [];
      let out = rows.map(r => ({ ...r }));
      const joinHits = [];
      joins.forEach(j => {
        const t = LOOKUP_TABLES[j.table];
        if (!t) { joinHits.push({ table: j.table || '(未选择)', hit: 0, miss: out.length, invalid: true }); return; }
        const idx = new Map();
        t.rows.forEach(rr => { const k = String(rr[j.rightKey] ?? ''); if (!idx.has(k)) idx.set(k, rr); });
        let hit = 0, miss = 0;
        out = out.map(r => {
          const m = idx.get(String(r[j.leftKey] ?? ''));
          const nr = { ...r };
          if (!m) {
            miss++;
            (j.fields || []).forEach(f => { nr[f] = null; });
            nr.__unmatched = { ...(nr.__unmatched || {}), [j.id]: true };
          } else {
            hit++;
            (j.fields || []).forEach(f => { nr[f] = m[f] === undefined ? null : m[f]; });
          }
          return nr;
        });
        if (j.type === 'inner') out = out.filter(r => !(r.__unmatched && r.__unmatched[j.id]));
        joinHits.push({ table: t.name, cn: t.cn, hit, miss });
      });
      const hit = joinHits.reduce((a, x) => a + x.hit, 0);
      const slots = hit + joinHits.reduce((a, x) => a + x.miss, 0);
      return { rows: out, stat: slots ? `命中 ${hit}/${slots}` : '未配置关联', joinHits, joinHit: hit, joinSlots: slots };
    },
  },
  {
    id: 'derive', name: '列加工', icon: '⚗️',
    desc: '拆分 / 合并 / 正则提取，派生新字段',
    recommend: () => ({ rules: [
      { id: 'd1', mode: 'regex', name: 'biz_date', cn: '业务日期(YYYYMMDD)', source: 'loan_id', pattern: '^LN(\\d{8})', group: 1 },
    ] }),
    run(rows, step) {
      const rules = (step.config.rules || []).filter(r => r.name);
      let cells = 0;
      const out = rows.map(r => {
        const nr = { ...r };
        for (const rl of rules) { nr[rl.name] = deriveValue(r, rl); cells++; }
        return nr;
      });
      return { rows: out, stat: rules.length ? `派生 ${rules.length} 列 · ${cells} 格` : '未配置派生列', derived: rules.length, cells };
    },
  },
  {
    id: 'mask', name: '数据脱敏', icon: '🔒',
    desc: '对证号 / 姓名等敏感字段脱敏，支持掩码与哈希',
    recommend: () => ({ rules: [
      { field: 'reader_no',   mode: 'partial', keepLeft: 3, keepRight: 2 },
      { field: 'patron_name', mode: 'partial', keepLeft: 1, keepRight: 0 },
    ] }),
    run(rows, step) {
      const rules = (step.config.rules || []).filter(r => r.field);
      let n = 0;
      const out = rows.map(r => {
        const nr = { ...r };
        for (const rule of rules) {
          const v = nr[rule.field];
          if (v == null) continue;
          nr[rule.field] = applyMask(v, rule);
          n++;
        }
        return nr;
      });
      return { rows: out, stat: rules.length ? `脱敏 ${n} 格` : '未配置脱敏', masked: n };
    },
  },
  {
    id: 'quality', name: '质量校验', icon: '🛡️',
    desc: 'DQC 式规则 + 阈值 + 告警/阻断；失败行落 _dirty 隔离表',
    // 推荐规则：阻断类只放「清洗后必然达标」的硬约束，避免默认即阻断；
    // 真有风险的（如码值翻译后的值域）默认给告警，客户可自行升级为阻断。
    recommend: () => ({
      rules: [
        newRule('unique',   'loan_id',     { threshold: 100, action: 'block' }),
        newRule('notnull',  'loan_id',     { threshold: 100, action: 'block' }),
        newRule('notnull',  'loan_date',   { threshold: 100, action: 'warn' }),
        newRule('regex',    'loan_id',     { pattern: '^LN\\d{11}$', threshold: 100, action: 'warn' }),
        newRule('enum',     'circ_status', { values: '在借,已还', threshold: 100, action: 'continue' }),
        newRule('range',    'borrow_cnt',  { min: 0, max: 99, threshold: 100, action: 'continue' }),
      ],
      dirty: true,     // 失败行写入 <目标表>_dirty
    }),
    run(rows) {
      const failed = rows.filter(r => r.__fail && Object.keys(r.__fail).length);
      const spec = pipeline.find(s => s.id === 'quality');
      const cols = planColumns('quality');
      const results = evaluateQualityRules(rows, (spec && spec.config && spec.config.rules) || [], cols);
      const blocked = results.some(r => r.action === 'block' && !r.passed);
      const bad = results.filter(r => !r.passed);
      const blockers = bad.filter(r => r.action === 'block');
      const stat = blocked
        ? `阻断写入：${blockers.map(r => qRuleLabel(r.rule)).join('、')}`
        : bad.length ? `${bad.length} 条规则未达阈值（告警）` : `${results.length} 条规则全部达标`;
      return { rows, stat, failedCount: failed.length, ruleResults: results, blocked, dirtyCount: failed.length };
    },
  },
];

// ===== 默认流水线顺序 =====
// 结构映射 → 标准化（清理/码值/类型/日期） → 去重 → 宽表（关联/派生） → 安全（脱敏） → 校验
const DEFAULT_ORDER = ['map', 'clean', 'codemap', 'cast', 'date', 'dedup', 'join', 'derive', 'mask', 'quality'];
// 脱敏默认停用：它会改变写入 DWD 的真实值，需由客户按数据安全要求显式开启
const DEFAULT_DISABLED = ['mask'];
const pipeline = DEFAULT_ORDER.map(id => {
  const spec = STEP_SPECS.find(s => s.id === id);
  return { ...spec, enabled: !DEFAULT_DISABLED.includes(id), config: spec.recommend() };
});

// ===== 步骤辅助函数 =====
function defaultFor(type, custom) {
  if (custom !== '' && custom != null) return custom;
  if (type === 'INT' || type === 'BIGINT') return 0;
  if (type === 'DECIMAL(10,2)') return '0.00';
  return null;
}
function applyMask(v, rule) {
  const s = String(v);
  if (rule.mode === 'full') return '*'.repeat(s.length);
  if (rule.mode === 'hash') return md5(s + (rule.salt || ''));
  const l = Math.max(0, Math.min(Number(rule.keepLeft ?? 0), s.length));
  const r = Math.max(0, Math.min(Number(rule.keepRight ?? 0), s.length - l));
  return s.slice(0, l) + '*'.repeat(Math.max(0, s.length - l - r)) + (r ? s.slice(s.length - r) : '');
}
function deriveValue(row, rl) {
  if (rl.mode === 'concat') {
    const parts = (rl.sources || []).map(s => row[s] == null ? '' : String(row[s]));
    return parts.length ? parts.join(rl.sep ?? '') : null;
  }
  const v = row[rl.source];
  if (v == null) return null;
  const s = String(v);
  if (rl.mode === 'split') {
    const parts = s.split(rl.sep ?? ',');
    const i = Number(rl.index ?? 0);
    return parts[i] === undefined ? null : parts[i];
  }
  if (rl.mode === 'regex') {
    let re;
    try { re = new RegExp(rl.pattern); } catch (e) { return null; }
    const m = s.match(re);
    if (!m) return null;
    const gi = Number(rl.group ?? 1);
    return m[gi] === undefined ? null : m[gi];
  }
  return null;
}
function maskLabel(rule) {
  if (rule.mode === 'full') return '全掩码';
  if (rule.mode === 'hash') return 'MD5 哈希';
  return `保留前 ${rule.keepLeft ?? 0} 后 ${rule.keepRight ?? 0}`;
}

// =====================================================================
// 列计划：沿流水线推导「每一步之后的输出列」
//   预览表列头、生成 SQL 的投影列、质量指标的统计口径全部由这里派生，
//   保证三者永远一致（这是「配置 → 预览 → SQL」闭环的关键）。
//   planColumns()                 → 全流水线跑完的最终列
//   planColumns('join')           → 关联步骤「之前」可用的列（用于配置项候选）
//   planColumns('join', true)     → 关联步骤「之后」的列（用于该步的预览与指标）
function applyColsStep(s, cols) {
  if (s.id === 'map') {
    const renames = s.config.renames || {};
    const drop = s.config.drop || [];
    for (let i = cols.length - 1; i >= 0; i--) if (cols[i].origin === 'source' && drop.includes(cols[i].src)) cols.splice(i, 1);
    cols.forEach(c => {
      if (c.origin !== 'source') return;
      const nn = renames[c.src];
      if (nn && nn !== c.src) { c.name = nn; c.renamed = true; }
    });
  } else if (s.id === 'codemap') {
    (s.config.maps || []).forEach(m => { const c = cols.find(x => x.name === m.field); if (c) c.mapped = m; });
  } else if (s.id === 'cast') {
    Object.keys(s.config.casts || {}).forEach(f => {
      const c = cols.find(x => x.name === f);
      if (c) { c.castTo = s.config.casts[f]; c.type = s.config.casts[f]; }
    });
  } else if (s.id === 'date') {
    (s.config.cols || []).forEach(f => { const c = cols.find(x => x.name === f); if (c) c.dateNorm = true; });
  } else if (s.id === 'join') {
    (s.config.joins || []).forEach((j, i) => {
      const t = LOOKUP_TABLES[j.table];
      if (!t) return;
      (j.fields || []).forEach(fn2 => {
        const tf = t.fields.find(x => x.name === fn2);
        if (!tf) return;
        let nm = fn2;
        if (cols.some(c => c.name === nm)) nm = `${t.name.replace(/^dwd_/, '')}_${fn2}`;
        cols.push({ name: nm, cn: tf.cn, origin: 'join', joinIdx: i, table: t.name, rightField: fn2, type: tf.type });
      });
    });
  } else if (s.id === 'derive') {
    (s.config.rules || []).forEach(r => {
      if (!r.name) return;
      let nm = r.name;
      while (cols.some(c => c.name === nm)) nm = nm + '_2';
      cols.push({ name: nm, cn: r.cn || '派生列', origin: 'derive', rule: r, type: r.type || 'VARCHAR', generated: nm !== r.name });
    });
  } else if (s.id === 'mask') {
    (s.config.rules || []).forEach(r => { const c = cols.find(x => x.name === r.field); if (c) c.masked = r; });
  }
}
function planColumns(untilId, inclusive) {
  const cols = FIELDS.map(f => ({ name: f.name, cn: f.cn, src: f.name, srcType: f.srcType, type: f.srcType, origin: 'source' }));
  for (const s of pipeline) {
    const isTarget = untilId && s.id === untilId;
    if (isTarget && !inclusive) break;
    if (s.enabled) applyColsStep(s, cols);
    if (isTarget) break;
  }
  return cols;
}

// =====================================================================
// 配置引用迁移：字段被重命名后，把后续步骤里对旧名的引用同步改掉，
// 否则会出现「配置看着还在、实际已失效」的悬挂配置。
// =====================================================================
function migrateColumnRef(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const get = id => pipeline.find(s => s.id === id);
  const cast = get('cast');
  if (cast) { const c = cast.config.casts || {}; if (c[oldName] !== undefined) { c[newName] = c[oldName]; delete c[oldName]; } }
  const date = get('date');
  if (date) date.config.cols = (date.config.cols || []).map(x => x === oldName ? newName : x);
  const dedup = get('dedup');
  if (dedup) {
    dedup.config.keys = (dedup.config.keys || []).map(x => x === oldName ? newName : x);
    if (dedup.config.orderBy === oldName) dedup.config.orderBy = newName;
  }
  const cmap = get('codemap');
  if (cmap) (cmap.config.maps || []).forEach(m => { if (m.field === oldName) m.field = newName; });
  const join = get('join');
  if (join) (join.config.joins || []).forEach(j => { if (j.leftKey === oldName) j.leftKey = newName; });
  const dv = get('derive');
  if (dv) (dv.config.rules || []).forEach(r => {
    if (r.source === oldName) r.source = newName;
    if (r.sources) r.sources = r.sources.map(x => x === oldName ? newName : x);
  });
  const mask = get('mask');
  if (mask) (mask.config.rules || []).forEach(r => { if (r.field === oldName) r.field = newName; });
}

// =====================================================================
// 执行流水线：缓存每一步输出供预览回放；完整透传指标，供质量面板与顶栏使用
// =====================================================================
// 数据来源：采样模式用 12 行模板；全量模式按模板等比例放大（仍是真执行）
//   放大的唯一扰动是 loan_id（保证唯一键真实递增），其余字段原样保留，
//   因此模板里混入的每一种脏数据（¥ 前缀、'abc'、'NULL'、'/'、歧义日期、
//   大小写不一致）都按原比例出现，去重 / 失败 / 门禁的结论才可信。
// =====================================================================
function genFullRows(n) {
  const pk = activeRoles().pk;
  const shape = pkShape();
  const uniqIds = [...new Set(RAW_ROWS.map(r => r[pk]))];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = RAW_ROWS[i % RAW_ROWS.length];
    const cycle = Math.floor(i / RAW_ROWS.length);
    const r = Object.assign({}, t);
    // 同一模板 key 在「同一轮」内保持相同 → 保留模板原有的重复键分组，去重步仍有活干
    const num = String(cycle * uniqIds.length + uniqIds.indexOf(t[pk])).padStart(shape.width, '0');
    r[pk] = shape.prefix + num.slice(-shape.width);
    r.__rid = i % RAW_ROWS.length;
    r.__gen = i;
    out[i] = r;
  }
  return out;
}
let FULL_CACHE = null;
function sourceRows() {
  if (RUNMODE === 'full' && FULL_CACHE) return FULL_CACHE.map(r => ({ ...r }));
  return RAW_ROWS.map(r => ({ ...r }));
}

// =====================================================================
let stepOutputs = [];
let GATE = { enabled: false, blocked: false, results: [], bad: [] };   // 质量门禁的最终判定（顶栏 / 预览 / SQL 共用）
// 单步执行：供「即时重算」与「全量试跑（分步进度）」共用同一套语义
function runStep(step, rows) {
  if (!step.enabled) return { step, rows: null, stat: '已停用', skipped: true, meta: null };
  try {
    const res = step.run(rows, step);
    return { step, rows: res.rows, stat: res.stat, removed: res.removed || 0, failedCount: res.failedCount || 0, skipped: false, meta: res };
  } catch (e) {
    return { step, rows: null, stat: '执行失败', skipped: true, error: e.message, meta: null };
  }
}
// 质量门禁：只要有一条 block 级规则未达阈值，就判定「阻断写入」
function refreshGate() {
  const qOut = stepOutputs.find(o => o.step.id === 'quality' && !o.skipped);
  const results = (qOut && qOut.meta && qOut.meta.ruleResults) || [];
  GATE = {
    enabled: !!(qOut && qOut.meta),
    results,
    bad: results.filter(r => !r.passed),
    blocked: !!(qOut && qOut.meta && qOut.meta.blocked),
  };
}
function executePipeline() {
  stepOutputs = [];
  let rows = sourceRows();
  for (const step of pipeline) {
    const e = runStep(step, rows);
    stepOutputs.push(e);
    if (!e.skipped && !e.error) rows = e.rows;
  }
  refreshGate();
  const broken = stepOutputs.find(o => o.error);
  if (broken) warn(`${broken.step.name} 执行失败：${broken.error}`, 'error');
}
function lastEnabledIndex() { return stepOutputs.reduce((acc, o, i) => (o.skipped ? acc : i), 0); }
function outputOf(stepId) {
  const idx = stepOutputs.findIndex(o => o.step.id === stepId);
  if (idx < 0) return null;
  for (let i = idx; i >= 0; i--) if (!stepOutputs[i].skipped) return stepOutputs[i];
  return null;
}
function lastOutput() {
  for (let i = stepOutputs.length - 1; i >= 0; i--) if (!stepOutputs[i].skipped) return stepOutputs[i];
  return null;
}
function lastStepId() { return pipeline.filter(s => s.enabled).pop()?.id || '__raw__'; }

// =====================================================================
// 智能探测：对原始采样做真实的格式统计
//   返回 { perField, stats } —— 界面上的每一个数字都由此计算，禁止写死
// =====================================================================
// ⚠ 探测逻辑要能被「多表字段对照」复用（要探测**别的**表），所以抽成参数化内核。
//   曾经考虑「临时换绑 FIELDS/RAW_ROWS 再还原」，但换绑一旦漏还原（异常路径尤甚），
//   预览、质量指标、SQL 会一起静默指向错表 —— 所以内核只吃参数，永不碰全局现场。
function probeCore(fields, rows, roles) {
  const perField = {};
  const add = (f, label, kind) => {
    perField[f] = perField[f] || {};
    perField[f][label] = perField[f][label] || { count: 0, kind };
    perField[f][label].count++;
  };
  const toks = String(pipeline.find(s => s.id === 'clean')?.config.nullTokens || NULL_TOKENS_DEFAULT)
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const dateInfo = {};
  // 按语义角色探测：换源表后同样是真统计，不是写死的字段名
  roles = roles || {};
  const dateFields = roles.dates || [];
  const numFields = roles.numerics || [];

  rows.forEach(r => {
    fields.forEach(f => {
      const raw = r[f.name];
      const s = raw == null ? null : String(raw);
      if (dateFields.includes(f.name)) {
        const t = (s || '').trim();
        if (t === '' || toks.includes(t.toUpperCase())) {
          add(f.name, '空值占位', 'null');
          return;
        }
        const c = classifyDate(t);
        add(f.name, c.label + (c.ambiguous ? '（歧义）' : ''), 'date');
        if (c.ambiguous) {
          dateInfo.ambiguous = dateInfo.ambiguous || [];
          if (!dateInfo.ambiguous.includes(t)) dateInfo.ambiguous.push(t);
          dateInfo.ambiguousFields = dateInfo.ambiguousFields || [];
          if (!dateInfo.ambiguousFields.includes(f.name)) dateInfo.ambiguousFields.push(f.name);
        }
        dateInfo[c.key] = dateInfo[c.key] || { label: c.label, count: 0 };
        dateInfo[c.key].count++;
        return;
      }
      if (f.name === roles.readerKey && s && /^\s|\s$/.test(s)) add(f.name, '前后空格', 'text');
      if (numFields.includes(f.name)) {
        if (s && /[¥,元]/.test(s)) add(f.name, '货币符号/千分位', 'num');
        const t = (s || '').trim();
        if (t !== '' && !/^-?\d+(\.\d+)?$/.test(t)) add(f.name, /[a-zA-Z]/.test(t) ? '字母混入' : '非数字字符', 'num');
      }
    });
  });

  // 主键重复（roles 没给主键时不做这项，避免把「没有主键概念的表」整列算成一组重复键）
  const dup = {};
  if (roles.pk) {
    rows.forEach(r => { const k = r[roles.pk]; dup[k] = (dup[k] || 0) + 1; });
  }
  const dupGroups = Object.entries(dup).filter(([, n]) => n > 1).map(([k, n]) => ({ key: k, n }));
  if (dupGroups.length) add(roles.pk, `${dupGroups.length} 组重复键`, 'dup');

  // 轻量枚举画像：短码值字段里同一码值出现不同大小写（下游码值映射最容易踩的坑）
  fields.forEach(f => {
    if (!/(status|type|flag|code)$/i.test(f.name) && f.name !== roles.status) return;
    const groups = {};
    rows.forEach(r => {
      const v = (r[f.name] == null ? '' : String(r[f.name])).trim();
      if (!v || v.length > 4) return;
      const k = v.toUpperCase();
      (groups[k] = groups[k] || new Set()).add(v);
    });
    if (Object.values(groups).some(set => set.size > 1)) add(f.name, '大小写不一致', 'enum');
  });

  // 汇总（实时）
  let formatCells = 0, dupCells = 0, nullCells = 0;
  const formatLabels = new Set();
  Object.values(perField).forEach(m => Object.entries(m).forEach(([label, o]) => {
    if (o.kind === 'dup') { dupCells += 1; return; }
    if (o.kind === 'null') { nullCells += o.count; return; }
    formatCells += o.count;
    formatLabels.add(label);
  }));

  return { perField, dupGroups, dateInfo, stats: { formatCells, formatTypes: formatLabels.size, dupGroups: dupGroups.length, dupKeys: dupGroups.length, nullCells, scanned: rows.length, fields: fields.length } };
}
// 当前编辑表的探测（唯一入口，界面上的数字都从这里来）
function probeFields() { return probeCore(FIELDS, RAW_ROWS, activeRoles()); }

// =====================================================================
// 质量度量：全部实时计算（含质量分的加权扣分明细，可解释）
//
// 【质量分必须与数据规模无关】早期版本用绝对条数扣分
//   （100 − 失败格×3 − 重复行×5 − 主键空值×8 − 源字段空值×0.5），
//   在 12 行采样上给出 97 分、在 20,000 行全量上直接归零 —— 同一个任务、
//   同一份脏数据比例，得分却随行数崩塌，指标失去意义（无法设阈值、无法跨批次比对）。
//   现改为「比率 × 权重」的加权合格率，权重合计 100，得分天然落在 [0,100]，
//   采样与全量口径可比：同一份数据换成 1 万倍行数，得分基本不变。
//     质量分 = 100 − Σ(问题比率 × 权重)
//       · 转换 / 解析失败单元格  比率 = 失败格 / 产出总单元格  权重 50
//       · 主键空值              比率 = 主键空格 / 源单元格    权重 30
//       · 未消除的重复行        比率 = 重复行 / 产出行数      权重 15
//       · 源字段空值            比率 = 源空格 / 源单元格      权重 5
//   展示层仍显示绝对条数（人看的是「几格、几行」），但扣分看比率（机算的是比例）。
//
//   不传 stepId 时按「整条流水线的最终产出」计算（顶栏门禁与质量校验面板用）；
//   传入 stepId 时按「回放到该步的输出」计算（预览区质量条用），口径与预览表一致。
// =====================================================================
const QUALITY_W = { fail: 50, key: 30, dup: 15, nul: 5 }; // 合计 100，得分即「加权质量合格率」
function computeQuality(stepId) {
  const scoped = !!stepId;
  const rows = scoped ? ((outputOf(stepId)?.rows) || []) : ((lastOutput()?.rows) || []);
  const cols = scoped ? planColumns(stepId, true) : planColumns();
  const srcCols = cols.filter(c => c.origin === 'source');
  const limitIdx = scoped ? stepOutputs.findIndex(o => o.step.id === stepId) : stepOutputs.length - 1;

  // 去重键只在「已执行过去重步骤」的回放点才有意义
  const dedupIdx = stepOutputs.findIndex(o => o.step.id === 'dedup');
  const dedup = pipeline.find(s => s.id === 'dedup');
  const keys = (dedup && dedup.enabled && dedupIdx >= 0 && dedupIdx <= limitIdx)
    ? (dedup.config.keys || []).filter(Boolean) : [];

  let failedCells = 0, nullCells = 0, keyNulls = 0, derivedNulls = 0;
  for (const r of rows) {
    failedCells += Object.keys(r.__fail || {}).length;
    for (const c of srcCols) {
      const v = r[c.name];
      if (v == null || v === '') { keys.includes(c.name) ? keyNulls++ : nullCells++; }
    }
    for (const c of cols) if (c.origin !== 'source' && r[c.name] == null) derivedNulls++;
  }
  const keyVals = rows.map(r => keys.map(k => String(r[k] ?? '∅')).join('§'));
  const dups = keys.length ? rows.length - new Set(keyVals).size : 0;
  const totalCells = rows.length * cols.length;
  const srcCells = rows.length * srcCols.length;

  // ---- 比率（与规模无关） ----
  const failRate = totalCells ? failedCells / totalCells : 0;
  const keyRate = srcCells ? keyNulls / srcCells : 0;
  const dupRate = rows.length ? dups / rows.length : 0;
  const nullRate = srcCells ? nullCells / srcCells : 0;
  const penalty = failRate * QUALITY_W.fail + keyRate * QUALITY_W.key
    + dupRate * QUALITY_W.dup + nullRate * QUALITY_W.nul;
  const score = Math.max(0, Math.round(100 - penalty));

  // 关联命中率只统计「回放点已经过」的关联
  const joinIdx = stepOutputs.findIndex(o => o.step.id === 'join');
  const jo = (joinIdx >= 0 && joinIdx <= limitIdx) ? stepOutputs[joinIdx] : null;
  const joinHits = (jo && jo.meta && jo.meta.joinHits) || [];
  const joinHit = joinHits.reduce((a, x) => a + x.hit, 0);
  const joinSlots = joinHit + joinHits.reduce((a, x) => a + x.miss, 0);

  // n = 绝对条数（展示给人看）；rate = 比率；w = 权重；pts = 实际扣分
  const deductions = [
    { label: '转换 / 解析失败单元格', n: failedCells, rate: failRate, w: QUALITY_W.fail },
    { label: '主键空值', n: keyNulls, rate: keyRate, w: QUALITY_W.key },
    { label: '未消除的重复行', n: dups, rate: dupRate, w: QUALITY_W.dup },
    { label: '源字段空值', n: nullCells, rate: nullRate, w: QUALITY_W.nul },
  ].map(d => ({ ...d, pts: d.rate * d.w }));

  const pct = (r) => (r * 100).toFixed(r >= 0.1 ? 0 : 2) + '%';
  const scoreTip = `质量分 = 100 − Σ(问题比率 × 权重)（权重合计 100，与数据规模无关）\n`
    + deductions.map(d => `  ${d.label}：${pct(d.rate)} × ${d.w} = −${d.pts.toFixed(2)}（${d.n} 条 / 占比 ${pct(d.rate)}）`).join('\n')
    + `\n  = ${score} 分　（样本 ${rows.length} 行 × ${cols.length} 列）`;

  return {
    rowCount: rows.length, cols, srcCols, srcCells, totalCells,
    failedCells, nullCells, keyNulls, derivedNulls, dups, keys,
    failRate, keyRate, dupRate, nullRate, penalty,
    nonNullRate: srcCells ? (srcCells - nullCells - keyNulls) / srcCells : 1,
    joinHit, joinSlots, joinHits, joinRate: joinSlots ? joinHit / joinSlots : null,
    score, deductions, scoreTip,
  };
}

// =====================================================================
// 交互状态
// =====================================================================
let selectedStepId = 'date';
let previewStepId = 'date';
let activeTab = 'cfg';
let lastChangedCells = 0;

// 字段问题的处理步骤映射：点击左栏字段可直接跳到对应规则
// 按语义角色判定，换源表后依然指向正确的处理步骤
function fieldTargetStep(fieldName) {
  const r = activeRoles();
  if ((r.dates || []).includes(fieldName)) return 'date';
  if ((r.numerics || []).includes(fieldName)) return 'cast';
  if (r.status && fieldName === r.status) return 'codemap';
  if (fieldName === r.pk) return 'dedup';
  if (fieldName === r.readerKey) return 'clean';
  if (fieldName === r.syncTime) return 'dedup';
  return 'clean';
}

// ===== 渲染：左侧字段列表（可点击直达处理步骤）=====
// 左栏面板标题固定为"当前编辑表的字段与智能探测"——方案 B 后不再有多表对照视图。
function setFieldHead() {
  const h = document.getElementById('field-head');
  if (!h) return;
  h.textContent = '🔍 当前编辑表的字段与智能探测（单击字段直达处理步骤）';
}
// ⚠ 方案 B 改造：以下多表对照相关函数已删除（batchNames / shortSourceName / renderFieldCompare / jumpFromCompare）。
//   多表批处理（含字段对照共用规则判定）的入口在顶栏「🗂 多表批处理」按钮弹窗里。

function renderFields() {
  setFieldHead();
  const probe = probeFields();
  const el = document.getElementById('field-list');
  el.innerHTML = FIELDS.map(f => {
    const it = probe.perField[f.name] || {};
    const chips = Object.keys(it).map(k => {
      const kind = it[k].kind;
      const cls = kind === 'date' ? 'issue-chip--date' : kind === 'dup' ? 'issue-chip--dup'
        : kind === 'null' ? 'issue-chip--null' : kind === 'enum' ? 'issue-chip--enum' : 'issue-chip--num';
      return `<span class="issue-chip ${cls}">${esc(k)}</span>`;
    }).join('');
    const target = fieldTargetStep(f.name);
    const tname = pipeline.find(s => s.id === target)?.name || '';
    return `<div class="field-item" onclick="jumpToFieldStep('${f.name}')" title="点击跳到处理该字段的步骤：${esc(tname)}">
      <div><div class="field-item__name">${esc(f.name)}</div><div class="field-item__type">${esc(f.srcType)} · ${esc(f.cn)}</div></div>
      <div class="field-item__issues">${chips}${chips ? '' : '<span class="issue-chip issue-chip--ok">无异常</span>'}<span class="field-item__go">›</span></div>
    </div>`;
  }).join('');

  const s = probe.stats;
  document.getElementById('probe-summary').innerHTML =
    `🤖 智能探测：扫描 <b>${s.scanned} 行 × ${s.fields} 字段</b>，发现 <b>${s.formatCells} 处格式问题（${s.formatTypes} 类）、` +
    `${s.dupGroups} 组重复键、${s.nullCells} 处空值占位</b>；已按下方流水线自动匹配清洗规则，单击字段可直达对应步骤。`;
}

// 对照视图里点字段：先切到「拥有该字段的第一张表」，再跳到处理它的步骤。
// ⚠ 不能直接 jumpToFieldStep —— 那个按 ACTIVE_SRC 的语义角色判步骤，
//   若当前编辑表压根没有这个字段，会静默落到「字段清理」这个兜底步骤上。
function jumpFromCompare(fieldName) {
  // ⚠ 方案 B 改造：对照视图已删除，此函数保留为兜底（无调用方时不会被触发）。
  const owner = batchNames().find(n => (SOURCES[n].fields || []).some(f => f.name === fieldName));
  if (!owner) { DF.app.toast(`所选表里没有字段 ${fieldName}`, 'warning', 1600); return; }
  if (owner !== ACTIVE_SRC) switchSource(owner);
  jumpToFieldStep(fieldName);
}

function jumpToFieldStep(fieldName) {
  const target = fieldTargetStep(fieldName);
  const step = pipeline.find(s => s.id === target);
  if (!step) return;
  if (!step.enabled) { selectStep(target); warn(`${step.name} 当前已停用，已为你打开配置面板`); return; }
  selectStep(target);
  DF.app.toast(`已定位到「${step.name}」——${fieldName} 的规则在这里配置`, 'info', 1800);
}

// ===== 渲染：流水线节点 =====
//   两种布局：'v' 纵向步骤条（默认，根治 10 步拥挤）/ 'h' 横向可换行视图
//   两者共用同一份 DOM 结构与同一套状态，切换只是换 CSS 与是否可拖拽。
function renderPipeline() {
  const el = document.getElementById('pipeline');
  const idxMap = {};
  let n = 0;
  pipeline.forEach(s => { if (s.enabled) idxMap[s.id] = ++n; });
  const vMode = LAYOUT === 'v';
  const node = (s, i) => {
    const out = stepOutputs.find(o => o.step.id === s.id);
    const stat = (out && !out.skipped) ? out.stat : (out && out.error ? '执行失败' : '已停用');
    const statCls = (!out || out.skipped) ? 'step-node__stat step-node__stat--none' : 'step-node__stat';
    const custom = !eqConfig(s.config, s.recommend());
    const drag = vMode
      ? `draggable="true" ondragstart="onStepDragStart(event,'${s.id}')" ondragover="onStepDragOver(event)" ondragleave="onStepDragLeave(event)" ondrop="onStepDrop(event,'${s.id}')" ondragend="onStepDragEnd(event)"`
      : '';
    const grip = vMode ? `<span class="step-node__grip" title="按住拖拽调整执行顺序">⠿</span>` : '';
    const ord = vMode ? `<span class="step-node__ord">
        <button class="ord-btn" onclick="event.stopPropagation(); moveStep('${s.id}','up')" title="上移一步">▲</button>
        <button class="ord-btn" onclick="event.stopPropagation(); moveStep('${s.id}','down')" title="下移一步">▼</button>
      </span>` : '';
    return `<div class="step-node ${s.id === selectedStepId ? 'step-node--active' : ''} ${s.enabled ? '' : 'step-node--off'}" data-step="${s.id}" onclick="selectStep('${s.id}')" title="${esc(s.desc)}${vMode ? '（︸ 可拖拽调整顺序）' : ''}" ${drag}>
      ${grip}
      ${custom ? '<span class="step-node__dot" title="已自定义（与智能推荐不同）"></span>' : ''}
      <button class="step-node__toggle" onclick="event.stopPropagation(); toggleStep('${s.id}')" title="${s.enabled ? '停用此步' : '启用此步'}">${s.enabled ? '✕' : '○'}</button>
      <div class="step-node__main">
        <div class="step-node__idx">STEP ${s.enabled ? String(idxMap[s.id]).padStart(2, '0') : '--'}</div>
        <div class="step-node__name">${s.icon} ${esc(s.name)}</div>
        <span class="${statCls}">${esc(stat)}</span>${(s.id === 'date' && s.enabled && daPending()) ? '<span class="step-node__alert" title="日期存在「日月均可解释」的歧义格式，尚未人工确认口径">待确认</span>' : ''}
      </div>
      ${ord}
    </div>`;
  };
  const srcLabel = RUNMODE === 'full' ? FULL_N.toLocaleString() + ' 行全量' : RAW_ROWS.length + ' 行采样';
  const src = `<div class="step-node step-node--src" title="ODS 原始层：客户业务系统原样同步，未做任何清洗
当前源表：${esc(activeSource().name)}">
    <div class="step-node__main">
      <div class="step-node__idx">SOURCE · ODS</div>
      <div class="step-node__name">📥 原始数据层</div>
      <span class="step-node__stat step-node__stat--none">${srcLabel}</span>
    </div>
  </div>`;
  const dst = `<div class="step-node step-node--dst" title="DWD 明细层：ODS 清洗规范化后的明细 / 宽表写入此层
目标表：${esc(TASK.targetTable)}">
    <div class="step-node__main">
      <div class="step-node__idx">TARGET · DWD</div>
      <div class="step-node__name">📤 明细层</div>
      <span class="step-node__stat${GATE.blocked ? ' step-node__stat--block' : ''}">${GATE.blocked ? '⛔ 已阻断写入' : ((lastOutput()?.rows) || []).length + ' 行产出'}</span>
    </div>
  </div>`;
  const parts = [src];
  pipeline.forEach((s, i) => { parts.push('<div class="step-arrow">→</div>'); parts.push(node(s, i)); });
  parts.push('<div class="step-arrow">→</div>');
  parts.push(dst);
  el.innerHTML = parts.join('');
  document.getElementById('pl-count').textContent = pipeline.filter(s => s.enabled).length;

  // 顶栏质量校验态：由真实校验结果 + 质量门禁判定驱动，不再写死
  const q = pipeline.find(s => s.id === 'quality');
  const boot = document.getElementById('pl-check');
  const modeTag = RUNMODE === 'full' ? `全量 ${FULL_N.toLocaleString()} 行` : `采样 ${RAW_ROWS.length} 行`;
  if (!q.enabled) {
    boot.textContent = '○ 质量校验已停用（无质量门禁，任何数据都会写入）';
    boot.style.color = 'var(--neutral-400)';
  } else if (GATE.blocked) {
    boot.textContent = `⛔ 质量门禁未通过 · 已阻断写入（${GATE.bad.filter(r => r.action === 'block').map(r => qRuleLabel(r.rule)).join('、')}）`;
    boot.style.color = 'var(--danger-700)';
  } else {
    const m = computeQuality();
    // 汇总「所有需要人工知道的问题」：门禁未达阈值 + 脏数据残留。
    // 不能因为门禁有告警就吞掉失败格/重复行的信息 —— 顶栏是唯一常驻摘要位。
    const bits = [];
    if (GATE.bad.length) bits.push(`${GATE.bad.length} 条规则未达阈值`);
    if (m.failedCells) bits.push(`${m.failedCells} 处转换/解析失败`);
    if (m.dups) bits.push(`${m.dups} 行重复未消除`);
    if (m.keyNulls) bits.push(`${m.keyNulls} 个主键空值`);
    if (!bits.length) {
      boot.textContent = `✓ ${modeTag}：${GATE.results.length} 条门禁规则全部达标（质量分 ${m.score}）`;
      boot.style.color = 'var(--success-700)';
    } else {
      const tail = GATE.bad.length ? '、告警不阻断' : '';
      boot.textContent = `⚠ ${modeTag}：${bits.join(' · ')}${tail} · 质量分 ${m.score}（${100 - m.score > 0 ? '扣 ' + (100 - m.score) + ' 分' : '满分'}）`;
      boot.style.color = 'var(--warning-700)';
    }
  }
}

// ===== 渲染：预览表（回放到 previewStepId）+ 质量条 =====
// 列头与质量条都按「回放到的这一步」计算，与表格内容同口径，不混用全链路指标。
function renderPreview() {
  const isRaw = previewStepId === '__raw__';
  const out = isRaw ? null : outputOf(previewStepId);
  const rows = (out?.rows) || RAW_ROWS;
  const cols = isRaw
    ? FIELDS.map(f => ({ name: f.name, cn: f.cn, src: f.name, origin: 'source' }))
    : planColumns(previewStepId, true);
  const onlyChanged = document.getElementById('only-changed').checked;
  const stepName = isRaw ? '原始采样（ODS 原始层）' : (pipeline.find(s => s.id === previewStepId)?.name || '');
  const isLast = !isRaw && previewStepId === lastStepId();

  document.getElementById('preview-scope').textContent = isRaw ? stepName : '回放至 · ' + stepName;
  const removed = out?.removed || 0;
  const capNote = rows.length > PREVIEW_CAP ? ` · 表格仅渲染前 ${PREVIEW_CAP} 行，指标统计全量` : '';
  document.getElementById('row-count').textContent = RUNMODE === 'full'
    ? `${rows.length.toLocaleString()} 行（全量试跑，源表 ${FULL_N.toLocaleString()} 行${removed ? ` · 本步减少 ${removed.toLocaleString()} 行` : ''}${capNote}）`
    : `${rows.length} 行（源表采样 ${RAW_ROWS.length} 行${removed ? ` · 本步减少 ${removed} 行` : ''}）`;
  const shown = rows.length > PREVIEW_CAP ? rows.slice(0, PREVIEW_CAP) : rows;

  let changedCells = 0;
  let rendered = 0;
  let html = '<thead><tr>' + cols.map(c =>
    `<th>${esc(c.cn)}<small>${esc(c.name)}${c.renamed ? ' ⟵ ' + esc(c.src) : ''}${c.origin === 'join' ? ' · 关联' : c.origin === 'derive' ? ' · 派生' : ''}</small></th>`
  ).join('') + '</tr></thead><tbody>';

  for (const r of shown) {
    const orig = RAW_ROWS[r.__rid];
    let rowChanged = false;
    const tds = cols.map(c => {
      const v = r[c.name];
      if (c.origin !== 'source') {
        return `<td class="${v == null ? 'is-null' : 'is-newcol'}">${v == null ? 'NULL' : esc(v)}</td>`;
      }
      const ov = orig ? orig[c.src] : undefined;
      const changed = orig !== undefined && String(v ?? '∅') !== String(ov ?? '∅');
      if (changed) { changedCells++; rowChanged = true; }
      const cls = changed ? (isRaw ? 'is-changed' : 'is-newval') : (v == null ? 'is-null' : '');
      const tip = changed ? ` title="原始值: ${esc(ov)}"` : '';
      return `<td class="${cls}"${tip}>${v == null ? 'NULL' : esc(v)}</td>`;
    }).join('');
    if (onlyChanged && !rowChanged) continue;
    html += `<tr>${tds}</tr>`;
    rendered++;
  }
  // 勾了「仅看发生变化的单元格」却一行不剩是很正常的情况（比如「字段映射」只改列名、
  // 不改单元格值）。直接给张空表会让人以为页面坏了，所以补一句解释。
  if (onlyChanged && rendered === 0) {
    html = `<tr><td colspan="${cols.length}" style="padding:14px 12px;font-size:12px;line-height:1.8;color:var(--neutral-600);text-align:left;">
      这一步共 ${rows.length} 行，但<b>没有任何单元格的取值发生变化</b>（例如「字段映射」只改列名、不改值），因此没有可显示的行。<br>
      取消勾选「仅看发生变化的单元格」即可看到该步的完整产出。
    </td></tr>`;
  }
  html += '</tbody>';
  document.getElementById('preview-table').innerHTML = html;
  lastChangedCells = changedCells;

  // 质量条（口径 = 回放到的这一步）
  const m = isRaw ? null : computeQuality(previewStepId);
  const scoreColor = m ? (m.score >= 95 ? 'var(--success-700)' : m.score >= 85 ? 'var(--warning-700)' : 'var(--danger-700)') : '';
  const gateChip = isRaw ? '' : (GATE.blocked
    ? `<span class="q-item q-item--block">⛔ 门禁阻断写入</span>`
    : GATE.bad.length ? `<span class="q-item q-item--warn">⚠ ${GATE.bad.length} 条规则告警</span>`
    : GATE.enabled ? `<span class="q-item q-item--ok">✓ ${GATE.results.length} 条门禁达标</span>` : '');
  document.getElementById('quality-strip').innerHTML = `
    <span class="q-item">${isLast || isRaw ? '产出行数' : '本步产出'} <b>${rows.length.toLocaleString()}</b>${rows.length < RAW_ROWS.length ? ` <span class="up">▼${RAW_ROWS.length - rows.length}</span>` : ''}</span>
    <span class="q-item">标准化修改 <b>${changedCells.toLocaleString()}</b> 格</span>
    ${m ? `
      <span class="q-item">转换失败 <b style="color:${m.failedCells ? 'var(--warning-700)' : 'var(--neutral-800)'};">${m.failedCells}</b> 格</span>
      ${m.joinSlots ? `<span class="q-item">关联命中 <b>${m.joinHit}/${m.joinSlots}</b></span>` : ''}
      <span class="q-item">源字段空值 <b>${m.nullCells + m.keyNulls}</b></span>
      <span class="q-item" title="${esc(m.scoreTip).replace(/\n/g, '&#10;')}">质量分 <b style="color:${scoreColor};">${m.score}</b></span>`
      : `<span class="q-item">字段数 <b>${cols.length}</b></span>`}
    ${gateChip}
    <span class="q-item" style="margin-left:auto;">
      <span class="badge-sample" onclick="openSampleInfo()" title="点开查看采样口径与全量试跑说明" style="cursor:pointer;">
        ${RUNMODE === 'full' ? `⚡ 全量试跑 · 载入 ${FULL_N.toLocaleString()} 行` : `采样 ${RAW_ROWS.length} 行 · 不代表全量`} <span style="opacity:.6;">ⓘ</span>
      </span>
    </span>`;
}

// =====================================================================
// 渲染：右侧规则配置面板（每个步骤的配置项都真实生效）
// =====================================================================
function sel(handler, options, cur, style) {
  return `<select onchange="${handler}"${style ? ` style="${style}"` : ''}>` +
    options.map(o => {
      const v = typeof o === 'string' ? o : o.v;
      const t = typeof o === 'string' ? o : o.t;
      return `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`;
    }).join('') + '</select>';
}
function colPick(stepId, filter) {
  let list = planColumns(stepId);
  if (filter) list = list.filter(filter);
  return list.map(c => ({ v: c.name, t: `${c.name} · ${c.cn}` }));
}

const TYPES = ['INT', 'BIGINT', 'DECIMAL(10,2)', 'DATE'];

function renderConfig() {
  const el = document.getElementById('cfg-body');
  if (activeTab === 'sql') {
    const d = D();
    const opts = Object.values(DIALECTS).map(x => `<option value="${x.key}" ${x.key === DIALECT ? 'selected' : ''}>${x.name} ${x.ver}</option>`).join('');
    el.innerHTML = `
      <div class="sql-bar">
        <span class="sql-bar__label">目标方言</span>
        <select class="cfg-input cfg-input--sm" style="flex:0 0 132px;" onchange="setDialect(this.value)">${opts}</select>
        <span class="sql-bar__spacer"></span>
        <button class="btn btn--sm" onclick="copySql()">⧉ 复制</button>
        <button class="btn btn--sm" onclick="downloadSql()">⤓ 下载 .sql</button>
      </div>
      <div class="sql-bar__note">${esc(d.name)} ${esc(d.ver)}：${esc(d.note)}</div>
      <div class="sql-view" id="sql-view">${genSQL()}</div>`;
    return;
  }
  const step = pipeline.find(s => s.id === selectedStepId);
  // ⚠ 选中项可能是「原始数据层」(__raw__) 或某个已不在流水线里的步骤。
  //   这里必须兜底：直接解引用 step.id 会抛 TypeError，右栏整块变空白（不报错式的面板失效）。
  if (!step) {
    el.innerHTML = `<div style="padding:18px 16px;font-size:12.5px;line-height:1.9;color:var(--neutral-600);">
      当前停留位置不在流水线的某一步上（可能是「原始数据层」未清洗视图）。<br>
      点击中间流水线上的任一步骤节点，即可在此查看并配置该步规则。
    </div>`;
    return;
  }
  const out = stepOutputs.find(o => o.step.id === step.id);
  let body = '';

  if (step.id === 'map') {
    const renames = step.config.renames || {};
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">🔗 字段命名（源字段 → DWD 规范字段名，可逐个改）</div>
      ${FIELDS.map(f => {
        const cur = renames[f.name] || f.name;
        const dropped = (step.config.drop || []).includes(f.name);
        return `<div class="cfg-row${dropped ? ' cfg-row--warn' : cur !== f.name ? ' cfg-row--ok' : ''}">
          <span class="cfg-row__name" style="flex:0 0 118px;">${esc(f.name)}<br><span class="cfg-row__from">${esc(f.cn)}</span></span>
          <span class="cfg-row__arrow">→</span>
          <input class="cfg-input" value="${esc(cur)}" ${dropped ? 'disabled' : ''} onchange="setRename('${f.name}', this.value)">
          <label class="chk" title="不写入 DWD"><input type="checkbox" ${dropped ? 'checked' : ''} onchange="toggleDrop('${f.name}', this.checked)">排除</label>
        </div>`;
      }).join('')}
      <div class="cfg-note">允许的小写字母 / 数字 / 下划线，不能以数字开头；重名会被拒绝。重命名后，后续步骤里对该字段的引用会自动跟着改，不会出现失效配置。已重命名 <b>${Object.keys(renames).filter(k => renames[k] !== k).length}</b> 个。</div>
    </div>`;
  } else if (step.id === 'clean') {
    const c = step.config;
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">🧹 清理规则（作用于全部 ${FIELDS.length} 个字段，仅字符串生效）</div>
      <label class="radio-line"><input type="checkbox" value="trim" ${c.trim !== false ? 'checked' : ''} onchange="setCleanOpt('trim', this.checked)"> 去除前后空格 / 制表符（TRIM）</label>
      <label class="radio-line"><input type="checkbox" value="nullNormalize" ${c.nullNormalize === true ? 'checked' : ''} onchange="setCleanOpt('nullNormalize', this.checked)"> 空值占位符归一为 NULL</label>
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">视为空值的占位符（逗号分隔，大小写不敏感）</div>
      <div class="cfg-row"><input class="cfg-input" value="${esc(c.nullTokens || '')}" onchange="setNullTokens(this.value)" ${c.nullNormalize === true ? '' : 'disabled'}></div>
      <div class="cfg-note">源系统里常见用 <code>/</code>、<code>NULL</code>、<code>-</code> 等字符表示空值。未归一为 NULL 时，这些字符会被当成真实值参与后续转换与统计。</div>
    </div>`;
  } else if (step.id === 'codemap') {
    const maps = step.config.maps || [];
    const srcCols = colPick('codemap', c2 => c2.origin === 'source');
    const usedFields = maps.map(m => m && m.field).filter(Boolean);
    const freeCols = srcCols.filter(o => !usedFields.includes(o.v));
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">🏷️ 码值映射（枚举 → 业务可读值）</div>
      ${maps.map((m, i) => {
        /* ⚠ 字段下拉**排除已被其它块占用的字段** —— 一个字段只生效第一组映射。
           以前不排重：用户能给同一字段配两组，而预览会链式叠加、生成的 SQL 只取第一条
           （genSQL 里是 find()），两者静默不一致，连下游 enum 门禁都给出相反结论。
           `o.v === m.field` 保留自己当前值，否则一旦成为重复项就再也改不掉。 */
        const takenByOthers = maps.filter((x, j) => j !== i && x && x.field).map(x => x.field);
        const opts = [{ v: '', t: '— 请选择字段 —' }]
          .concat(srcCols.filter(o => o.v === m.field || !takenByOthers.includes(o.v)));
        const dup = isRedundantMap(step.config, i);
        const firstIdx = dup ? maps.findIndex(x => x && x.field === m.field) : -1;
        const eff = !dup && !!m.field;
        return `
        <div class="cfg-row" style="flex-direction:column;align-items:stretch;gap:7px;padding:10px;${dup ? 'background:var(--danger-50);border-color:var(--danger-100);' : (m.others === 'keep' ? '' : 'background:var(--warning-50);border-color:var(--warning-100);')}">
          ${dup ? `<div style="font-size:11px;color:var(--danger-700);line-height:1.7;">
            字段 <b>${esc(m.field)}</b> 已由第 ${firstIdx + 1} 组配置 —— <b>一个字段只生效第一组</b>，
            本块的码值对照不会进入预览，也不会进入生成的 SQL。
          </div>
          <button class="cfg-add" style="align-self:flex-start;background:var(--danger-50);border-color:var(--danger-100);color:var(--danger-700);" onclick="mergeRedundantMap(${i})">并入第 ${firstIdx + 1} 组（补上缺的对照后删掉本块）</button>` : ''}
          <div style="display:flex;gap:6px;align-items:center;">
            <span style="font-size:11px;color:var(--neutral-500);">字段</span>
            ${sel(`setMapField(${i}, this.value)`, opts, m.field, 'flex:1;')}
            ${eff ? '<span class="tag tag--success" style="white-space:nowrap;">生效中</span>' : ''}
            <button class="cfg-del" onclick="removeMap(${i})" title="删除该映射">✕</button>
          </div>
          ${(m.pairs || []).map((p, k) => `
            <div style="display:flex;gap:6px;align-items:center;">
              <input class="cfg-input" value="${esc(p.from)}" onchange="setMapPair(${i},${k},'from',this.value)" placeholder="源值">
              <span class="cfg-row__arrow">→</span>
              <input class="cfg-input" value="${esc(p.to)}" onchange="setMapPair(${i},${k},'to',this.value)" placeholder="业务值">
              <button class="cfg-del" onclick="removeMapPair(${i},${k})">✕</button>
            </div>`).join('')}
          <button class="cfg-add" onclick="addMapPair(${i})">＋ 添加码值对照</button>
          <div style="font-size:11px;color:var(--neutral-500);margin-top:2px;">未匹配到的值：</div>
          ${[['keep', '保留原值'], ['null', '置为 NULL'], ['default', '填默认值']].map(([v, t]) =>
            `<label class="radio-line"><input type="radio" name="others${i}" value="${v}" ${(m.others || 'keep') === v ? 'checked' : ''} onchange="setMapOthers(${i},'${v}')"> ${t}</label>`).join('')}
          ${(m.others === 'default') ? `<input class="cfg-input" value="${esc(m.defaultValue || '未知')}" onchange="setMapOthers(${i},'default',this.value)" placeholder="默认值">` : ''}
        </div>`;
      }).join('')}
      ${freeCols.length
        ? `<button class="cfg-add" onclick="addMap()">＋ 为另一个字段配置码值映射</button>`
        : `<div class="cfg-note">该表的源字段都已配置码值映射 —— 要再换一个字段，请先删掉上面某一块。</div>`}
      <div class="cfg-note"><b>一个字段只生效第一组</b>映射，下拉里已被其它块占用的字段不会再出现（预览与生成的 SQL 共用同一条规则，两者永远一致）。命中率与未命中处理结果会实时反映在预览表与质量指标上；生成的 SQL 使用 CASE WHEN 表达，无方言依赖。</div>
    </div>`;
  } else if (step.id === 'cast') {
    const casts = step.config.casts || {};
    const onFail = step.config.onFail || 'null';
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">🔢 字段类型转换（选「保持源类型」即不转换，可自由增减）</div>
      ${colPick('cast', c => c.origin === 'source').map(o => {
        const cur = casts[o.v] || '';
        const srcName = Object.entries(pipeline.find(s => s.id === 'map')?.config.renames || {}).find(([, d]) => d === o.v)?.[0] || o.v;
        const srcType = FIELDS.find(x => x.name === srcName)?.srcType || 'VARCHAR';
        return `<div class="cfg-row${cur ? ' cfg-row--ok' : ''}">
          <span class="cfg-row__name">${esc(o.v)}<br><span class="cfg-row__from">${esc(srcType)}</span></span>
          <span class="cfg-row__arrow">→</span>
          ${sel(`setCast('${o.v}', this.value)`, [{ v: '', t: '保持源类型' }, ...TYPES], cur)}
        </div>`;
      }).join('')}
      <div class="cfg-note">已配置 <b>${Object.keys(casts).length}</b> 个转换；金额类字段会自动剥离 ¥ 与千分位分隔符后再转换。转换规则变化会同步反映到生成的 SQL。</div>
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">转换失败策略</div>
      ${[['null', '置为 NULL（保留行）'], ['default', '填默认值（保留行）'], ['skip', '丢弃该行']].map(([v, t]) =>
        `<label class="radio-line"><input type="radio" name="onfail" value="${v}" ${onFail === v ? 'checked' : ''} onchange="setOnFail('${v}')"> ${t}</label>`).join('')}
      ${onFail === 'default' ? `<div class="cfg-row"><span class="cfg-row__name">默认值</span><input class="cfg-input" value="${esc(step.config.defaultValue ?? '')}" onchange="setFailDefault(this.value)" placeholder="留空则按类型取 0 / 0.00"></div>` : ''}
      <div class="cfg-note">${onFail === 'null' ? '失败值写 NULL，原始值仍会保留在失败明细里，可导出回源核查。'
        : onFail === 'default' ? '失败值写默认值，原值同样留存；生成的 SQL 用 COALESCE(CAST(...), 默认值) 表达。'
        : '失败行整行丢弃（不计入产出），生成的 SQL 会在 WHERE 里追加非空过滤；失败明细可导出。'}</div>
    </div>`;
  } else if (step.id === 'date') {
    const probe = probeFields();
    const di = probe.dateInfo;
    // ⚠ dateInfo 会随功能演进增加新键（如 ambiguousFields），这里必须按「是不是一个带 count 的格式项」
    //   来筛选，而不是按黑名单排除 —— 否则新增键会渲染成 ×undefined（配置可见、静默错误）
    const chips = Object.keys(di)
      .filter(k => di[k] && typeof di[k] === 'object' && typeof di[k].count === 'number')
      .map(k => `<span class="issue-chip issue-chip--date">${esc(di[k].label)} ×${di[k].count}</span>`).join('');
    // ⚠ 只列「语义角色标记为日期」的列（roles.dates）。
    //   曾经这里用 planColumns('date') 的全部源列 —— 面板于是把「读者证号 reader_no」也列成
    //   可勾选的「参与标准化的字段」，用户勾上后整列被写成 NULL（静默丢数据，指标无异常）。
    const roleDates = roleColsOf('dates');
    const srcCols = planColumns('date').filter(c => c.origin === 'source');
    const allSrc = roleDates.length === 0;                       // 无角色信息的表退化为不限制，保持旧行为
    const targets = allSrc ? srcCols : roleDates.map(n => srcCols.find(c => c.name === n)).filter(Boolean);
    // 旧版本面板允许把任意列加进来且配置已持久化到 localStorage —— 残留项单列出来提示并可一键移除
    const stale = allSrc ? [] : (step.config.cols || []).filter(n => !roleDates.includes(n));
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">📅 参与标准化的字段 <span style="font-weight:400;color:var(--neutral-400);">（只列日期字段）</span></div>
      ${targets.map(c => `<label class="radio-line"><input type="checkbox" ${(step.config.cols || []).includes(c.name) ? 'checked' : ''} onchange="setDateCol('${c.name}', this.checked)"> ${esc(c.name)} · ${esc(c.cn)}</label>`).join('')}
      ${targets.length ? '' : '<div class="cfg-row__from">当前源表没有标记为日期的字段（语义角色里没有 dates 角色），本步骤无需配置。</div>'}
      <div class="cfg-note">输出格式：<b>YYYY-MM-DD</b>（ISO 8601）；无法解析的值置 NULL 并计入失败明细。非日期字段（如读者证号 <code>reader_no</code>）不能纳入本步骤 —— 它的每个值都解析不出日期，纳入后整列会变成 NULL。</div>
      ${stale.length ? `<div class="cfg-row cfg-row--warn" style="flex-direction:column;align-items:stretch;gap:4px;">
        <b style="font-size:11px;color:var(--warning-700);">⚠ 配置里残留了 ${stale.length} 个非日期列：${stale.map(n => `<code>${esc(n)}</code>`).join('、')}</b>
        <span class="cfg-row__from">它们不是日期字段，纳入会把整列置为 NULL。预览与 SQL 已自动跳过它们（不会生效），建议直接移除。</span>
        <div><button class="btn btn--sm" onclick="dropStaleDateCols()">🧹 移除这些列</button></div>
      </div>` : ''}
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">自动识别到的源格式（实时统计）</div>
      <div class="cfg-row" style="flex-wrap:wrap;gap:4px;">${chips || '<span class="cfg-row__from">采样中未发现日期字段</span>'}</div>
      ${di.ambiguous && di.ambiguous.length ? `
        <div class="cfg-row cfg-row--warn" style="flex-direction:column;align-items:stretch;gap:6px;">
          <b style="font-size:11px;color:var(--warning-700);">⚠ 存在歧义格式「${di.ambiguous.map(esc).join('、')}」${daPending() ? ' · <span style="background:var(--danger-50);color:var(--danger-700);padding:1px 6px;border-radius:3px;">待确认</span>' : ' · <span style="background:var(--success-50);color:var(--success-700);padding:1px 6px;border-radius:3px;">已确认</span>'}</b>
          <span class="cfg-row__from">这类值既可解为「日-月-年」也可解为「月-日-年」，引擎当前按所选口径处理。当前口径：
            <b style="color:var(--brand-600);">${step.config.dayFirst !== false ? '日在前 DD-MM-YYYY' : '月在前 MM-DD-YYYY'}</b>。</span>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px;">
            ${[['true', '按 DD-MM-YYYY 解释（日在前）'], ['false', '按 MM-DD-YYYY 解释（月在前）']].map(([v, t]) =>
              `<label class="radio-line"><input type="radio" name="dayfirst" value="${v}" ${String(step.config.dayFirst !== false) === v ? 'checked' : ''} onchange="setDayFirst('${v}')"> ${t}</label>`).join('')}
            <span class="cfg-row__from">当前 <code>${esc(di.ambiguous[0])}</code> 归一为 <b>${esc(parseDate(di.ambiguous[0], step.config.dayFirst !== false) || 'NULL')}</b></span>
            <button class="btn btn--sm" onclick="openDateAmbiguity(true)">⚖ 打开歧义确认弹窗</button>
            <span class="cfg-row__from">弹窗里可对照两种解释的实际归一结果、冲突样本与影响行数</span>
          </div>
        </div>` : ''}
      <div class="cfg-note">识别到的格式为真实统计结果（随采样与清理规则变化）；引擎按 斜杠式 → 短横线 → 紧凑式 → 日/月前后缀 的顺序依次尝试解析。歧义格式先按所选口径解释，若该口径下不成立（如「月在前」遇到 13-08-2026），自动退回唯一可行解，不会置 NULL。</div>
      <div class="cfg-note">口径<b>只裁决上面这类「日月都能解释」的值</b>。像 <code>13-08-2026</code> 这种只有一个可行解的，无论选哪个口径都归一为 <b>2026-08-13</b>，不受影响。</div>
    </div>`;
  } else if (step.id === 'dedup') {
    const keys = step.config.keys || [];
    const avail = planColumns('dedup');
    const orderBy = step.config.orderBy;
    const order = out && out.meta ? out.meta : null;
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">🧬 去重键（业务主键，可多选）</div>
      ${avail.map(c => `<label class="radio-line"><input type="checkbox" ${keys.includes(c.name) ? 'checked' : ''} onchange="setDedupKey('${c.name}', this.checked)"> ${esc(c.name)} · ${esc(c.cn)}</label>`).join('')}
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">保留策略</div>
      ${[['latest', '保留排序字段最新的一条'], ['earliest', '保留排序字段最早的一条']].map(([v, t]) =>
        `<label class="radio-line"><input type="radio" name="keep" value="${v}" ${step.config.keep === v ? 'checked' : ''} onchange="setKeep('${v}')"> ${t}</label>`).join('')}
      <div class="cfg-row" style="margin-top:6px;"><span class="cfg-row__name">排序字段</span>
        ${sel(`setDedupOrder(this.value)`, colPick('dedup'), orderBy)}</div>
      <div class="cfg-note">等价 SQL：<span style="font-family:var(--font-mono,monospace);">ROW_NUMBER() OVER (PARTITION BY ${esc(keys.join(', '))} ORDER BY ${esc(orderBy)} ${step.config.keep === 'latest' ? 'DESC' : 'ASC'})=1</span>
      ${order && order.removed ? `<br>本步实际去除 <b>${order.removed}</b> 行。` : ''}</div>
    </div>`;
  } else if (step.id === 'join') {
    const joins = step.config.joins || [];
    const avail = planColumns('join');
    const hits = (out && out.meta && out.meta.joinHits) || [];
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">🧩 关联 DWD 维表 / 主档（同一份清洗后的主档，按左表可用的键关联）</div>
      ${joins.map((j, i) => {
        const t = LOOKUP_TABLES[j.table];
        const h = hits[i];
        const rfields = t ? t.fields.filter(f => f.name !== j.rightKey) : [];
        return `
        <div class="cfg-row" style="flex-direction:column;align-items:stretch;gap:7px;padding:10px;${h && h.miss ? 'background:var(--warning-50);border-color:var(--warning-100);' : ''}">
          <div style="display:flex;gap:6px;align-items:center;">
            <b style="font-size:11px;">关联 ${i + 1}</b>
            ${sel(`setJoin(${i},'type',this.value)`, [{ v: 'left', t: 'LEFT JOIN' }, { v: 'inner', t: 'INNER JOIN' }], j.type)}
            ${sel(`setJoin(${i},'table',this.value)`, Object.values(LOOKUP_TABLES).map(t2 => ({ v: t2.name, t: `${t2.name} · ${t2.cn}` })), j.table, 'flex:1;')}
            <button class="cfg-del" onclick="removeJoin(${i})" title="删除该关联">✕</button>
          </div>
          <div style="display:flex;gap:5px;align-items:center;font-size:11px;color:var(--neutral-500);">
            <span>ON</span>
            ${sel(`setJoin(${i},'leftKey',this.value)`, avail.map(c2 => ({ v: c2.name, t: c2.name })), j.leftKey, 'flex:1;')}
            <span>=</span>
            ${sel(`setJoin(${i},'rightKey',this.value)`, (t ? t.fields : []).map(f => ({ v: f.name, t: f.name })), j.rightKey, 'flex:1;')}
          </div>
          <div style="font-size:11px;color:var(--neutral-500);">取字段</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${rfields.map(f => `<label class="chk"><input type="checkbox" ${(j.fields || []).includes(f.name) ? 'checked' : ''} onchange="toggleJoinField(${i},'${f.name}', this.checked)"> ${esc(f.name)} · ${esc(f.cn)}</label>`).join('') || '<span class="cfg-row__from">请先选择维表</span>'}
          </div>
          ${h ? `<span class="cfg-row__from">${h.invalid ? '⚠ ' + esc(h.table) + ' 不存在' : `命中 ${h.hit} / ${h.hit + h.miss} 行${h.miss ? ` · ${h.miss} 行未匹配（字段为 NULL）` : ''}`}</span>` : ''}
          ${t ? `<span class="cfg-row__from">${esc(t.desc)}</span>` : ''}
        </div>`;
      }).join('')}
      <button class="cfg-add" onclick="addJoin()">＋ 添加关联（DWD 宽表可由多个主档拼成）</button>
      <div class="cfg-note">只提供 LEFT / INNER：这两种能在「预览结果」和「生成 SQL」里保持完全一致的语义（右连接可用交换左右表的方式表达）。未命中的行保留原行、对应字段为 NULL，命中率计入质量指标。</div>
    </div>`;
  } else if (step.id === 'derive') {
    const rules = step.config.rules || [];
    const avail = planColumns('derive').filter(c => c.origin !== 'derive');
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">⚗️ 派生列（拆分 / 合并 / 正则提取）</div>
      ${rules.map((r, i) => `
        <div class="cfg-row" style="flex-direction:column;align-items:stretch;gap:7px;padding:10px;">
          <div style="display:flex;gap:6px;align-items:center;">
            ${sel(`setDerive(${i},'mode',this.value)`, [{ v: 'regex', t: '正则提取' }, { v: 'split', t: '按分隔符拆分' }, { v: 'concat', t: '多列合并' }], r.mode)}
            <input class="cfg-input" value="${esc(r.name)}" onchange="setDerive(${i},'name',this.value)" placeholder="新字段名">
            <button class="cfg-del" onclick="removeDerive(${i})" title="删除该派生列">✕</button>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <input class="cfg-input" value="${esc(r.cn || '')}" onchange="setDerive(${i},'cn',this.value)" placeholder="中文名（列头显示）">
          </div>
          ${r.mode === 'concat' ? `
            <div style="font-size:11px;color:var(--neutral-500);">参与合并的字段（按勾选顺序）</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${avail.map(c2 => `<label class="chk"><input type="checkbox" ${(r.sources || []).includes(c2.name) ? 'checked' : ''} onchange="toggleDeriveSource(${i},'${c2.name}', this.checked)"> ${esc(c2.name)}</label>`).join('')}
            </div>
            <div style="display:flex;gap:6px;align-items:center;"><span style="font-size:11px;color:var(--neutral-500);">连接符</span>
              <input class="cfg-input cfg-input--sm" value="${esc(r.sep ?? '')}" onchange="setDerive(${i},'sep',this.value)"></div>`
          : r.mode === 'split' ? `
            <div style="display:flex;gap:6px;align-items:center;">
              <span style="font-size:11px;color:var(--neutral-500);">源字段</span>
              ${sel(`setDerive(${i},'source',this.value)`, avail.map(c2 => ({ v: c2.name, t: c2.name })), r.source, 'flex:1;')}
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span style="font-size:11px;color:var(--neutral-500);">分隔符</span>
              <input class="cfg-input cfg-input--sm" value="${esc(r.sep ?? ',')}" onchange="setDerive(${i},'sep',this.value)">
              <span style="font-size:11px;color:var(--neutral-500);">取第</span>
              <input class="cfg-input cfg-input--sm" type="number" min="1" value="${Number(r.index ?? 0) + 1}" onchange="setDerive(${i},'index', Number(this.value) - 1)">
              <span style="font-size:11px;color:var(--neutral-500);">段</span>
            </div>`
          : `
            <div style="display:flex;gap:6px;align-items:center;">
              <span style="font-size:11px;color:var(--neutral-500);">源字段</span>
              ${sel(`setDerive(${i},'source',this.value)`, avail.map(c2 => ({ v: c2.name, t: c2.name })), r.source, 'flex:1;')}
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span style="font-size:11px;color:var(--neutral-500);">正则</span>
              <input class="cfg-input" value="${esc(r.pattern || '')}" onchange="setDerive(${i},'pattern',this.value)" placeholder="如 ^LN(\\d{8})">
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span style="font-size:11px;color:var(--neutral-500);">取第</span>
              <input class="cfg-input cfg-input--sm" type="number" min="0" value="${Number(r.group ?? 1)}" onchange="setDerive(${i},'group', Number(this.value))">
              <span style="font-size:11px;color:var(--neutral-500);">个捕获组</span>
            </div>`}
        </div>`).join('')}
      <button class="cfg-add" onclick="addDerive()">＋ 添加派生列</button>
      <div class="cfg-note">派生列会追加到输出字段末尾，并在列头标记「派生」；正则与拆分函数属 Spark/Hive 方言（迁移到 MySQL 需改写），合并使用 CONCAT + COALESCE，无方言依赖。</div>
    </div>`;
  } else if (step.id === 'mask') {
    const rules = step.config.rules || [];
    const avail = planColumns('mask').filter(c => c.origin !== 'derive');
    body = `
    <div class="cfg-sec"><div class="cfg-sec__title">🔒 脱敏规则</div>
      ${rules.length ? rules.map((r, i) => `
        <div class="cfg-row" style="flex-direction:column;align-items:stretch;gap:7px;padding:10px;">
          <div style="display:flex;gap:6px;align-items:center;">
            ${sel(`setMask(${i},'field',this.value)`, avail.map(c2 => ({ v: c2.name, t: `${c2.name} · ${c2.cn}` })), r.field, 'flex:1;')}
            ${sel(`setMask(${i},'mode',this.value)`, [{ v: 'partial', t: '部分掩码' }, { v: 'full', t: '全掩码' }, { v: 'hash', t: 'MD5 哈希' }], r.mode)}
            <button class="cfg-del" onclick="removeMask(${i})" title="删除该脱敏规则">✕</button>
          </div>
          ${r.mode === 'partial' ? `<div style="display:flex;gap:6px;align-items:center;">
            <span style="font-size:11px;color:var(--neutral-500);">保留前</span>
            <input class="cfg-input cfg-input--sm" type="number" min="0" value="${Number(r.keepLeft ?? 0)}" onchange="setMask(${i},'keepLeft', Number(this.value))">
            <span style="font-size:11px;color:var(--neutral-500);">位 · 后</span>
            <input class="cfg-input cfg-input--sm" type="number" min="0" value="${Number(r.keepRight ?? 0)}" onchange="setMask(${i},'keepRight', Number(this.value))">
            <span style="font-size:11px;color:var(--neutral-500);">位，其余以 * 填充</span></div>` : ''}
          ${r.mode === 'hash' ? `<div style="display:flex;gap:6px;align-items:center;">
            <span style="font-size:11px;color:var(--neutral-500);">加盐</span>
            <input class="cfg-input" value="${esc(r.salt || '')}" onchange="setMask(${i},'salt',this.value)" placeholder="可选，用于防止彩虹表反查">
            <span class="cfg-row__from">预览：${esc(applyMask('R20260012', { mode: 'hash', salt: r.salt || '' }))}</span></div>` : ''}
          <span class="cfg-row__from">预览：${esc(r.field && out && out.rows && out.rows[0] ? String(out.rows[0][r.field]) : '—')}</span>
        </div>`).join('') : '<div class="cfg-note">尚未配置脱敏规则。</div>'}
      <button class="cfg-add" onclick="addMask()">＋ 添加脱敏字段</button>
      <div class="cfg-note">掩码长度与原值一致（SQL 用 REPEAT + CHAR_LENGTH 表达，与预览逐格对齐）；哈希模式为 MD5，与 SQL 的 MD5() 一致。<b>注意</b>：脱敏会改变写入 DWD 的值，请确认下游 ADS 是否仍需要原值；本步骤默认停用，按客户数据安全要求开启。</div>
    </div>`;
  } else if (step.id === 'quality') {
    const m = computeQuality();
    const rules = step.config.rules || [];
    const pick = colPick('quality');
    const resOf = id => GATE.results.find(r => r.rule.id === id);
    const actOf = k => QUALITY_ACTIONS.find(a => a.key === k) || QUALITY_ACTIONS[1];
    const ruleParam = (r, i) => {
      if (r.type === 'enum') return `<input class="cfg-input" value="${esc(r.values || '')}" placeholder="白名单，逗号分隔，如 在借,已还" onchange="setQualityRule(${i},'values',this.value)">`;
      if (r.type === 'range') return `<div style="display:flex;gap:6px;align-items:center;">
          <input class="cfg-input cfg-input--sm" value="${esc(r.min)}" placeholder="min" onchange="setQualityRule(${i},'min',this.value)">
          <span style="font-size:11px;color:var(--neutral-500);">≤ 值 ≤</span>
          <input class="cfg-input cfg-input--sm" value="${esc(r.max)}" placeholder="max" onchange="setQualityRule(${i},'max',this.value)"></div>`;
      if (r.type === 'regex') return `<input class="cfg-input" value="${esc(r.pattern || '')}" placeholder="正则，如 ^LN\\d{11}$" onchange="setQualityRule(${i},'pattern',this.value)">`;
      if (r.type === 'custom') return `<div style="display:flex;gap:6px;align-items:center;">
          ${sel(`setQualityRule(${i},'op',this.value)`, Q_OPS.map(o => ({ v: o, t: o })), r.op, 'flex:0 0 108px;')}
          ${r.op.includes('NULL') ? '<span style="font-size:11px;color:var(--neutral-400);">无需常量</span>'
            : `<input class="cfg-input" value="${esc(r.value || '')}" placeholder="常量" onchange="setQualityRule(${i},'value',this.value)">`}</div>`;
      return `<span class="cfg-row__from">按字段求唯一率 / 非空率，无需额外参数</span>`;
    };
    body = `
    ${GATE.blocked ? `<div class="gate-banner gate-banner--block">⛔ <b>质量门禁未通过 · 已阻断写入</b>：${esc(GATE.bad.filter(r => r.action === 'block').map(r => qRuleLabel(r.rule) + ` 实测 ${r.rate.toFixed(2)}%`).join('；'))}
      <div class="cfg-note" style="margin:4px 0 0;">当前配置下该任务会被判定失败，不写入 ${esc(TASK.targetTable)}；请修数据、放宽阈值，或把该规则降级为「告警」。</div></div>`
      : (GATE.bad.length ? `<div class="gate-banner gate-banner--warn">⚠ <b>${GATE.bad.length} 条规则未达阈值</b>（告警级，不阻断写入）：${esc(GATE.bad.map(r => qRuleLabel(r.rule)).join('；'))}</div>`
      : (GATE.enabled ? `<div class="gate-banner gate-banner--ok">✓ 全部门禁规则达标，允许写入 ${esc(TASK.targetTable)}</div>` : ''))}
    <div class="cfg-sec"><div class="cfg-sec__title">🛡️ 质量规则（规则 + 阈值 + 不达标动作，对齐 DataWorks DQC）</div>
      ${rules.length ? rules.map((r, i) => {
        const res = resOf(r.id);
        const act = actOf(r.action);
        const cls = !r.enabled ? 'cfg-row' : (res && !res.passed ? (r.action === 'block' ? 'cfg-row cfg-row--warn' : 'cfg-row cfg-row--warn') : 'cfg-row cfg-row--ok');
        return `
        <div class="${cls}" style="flex-direction:column;align-items:stretch;gap:7px;padding:10px;${!r.enabled ? 'opacity:.55;' : ''}">
          <div style="display:flex;gap:6px;align-items:center;">
            <label class="chk" title="启用 / 停用该规则"><input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="setQualityRule(${i},'enabled',this.checked)"></label>
            ${sel(`setQualityRule(${i},'type',this.value)`, QUALITY_RULE_TYPES.map(t => ({ v: t.key, t: t.label })), r.type, 'flex:0 0 96px;')}
            ${sel(`setQualityRule(${i},'field',this.value)`, pick, r.field, 'flex:1;')}
            <button class="cfg-del" onclick="removeQualityRule(${i})" title="删除该规则">✕</button>
          </div>
          <div>${ruleParam(r, i)}</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span style="font-size:11px;color:var(--neutral-500);">通过率 ≥</span>
            <input class="cfg-input cfg-input--sm" style="flex:0 0 62px;" type="number" min="0" max="100" value="${Number(r.threshold)}" onchange="setQualityRule(${i},'threshold',this.value)">
            <span style="font-size:11px;color:var(--neutral-500);">%</span>
            ${sel(`setQualityRule(${i},'action',this.value)`, QUALITY_ACTIONS.map(a => ({ v: a.key, t: a.label })), r.action, 'flex:0 0 84px;')}
            <span style="font-size:11px;color:var(--neutral-400);" title="${esc(act.hint)}">${esc(act.hint)}</span>
          </div>
          <div class="cfg-row__from">${res ? (res.unmet
            ? '⚠ 字段不在当前产出列中，规则无法判定'
            : `实测通过率 <b style="color:${res.passed ? 'var(--success-700)' : 'var(--warning-700)'};">${res.rate.toFixed(2)}%</b>（违规 ${res.violations} 行 / 共 ${res.total} 行）${res.samples.length ? ` · 样本 ${esc(res.samples.join(' / '))}` : ''}${res.passed ? ' · 达标' : ' · 未达标'}`)
            : '该规则已停用'}</div>
        </div>`;
      }).join('') : '<div class="cfg-note">尚未配置质量规则。</div>'}
      <button class="cfg-add" onclick="addQualityRule()">＋ 添加质量规则</button>
      <div class="cfg-note">阈值指<b>通过率</b>（0–100）；<b>阻断</b>表示不达标即判定任务失败、不写目标表并阻断下游（对应 DQC 的强规则），<b>告警</b>只提示、<b>继续</b>仅记录。规则会一并落到生成的 SQL：写入后对目标表执行同一组断言。</div>
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">🧯 脏数据分流（替代手工导 CSV）</div>
      <label class="radio-line"><input type="checkbox" ${step.config.dirty ? 'checked' : ''} onchange="toggleDirty(this.checked)"> 失败行写入隔离表 <code>${esc(dirtyTableName())}</code></label>
      <div class="cfg-note">开启后，SQL 会额外生成一段分流写入：失败行连同 <code>fail_field</code> / <code>fail_reason</code> / <code>fail_raw_value</code> / <code>quarantine_time</code> 落隔离表，并回写血缘（${esc(dirtyTableName())} → 质量看板 / 人工复洗队列 → 复核后回灌 ${esc(TASK.targetTable)}）。同一行多字段失败会写多条，便于按字段维度统计复洗工作量。</div>
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">📊 产出与质量分（实时，非写死）</div>
      <div class="metric-row"><span>产出规模</span><b>${m.rowCount} 行 × ${m.cols.length} 列</b></div>
      <div class="metric-row"><span>转换 / 解析失败</span><b style="color:${m.failedCells ? 'var(--warning-700)' : 'var(--success-700)'};">${m.failedCells ? '⚠ ' + m.failedCells + ' 格' : '✓ 0 格'}</b></div>
      <div class="metric-row"><span>源字段非空率</span><b style="color:${m.nonNullRate >= 0.95 ? 'var(--success-700)' : 'var(--warning-700)'};">${(m.nonNullRate * 100).toFixed(1)}%</b></div>
      ${m.joinSlots ? `<div class="metric-row"><span>关联命中率</span><b style="color:${m.joinRate >= 0.95 ? 'var(--success-700)' : 'var(--warning-700)'};">${(m.joinRate * 100).toFixed(0)}%（${m.joinHit}/${m.joinSlots}）</b></div>` : ''}
      <div class="metric-row" style="border-bottom:none;padding-bottom:2px;"><span>基础分</span><b>100</b></div>
      ${m.deductions.map(d => {
        const rp = (d.rate * 100).toFixed(d.rate >= 0.1 ? 0 : 2) + '%';
        return `<div class="metric-row" style="border-bottom:none;padding:3px 10px;" title="${esc(d.label)}：${d.n} 条">
          <span>− ${esc(d.label)} <span style="color:var(--neutral-400);">${rp} × ${d.w}</span></span>
          <b style="color:${d.pts ? 'var(--warning-700)' : 'var(--neutral-400)'};">− ${d.pts.toFixed(2)}</b></div>`;
      }).join('')}
      <div class="metric-row"><span><b>质量分</b></span><b style="font-size:14px;color:${m.score >= 95 ? 'var(--success-700)' : m.score >= 85 ? 'var(--warning-700)' : 'var(--danger-700)'};">${m.score}</b></div>
      <div class="cfg-note">口径：<b>比率 × 权重</b>扣分（转换失败格 50 / 主键空值 30 / 重复行 15 / 源字段空值 5，权重合计 100），扣分看占比而非绝对条数，因此 12 行采样与 20,000 行全量的得分可直接对比、可用于设阈值。括号内为该问题的实际条数。关联未命中与派生列为空不计入扣分，单独看命中率。</div>
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">失败行处置</div>
      <button class="btn btn--sm" onclick="exportFailedRows()">⬇ 导出失败行明细（CSV）</button>
      <div class="cfg-note">失败行按「类型转换」策略写入 DWD（置 NULL / 默认值 / 丢弃），并留存原始值；CSV 含业务主键、同步时间、字段名、批内标准化值与原始值，可回源系统核查后人工修复。</div>
    </div>`;
  }

  const custom = !eqConfig(step.config, step.recommend());
  // 提示语必须与右侧配置面板同口径：面板同时给出「失败格数」和「规则达标情况」，
  // 这里也把失败行数带上，避免出现「面板说脏、提示说干净」的矛盾观感。
  const failNote = (out && !out.skipped && out.meta && out.meta.failedCount > 0)
    ? `（${out.meta.failedCount} 行含失败字段）` : '';
  el.innerHTML = `
    <div class="ai-tip"><b>🤖 智能推荐</b>：本步骤规则由引擎按采样数据自动匹配，${out && !out.skipped ? `当前执行结果：<b>${esc(out.stat)}</b>${failNote}` : '<b>当前已停用</b>'}。
    ${`<span class="link" onclick="resetStep('${step.id}')" title="把本步骤配置回滚为智能推荐">${custom ? '恢复推荐' : '已为推荐值 · 恢复推荐'}</span> ·
       <span class="link" onclick="toggleStep('${step.id}')">${step.enabled ? '停用此步' : '启用此步'}</span>`}
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--neutral-800);margin-bottom:10px;display:flex;align-items:center;gap:6px;min-width:0;">
      <span style="white-space:nowrap;flex-shrink:0;">${step.icon} ${esc(step.name)}</span>
      <span style="font-weight:400;font-size:11px;color:var(--neutral-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;" title="${esc(step.desc)}">— ${esc(step.desc)}</span>
      ${custom ? '<span class="tag" style="margin-left:auto;flex-shrink:0;background:var(--warning-50);color:var(--warning-700);">已自定义</span>' : '<span class="tag" style="margin-left:auto;flex-shrink:0;">推荐配置</span>'}
    </div>
    ${body}`;
}

// =====================================================================
// SQL 生成：与「规则配置」逐步一一对应，并按所选方言产出该引擎真能执行的语法
//   要点 1：投影采用「前导逗号」风格 —— 逗号写在行首，行尾的 `-- 注释`
//          永远不会把分隔逗号注释掉（早期版本因此产出过无法执行的 SQL）。
//   要点 2：clean / codemap / cast / date / dedup / join / derive / mask 全部落地；
//          质量门禁以 DQC 断言段落地（写入后校验目标表，block 级不达标阻断下游）；
//          失败行以脏数据分流段落入 <目标表>_dirty。
//   要点 3：四种方言的真实差异（覆盖写入 / 日期函数与格式串 / 正则运算符与提取 /
//          字符串长度与分词 / CAST 目标类型 / 调度变量与日期运算）逐条映射。
// =====================================================================

// 从正则里取出第 n 个顶层捕获组的内容（供不支持「分组提取」的方言做等价改写）
//   返回 null 表示无法安全改写（存在顶层分支、组内分支或组数不足）
function focusGroup(pattern, n) {
  let depth = 0, esc = false, inCls = false;
  const groups = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inCls) { if (c === ']') inCls = false; continue; }
    if (c === '[') { inCls = true; continue; }
    if (c === '(') {
      const ahead = pattern.slice(i, i + 4);
      if (/^\(\?[:=!]/.test(ahead) || /^\(\?<[=!]/.test(ahead)) { depth++; continue; }
      depth++;
      if (depth === 1) groups.push({ open: i, close: -1 });
      continue;
    }
    if (c === ')') {
      if (depth === 1 && groups.length) groups[groups.length - 1].close = i;
      if (depth > 0) depth--;
      continue;
    }
    if (c === '|' && depth === 0) return null;
  }
  const g = groups[n - 1];
  if (!g || g.close < 0) return null;
  const body = pattern.slice(g.open + 1, g.close);
  if (/(^|[^\\])\|/.test(body)) return null;
  return body || null;
}

function genSQL(plain) {
  const dl = D();
  const raw = t => plain ? t : t;
  const kw = plain ? raw : (t => `<span class="kw">${t}</span>`);
  const fn = plain ? raw : (t => `<span class="fn">${t}</span>`);
  const cm = plain ? raw : (t => `<span class="cm">${t}</span>`);
  const get = id => pipeline.find(s => s.id === id);
  const on = id => { const s = get(id); return !!s && s.enabled; };
  const sqlStr = s => String(s ?? '').replace(/'/g, "''");
  // 正则嵌进 SQL 字符串字面量时必须把 \ 写成 \\，否则 Hive/MySQL 会把反斜杠当转义符吃掉
  const sqlRx = p => String(p ?? '').replace(/'/g, "''").replace(/\\/g, '\\\\');
  const pad = (e, p) => e.split('\n').map((l, i) => i === 0 ? l : p + l).join('\n');
  const aliasOf = i => 'm' + (i + 1);
  const strType = dl.stringType;

  const cols = planColumns();
  const baseCols = cols.filter(c => c.origin === 'source');
  const joinStep = get('join');
  const joinList = on('join') ? (joinStep.config.joins || []).filter(j => LOOKUP_TABLES[j.table]) : [];
  const dedupStep = get('dedup');
  const orderBy = on('dedup') ? dedupStep.config.orderBy : null;

  // 正则字面量（SQL 文本里写作 '\\d'，四种引擎都会解析成 \d）
  const RX = {
    slash: '^\\\\d{4}/\\\\d{1,2}/\\\\d{1,2}$',
    dash:  '^\\\\d{4}-\\\\d{1,2}-\\\\d{1,2}$',
    compact: '^\\\\d{8}$',
    dmyDash: '^\\\\d{1,2}-\\\\d{1,2}-\\\\d{4}$',
    dmySlash: '^\\\\d{1,2}/\\\\d{1,2}/\\\\d{4}$',
  };

  const PV = dl.varRef(TASK.bizdateVar);                  // 分区值表达式（PARTITION 子句 / 投影）
  const QPV = dl.varLit(TASK.bizdateVar);                 // 比较语境用（Hive/Spark 必须带引号）
  const SRC_PART = dl.dayBefore(PV);                      // 源分区：T-1
  const dialectNotes = [];                                // 方言能力降级说明，集中输出
  const configNotes = [];                                 // 配置无法落地的提示（避免「配置悬空、静默失效」）
  // 日期歧义未人工确认时，在 SQL 里显式标注：这段 SQL 的日期口径是「暂定」而非「已确认」
  if (on('date')) {
    const da = dateAmbiguityInfo();
    if (da && !DA_ACK[daSignature()]) {
      configNotes.push(`日期字段 ${da.fields.join('、')} 存在歧义格式 ${da.amb.join('、')}（影响源表 ${da.affected} 行），当前按「${da.dayFirst ? '日在前 DD-MM-YYYY' : '月在前 MM-DD-YYYY'}」暂定执行，尚未人工确认，上线前请先在「日期标准化」步骤确认口径`);
    }
    // 配置里混进了非日期列时点出来 —— 它们已被跳过（不写进 SQL），
    // 否则用户会以为「勾了就该生效」，而在数据库侧发现整列 NULL 或与预期不符
    const staleCols = (get('date').config.cols || []).filter(n => !isDateColName(n));
    if (staleCols.length) {
      configNotes.push(`「日期标准化」的配置里有非日期列 ${staleCols.join('、')}（语义角色未标记为日期），已跳过、未写入 SQL —— 这类列若参与日期归一，整列会被置为 NULL`);
    }
  }
  const skipFilters = [];                                 // 主查询保留条件（与 JS 语义对齐：空值保留）
  const failItems = [];                                   // 失败条件（脏数据分流用），与 skipFilters 互补

  // ---- 表达式构造 ----
  const cleanedExpr = (src) => {
    const trimOn = on('clean') && get('clean').config.trim !== false;
    const normOn = on('clean') && get('clean').config.nullNormalize === true;
    if (!trimOn && !normOn) return src;
    const inner = trimOn ? `${fn('TRIM')}(${src})` : src;
    if (!normOn) return inner;
    const list = String(get('clean').config.nullTokens || '').split(',').map(s => s.trim()).filter(Boolean)
      .map(t => `'${sqlStr(t.toUpperCase())}'`).join(', ');
    if (!list) return inner;
    return `${kw('CASE')} ${kw('WHEN')} ${fn('UPPER')}(${inner}) ${kw('IN')} (${list}) ${kw('THEN')} ${kw('NULL')} ${kw('ELSE')} ${inner} ${kw('END')}`;
  };
  const isoOut = dpat('yyyy-MM-dd');
  const dateExpr = (e, dayFirst) => {
    const p1 = dayFirst === false ? 'MM-dd-yyyy' : 'dd-MM-yyyy';
    const p2 = dayFirst === false ? 'MM/dd/yyyy' : 'dd/MM/yyyy';
    const a1 = dayFirst === false ? 'dd-MM-yyyy' : 'MM-dd-yyyy';
    const a2 = dayFirst === false ? 'dd/MM/yyyy' : 'MM/dd/yyyy';
    const to = canon => `${fn('DATE_FORMAT')}(${dl.toDate(e, dpat(canon))}, '${isoOut}')`;
    const toISO = `${fn('DATE_FORMAT')}(${dl.toDateISO(e)}, '${isoOut}')`;
    // ⚠ 与 JS 侧 parseDate 严格同构：口径只裁决歧义值，唯一解的值（13-08-2026）不能被口径改判成 NULL。
    //   先试首选口径、失败再退回另一解。各方言的 toDate 在解析失败时都返回 NULL，COALESCE 语义成立。
    const either = (pref, alt) => `${fn('COALESCE')}(${to(pref)}, ${to(alt)})`;
    return [
      `${kw('CASE')}`,
      `  ${kw('WHEN')} ${e} ${kw(dl.regexOp)} '${RX.slash}' ${kw('THEN')} ${to('yyyy/MM/dd')}`,
      `  ${kw('WHEN')} ${e} ${kw(dl.regexOp)} '${RX.dash}' ${kw('THEN')} ${toISO}`,
      `  ${kw('WHEN')} ${e} ${kw(dl.regexOp)} '${RX.compact}' ${kw('THEN')} ${to('yyyyMMdd')}`,
      `  ${kw('WHEN')} ${e} ${kw(dl.regexOp)} '${RX.dmyDash}' ${kw('THEN')} ${either(p1, a1)}`,
      `  ${kw('WHEN')} ${e} ${kw(dl.regexOp)} '${RX.dmySlash}' ${kw('THEN')} ${either(p2, a2)}`,
      `  ${kw('ELSE')} ${kw('NULL')} ${kw('END')}`,
    ].join('\n');
  };
  const castCore = (e, type) => {
    const t = dl.castType(type);
    // 转 DATE 绝不能直接 CAST(x AS DATE)：引擎自带的格式识别在 Hive / Spark / MySQL 上
    // 遇到 13-08-2026 一律返回 NULL，而预览里它是能正常归一的 —— 就成了「预览对、落库全丢」。
    // 统一走日期解析表达式（与 JS parseDate 同构、口径取自「日期标准化」的同一步配置），再 CAST 成目标类型。
    if (type === 'DATE') {
      const dstep = get('date');
      return `${fn('CAST')}(${dateExpr(e, !dstep || dstep.config.dayFirst !== false)} ${kw('AS')} ${t})`;
    }
    if (type === 'DECIMAL(10,2)') return `${fn('CAST')}(${fn('REPLACE')}(${fn('REPLACE')}(${e}, '¥', ''), ',', '') ${kw('AS')} ${t})`;
    return `${fn('CAST')}(${e} ${kw('AS')} ${t})`;
  };
  // 转换失败 / 丢弃行的判定：空值不算失败（与引擎 JS 侧 run() 完全一致）
  const noteConv = (colName, type, inner) => {
    const onFail = (get('cast').config.onFail) || 'null';
    const core = castCore(inner, type);
    if (onFail === 'skip') {
      skipFilters.push(`(${inner} ${kw('IS NULL')} ${kw('OR')} ${core} ${kw('IS NOT NULL')})`);
      failItems.push({ field: colName, reason: `类型转换失败（${type}）`, raw: inner, pred: `(${inner} ${kw('IS NOT NULL')} ${kw('AND')} ${core} ${kw('IS NULL')})` });
    }
    return core;
  };
  const codemapExpr = (e, m) => {
    const whens = (m.pairs || []).filter(p => String(p.from) !== '')
      .map(p => `  ${kw('WHEN')} ${e} = '${sqlStr(p.from)}' ${kw('THEN')} '${sqlStr(p.to)}'`).join('\n');
    const els = m.others === 'null' ? kw('NULL')
      : m.others === 'default' ? `'${sqlStr(m.defaultValue === '' || m.defaultValue == null ? '未知' : m.defaultValue)}'` : e;
    return `${kw('CASE')}\n${whens}\n  ${kw('ELSE')} ${els}\n${kw('END')}`;
  };
  // 某源列在 base 子查询里的 { 清洗后表达式, 转换后表达式 }
  const stageOf = (c) => {
    let e = cleanedExpr(c.src);
    if (on('codemap')) {
      // 与 step.run() 共用 effectiveMaps()：同字段只认第一组，两处永远不会再分叉
      const m = effectiveMaps(get('codemap').config).find(x => x.field === c.name);
      if (m && (m.pairs || []).length) e = codemapExpr(e, m);
    }
    if (on('cast') && (get('cast').config.casts || {})[c.name]) return { inner: e, core: noteConv(c.name, get('cast').config.casts[c.name], e) };
    // 与「日期标准化」run() 保持同一判据：只对真正的日期列生成归一表达式。
    // 否则配置里残留一个非日期列时，SQL 会把整列写成 NULL 而预览不会 —— 落库数据静默丢失。
    if (on('date') && (get('date').config.cols || []).includes(c.name) && isDateColName(c.name)) {
      const d = dateExpr(e, get('date').config.dayFirst !== false);
      failItems.push({ field: c.name, reason: '日期格式无法解析', raw: e, pred: `(${e} ${kw('IS NOT NULL')} ${kw('AND')} ${d} ${kw('IS NULL')})` });
      return { inner: e, core: d };
    }
    return { inner: e, core: e };
  };
  const refOf = (name) => {
    const c = cols.find(x => x.name === name);
    if (!c) return `x.${name}`;
    if (c.origin === 'join') return `${aliasOf(c.joinIdx)}.${c.rightField}`;
    return `x.${c.name}`;
  };
  const deriveExpr = (rl) => {
    if (rl.mode === 'concat') {
      const parts = [];
      (rl.sources || []).forEach((s, i) => {
        if (i) parts.push(`'${sqlStr(rl.sep ?? '')}'`);
        parts.push(`${fn('COALESCE')}(${refOf(s)}, '')`);
      });
      return parts.length ? `${fn('CONCAT')}(${parts.join(', ')})` : kw('NULL');
    }
    if (rl.mode === 'split') return dl.splitPart(refOf(rl.source), sqlStr(rl.sep ?? ','), Number(rl.index ?? 0) + 1);
    if (rl.mode === 'regex') {
      const g = Number(rl.group ?? 1) || 1;
      if (dl.regexExtract) return dl.regexExtract(refOf(rl.source), sqlRx(rl.pattern ?? ''), g);
      const focused = focusGroup(String(rl.pattern ?? ''), g);
      if (focused) return dl.regexSubstr(refOf(rl.source), sqlRx(focused));
      dialectNotes.push(`${dl.name} 不支持指定捕获组，派生列「${rl.name || '未命名'}」按整段匹配提取，请确认正则语义`);
      return dl.regexSubstr(refOf(rl.source), sqlRx(rl.pattern ?? ''));
    }
    // 加工方式无法识别时不再静默吐 NULL —— 派生列会「有列名、全空值」，
    // 是典型的静默失效（配置看起来生效、结果全错），必须在 SQL 里点出来。
    configNotes.push(`派生列「${rl.name || '未命名'}」的加工方式「${rl.mode || '空'}」无法识别，已按 NULL 输出`);
    return kw('NULL');
  };
  const maskExpr = (ref, rule) => {
    if (rule.mode === 'full') return `${fn('REPEAT')}('*', ${fn(dl.len)}(${ref}))`;
    if (rule.mode === 'hash') return rule.salt ? `${fn('MD5')}(${fn('CONCAT')}(${ref}, '${sqlStr(rule.salt)}'))` : `${fn('MD5')}(${ref})`;
    const l = Number(rule.keepLeft ?? 0), r = Number(rule.keepRight ?? 0), dec = l + r;
    const parts = [];
    if (l > 0) parts.push(`${fn('SUBSTR')}(${ref}, 1, ${l})`);
    parts.push(`${fn('REPEAT')}('*', ${fn('GREATEST')}(${fn(dl.len)}(${ref}) - ${dec}, 0))`);
    if (r > 0) parts.push(`${fn('RIGHT')}(${ref}, ${r})`);
    return `${fn('CONCAT')}(${parts.join(', ')})`;
  };

  // ---- 投影列（前导逗号风格：逗号在行首，行尾注释永远安全）----
  const projLines = cols.map((c, i) => {
    const lead = i === 0 ? '      ' : '    , ';
    let ref, note = '';
    if (c.origin === 'join') {
      ref = `${aliasOf(c.joinIdx)}.${c.rightField}`;
      note = `  -- 关联 ${(LOOKUP_TABLES[c.table] || {}).cn || c.table}`;
    } else if (c.origin === 'derive') {
      ref = deriveExpr(c.rule);
      note = '  -- 派生列';
    } else {
      ref = `x.${c.name}`;
    }
    if (c.masked) { ref = maskExpr(ref, c.masked); note = `  -- 脱敏：${maskLabel(c.masked)}`; }
    if (c.renamed) note = `  -- 原 ${c.src}` + (c.masked ? '；已脱敏' : '');
    return `${lead}${pad(ref, '       ')} ${kw('AS')} ${c.name}${cm(note)}`;
  });
  const baseLines = baseCols.map((c, i) => {
    const lead = i === 0 ? '      ' : '    , ';
    const note = c.renamed ? cm(`  -- 原 ${c.src}`) : '';
    return `${lead}${pad(stageOf(c).core, '       ')} ${kw('AS')} ${c.name}${note}`;
  });
  // 去重排序字段被排除出目标表时，仍需在子查询里保留它
  if (orderBy && !cols.some(c => c.name === orderBy)) {
    const rn = (get('map') || {}).config?.renames || {};
    const srcName = Object.entries(rn).find(([, d]) => d === orderBy)?.[0] || orderBy;
    baseLines.push(`    , ${fn('TRIM')}(${srcName}) ${kw('AS')} ${orderBy}${cm('  -- 去重排序依据，不写入目标表')}`);
  }

  // ---- 三段 SQL 的公共片段 ----
  const baseFrom = [
    '    ' + kw('SELECT'),
    baseLines.join('\n'),
    '    ' + kw('FROM') + ' ' + TASK.sourceTable,
    '    ' + kw('WHERE') + ` ${TASK.partitionField} = ${pad(SRC_PART, '      ')}`
      + (skipFilters.length ? '\n      ' + skipFilters.map(f => `${kw('AND')} ${f}`).join('\n      ') + cm('  -- 转换失败即丢弃（空值保留，与预览一致）') : ''),
  ].join('\n');
  const withDedup = orderBy ? [
    '  ' + kw('SELECT') + ' t.*,',
    `         ${fn('ROW_NUMBER()')} ${kw('OVER')} (${kw('PARTITION BY')} ${dedupStep.config.keys.filter(Boolean).join(', ')} ${kw('ORDER BY')} ${orderBy} ${dedupStep.config.keep === 'latest' ? 'DESC' : 'ASC'}) ${kw('AS')} rn`
      + cm(`  -- 去重：同 ${dedupStep.config.keys.filter(Boolean).join('/')} 保留 ${orderBy} ${dedupStep.config.keep === 'latest' ? '最新' : '最早'}`),
    '  ' + kw('FROM') + ' (',
  ].join('\n') : null;
  const joinLines = joinList.map((j, i) => {
    const t = LOOKUP_TABLES[j.table];
    const leftOk = baseCols.some(c => c.name === j.leftKey) || cols.some(c => c.name === j.leftKey);
    if (!leftOk) return cm(`-- ⚠ 关联 ${i + 1} 已跳过：左键 ${j.leftKey} 不在可用字段中（可能已被排除或改名）`);
    return kw(j.type === 'inner' ? 'INNER JOIN' : 'LEFT JOIN') + ` ${t.name} ${aliasOf(i)} ${kw('ON')} x.${j.leftKey} = ${aliasOf(i)}.${j.rightKey}`
      + cm(`  -- ${t.cn}，取 ${(j.fields || []).join(', ') || '无字段'}`);
  });
  const mainSelect = [
    kw('SELECT'),
    projLines.join('\n'),
    kw('FROM') + ' (',
    ...(withDedup ? [withDedup, baseFrom, '  ) t'] : [baseFrom]),
    ') x',
    ...joinLines,
    ...(orderBy ? [kw('WHERE') + ' x.rn = 1'] : []),
  ].join('\n');

  // 分区列：Hive/Spark 由 PARTITION 子句承载；MySQL/Doris 必须写进投影
  const projWithPart = dl.partitionInProjection
    ? [`      ${PV} ${kw('AS')} ${TASK.partitionField}${cm('  -- 目标分区（该方言必须写进投影）')}`]
        .concat(projLines.map((l, i) => i === 0 ? l.replace(/^ {6}/, '    , ') : l))
    : projLines;
  const mainSelectWithPart = dl.partitionInProjection
    ? mainSelect.replace(projLines.join('\n'), projWithPart.join('\n'))
    : mainSelect;

  // ---- 组装 ----
  const en = pipeline.filter(s => s.enabled).length;
  const L = [];
  L.push(cm(`-- DataForge 自动生成 · 清洗加工 SQL（可视化流水线 ${en} 步，逐条对应「规则配置」）`));
  L.push(cm(`-- 目标方言：${dl.name} ${dl.ver} —— ${dl.note}`));
  L.push(cm(`-- 分层链路：ODS 原始层 ${TASK.sourceTable}（客户业务系统同步） → 标准化清洗 → DWD 明细层 ${TASK.targetTable}`));
  L.push(cm('-- 口径：投影列 = 预览表列头 = 质量指标统计口径，三处由同一份列计划推导'));
  L.push(cm(`-- 调度变量：${PV} = 业务日期（由调度器注入）；读取源分区 ${TASK.partitionField} = ${SRC_PART}`));
  L.push(cm(`-- 写入模式：${TASK.writeMode === 'overwrite' ? `覆盖当日分区 ${TASK.partitionField} = ${PV}` : '追加写入（不覆盖既有分区）'}`));
  L.push(cm(`-- 运行模式：${RUNMODE === 'full' ? `全量试跑（本次载入 ${FULL_N.toLocaleString()} 行）` : `采样 ${RAW_ROWS.length} 行预览，不代表全量`}`));
  if (joinList.length) L.push(cm('-- 关联维表：' + joinList.map(j => `${LOOKUP_TABLES[j.table].name}（${j.type === 'inner' ? 'INNER' : 'LEFT'} JOIN）`).join('、')));
  if (on('mask') && (get('mask').config.rules || []).some(r => r.field)) L.push(cm('-- 数据安全：脱敏规则已生效，写入目标是脱敏后的值'));
  [...new Set(dialectNotes)].forEach(n => L.push(cm('-- ⚠ 方言差异：' + n)));
  [...new Set(configNotes)].forEach(n => L.push(cm('-- ⚠ 配置提示：' + n)));
  if (GATE.blocked) L.push(cm(`-- ⚠ 当前${RUNMODE === 'full' ? '全量试跑' : '采样运行'}已被质量门禁阻断：${GATE.bad.filter(r => r.action === 'block').map(r => qRuleLabel(r.rule)).join('、')}`));
  if (GATE.bad.length) L.push(cm(`-- ⚠ 未达阈值规则：${GATE.bad.map(r => `${qRuleLabel(r.rule)} 实测 ${r.rate.toFixed(2)}%`).join('；')}`));
  L.push('');

  // ===== ① 质量门禁（DQC 断言，写入后校验目标表）=====
  if (GATE.enabled && GATE.results.length) {
    L.push(cm('-- ===== ① 质量门禁（DQC 断言）：写入后对目标表校验，每返回一行即一条规则的违规数 ====='));
    L.push(cm('-- 动作约定：block 级 violations > 0 → 任务判定失败并阻断下游；warn 级 → 仅告警；continue 级 → 仅记录'));
    const asserts = GATE.results.map((res, i) => {
      const r = res.rule;
      const act = (QUALITY_ACTIONS.find(a => a.key === r.action) || {}).label || r.action;
      const f = r.field;
      const head = [
        `  ${kw('SELECT')} '${sqlStr(qRuleLabel(r))}' ${kw('AS')} rule_name`,
        `       , '${r.action}' ${kw('AS')} on_fail${cm(`  -- ${act}`)}`,
        `       , ${Number(r.threshold)} ${kw('AS')} threshold_pct`,
        `       , `,
      ].join('\n');
      let viol;
      const num = `${fn('CAST')}(${f} ${kw('AS')} DECIMAL(10,2))`;
      if (r.type === 'unique') viol = `${fn('COUNT')}(1) - ${fn('COUNT')}(${kw('DISTINCT')} ${fn('COALESCE')}(${fn('CAST')}(${f} ${kw('AS')} ${strType}), '∅'))`;
      else if (r.type === 'notnull') viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${f} ${kw('IS NULL')} ${kw('OR')} ${f} = '' ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      else if (r.type === 'enum') viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${f} ${kw('IS NULL')} ${kw('OR')} ${f} ${kw('NOT IN')} (${String(r.values || '').split(',').map(x => x.trim()).filter(Boolean).map(x => `'${sqlStr(x)}'`).join(', ') || "''"}) ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      else if (r.type === 'range') viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${num} ${kw('IS NULL')} ${kw('OR')} ${num} < ${Number(r.min === '' ? '-999999999' : r.min)} ${kw('OR')} ${num} > ${Number(r.max === '' ? '999999999' : r.max)} ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      else if (r.type === 'regex') viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${f} ${kw('IS NULL')} ${kw('OR')} ${kw('NOT')} (${f} ${kw(dl.regexOp)} '${sqlRx(r.pattern)}') ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      else if (r.op === 'IS NULL') viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${f} ${kw('IS NOT NULL')} ${kw('AND')} ${f} <> '' ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      else if (r.op === 'IS NOT NULL') viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${f} ${kw('IS NULL')} ${kw('OR')} ${f} = '' ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      else if (r.op === 'CONTAINS') viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${f} ${kw('IS NULL')} ${kw('OR')} ${fn('INSTR')}(${f}, '${sqlStr(r.value)}') = 0 ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      else {
        const isNum = r.value !== '' && !isNaN(Number(r.value));
        const lhs = isNum ? num : `${fn('CAST')}(${f} ${kw('AS')} ${strType})`;
        const rhs = isNum ? Number(r.value) : `'${sqlStr(r.value)}'`;
        const flip = { '>': '<=', '>=': '<', '<': '>=', '<=': '>', '=': '<>', '!=': '=' }[r.op] || '<>';
        viol = `${fn('SUM')}(${kw('CASE')} ${kw('WHEN')} ${lhs} ${kw('IS NULL')} ${kw('OR')} ${lhs} ${kw(flip)} ${rhs} ${kw('THEN')} 1 ${kw('ELSE')} 0 ${kw('END')})`;
      }
      const tail = [
        `${cm('  -- ' + (res.passed ? '达标' : '未达标') + `：实测 ${res.rate.toFixed(2)}%` + (res.samples.length ? `，样本 ${res.samples.join(' / ')}` : ''))}`,
        `${fn('FROM')} ${TASK.targetTable}${cm('  -- 校验对象：本次写入的目标表分区')}`,
        `${kw('WHERE')} ${TASK.partitionField} = ${QPV}`,
      ].join('\n');
      return head + viol + '\n' + tail;
    });
    L.push(asserts.join('\n' + cm('  UNION ALL') + '\n'));
    L.push(';');
    L.push('');
  }

  // ===== ② 主写入 =====
  L.push(cm('-- ===== ② 主写入 → ' + TASK.targetTable + ' ====='));
  if (TASK.writeMode === 'overwrite' && dl.key === 'mysql') {
    L.push(cm(`-- ${dl.name} 无 INSERT OVERWRITE：以「同一事务内先删当日分区再插入」表达覆盖语义`));
    L.push(kw('START TRANSACTION') + ';');
    L.push(kw('DELETE FROM') + ` ${TASK.targetTable} ${kw('WHERE')} ${TASK.partitionField} = ${PV};`);
  } else if (TASK.writeMode === 'overwrite' && dl.key === 'doris') {
    L.push(cm(`-- ${dl.name} 覆盖语义：动态分区表由 INSERT 覆盖同名分区；静态分区需先 ALTER TABLE ${TASK.targetTable} ADD PARTITION`));
  }
  const colList = dl.partitionInProjection ? [TASK.partitionField].concat(cols.map(c => c.name)) : null;
  if (dl.partitionInProjection) {
    L.push(kw('INSERT INTO') + ` ${TASK.targetTable} (${colList.join(', ')})`);
    L.push(mainSelectWithPart);
  } else {
    L.push(dl.overwriteHeader(TASK.targetTable, TASK.partitionField, PV).replace('INSERT OVERWRITE TABLE', TASK.writeMode === 'overwrite' ? kw('INSERT OVERWRITE TABLE') : kw('INSERT INTO TABLE')));
    L.push(mainSelect);
  }
  L.push(';');
  if (TASK.writeMode === 'overwrite' && dl.key === 'mysql') L.push(kw('COMMIT') + ';');
  L.push('');

  // ===== ③ 脏数据分流 =====
  const dirtyOn = !!(get('quality') && get('quality').config && get('quality').config.dirty);
  L.push(cm('-- ===== ③ 脏数据分流 → ' + dirtyTableName() + ' ====='));
  if (!dirtyOn) {
    L.push(cm('-- 已在「质量校验」中关闭分流：失败行不落隔离表（建议开启，避免脏数据只能靠人工导 CSV 排查）'));
  } else if (!failItems.length) {
    L.push(cm('-- 当前配置下没有会产生失败行的转换（类型转换均未选「丢弃该行」且日期字段可解析），本段不生成写入'));
  } else {
    L.push(cm(`-- 血缘：${TASK.sourceTable} → ${dirtyTableName()} → 数据质量看板 / 人工复洗队列 → 复核后回灌 ${TASK.targetTable}`));
    L.push(cm('-- 说明：同一行若有多个字段失败会写入多条（每字段一条），便于按字段维度统计复洗工作量'));
    L.push(cm(`-- 建表建议：CREATE TABLE ${dirtyTableName()} (`));
    L.push(cm(`--     ${TASK.partitionField} ${strType}, ${baseCols.slice(0, 4).map(c => `${c.src} ${strType}`).join(', ')}, …`));
    L.push(cm(`--     fail_field ${strType}, fail_reason ${strType}, fail_raw_value ${strType}, quarantine_time TIMESTAMP`));
    const dirtyPartNote = (dl.key === 'hive' || dl.key === 'spark') ? ` PARTITIONED BY (${TASK.partitionField})` : ` -- 分区同 ${TASK.targetTable}`;
    L.push(cm(`--   )${dirtyPartNote}`));
    // 隔离表一律「追加」写入，不跟随目标表的 writeMode：
    //   目标是可覆盖重跑的生产表，隔离表是复洗/追溯的台账 —— 用 OVERWRITE 会把上一批
    //   尚未处理的脏数据连同 quarantine_time 一起删掉，等于把复洗队列清了。
    L.push(cm(`-- 写入方式：追加（不覆盖历史，保证复洗队列与追溯链完整）；主表写入模式为 ${TASK.writeMode === 'overwrite' ? '覆盖当日分区' : '追加'}`));
    const dirtyInner = [
      '    ' + kw('SELECT'),
      baseCols.map((c, i) => `${i === 0 ? '      ' : '    , '}${pad(cleanedExpr(c.src), '       ')} ${kw('AS')} ${c.name}`).join('\n'),
      '    ' + kw('FROM') + ' ' + TASK.sourceTable,
      '    ' + kw('WHERE') + ` ${TASK.partitionField} = ${pad(SRC_PART, '      ')}`,
    ].join('\n');
    const dirtyBranches = failItems.map(it => {
      const head = dl.partitionInProjection
        ? `  ${kw('SELECT')}\n        ${PV} ${kw('AS')} ${TASK.partitionField}`
        : `  ${kw('SELECT')}`;
      const proj = baseCols.map(c => `    , ${pad(`r.${c.name}`, '      ')}${cm(`  -- ${c.cn}`)}`).join('\n');
      const tail = [
        `    , '${sqlStr(it.field)}' ${kw('AS')} fail_field`,
        `    , '${sqlStr(it.reason)}' ${kw('AS')} fail_reason`,
        `    , ${fn('CAST')}(${pad(`r.${it.field}`, '    ')} ${kw('AS')} ${strType}) ${kw('AS')} fail_raw_value`,
        `    , ${fn('CURRENT_TIMESTAMP()')} ${kw('AS')} quarantine_time${cm('  -- 入隔离表时间')}`,
        `  ${fn('FROM')} (`,
        dirtyInner,
        '  ) r',
        `  ${kw('WHERE')} ${it.pred}`,
      ].join('\n');
      return head + '\n' + proj + '\n' + tail;
    });
    const dirtyHeader = dl.partitionInProjection
      ? kw('INSERT INTO') + ` ${dirtyTableName()} (${TASK.partitionField}, ${baseCols.map(c => c.name).join(', ')}, fail_field, fail_reason, fail_raw_value, quarantine_time)`
      : dl.overwriteHeader(dirtyTableName(), TASK.partitionField, PV).replace('INSERT OVERWRITE TABLE', kw('INSERT INTO TABLE'));
    L.push(dirtyHeader);
    L.push(dirtyBranches.join('\n' + cm('  UNION ALL') + '\n'));
    L.push(';');
  }
  return L.join('\n');
}

// =====================================================================
// 统一重算入口：任何配置变更都必须重跑流水线，否则预览会展示旧缓存
//   apply(label) 同时是「历史登记」的唯一收口：
//   在这里比对「上一次已登记的状态」，不同就把变更前的快照压入撤销栈。
//   好处 —— 不需要在 40 多个 handler 里逐个埋点，也就不存在
//   「某个入口忘了登记历史」这种漏网之鱼；label 描述的是本次变更。
// =====================================================================
function recompute() {
  executePipeline();
  // 与 toggleStep() 同款兜底：切源表 / 多表批处理等也会让当前回放点指向一个已停用的步骤。
  // 一并把"挪到了哪里"告知用户 —— 否则字段数变化会被误解为"数据被改了"。
  const previewBefore = previewStepId;
  if (previewBefore !== '__raw__' && !pipeline.find(s => s.id === previewBefore)?.enabled) previewStepId = lastStepId();
  renderAll();
  if (previewBefore !== previewStepId && previewBefore !== '__raw__') {
    const fromName = pipeline.find(x => x.id === previewBefore)?.name || previewBefore;
    const toName = pipeline.find(x => x.id === previewStepId)?.name || previewStepId;
    DF.app.toast(`预览回放点已从「${fromName}」自动切到「${toName}」（原步骤当前未启用）`, 'info', 2400);
  }
}
function apply(label) {
  recompute();
  commitHistory(label);
}
function renderAll() { renderSources(); renderFields(); renderPipeline(); renderPreview(); renderConfig(); applyLayout(); attachHelpIcons(document.getElementById('cfg-body')); }
function closeTopModal() { if (DF.app._lastOverlay) { DF.app._lastOverlay.remove(); DF.app._lastOverlay = null; } }

// =====================================================================
// 撤销 / 重做：栈里存的是「完整配置快照」（流水线顺序 + 每步启停与配置 + 任务 + 方言 + 源表）
//   前端原型是纯内存态，快照成本极低；换来的是任意深度回退都不会出现半截状态。
// =====================================================================
const HIST_LIMIT = 80;
let UNDO_STACK = [], REDO_STACK = [], LAST_STATE = null, HIST_SUSPEND = 0;
function histState() {
  return {
    pipeline: clone(pipeline.map(s => ({ id: s.id, enabled: s.enabled, config: s.config }))),
    task: clone(TASK), dialect: DIALECT, src: ACTIVE_SRC,
  };
}
// 从两份快照的真实差异里推导一句人话描述 —— 这样不必在几十个 handler 里手写标签，
// 撤销栈里也永远不会出现「配置变更」这种没有信息量的条目。
const CFG_LABEL = {
  renames: '字段重命名', drop: '排除字段', nullTokens: '空值占位符', trim: '去空格规则',
  fullwidth: '全角转换', collapse: '空白压缩', caseNorm: '大小写规范化', maps: '码值映射',
  casts: '类型转换', onFail: '转换失败策略', defaultValue: '失败默认值', cols: '日期字段选择',
  dayFirst: '歧义日期解释', target: '目标格式', keys: '去重键', keep: '保留策略',
  orderBy: '去重排序字段', joins: '关联配置', rules: '规则明细', dirty: '脏数据分流',
  threshold: '规则阈值', action: '不达标动作', type: '规则类型', field: '规则字段',
  pattern: '格式正则', values: '值域白名单', min: '区间下限', max: '区间上限',
};
// 任务配置字段的中文名（撤销标签、提示文案共用一份，避免两处口径漂移）
const TASK_LABEL = {
  code: '任务代码', name: '任务名称', owner: '责任人', sourceTable: '源表', targetTable: '目标表',
  partitionField: '分区字段', writeMode: '写入模式', bizdateVar: '业务日期变量',
  cycle: '调度周期', cycleTime: '调度时间', retry: '重试次数', upstream: '上游依赖',
};
function describeDiff(a, b) {
  const d = diffObjects(a, b, '', []);
  if (!d.length) return '配置变更';
  const p = d[0].path;
  const at = i => (b.pipeline[i] || a.pipeline[i] || {});
  let m = /^pipeline\.(\d+)\.enabled$/.exec(p);
  if (m) {
    const st = at(Number(m[1]));
    const name = (pipeline.find(s => s.id === st.id) || {}).name || st.id;
    return `${st.enabled ? '启用' : '停用'}「${name}」`;
  }
  if (/^pipeline\.\d+\.id$/.test(p)) return '调整步骤执行顺序';
  m = /^pipeline\.(\d+)\.config\.([A-Za-z_]+)/.exec(p);
  if (m) {
    const st = at(Number(m[1]));
    const name = (pipeline.find(s => s.id === st.id) || {}).name || st.id;
    return `修改「${name}」的${CFG_LABEL[m[2]] || m[2]}`;
  }
  if (/^task\./.test(p)) {
    const k = p.replace(/^task\./, '');
    return `修改任务配置：${TASK_LABEL[k] || k}`;
  }
  if (p === 'dialect') return '切换 SQL 方言';
  if (p === 'src') return '切换源表';
  return `配置变更（${d.length} 处）`;
}
function commitHistory(label) {
  if (HIST_SUSPEND) return;
  const now = histState();
  if (!LAST_STATE) { LAST_STATE = now; return; }
  if (eqConfig(LAST_STATE, now)) return;
  UNDO_STACK.push({ state: LAST_STATE, label: label || describeDiff(LAST_STATE, now) });
  if (UNDO_STACK.length > HIST_LIMIT) UNDO_STACK.shift();
  REDO_STACK.length = 0;
  LAST_STATE = now;
  renderHistoryBar();
}
function renderHistoryBar() {
  const u = document.getElementById('undo-btn'), r = document.getElementById('redo-btn');
  if (!u || !r) return;
  const ut = UNDO_STACK[UNDO_STACK.length - 1], rt = REDO_STACK[REDO_STACK.length - 1];
  u.disabled = !ut; r.disabled = !rt;
  u.title = ut ? `撤销：${ut.label}（⌘Z / Ctrl+Z）` : '没有可撤销的操作';
  r.title = rt ? `重做：${rt.label}（⇧⌘Z / Ctrl+Y）` : '没有可重做的操作';
  u.innerHTML = ut ? `↶ 撤销<span class="hist-badge">${UNDO_STACK.length}</span>` : '↶ 撤销';
  r.innerHTML = rt ? `↷ 重做<span class="hist-badge">${REDO_STACK.length}</span>` : '↷ 重做';
}
// 把一份快照写回当前状态（顺序、启停、配置、任务、方言、源表一并还原）
function restoreState(st) {
  if (!st) return;
  // 顺序：按快照顺序把每一步移到对应下标（选择排序式，原地不打乱 pipeline 引用）
  if (Array.isArray(st.pipeline)) {
    st.pipeline.forEach((c, i) => {
      const j = pipeline.findIndex(s => s.id === c.id);
      if (j >= 0 && j !== i) { const [moved] = pipeline.splice(j, 1); pipeline.splice(i, 0, moved); }
    });
  }
  pipeline.forEach(s => {
    const c = (st.pipeline || []).find(x => x.id === s.id);
    if (c) { s.enabled = c.enabled; s.config = clone(c.config); }
  });
  if (st.task) TASK = clone(st.task);
  if (st.dialect) DIALECT = st.dialect;
  if (st.src && st.src !== ACTIVE_SRC && SOURCES[st.src]) bindSource(st.src);
  HIST_SUSPEND++;
  recompute();
  HIST_SUSPEND--;
  LAST_STATE = histState();
  renderHistoryBar();
}
function undo() {
  const e = UNDO_STACK.pop();
  if (!e) { warn('没有可撤销的操作'); return; }
  REDO_STACK.push({ state: histState(), label: e.label });
  restoreState(e.state);
  DF.app.toast(`↶ 已撤销：${e.label}`, 'info', 1900);
}
function redo() {
  const e = REDO_STACK.pop();
  if (!e) { warn('没有可重做的操作'); return; }
  UNDO_STACK.push({ state: histState(), label: e.label });
  restoreState(e.state);
  DF.app.toast(`↷ 已重做：${e.label}`, 'info', 1900);
}

// ===== 步骤级操作 =====
function selectStep(id) { selectedStepId = id; previewStepId = id; renderAll(); }

// =====================================================================
// ❓ 帮助图标 helper：把所有 cfg-note / cfg-row__from 类的说明文字
//   收纳到 section 标题栏的 ❓ 按钮里，hover 时弹 popover。
//   默认 cfg-note 隐藏在页面上 —— 用户主动 hover 才能看到详细说明，
//   避免右栏被密密麻麻的灰色文字挤满（用户反馈：页面太复杂）。
//   ⚠ 这是一个"事后优化"——之前所有说明都平铺在配置面板上，现在折叠到 popover。
//     与"控件旁的反馈"（如"命中 X/Y 行"）区分：cfg-row__from 仍是反馈，不归 ❓。
//     cfg-row--warn 是告警（如"歧义未确认"），保留。
// =====================================================================
function attachHelpIcons(scope) {
  scope = scope || document;
  const sections = [...scope.querySelectorAll('.cfg-sec')];
  sections.forEach(sec => {
    const title = sec.querySelector('.cfg-sec__title');
    if (!title || title.querySelector('.cfg-help-icon')) return;
    // 归集本 section 内所有 cfg-note 文本（用 innerHTML 保留 <code> <b> 等格式）
    const notes = [...sec.querySelectorAll('.cfg-note')]
      .map(n => n.innerHTML.trim())
      .filter(Boolean);
    if (!notes.length) return;
    // 默认隐藏 cfg-note（CSS class 在容器范围内生效）
    sec.classList.add('cfg-sec--has-help');
    const btn = document.createElement('button');
    btn.className = 'cfg-help-icon';
    btn.setAttribute('aria-label', '查看说明');
    btn.setAttribute('data-help', '<div class="cfg-help-popover">' + notes.map(n => '<div class="cfg-help-popover__item">' + n + '</div>').join('') + '</div>');
    btn.innerHTML = '<span>❓</span>';
    title.appendChild(btn);
  });
  // 单一浮层（hover 哪个就定位哪个）—— 在 document.body 上挂一次即可，多次 attachHelpIcons 也复用
  ensureHelpPopover();
  // 只绑 scope 范围内的 icon（避免重复绑定历史 icon）
  scope.querySelectorAll('.cfg-help-icon').forEach(btn => {
    if (btn.dataset.boundHelp) return;
    btn.dataset.boundHelp = '1';
    btn.addEventListener('mouseenter', () => showHelpAt(btn));
    btn.addEventListener('mouseleave', () => scheduleHideHelp());
    btn.addEventListener('click', (e) => { e.stopPropagation(); showHelpAt(btn, true); });
  });
}
function ensureHelpPopover() {
  if (document.getElementById('cfg-help-popover')) return;
  const div = document.createElement('div');
  div.id = 'cfg-help-popover';
  div.className = 'cfg-help-popover-host';
  document.body.appendChild(div);
}
// 弹窗里内联 ❓ helper：cfg-help-icon--inline 指向兄弟隐藏 div（不走 cfg-sec/cfg-note 结构）
function bindInlineHelpIcons(scope) {
  scope = scope || document;
  scope.querySelectorAll('.cfg-help-icon--inline').forEach(btn => {
    if (btn.dataset.boundInline) return;
    btn.dataset.boundInline = '1';
    const targetId = btn.getAttribute('data-help-text');
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    btn.addEventListener('mouseenter', () => { clearTimeout(helpHideTimer); showInlineHelp(btn, target); });
    btn.addEventListener('mouseleave', () => scheduleHideHelp());
    btn.addEventListener('click', (e) => { e.stopPropagation(); showInlineHelp(btn, target, true); });
  });
}
function showInlineHelp(btn, target, pinned) {
  const pop = document.getElementById('cfg-help-popover');
  if (!pop) return;
  clearTimeout(helpHideTimer);
  pop.innerHTML = '<div class="cfg-help-popover">' + target.innerHTML + '</div>';
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - 360, r.left) + 'px';
  pop.style.top  = (r.bottom + window.scrollY + 6) + 'px';
  pop.classList.add('is-on');
  pop.onmouseenter = () => clearTimeout(helpHideTimer);
  pop.onmouseleave = () => { if (!pinned) scheduleHideHelp(); };
}
let helpHideTimer = null;
function scheduleHideHelp() {
  clearTimeout(helpHideTimer);
  helpHideTimer = setTimeout(hideHelp, 200);
}
function hideHelp() {
  const pop = document.getElementById('cfg-help-popover');
  if (pop) pop.classList.remove('is-on');
}
function showHelpAt(btn, pinned) {
  const pop = document.getElementById('cfg-help-popover');
  if (!pop) return;
  clearTimeout(helpHideTimer);
  pop.innerHTML = btn.getAttribute('data-help') || '';
  // 定位到 btn 下方
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - 360, r.left) + 'px';
  pop.style.top  = (r.bottom + window.scrollY + 6) + 'px';
  pop.classList.add('is-on');
  pop.onmouseenter = () => clearTimeout(helpHideTimer);
  pop.onmouseleave = () => { if (!pinned) scheduleHideHelp(); };
  if (pinned) {
    // 点击模式下，再点其他地方关掉
    pop.querySelector('.cfg-help-popover-close')?.addEventListener('click', hideHelp);
  }
}

function toggleStep(id) {
  const s = pipeline.find(x => x.id === id);
  s.enabled = !s.enabled;
  executePipeline();
  // 回放点不能悬空在已停用的步骤上 —— 那会同时出现"节点显示已停用"和"预览仍画它产出"的互相说谎。
  // 挪动到的目标已在 `lastStepId()` / `id` 这两处选过；这里只负责告知用户「回放点被挪了」。
  // ⚠ 这一行 _前后_ 的 previewStepId 才是「挪动之前 / 之后」，必须先用旧值记下，再调用挪动。
  const previewBefore = previewStepId;
  // 用 flag 而不是单一 `previewBefore !== previewStepId` 来区分两类修改：
  //   movedByDisable — 挪动：停用了正在回放的步骤，必须挪走（挪到 id 或 lastStepId）
  //   resumedToHere  — 恢复：再次启用「右栏正在显示的步骤」，让 preview 跟回 id
  // 两类都不需要挪动 toast（后者是"回原位"，用户期望的就是回到 id）。
  let movedByDisable = false;
  let resumedToHere = false;
  if (previewBefore !== '__raw__' && !pipeline.find(x => x.id === previewBefore)?.enabled) {
    previewStepId = s.enabled ? id : lastStepId();
    movedByDisable = s.enabled
      ? previewBefore !== id       // 启用挪动到的就是 id（极少情况）：previewBefore != id，挪
      : true;                        // 停用：永远视为挪动
  } else if (s.enabled && selectedStepId === id && previewBefore !== id) {
    previewStepId = id;
    resumedToHere = true;
  }
  renderAll();
  commitHistory(`${s.enabled ? '启用' : '停用'}「${s.name}」`);
  // ⚠ 用户最初报过「点了停用此步、字段莫名其妙变多」：本质就是 previewStepId 被挪动 + 没提示。
  // 只有挪动（movedByDisable）才出挪动 toast；resumedToHere 是"恢复原位"，用户期望的就是回到 id，
  // 不出挪动 toast，避免「启用反而被提示『字段变了』」。
  if (movedByDisable) {
    const fromName = pipeline.find(x => x.id === previewBefore)?.name || previewBefore;
    const toName = pipeline.find(x => x.id === previewStepId)?.name || previewStepId;
    DF.app.toast(`⚠ 预览回放点已自动从「${fromName}」切到「${toName}」—— 原步骤已停用，挪到最后一个启用步骤才不会画出不存在的中间态。`, 'warning', 2800);
  } else if (resumedToHere) {
    DF.app.toast(`✓ ${s.name} 已启用，配置与预览都已切回到这一步`, 'success', 1700);
  } else {
    DF.app.toast(`${s.name} 已${s.enabled ? '启用' : '停用'}${s.enabled ? '' : '，预览与质量指标已按新链路重算'}`, 'info', 1700);
  }
}
function resetStep(id) {
  const s = pipeline.find(x => x.id === id);
  if (!s || !s.recommend) return;
  const before = clone(s.config);
  s.config = s.recommend();
  apply(`恢复「${s.name}」的智能推荐`);
  DF.app.toast(eqConfig(before, s.config) ? `${s.name} 已经是推荐配置` : `✓ ${s.name} 已恢复为智能推荐规则`, 'success', 1800);
}

// =====================================================================
// 步骤顺序调整：纵向步骤条里直接拖拽 / 上移下移
//   ⚠ 顺序不是装饰：planColumns 与执行引擎都按 pipeline 的数组顺序推导，
//     把某步挪到它依赖的字段产生之前，会导致该步配置「悬空却静默失效」。
//     所以移动前先做一次真实的可达性校验，不通过就拒绝并说明原因。
// =====================================================================
function stepRefs(id, s) {
  const rf = [];
  const push = (name, what) => { if (name) rf.push({ field: name, what }); };
  if (id === 'map') {
    Object.keys(s.config.renames || {}).forEach(k => push(k, '重命名源字段'));
    (s.config.drop || []).forEach(k => push(k, '排除字段'));
  } else if (id === 'codemap') {
    effectiveMaps(s.config).forEach(m => push(m.field, '码值映射字段'));
  } else if (id === 'cast') {
    Object.keys(s.config.casts || {}).forEach(k => push(k, '类型转换字段'));
  } else if (id === 'date') {
    (s.config.cols || []).forEach(k => push(k, '日期标准化字段'));
  } else if (id === 'dedup') {
    (s.config.keys || []).forEach(k => push(k, '去重键'));
    push(s.config.orderBy, '去重排序字段');
  } else if (id === 'join') {
    (s.config.joins || []).forEach(j => push(j.leftKey, '关联左键'));
  } else if (id === 'derive') {
    (s.config.rules || []).forEach(r => {
      if (r.mode === 'concat') (r.sources || []).forEach(x => push(x, '派生来源列'));
      else push(r.source, '派生来源列');
    });
  } else if (id === 'mask') {
    (s.config.rules || []).forEach(r => push(r.field, '脱敏字段'));
  } else if (id === 'quality') {
    (s.config.rules || []).forEach(r => { if (r.enabled) push(r.field, '质量规则字段'); });
  }
  return rf;
}
// 返回 null = 可以移动；否则返回第一条「移动后取不到字段」的说明
//   ⚠ 步骤内部可能存在「按顺序自我供给」的依赖：
//     第 2 个关联的左键 dept_code 来自第 1 个关联产出的列；派生规则可以引用同一步里
//     更靠前的派生列。若把整个步骤的引用一次性拿去和上游列比对，就会把它们误判为
//     悬空 —— 结果是「校验永远失败、排序功能整体死掉」。所以这里按步内顺序推演。
function validateStep(id, s, cols) {
  const names = () => cols.map(c => c.name);
  const missing = r => r.field && !/^__/.test(r.field) && !names().includes(r.field);
  if (id === 'join') {
    const local = cols.slice();
    const joins = s.config.joins || [];
    for (let i = 0; i < joins.length; i++) {
      const lk = joins[i].leftKey;
      if (lk && !local.some(c => c.name === lk)) {
        return `「${s.name}」第 ${i + 1} 个关联的左键「${lk}」在上游还不存在`;
      }
      // ⚠ applyColsStep 的签名是 (step, cols)，第一个参数必须是步骤对象
      applyColsStep({ id: 'join', config: { joins: [joins[i]] } }, local);
    }
    return null;
  }
  if (id === 'derive') {
    const local = cols.slice();
    const rules = s.config.rules || [];
    for (let i = 0; i < rules.length; i++) {
      const refs = rules[i].mode === 'concat' ? (rules[i].sources || []) : [rules[i].source];
      const bad = refs.find(f => f && !local.some(c => c.name === f) && !names().includes(f));
      if (bad) return `「${s.name}」第 ${i + 1} 个派生列的来源「${bad}」在上游还不存在`;
      if (rules[i].name && !local.some(c => c.name === rules[i].name)) {
        local.push({ name: rules[i].name, cn: rules[i].cn || '派生列', origin: 'derive' });
      }
    }
    return null;
  }
  const bad = stepRefs(id, s).find(missing);
  return bad ? `「${s.name}」的${bad.what}「${bad.field}」在上游还不存在` : null;
}
function checkPlacement(stepId, targetIdx) {
  const order = pipeline.map(s => s.id);
  const from = order.indexOf(stepId);
  if (from < 0) return null;
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(targetIdx, order.length)), 0, stepId);
  // 与 planColumns 完全同口径地重放一遍列演进（停用的步骤不改变列，也不做校验）
  const cols = FIELDS.map(f => ({ name: f.name, cn: f.cn, src: f.name, srcType: f.srcType, type: f.srcType, origin: 'source' }));
  for (const id of order) {
    const s = pipeline.find(x => x.id === id);
    if (!s || !s.enabled) continue;
    const reason = validateStep(id, s, cols);
    if (reason) return reason;
    applyColsStep(s, cols);
  }
  return null;
}
function moveStep(id, dir) {
  const from = pipeline.findIndex(s => s.id === id);
  if (from < 0) return;
  const to = from + (dir === 'up' ? -1 : 1);
  if (to < 0 || to >= pipeline.length) return;
  reorderStep(from, to);
}
function reorderStep(from, to) {
  if (from === to) return;
  const s = pipeline[from];
  const reason = checkPlacement(s.id, to);
  if (reason) {
    warn(`${reason}。顺序调整已取消 —— 强行移动会让这一步的配置静默失效`);
    renderPipeline();
    return;
  }
  const [moved] = pipeline.splice(from, 1);
  pipeline.splice(to, 0, moved);
  recompute();
  commitHistory(`调整「${moved.name}」的执行顺序（第 ${from + 1} → 第 ${to + 1} 位）`);
  DF.app.toast(`「${moved.name}」已移到第 ${to + 1} 位，预览与 SQL 按新顺序重算`, 'success', 1900);
}
function resetOrder() {
  const before = pipeline.map(s => s.id).join(',');
  DEFAULT_ORDER.forEach((id, i) => {
    const j = pipeline.findIndex(s => s.id === id);
    if (j >= 0 && j !== i) { const [m] = pipeline.splice(j, 1); pipeline.splice(i, 0, m); }
  });
  recompute();
  commitHistory('恢复默认执行顺序');
  DF.app.toast(before === pipeline.map(s => s.id).join(',') ? '当前已是默认顺序' : '已恢复默认执行顺序（结构映射 → 标准化 → 去重 → 宽表 → 安全 → 校验）', 'info', 2000);
}

// ===== 字段映射 =====
function setRename(src, dst) {
  const map = pipeline.find(s => s.id === 'map');
  const snapshot = clone(map.config.renames || {});
  const oldName = snapshot[src] || src;
  const newName = String(dst || '').trim();
  delete map.config.renames[src];

  if (!newName || newName === src) {
    if (oldName !== src) migrateColumnRef(oldName, src);
    apply();
    DF.app.toast(`${src} 已恢复源字段名`, 'info', 1400);
    return;
  }
  if (!/^[a-z][a-z0-9_]*$/.test(newName)) {
    map.config.renames = snapshot;
    warn('字段名只能包含小写字母 / 数字 / 下划线，且不能以数字开头');
    renderConfig();
    return;
  }
  map.config.renames[src] = newName;
  const names = planColumns().map(c => c.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) {
    map.config.renames = snapshot;
    warn(`字段名 ${dup} 重复，重命名未生效`);
    renderConfig();
    return;
  }
  migrateColumnRef(oldName, newName);
  apply();
  DF.app.toast(`${oldName} → ${newName}，后续步骤中的引用已同步迁移`, 'success', 1800);
}
function toggleDrop(name, checked) {
  const map = pipeline.find(s => s.id === 'map');
  const dd = pipeline.find(s => s.id === 'dedup');
  const used = dd && dd.enabled && ((dd.config.keys || []).includes(name) || dd.config.orderBy === name);
  if (checked && used) {
    warn(`${name} 是去重键 / 去重排序依据，不能排除；如确需排除请先修改「数据去重」配置`);
    renderConfig();
    return;
  }
  const set = new Set(map.config.drop || []);
  checked ? set.add(name) : set.delete(name);
  map.config.drop = [...set];
  apply();
}

// ===== 字段清理 =====
function setCleanOpt(key, val) {
  const s = pipeline.find(x => x.id === 'clean');
  s.config[key] = val;
  apply();
}
function setNullTokens(v) {
  const s = pipeline.find(x => x.id === 'clean');
  s.config.nullTokens = v;
  apply();
}

// ===== 码值映射 =====
function addMap() {
  const s = pipeline.find(x => x.id === 'codemap');
  const used = (s.config.maps || []).map(m => m.field);
  const cand = planColumns('codemap').find(c => c.origin === 'source' && !used.includes(c.name));
  s.config.maps = [...(s.config.maps || []), { field: cand ? cand.name : '', pairs: [{ from: '', to: '' }], others: 'keep', defaultValue: '未知' }];
  apply();
}
function removeMap(i) {
  const s = pipeline.find(x => x.id === 'codemap');
  s.config.maps.splice(i, 1);
  apply();
}
/** 把一块「不生效的重复映射」并进它上面那一组：补上缺的对照，然后删掉本块。
    ⚠ 已存在的 from **不覆盖** —— 否则等于悄悄改掉了生效组的语义；跳过的条数要在提示里说清。 */
function mergeRedundantMap(i) {
  const s = pipeline.find(x => x.id === 'codemap');
  const maps = s.config.maps || [];
  const m = maps[i];
  if (!m || !m.field) return;
  const first = maps.findIndex(x => x && x.field === m.field);
  if (first < 0 || first === i) return;
  const tgt = maps[first];
  tgt.pairs = tgt.pairs || [];
  const have = new Set(tgt.pairs.map(p => String(p.from)));
  let added = 0, skipped = 0;
  (m.pairs || []).forEach(p => {
    if (String(p.from) === '') return;
    if (have.has(String(p.from))) { skipped++; return; }
    tgt.pairs.push({ from: p.from, to: p.to });
    have.add(String(p.from));
    added++;
  });
  maps.splice(i, 1);
  apply();
  DF.app.toast(
    skipped
      ? `已并入第 ${first + 1} 组：补上 ${added} 条对照，${skipped} 条因源值已存在被跳过（不覆盖原规则）`
      : `已并入第 ${first + 1} 组：补上 ${added} 条对照`,
    'success', 3600);
}
function setMapField(i, v) { const s = pipeline.find(x => x.id === 'codemap'); s.config.maps[i].field = v; apply(); }
function addMapPair(i) { const s = pipeline.find(x => x.id === 'codemap'); s.config.maps[i].pairs.push({ from: '', to: '' }); apply(); }
function removeMapPair(i, k) { const s = pipeline.find(x => x.id === 'codemap'); s.config.maps[i].pairs.splice(k, 1); apply(); }
function setMapPair(i, k, key, v) { const s = pipeline.find(x => x.id === 'codemap'); s.config.maps[i].pairs[k][key] = v; apply(); }
function setMapOthers(i, v, defVal) {
  const s = pipeline.find(x => x.id === 'codemap');
  s.config.maps[i].others = v;
  if (v === 'default' && defVal !== undefined) s.config.maps[i].defaultValue = defVal;
  apply();
}

// ===== 类型转换 =====
function setCast(col, type) {
  const s = pipeline.find(x => x.id === 'cast');
  if (!type) delete s.config.casts[col]; else s.config.casts[col] = type;
  apply();
  DF.app.toast(type ? `${col} 将转换为 ${type}` : `${col} 保持源类型`, 'info', 1400);
}
function setOnFail(v) { pipeline.find(x => x.id === 'cast').config.onFail = v; apply(); }
function setFailDefault(v) { pipeline.find(x => x.id === 'cast').config.defaultValue = v; apply(); }

// ===== 日期标准化 =====
function setDateCol(name, checked) {
  const s = pipeline.find(x => x.id === 'date');
  if (!s) return;
  // ⚠ 非日期列必须在这里就被挡住。这里曾经无条件接受任何列名：用户勾上「读者证号」后，
  //   parseDate 对 R20260012 一律返回 null → 整列被静默写成 NULL，
  //   而且预览与 SQL 一起错，指标上看不出任何异常。
  if (checked && !isDateColName(name)) {
    DF.app.toast(`「${name}」不是日期字段，不能纳入日期标准化 —— 它的值解析不出日期，纳入后整列会变成 NULL`, 'warning', 3200);
    renderConfig();                                  // 把勾选状态回滚到真实配置
    return;
  }
  const set = new Set(s.config.cols || []);
  checked ? set.add(name) : set.delete(name);
  s.config.cols = [...set];
  apply();
}
// 清掉配置里残留的非日期列（旧版本面板允许把任意列加进来，且配置已持久化到 localStorage）
function dropStaleDateCols() {
  const s = pipeline.find(x => x.id === 'date');
  if (!s) return;
  const before = (s.config.cols || []).length;
  s.config.cols = (s.config.cols || []).filter(isDateColName);
  const n = before - s.config.cols.length;
  if (!n) { DF.app.toast('没有可移除的非日期列', 'info', 1800); return; }
  apply(`移除日期标准化里 ${n} 个非日期列`);
  DF.app.toast(`已移除 ${n} 个非日期列，预览与 SQL 已同步`, 'success', 2200);
}
function setDayFirst(v) {
  pipeline.find(x => x.id === 'date').config.dayFirst = (v === 'true');
  daAck();                                    // 显式选口径 = 人工确认过，清掉「待确认」标记
  apply(`确认日期歧义口径为「${v === 'true' ? '日在前 DD-MM-YYYY' : '月在前 MM-DD-YYYY'}」`);
  DF.app.toast(`歧义日期按 ${v === 'true' ? 'DD-MM-YYYY（日在前）' : 'MM-DD-YYYY（月在前）'} 重新解释，预览与 SQL 已同步`, 'info', 2000);
}

// ===== 去重 =====
function setDedupKey(name, checked) {
  const s = pipeline.find(x => x.id === 'dedup');
  const set = new Set(s.config.keys || []);
  checked ? set.add(name) : set.delete(name);
  s.config.keys = [...set];
  apply();
}
function setKeep(v) { pipeline.find(x => x.id === 'dedup').config.keep = v; apply(); }
function setDedupOrder(v) {
  const dd = pipeline.find(x => x.id === 'dedup');
  dd.config.orderBy = v;
  const map = pipeline.find(x => x.id === 'map');
  if ((map.config.drop || []).includes(Object.entries(map.config.renames || {}).find(([, d]) => d === v)?.[0] || v)) {
    warn(`${v} 当前被排除，去重在 SQL 中会把它作为技术字段保留，不会写入目标表`);
  }
  apply();
}

// ===== 多表关联 =====
function addJoin() {
  const s = pipeline.find(x => x.id === 'join');
  const t = LOOKUP_TABLES.dwd_patron;
  const avail = planColumns('join');
  const left = avail.find(c => c.name === t.key) || avail[0] || {};
  s.config.joins = [...(s.config.joins || []), {
    id: 'j' + Date.now(), type: 'left', table: t.name,
    leftKey: left.name || '', rightKey: t.key, fields: [],
  }];
  apply();
}
function removeJoin(i) { const s = pipeline.find(x => x.id === 'join'); s.config.joins.splice(i, 1); apply(); }
function setJoin(i, key, v) {
  const s = pipeline.find(x => x.id === 'join');
  const j = s.config.joins[i];
  if (!j) return;
  if (key === 'table') {
    const t = LOOKUP_TABLES[v];
    j.table = v;
    j.rightKey = t ? t.key : '';
    j.fields = [];
  } else if (key === 'rightKey') {
    j.rightKey = v;
    j.fields = (j.fields || []).filter(f => f !== v);
  } else {
    j[key] = v;
  }
  apply();
}
function toggleJoinField(i, field, checked) {
  const s = pipeline.find(x => x.id === 'join');
  const j = s.config.joins[i];
  const set = new Set(j.fields || []);
  checked ? set.add(field) : set.delete(field);
  j.fields = [...set];
  apply();
}

// ===== 列加工 =====
function addDerive() {
  const s = pipeline.find(x => x.id === 'derive');
  const names = planColumns().map(c => c.name);
  let nm = 'new_col', k = 1;
  while (names.includes(nm)) nm = 'new_col_' + (++k);
  const src = planColumns('derive')[0] || {};
  s.config.rules = [...(s.config.rules || []), { id: 'd' + Date.now(), mode: 'regex', name: nm, cn: '新派生列', source: src.name || '', pattern: '', group: 1 }];
  apply();
  DF.app.toast('已新增派生列，请配置源字段与正则', 'info', 1800);
}
function removeDerive(i) { const s = pipeline.find(x => x.id === 'derive'); s.config.rules.splice(i, 1); apply(); }
function setDerive(i, key, v) {
  const s = pipeline.find(x => x.id === 'derive');
  const r = s.config.rules[i];
  if (!r) return;
  if (key === 'name') {
    const nm = String(v || '').trim();
    if (!/^[a-z][a-z0-9_]*$/.test(nm)) { warn('派生列名只能包含小写字母 / 数字 / 下划线，且不能以数字开头'); renderConfig(); return; }
    if (planColumns().some(c => c.name === nm && c.rule !== r)) { warn(`字段名 ${nm} 已存在`); renderConfig(); return; }
    r.name = nm;
  } else if (key === 'group' || key === 'index') {
    r[key] = Number(v) || 0;
  } else {
    r[key] = v;
  }
  apply();
}
function toggleDeriveSource(i, name, checked) {
  const s = pipeline.find(x => x.id === 'derive');
  const r = s.config.rules[i];
  const list = (r.sources || []).filter(x => x !== name);
  if (checked) list.push(name);
  r.sources = list;
  apply();
}

// ===== 数据脱敏 =====
function addMask() {
  const s = pipeline.find(x => x.id === 'mask');
  const used = (s.config.rules || []).map(r => r.field);
  const cand = planColumns('mask').find(c => c.origin !== 'derive' && !used.includes(c.name));
  s.config.rules = [...(s.config.rules || []), { field: cand ? cand.name : '', mode: 'partial', keepLeft: 3, keepRight: 2 }];
  apply();
}
function removeMask(i) { const s = pipeline.find(x => x.id === 'mask'); s.config.rules.splice(i, 1); apply(); }
function setMask(i, key, v) {
  const s = pipeline.find(x => x.id === 'mask');
  const r = s.config.rules[i];
  if (!r) return;
  if (key === 'keepLeft' || key === 'keepRight') r[key] = Math.max(0, Number(v) || 0);
  else r[key] = v;
  apply();
}

// ===== 失败行导出 =====
function exportFailedRows() {
  const out = lastOutput();
  const rows = ((out && out.rows) || []).filter(r => r.__fail && Object.keys(r.__fail).length);
  if (!rows.length) { DF.app.toast('没有校验失败行，无需导出', 'info'); return; }
  const cols = planColumns();
  const keyCol = (cols.find(c => c.src === 'loan_id') || {}).name || 'loan_id';
  const timeCol = (cols.find(c => c.src === 'sync_time') || {}).name || 'sync_time';
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [[keyCol, timeCol, 'field', 'value_in_batch', 'raw_value'].join(',')];
  rows.forEach(r => Object.entries(r.__fail).forEach(([f, v]) => {
    lines.push([q(r[keyCol]), q(r[timeCol]), q(f), q(r[f]), q(v)].join(','));
  }));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ods_circ_loan_sync_failed_rows.csv';
  document.body.appendChild(a); a.click(); a.remove();
  DF.app.toast(`✓ 已导出 ${rows.length} 行失败明细（${lines.length - 1} 条字段级记录）`, 'success', 2200);
}

// =====================================================================
// 规则模板库：把高频清洗组合沉淀为可复用模板（覆盖范围按源表字段实时计算）
// =====================================================================
const TEMPLATES = [
  {
    name: '通用借阅流水清洗', domain: '流通域', when: 'ODS 借阅流水 → DWD 明细宽表',
    touched: ['loan_id', 'reader_id', 'loan_date', 'return_date', 'borrow_cnt', 'fine_amt', 'circ_status'],
    desc: 'TRIM + 空值占位归一 · 码值翻译（Y/N → 在借/已还）· 金额与次数转数值 · 日期多格式归一 · 按 loan_id 去重 · 关联读者主档与院系主档生成宽表',
    apply() {
      pipeline.forEach(s => { s.enabled = true; s.config = s.recommend(); });
      const mask = pipeline.find(s => s.id === 'mask');
      mask.enabled = false;
      mask.config = mask.recommend();
    },
  },
  {
    name: '读者主数据清洗', domain: '读者域', when: '读者相关字段的独立规整',
    touched: ['reader_id', 'loan_date', 'return_date'],
    desc: '证号去空格 · 日期归一 · 按 reader_no 去重（同一证号只留最新）；不做金额转换、不做码值翻译、不关联主档',
    apply() {
      pipeline.forEach(s => { s.enabled = true; s.config = s.recommend(); });
      const dd = pipeline.find(s => s.id === 'dedup');
      dd.config = { keys: ['reader_no'], keep: 'latest', orderBy: 'sync_time' };
      ['cast', 'codemap', 'join', 'derive', 'mask'].forEach(id => { pipeline.find(s => s.id === id).enabled = false; });
    },
  },
  {
    name: '金额 / 日期轻度清洗', domain: '通用', when: '源端已有主键保障，仅做格式规整',
    touched: ['borrow_cnt', 'fine_amt', 'loan_date', 'return_date'],
    desc: '只做字段清理 + 类型转换 + 日期归一；不去重、不关联、不派生（适用于只关心格式规整的一遍扫）',
    apply() {
      pipeline.forEach(s => { s.enabled = true; s.config = s.recommend(); });
      ['dedup', 'join', 'derive', 'mask'].forEach(id => { pipeline.find(s => s.id === id).enabled = false; });
    },
  },
];
function templateMatch(t) {
  const hit = t.touched.filter(f => FIELDS.some(x => x.name === f)).length;
  return { hit, total: FIELDS.length, rate: hit / FIELDS.length };
}
function openTemplateLib() {
  const cards = TEMPLATES.map((t, i) => {
    const m = templateMatch(t);
    return `<div class="tpl-card" data-resolve="tpl:${i}">
      <div class="tpl-card__top"><b>${esc(t.name)}</b><span class="tag">${esc(t.domain)}</span>
        <span class="tpl-card__match">覆盖 ${m.hit}/${m.total} 字段</span></div>
      <div class="tpl-card__desc">${esc(t.desc)}</div>
      <div class="tpl-card__when">适用：${esc(t.when)}</div>
      <div class="tpl-card__foot">
        <span class="tpl-card__hint">套用后可随时用顶栏「↶ 撤销」一键回退</span>
        <button type="button" class="btn btn--sm btn--primary tpl-card__apply" data-resolve="apply:${i}" onclick="event.stopPropagation()" title="把「${esc(t.name)}」的整条流水线配置套用到当前源表（可撤销）">套用此模板</button>
      </div>
    </div>`;
  }).join('');
  DF.app.modal({
    title: '📚 清洗规则模板库',
    width: 620,
    body: `<div class="cfg-note" style="margin-bottom:10px;">模板 = 一整套清洗流水线配置。同类源表接入时一键套用，再按字段微调，避免从零配置。覆盖范围按源表实际字段实时计算。</div>
      <div style="display:flex;flex-direction:column;gap:8px;">${cards}</div>`,
    actions: '<button class="btn" data-resolve>关闭</button>',
  }).then(r => {
    // 两个 resolve 值：按钮的 'apply:i'（显式套用）与整卡点击的 'tpl:i'（老用法，保留）。
    // ⚠ 按钮上带 onclick="event.stopPropagation()"，避免点按钮后事件冒泡到卡片触发第二次 close。
    const v = r == null ? '' : String(r);
    if (v.indexOf('apply:') === 0) applyTemplate(Number(v.slice(6)));
    else if (v.indexOf('tpl:') === 0) applyTemplate(Number(v.slice(4)));
  });
}
function applyTemplate(i) {
  const t = TEMPLATES[i];
  if (!t) return;
  const dirty = pipeline.some(s => !eqConfig(s.config, s.recommend()));
  const run = () => {
    t.apply();
    // 回放点与配置面板都落到「日期标准化」—— 三个模板都恰好保留这一步，
    // 所以 recompute() 里的兜底不会再挪走它（挪动提示只会在真有步骤被停用时出现）。
    selectedStepId = 'date';
    previewStepId = 'date';
    // ⚠ 2026-09-21 修：原来是 executePipeline() + renderAll() 自行拼一遍 —— 绕过了统一通道，
    //   于是套用模板不进撤销栈（实测点完「撤销」仍 disabled、undo() 回「没有可撤销的操作」）。
    //   改走 apply(label)：内部 recompute() 重算 + commitHistory() 登记，与其它 40 多个入口同一条路。
    apply(`套用模板「${t.name}」`);
    // 注：toast(type='success') 自己会渲染一个 "✓" 图标，文案里不再重复写。
    DF.app.toast(`已套用模板「${t.name}」，预览、质量指标与 SQL 已同步重算（可撤销）`, 'success', 2600);
  };
  if (!dirty) { run(); return; }
  DF.app.modal({
    title: '⚠ 确认套用模板？',
    width: 470,
    body: `<div style="font-size:13px;line-height:1.85;color:var(--neutral-700);">当前流水线存在<b>自定义配置</b>，套用模板「${esc(t.name)}」会覆盖这些改动。
      <br><span style="color:var(--neutral-500);font-size:12px;">套用后若想反悔，可在顶栏点「↶ 撤销」一键回到套用前的完整配置（含你手工调过的每一项）。</span></div>`,
    actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">覆盖并套用</button>',
  }).then(r => { if (r === 'ok') run(); });
}

// ===== 顶栏与页签 =====
function runPreview() {
  executePipeline();
  const previewBefore = previewStepId;
  if (previewBefore !== '__raw__' && !pipeline.find(s => s.id === previewBefore)?.enabled) previewStepId = lastStepId();
  renderAll();
  const m = computeQuality();
  const moved = previewBefore !== previewStepId && previewBefore !== '__raw__';
  if (moved) {
    const fromName = pipeline.find(x => x.id === previewBefore)?.name || previewBefore;
    const toName = pipeline.find(x => x.id === previewStepId)?.name || previewStepId;
    DF.app.toast(`✓ 已按当前规则重算：产出 ${m.rowCount} 行、${m.cols.length} 列，质量分 ${m.score}（回放点已从「${fromName}」切到「${toName}」）`, 'success', 2600);
  } else {
    DF.app.toast(`✓ 已按当前规则重算：产出 ${m.rowCount} 行、${m.cols.length} 列，质量分 ${m.score}`, 'success', 2000);
  }
}
function switchTab(t) {
  activeTab = t;
  document.getElementById('tab-cfg').classList.toggle('cfg-tab--active', t === 'cfg');
  document.getElementById('tab-sql').classList.toggle('cfg-tab--active', t === 'sql');
  renderConfig();
}
function toggleSqlTab() { switchTab(activeTab === 'sql' ? 'cfg' : 'sql'); }
function saveTask() {
  const m = computeQuality();
  const enabled = pipeline.filter(s => s.enabled).length;
  DF.app.modal({
    title: '💾 保存清洗任务',
    width: 560,
    body: `<div style="font-size:13px;line-height:1.9;color:var(--neutral-700);">
      清洗任务 <b class="text-mono" style="color:var(--brand-700);">clean_ods_circ_loan</b> 将保存为可视化流水线（${enabled} 步），并生成对应的清洗 SQL 进入任务编排。<br>
      <span style="font-size:12px;color:var(--brand-700);background:var(--brand-50);padding:2px 8px;border-radius:4px;">分层链路：ODS 原始层 → 清洗标准化 → <b>DWD 明细层</b>（dwd_circ_loan_di）</span><br>
      <div style="margin-top:10px;padding:10px 12px;background:var(--neutral-50);border-radius:8px;font-size:12px;">
        <div style="display:flex;gap:8px;"><span style="flex:1;">产出字段</span><b>${m.cols.length} 列（含关联 ${m.cols.filter(c => c.origin === 'join').length} 列、派生 ${m.cols.filter(c => c.origin === 'derive').length} 列）</b></div>
        <div style="display:flex;gap:8px;"><span style="flex:1;">采样产出</span><b>${m.rowCount} 行</b></div>
        <div style="display:flex;gap:8px;"><span style="flex:1;">采样质量分</span><b>${m.score}</b></div>
        <div style="display:flex;gap:8px;"><span style="flex:1;">转换失败</span><b>${m.failedCells} 格</b></div>
      </div>
      <span style="color:var(--neutral-500);font-size:12px;display:block;margin-top:10px;">上线建议：先对全量执行一次试跑并核对质量分，再挂载每日调度；质量分低于阈值时应阻断写入而非静默产出。</span>
    </div>`,
    actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">确认保存</button>',
  }).then(r => { if (r === 'ok') DF.app.toast('✓ 清洗任务已保存，清洗结果将写入 DWD 明细层', 'success', 2400); });
}

// =====================================================================
// 第 3 档交互：方言 / 复制下载 / 质量规则 / 脏数据分流 / 采样与全量 / 任务与版本
// =====================================================================

// ===== 方言 =====
function setDialect(k) {
  if (!DIALECTS[k]) return;
  if (k === DIALECT) return;
  DIALECT = k;
  apply(`切换 SQL 方言为 ${DIALECTS[k].name}`);
  DF.app.toast(`已切换目标方言：${DIALECTS[k].name} ${DIALECTS[k].ver}，SQL 已按该引擎语法重写`, 'success', 2200);
}
function sqlText() {
  // 纯文本版本（去掉高亮标签），用于复制与下载
  return genSQL(true)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
function copySql() {
  const txt = sqlText();
  const done = () => DF.app.toast(`✓ 已复制 ${txt.split('\n').length} 行 SQL 到剪贴板`, 'success', 2000);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
  } else fallbackCopy(txt, done);
}
function fallbackCopy(txt, done) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.cssText = 'position:fixed;left:-9999px;';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand && document.execCommand('copy');
  ta.remove();
  ok ? done() : warn('当前浏览器不允许自动复制，已改为下载文件');
  if (!ok) downloadSql();
}
function downloadSql() {
  const txt = sqlText();
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${TASK.code}.${DIALECT}.sql`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  DF.app.toast(`⤓ 已下载 ${TASK.code}.${DIALECT}.sql（${(txt.length / 1024).toFixed(1)} KB）`, 'success', 2200);
}

// ===== 质量规则 =====
function qSpec() { return pipeline.find(s => s.id === 'quality'); }
function addQualityRule() {
  const s = qSpec();
  const cols = planColumns('quality');
  s.config.rules = s.config.rules || [];
  s.config.rules.push(newRule('notnull', cols[0] ? cols[0].name : '', { threshold: 100, action: 'warn' }));
  apply();
}
function removeQualityRule(i) { qSpec().config.rules.splice(i, 1); apply(); }
function setQualityRule(i, key, v) {
  const r = qSpec().config.rules[i];
  if (!r) return;
  if (key === 'threshold') v = Math.max(0, Math.min(100, Number(v) || 0));
  if (key === 'type') {
    r.type = v;
    if (v === 'range') { r.min = r.min === '' ? 0 : r.min; r.max = r.max === '' ? 99 : r.max; }
    if (v === 'enum' && !r.values) r.values = '在借,已还';
    if (v === 'regex' && !r.pattern) r.pattern = '^LN\\d{11}$';
    if (v === 'custom' && !r.op) r.op = 'IS NOT NULL';
  } else r[key] = v;
  apply();
}
function toggleDirty(v) { qSpec().config.dirty = !!v; apply(); }

// ===== 采样 / 全量 =====
function openSampleInfo() {
  const m = computeQuality();
  const rows = (lastOutput()?.rows) || [];
  DF.app.modal({
    title: 'ⓘ 数据口径：采样预览 vs 全量试跑',
    width: 600,
    body: `<div style="font-size:12.5px;line-height:1.9;color:var(--neutral-700);">
      <div style="padding:10px 12px;background:var(--brand-50);border:1px solid var(--brand-100);border-radius:8px;">
        <b>当前模式：${RUNMODE === 'full' ? `⚡ 全量试跑（${FULL_N.toLocaleString()} 行）` : `采样预览（${RAW_ROWS.length} 行）`}</b><br>
        ${RUNMODE === 'full'
          ? `已按 12 行模板等比例放大到 ${FULL_N.toLocaleString()} 行并真实跑完全部 ${pipeline.filter(s => s.enabled).length} 步；预览表只渲染前 ${PREVIEW_CAP} 行，但质量指标统计的是全量。`
          : `12 行是从昨日全量 1,284,730 行里随机抽的样本，<b>只用于看清规则效果，不能代表全量分布</b>。上量前请务必做一次全量试跑。`}
      </div>
      <div style="margin-top:12px;padding:10px 12px;background:var(--neutral-50);border-radius:8px;">
        <div style="display:flex;"><span style="flex:1;">本次产出规模</span><b>${m.rowCount.toLocaleString()} 行 × ${m.cols.length} 列</b></div>
        <div style="display:flex;"><span style="flex:1;">质量分</span><b>${m.score}</b></div>
        <div style="display:flex;"><span style="flex:1;">质量分口径</span><b style="color:var(--neutral-600);">比率加权（与规模无关，两种模式可直接比）</b></div>
        <div style="display:flex;"><span style="flex:1;">门禁判定</span><b style="color:${GATE.blocked ? 'var(--danger-700)' : GATE.bad.length ? 'var(--warning-700)' : 'var(--success-700)'};">${GATE.blocked ? '⛔ 阻断写入' : GATE.bad.length ? `⚠ ${GATE.bad.length} 条未达阈值（告警）` : '✓ 全部达标'}</b></div>
      </div>
      <div style="margin-top:12px;color:var(--neutral-600);">
        <b>为什么必须区分？</b>采样阶段规则效果看得快，但阈值是拿采样算的；一旦全量分布更脏，采样阶段「达标」的规则会在生产上翻车。所以本页把「采样预览」与「全量试跑」做成两个显式入口，全量试跑带行数上限保护，避免误触发大查询。
      </div>
    </div>`,
    actions: RUNMODE === 'full'
      ? '<button class="btn" data-resolve>关闭</button><button class="btn btn--primary" data-resolve="back">↩ 返回采样模式</button>'
      : '<button class="btn" data-resolve>关闭</button><button class="btn btn--primary" data-resolve="run">⚡ 全量试跑</button>',
  }).then(r => {
    if (r === 'back') { RUNMODE = 'sample'; FULL_CACHE = null; FULL_N = 0; FULL_STATS = null; apply(); DF.app.toast('已切回采样模式（' + RAW_ROWS.length + ' 行）', 'info', 2000); }
    if (r === 'run') openFullRun();
  });
}
function openFullRun() {
  DF.app.modal({
    title: '⚡ 全量试跑（带行数上限保护）',
    width: 580,
    body: `<div style="font-size:12.5px;line-height:1.9;color:var(--neutral-700);">
      源表 <b class="text-mono">${esc(TASK.sourceTable)}</b> 昨日全量 <b>1,284,730 行</b>。<br>
      本次试跑会按 12 行模板等比例生成数据并真实跑完全部步骤，用于验证规则在全量分布下是否仍然成立。
      <div style="margin-top:12px;padding:10px 12px;background:var(--neutral-50);border-radius:8px;">
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="flex:0 0 96px;">本次试跑行数</span>
          <input class="cfg-input" id="fr-n" type="number" min="100" max="${FULL_LIMIT}" value="200000" style="font-family:var(--font-mono);">
          <span style="font-size:11px;color:var(--neutral-500);">上限 ${FULL_LIMIT.toLocaleString()} 行</span>
        </label>
        <div style="margin-top:6px;font-size:11px;color:var(--neutral-500);">超过上限会被拒绝，避免在原型/开发环境误触发大查询。</div>
      </div>
      <div style="margin-top:12px;color:var(--neutral-600);">
        试跑完成后，预览表只渲染前 ${PREVIEW_CAP} 行，但<b>质量分、失败格数、门禁判定全部按全量统计</b>；切回采样模式即可恢复 12 行口径。
      </div>
    </div>`,
    actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">开始试跑</button>',
  }).then(r => {
    if (r !== 'ok') return;
    const ov = DF.app._lastOverlay;
    const n = ov ? Number((ov.querySelector('#fr-n') || {}).value) : 0;
    if (!n || n < 1) { warn('请填写有效的试跑行数'); return; }
    if (n > FULL_LIMIT) { warn(`试跑行数超过上限 ${FULL_LIMIT.toLocaleString()}，已拒绝执行`); return; }
    if (n > 100000 && n <= FULL_LIMIT) { /* 大行数不额外确认，进度弹窗即反馈 */ }
    runFullTrial(n);
  });
}
const frame = () => new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));
function frunOverlay() {
  document.querySelectorAll('.df-modal__overlay').forEach(o => o.remove());
  const ov = document.createElement('div');
  ov.className = 'df-modal__overlay';
  ov.id = 'frun-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,23,40,.45);z-index:9998;display:grid;place-items:center;';
  ov.innerHTML = `<div style="background:#fff;border-radius:12px;width:600px;max-width:92vw;box-shadow:0 24px 48px rgba(0,0,0,.2);overflow:hidden;">
    <div style="padding:16px 24px;border-bottom:1px solid #EEF1F6;font-size:15px;font-weight:600;color:#111728;">⚡ 全量试跑进行中</div>
    <div id="frun-body" style="padding:18px 24px;"></div>
  </div>`;
  document.body.appendChild(ov);
  DF.app._lastOverlay = ov;
  return ov;
}
async function runFullTrial(n) {
  closeTopModal();
  const t0 = performance.now();
  FULL_CACHE = genFullRows(n);
  FULL_N = n;
  RUNMODE = 'full';
  const ov = frunOverlay();
  const body = () => ov.querySelector('#frun-body');
  const enabled = pipeline.filter(s => s.enabled);
  stepOutputs = [];
  let rows = sourceRows();
  const timings = [];
  const paint = (i, cur, extra) => {
    body().innerHTML = `
      <div style="font-size:12.5px;color:var(--neutral-700);line-height:1.9;">
        载入 <b>${n.toLocaleString()}</b> 行（按 12 行模板等比例放大，保留全部脏数据比例）<br>
        已执行 <b>${i}/${enabled.length}</b> 步${cur ? ` · 当前：${esc(cur.icon + ' ' + cur.name)}` : ''}
      </div>
      <div style="margin-top:10px;height:6px;background:var(--neutral-100);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${enabled.length ? (i / enabled.length * 100).toFixed(1) : 0}%;background:var(--brand-500);transition:width .15s;"></div>
      </div>
      <div style="margin-top:12px;font-family:var(--font-mono,monospace);font-size:11px;color:var(--neutral-500);line-height:1.8;">
        ${timings.map(t => `${t.name.padEnd(6, '　')} ${String(t.ms).padStart(6)} ms　${esc(t.stat)}`).join('<br>')}
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--neutral-400);">${extra || `已用时 ${((performance.now() - t0) / 1000).toFixed(1)} s`}</div>`;
  };
  paint(0, null);
  await frame();
  let idx = 0;
  for (const step of pipeline) {
    const ts = performance.now();
    const e = runStep(step, rows);
    stepOutputs.push(e);
    if (!e.skipped && !e.error) rows = e.rows;
    if (step.enabled) {
      idx++;
      timings.push({ name: step.name, ms: Math.round(performance.now() - ts), stat: e.skipped ? '已停用' : e.stat });
      paint(idx, step, null);
      await frame();
    }
  }
  refreshGate();
  const ms = performance.now() - t0;
  FULL_STATS = { n, ms, timings, at: tsNow() };
  // 结果弹窗
  const m = computeQuality();
  const dirty = (rows || []).filter(r => r.__fail && Object.keys(r.__fail).length).length;
  body().innerHTML = `
    <div style="font-size:12.5px;color:var(--neutral-700);line-height:1.9;">
      <div style="padding:10px 12px;background:${GATE.blocked ? 'var(--danger-50)' : 'var(--success-50)'};border-radius:8px;border:1px solid ${GATE.blocked ? 'var(--danger-100)' : 'var(--success-100)'};">
        <b style="color:${GATE.blocked ? 'var(--danger-700)' : 'var(--success-700)'};">${GATE.blocked ? '⛔ 门禁未通过 · 已阻断写入' : '✓ 全量试跑完成'}</b>
      </div>
      <div style="margin-top:12px;">
        <div style="display:flex;"><span style="flex:1;">试跑行数</span><b>${n.toLocaleString()} 行</b></div>
        <div style="display:flex;"><span style="flex:1;">产出规模</span><b>${m.rowCount.toLocaleString()} 行 × ${m.cols.length} 列</b></div>
        <div style="display:flex;"><span style="flex:1;">质量分（全量口径）</span><b>${m.score}</b></div>
        <div style="display:flex;"><span style="flex:1;">转换失败</span><b>${m.failedCells.toLocaleString()} 格 · 占比 ${(m.failRate * 100).toFixed(2)}%</b></div>
        <div style="display:flex;"><span style="flex:1;">去重消除</span><b>${(RAW_ROWS.length * Math.ceil(n / RAW_ROWS.length) - m.rowCount).toLocaleString()} 行</b></div>
        <div style="display:flex;"><span style="flex:1;">脏数据（将入隔离表）</span><b>${dirty.toLocaleString()} 行 · 占比 ${(m.rowCount ? dirty / m.rowCount * 100 : 0).toFixed(2)}%</b></div>
        <div style="display:flex;"><span style="flex:1;">总耗时</span><b>${(ms / 1000).toFixed(2)} s</b></div>
      </div>
      <div style="margin-top:10px;font-size:11.5px;color:var(--neutral-500);">质量分按<b>比率</b>计算（与规模无关），因此这里的全量得分可与采样模式的得分直接比对；<b>绝对条数</b>（失败格数、脏数据行数）才会随行数同比增长。</div>
      <div style="margin-top:12px;font-family:var(--font-mono,monospace);font-size:11px;color:var(--neutral-500);line-height:1.8;">
        ${timings.map(t => `${t.name.padEnd(6, '　')} ${String(t.ms).padStart(6)} ms　${esc(t.stat)}`).join('<br>')}
      </div>
      ${GATE.bad.length ? `<div style="margin-top:12px;padding:8px 10px;background:var(--warning-50);border-radius:6px;font-size:11.5px;color:var(--warning-700);">未达阈值：${esc(GATE.bad.map(r => `${qRuleLabel(r.rule)} 实测 ${r.rate.toFixed(2)}%`).join('；'))}</div>` : ''}
      <div style="margin-top:12px;font-size:11.5px;color:var(--neutral-600);">预览表只渲染前 ${PREVIEW_CAP} 行，指标按全量统计；如需恢复采样口径，点质量条右侧的「全量试跑」徽标即可切回。</div>
    </div>`;
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 24px;border-top:1px solid #EEF1F6;background:#F7F9FC;display:flex;justify-content:flex-end;gap:8px;';
  footer.innerHTML = '<button class="btn" id="fr-close">关闭</button><button class="btn btn--primary" id="fr-back">↩ 切回采样模式</button>';
  ov.firstElementChild.appendChild(footer);
  footer.querySelector('#fr-close').onclick = () => { ov.remove(); DF.app._lastOverlay = null; renderAll(); };
  footer.querySelector('#fr-back').onclick = () => {
    ov.remove(); DF.app._lastOverlay = null;
    RUNMODE = 'sample'; FULL_CACHE = null; FULL_N = 0;
    apply();
    DF.app.toast('已切回采样模式（' + RAW_ROWS.length + ' 行）', 'info', 2000);
  };
  renderAll();
}

// ===== 任务配置与版本 =====
function applyTaskField(key, v) {
  // 源表是「本页已登记的采样源」：改它等于换一张表。必须走完整的换表链路（换绑定 + 重算 + 记历史），
  // 否则会出现「预览/字段字典还是旧表，SQL 已经指向新表」的静默不一致。
  if (key === 'sourceTable') {
    const want = String(v || '').trim();
    if (want === TASK.sourceTable) return;
    if (SOURCES[want]) { switchSource(want); return; }
    warn(`「${want || '(空)'}」不是本页已登记的源表。请在左侧「源表清单」中切换，否则预览与 SQL 会指向不同的表`);
    renderConfig();
    return;
  }
  if (TASK[key] === v) return;
  TASK[key] = v;
  persistTask();
  // 任务配置同样影响「预览 / 质量门禁 / 生成的 SQL」（写入模式、分区字段、目标表…），
  // 所以必须和步骤配置走同一条 apply 通道：重算 + 记入撤销栈。只 renderConfig 是不够的。
  apply(`修改任务配置：${TASK_LABEL[key] || key}`);
}
function toggleDep(name, checked) {
  const set = new Set(TASK.upstream);
  checked ? set.add(name) : set.delete(name);
  TASK.upstream = [...set];
  persistTask();
  apply('修改任务依赖：上游表');
}
const TASK_KEY = 'df-cleaning-task';
function persistTask() { try { localStorage.setItem(TASK_KEY, JSON.stringify(TASK)); } catch (e) {} }
function loadTask() {
  try {
    const t = JSON.parse(localStorage.getItem(TASK_KEY) || 'null');
    if (t && t.targetTable) TASK = Object.assign(TASK, t);
  } catch (e) {}
}
// 调度表达式摘要（真实换算，不是写死的文案）
function scheduleExpr() {
  return TASK.cycle === 'hourly'
    ? `0 0 * * * ?（每小时第 ${(TASK.cycleTime.split(':')[1] || '0')} 分触发）`
    : `${TASK.cycleTime.split(':')[1] || '30'} ${TASK.cycleTime.split(':')[0] || '2'} * * * ?（每日 ${TASK.cycleTime} 触发）`;
}
function openTaskVersions(tab) {
  const t = tab || 'task';
  const isTask = t === 'task';
  const depChoices = [TASK.sourceTable, 'ods_reader', 'ods_holding', 'dwd_patron', 'dwd_org_dept'];
  const taskBody = `
    <div class="cfg-sec"><div class="cfg-sec__title">📋 基本信息</div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">任务代码</span><input class="cfg-input" value="${esc(TASK.code)}" onchange="applyTaskField('code',this.value)"></div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">任务名称</span><input class="cfg-input" value="${esc(TASK.name)}" onchange="applyTaskField('name',this.value)"></div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">责任人</span><input class="cfg-input" value="${esc(TASK.owner)}" onchange="applyTaskField('owner',this.value)"></div>
      <div class="cfg-note">任务代码会作为下载的 SQL 文件名与调度节点标识，建议与目标表名保持一致。</div>
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">🗄 读写配置（直接落进生成的 SQL）</div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">源表</span><input class="cfg-input" value="${esc(TASK.sourceTable)}" onchange="applyTaskField('sourceTable',this.value)"></div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">目标表</span><input class="cfg-input" value="${esc(TASK.targetTable)}" onchange="applyTaskField('targetTable',this.value)"></div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">分区字段</span><input class="cfg-input" value="${esc(TASK.partitionField)}" onchange="applyTaskField('partitionField',this.value)">
        <span class="cfg-row__from">隔离表自动为 ${esc(dirtyTableName())}</span></div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">写入模式</span>
        ${sel("applyTaskField('writeMode',this.value)", [{ v: 'overwrite', t: '覆盖当日分区' }, { v: 'append', t: '追加写入' }], TASK.writeMode)}</div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">调度变量</span>
        <input class="cfg-input cfg-input--sm" style="flex:0 0 120px;" value="${esc(TASK.bizdateVar)}" onchange="applyTaskField('bizdateVar',this.value)">
        <span class="cfg-row__from">SQL 中写作 <code>${esc(D().varRef(TASK.bizdateVar))}</code>，由调度器注入业务日期</span></div>
      <div class="cfg-note">分区读取为 T-1：<code>${esc(TASK.partitionField)} = ${esc(D().dayBefore(D().varRef(TASK.bizdateVar)))}</code>（按当前 ${esc(D().name)} 方言生成）。</div>
    </div>
    <div class="cfg-sec"><div class="cfg-sec__title">⏱ 调度周期与依赖</div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">调度周期</span>
        ${sel("applyTaskField('cycle',this.value)", [{ v: 'daily', t: '每日' }, { v: 'hourly', t: '每小时' }], TASK.cycle)}
        <input class="cfg-input cfg-input--sm" style="flex:0 0 92px;" value="${esc(TASK.cycleTime)}" onchange="applyTaskField('cycleTime',this.value)">
        <span class="cfg-row__from">${esc(scheduleExpr())}</span></div>
      <div class="cfg-row"><span class="cfg-row__name" style="flex:0 0 92px;">失败重试</span>
        <input class="cfg-input cfg-input--sm" type="number" min="0" max="10" style="flex:0 0 62px;" value="${Number(TASK.retry)}" onchange="applyTaskField('retry', Number(this.value))">
        <span class="cfg-row__from">次（超过则告警责任人 ${esc(TASK.owner)}）</span></div>
      <div class="cfg-row" style="flex-direction:column;align-items:stretch;gap:6px;">
        <span class="cfg-row__name">上游依赖（全部成功后本任务才起跑）</span>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${depChoices.map(d => `<label class="chk"><input type="checkbox" ${TASK.upstream.includes(d) ? 'checked' : ''} onchange="toggleDep('${d}', this.checked)"> ${esc(d)}</label>`).join('')}
        </div>
      </div>
      <div class="cfg-note">质量门禁为 block 级规则未达标时，本任务按失败处理并阻断下游；调度器应据此跳过 ${esc(TASK.targetTable)} 的下游节点。</div>
    </div>`;
  const verBody = `
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button class="btn btn--primary btn--sm" onclick="saveVersion()">＋ 保存当前为版本</button>
      <span style="font-size:11.5px;color:var(--neutral-500);align-self:center;">共 ${VERSIONS.length} 个版本 · 快照含 ${pipeline.length} 步配置 + 任务配置 + 方言</span>
    </div>
    ${VERSIONS.length ? VERSIONS.map((v, i) => {
      const d = diffObjects(v.snapshot, snapshot(), '', []);
      const steps = new Set(d.filter(x => x.path.startsWith('pipeline')).map(x => x.path.split('.')[1]));
      return `<div class="cfg-row" style="flex-direction:column;align-items:stretch;gap:6px;padding:10px;${i === 0 ? '' : ''}">
        <div style="display:flex;gap:8px;align-items:center;">
          <b style="font-family:var(--font-mono);font-size:12px;color:var(--brand-700);">v${v.v}</b>
          <span style="font-size:12px;color:var(--neutral-700);">${esc(v.note || '手动保存')}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--neutral-400);">${esc(v.ts)} · ${esc(v.dialect)}</span>
        </div>
        <div class="cfg-row__from">${d.length === 0
          ? '与当前配置完全一致'
          : `与当前有 <b>${d.length}</b> 处差异${steps.size ? `（涉及步骤：${[...steps].join('、')}）` : ''}`}</div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn--sm" onclick="showVersionDiff(${i})">🔍 查看 diff</button>
          <button class="btn btn--sm" onclick="rollbackVersion(${i})">↩ 回滚到该版本</button>
        </div>
      </div>`;
    }).join('') : '<div class="cfg-note">还没有任何版本。保存后即可对比配置差异并一键回滚。</div>'}`;
  const tabBar = `
    <div class="cfg-tabs" style="margin:-20px -24px 16px;border-radius:0;">
      <div class="cfg-tab ${isTask ? 'cfg-tab--active' : ''}" onclick="openTaskVersions('task')">📋 任务与调度</div>
      <div class="cfg-tab ${isTask ? '' : 'cfg-tab--active'}" onclick="openTaskVersions('versions')">🗂 版本管理</div>
    </div>`;
  DF.app.modal({
    title: '⚙ 任务配置与版本',
    width: 660,
    body: tabBar + (isTask ? taskBody : verBody),
    actions: isTask
      ? '<button class="btn" data-resolve>关闭</button><button class="btn btn--primary" data-resolve="sql">查看按此配置生成的 SQL</button>'
      : '<button class="btn" data-resolve>关闭</button>',
  }).then(r => { if (r === 'sql') switchTab('sql'); });
}
function saveVersion() {
  const note = `${pipeline.filter(s => s.enabled).length} 步启用 · 目标表 ${TASK.targetTable}`;
  VERSIONS.unshift({ v: VERSIONS.length + 1, ts: tsNow(), note, dialect: DIALECTS[DIALECT].name, snapshot: snapshot() });
  persistVersions();
  DF.app.toast(`✓ 已保存版本 v${VERSIONS[0].v}（${note}）`, 'success', 2200);
  openTaskVersions('versions');
}
function rollbackVersion(i) {
  const v = VERSIONS[i];
  if (!v) return;
  DF.app.modal({
    title: `↩ 回滚到 v${v.v}`,
    width: 560,
    body: `<div style="font-size:12.5px;line-height:1.9;color:var(--neutral-700);">
      将把整条流水线、任务配置与目标方言全部替换为 <b>v${v.v}</b>（${esc(v.ts)}）的快照。<br>
      <span style="color:var(--warning-700);">当前配置不会被自动保存</span>——如需保留，请先「保存当前为版本」。
      <div style="margin-top:10px;padding:10px 12px;background:var(--neutral-50);border-radius:8px;font-size:12px;">
        ${esc(v.note)}<br>方言：${esc(v.dialect || '—')}
      </div>
    </div>`,
    actions: '<button class="btn" data-resolve>取消</button><button class="btn btn--primary" data-resolve="ok">确认回滚</button>',
  }).then(r => {
    if (r !== 'ok') return;
    const snap = clone(v.snapshot);
    snap.pipeline.forEach(ps => {
      const live = pipeline.find(s => s.id === ps.id);
      if (live) { live.enabled = ps.enabled; live.config = clone(ps.config); }
    });
    TASK = Object.assign(TASK, clone(snap.task));
    if (DIALECTS[snap.dialect]) DIALECT = snap.dialect;
    if (snap.src && snap.src !== ACTIVE_SRC && SOURCES[snap.src]) bindSource(snap.src);
    persistTask();
    apply(`回滚到版本 v${v.v}`);
    closeTopModal();
    DF.app.toast(`↩ 已回滚到 v${v.v}，预览、质量指标与 SQL 已按该版本重算`, 'success', 2600);
  });
}
function showVersionDiff(i) {
  const v = VERSIONS[i];
  if (!v) return;
  const d = diffObjects(v.snapshot, snapshot(), '', []);
  const stepName = p => {
    const m = /^pipeline\.(\d+)\.(.*)$/.exec(p);
    if (!m) return null;
    const id = (v.snapshot.pipeline[Number(m[1])] || {}).id;
    return (pipeline.find(s => s.id === id) || {}).name || id;
  };
  const kindLabel = { add: '新增', del: '删除', mod: '修改' };
  DF.app.modal({
    title: `🔍 v${v.v} → 当前配置 的真实差异`,
    width: 720,
    body: `<div style="font-size:12px;color:var(--neutral-600);margin-bottom:10px;">共 <b>${d.length}</b> 处差异（逐项按配置路径递归比对，不是字符串比较）。</div>
    ${d.length ? `<div style="max-height:52vh;overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead><tr style="background:var(--neutral-50);">
          <th style="text-align:left;padding:6px 8px;">配置路径</th>
          <th style="text-align:left;padding:6px 8px;width:80px;">类型</th>
          <th style="text-align:left;padding:6px 8px;">v${v.v}</th>
          <th style="text-align:left;padding:6px 8px;">当前</th>
        </tr></thead>
        <tbody>
        ${d.map(x => {
          const sn = stepName(x.path);
          const label = sn ? `${sn} · ${x.path.replace(/^pipeline\.\d+\./, '')}` : x.path.replace(/^task\./, '任务 · ').replace(/^dialect$/, '方言');
          const pct = x.kind === 'mod' && /threshold$/.test(x.path);
          const fmt = val => {
            const s = fmtVal(val);
            return s.length > 120 ? esc(s.slice(0, 120)) + '…' : esc(s);
          };
          return `<tr style="border-top:1px solid var(--neutral-100);">
            <td style="padding:6px 8px;font-family:var(--font-mono);color:var(--neutral-700);">${esc(label)}</td>
            <td style="padding:6px 8px;"><span class="tag" style="background:${x.kind === 'add' ? 'var(--success-50)' : x.kind === 'del' ? 'var(--danger-50)' : 'var(--warning-50)'};color:${x.kind === 'add' ? 'var(--success-700)' : x.kind === 'del' ? 'var(--danger-700)' : 'var(--warning-700)'};">${kindLabel[x.kind]}</span></td>
            <td style="padding:6px 8px;font-family:var(--font-mono);color:var(--danger-700);">${fmt(x.from)}</td>
            <td style="padding:6px 8px;font-family:var(--font-mono);color:var(--success-700);">${fmt(x.to)}${pct ? '<span style="color:var(--neutral-400);"> %</span>' : ''}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>`
      : '<div class="cfg-note">当前配置与该版本完全一致。</div>'}`,
    actions: `<button class="btn" data-resolve>关闭</button><button class="btn btn--primary" data-resolve="rb">↩ 回滚到 v${v.v}</button>`,
  }).then(r => { if (r === 'rb') rollbackVersion(i); });
}
function openTaskConfig() { openTaskVersions('task'); }

/* =====================================================================
 * 第 4 档 · 交互打磨（生产级完整版）
 *   16 流水线纵向 / 横向可换行双布局 —— 根治 10 步拥挤
 *   17 步骤顺序可调整（▶ 拖拽 / ▲▼），带真实的可达性校验
 *   18 撤销 / 重做（收口在 apply()，见上方）
 *   19 键盘快捷键
 *   20 日期歧义格式确认弹窗
 *   21 多表批处理：一套规则模板套用到多张同类源表
 * ===================================================================== */

/* ---------- 16/17 布局与顺序 ---------- */
const LAYOUT_KEY = 'df-cleaning-layout';
let LAYOUT = 'v';
try { const v = localStorage.getItem(LAYOUT_KEY); if (v === 'v' || v === 'h') LAYOUT = v; } catch (e) {}
function applyLayout() {
  const panel = document.getElementById('flow-panel');
  if (panel) panel.classList.toggle('flow-panel--v', LAYOUT === 'v');
  const b = document.getElementById('layout-btn');
  if (b) b.textContent = LAYOUT === 'v' ? '⇄ 横向视图' : '⇅ 纵向步骤条';
  const h = document.getElementById('pl-hint');
  if (h) {
    h.textContent = LAYOUT === 'v'
      ? `纵向步骤条 · 拖拽 ⠿ 或点 ▲▼ 调整顺序（共 ${pipeline.length} 步，全部可达）`
      : `横向可换行视图 · ${pipeline.length} 步自动排布`;
  }
}
function toggleLayout() {
  LAYOUT = LAYOUT === 'v' ? 'h' : 'v';
  try { localStorage.setItem(LAYOUT_KEY, LAYOUT); } catch (e) {}
  applyLayout(); renderPipeline();
  DF.app.toast(LAYOUT === 'v' ? '已切换为纵向步骤条：10 步也能一屏看完，不再横向挤压' : '已切换为横向可换行视图', 'info', 1800);
}
function togglePipeCollapse() {
  const bar = document.getElementById('pipeline-bar'), btn = document.getElementById('collapse-btn');
  if (!bar) return;
  const collapsed = bar.classList.toggle('pipeline-bar--collapsed');
  if (btn) btn.textContent = collapsed ? '⌄ 展开' : '⌃ 收起';
}

// 拖拽排序
let DRAG_ID = null;
function onStepDragStart(e, id) {
  DRAG_ID = id;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id); } catch (err) {} }
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('step-node--dragging');
}
function onStepDragOver(e) {
  if (!DRAG_ID) return;
  e.preventDefault();
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('step-node--dragover');
}
function onStepDragLeave(e) {
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('step-node--dragover');
}
function onStepDrop(e, id) {
  e.preventDefault();
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('step-node--dragover');
  const dragged = DRAG_ID;
  DRAG_ID = null;
  if (!dragged || dragged === id) return;
  const from = pipeline.findIndex(s => s.id === dragged);
  const to = pipeline.findIndex(s => s.id === id);
  if (from < 0 || to < 0) return;
  reorderStep(from, to);
}
function onStepDragEnd() {
  DRAG_ID = null;
  document.querySelectorAll('.step-node--dragging, .step-node--dragover')
    .forEach(n => n.classList.remove('step-node--dragging', 'step-node--dragover'));
}

/* ---------- 21 多表批处理：源表清单 ---------- */
let BATCH_SEL = [];
// 当前流水线真正用到的语义角色 —— 只有用到的角色才参与「同类」判定，
// 避免把「这张表没有状态字段」当成问题报出来，而模板其实根本没用到状态字段。
function usedRoles() {
  const need = {};
  pipeline.forEach(s => {
    if (!s.enabled) return;
    if (s.id === 'map' && Object.keys(s.config.renames || {}).length) need.readerKey = 1;
    if (s.id === 'codemap' && (s.config.maps || []).length) need.status = 1;
    if (s.id === 'cast' && Object.keys(s.config.casts || {}).length) need.numerics = 1;
    if (s.id === 'date' && (s.config.cols || []).length) need.dates = 1;
    if (s.id === 'dedup' && ((s.config.keys || []).length || s.config.orderBy)) { need.pk = 1; }
    if (s.id === 'join' && (s.config.joins || []).length) need.readerKey = 1;
  });
  return need;
}
function roleGapLabels(src) {
  const need = usedRoles(), r = src.roles || {}, out = [];
  const SHORT = { pk: '主键', readerKey: '读者键', syncTime: '同步时间', status: '状态', dates: '日期', numerics: '数值' };
  ['pk', 'readerKey', 'status'].forEach(k => { if (need[k] && !r[k]) out.push(SHORT[k]); });
  if (need.dates && !(r.dates || []).length) out.push(SHORT.dates);
  if (need.numerics && !(r.numerics || []).length) out.push(SHORT.numerics);
  return out;
}
function renderSources() {
  const list = document.getElementById('src-list');
  if (!list) return;
  // ⚠ 方案 B：左栏只显示当前活动的那张表（单表 UI 简化）。
  //   「切源表」不再是原生 <select>，而是把这张卡片本身做成触发器 ——
  //   点击 / Enter / ⇧⌘K 唤起 assets/src-picker.js 的搜索式浮层：
  //   可搜索（表名/中文名/字段名）、可键盘操作（↑↓ ↵ Esc）、并能**预知切换后果**
  //   （切过去会有几项规则不适用），这是原生下拉给不了的信息。
  //   多表操作（多表批处理、字段对照）仍在顶栏「🗂 多表批处理」弹窗里完成。
  const active = SOURCES[ACTIVE_SRC];
  const g = roleGapLabels(active);
  const badge = g.length
    ? `<span class="src-item__warn" title="当前模板需要这些角色的字段，该表缺少：${esc(g.join('、'))}">缺 ${esc(g.join('/'))}</span>`
    : '<span class="src-item__ok" title="当前模板需要的语义角色齐备">同类</span>';
  const m = active.src || {};
  const rowsTxt = m.rows >= 1e4 ? (m.rows / 1e4).toFixed(2) + ' 万行' : (m.rows ? m.rows + ' 行' : '');
  const meta = [m.db, m.schema, rowsTxt, m.syncAt ? m.syncAt + ' 同步' : ''].filter(Boolean).join(' · ');
  list.innerHTML = `
    <div class="src-item src-item--active src-item--solo src-card" id="src-trigger" role="button" tabindex="0"
         aria-haspopup="listbox" aria-expanded="false" title="切换当前编辑的源表（⇧⌘K）"
         onclick="openSourceSwitcher(this)"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openSourceSwitcher(this);}">
      <div class="src-card__line1">
        <span class="src-card__dot" aria-hidden="true"></span>
        <span class="src-item__name">${esc(active.name)}</span>
        ${badge}
        <span class="src-card__chev" aria-hidden="true">⌄</span>
      </div>
      <div class="src-item__sub">${esc(active.cn)} → ${esc(active.target)}</div>
      <div class="src-card__meta">${esc(meta)}</div>
      <div class="src-card__cta">点表名切换 <kbd>⇧⌘K</kbd></div>
    </div>`;
  // 备注：「src-meta」整块 DOM 节点已在 HTML 侧删除（方案 B 一并清理）。
  syncCrumbTable();
}
/* 面包屑第三段（#crumb-table）＝「当前源表」的第二个召唤点，与左栏卡片共用同一浮层。
   ⚠ 2026-09-21 修：它原来是 HTML 里的一段死文本 —— 不可点、从初始化起就再没变过，
     切表后仍显示旧表名（「想换表时看得见表名却点不动」的根因）。
   ✅ 刻意放在 renderSources() 里而不是 switchSource() 里：renderAll() 第一步就是它，
     于是启动 / 切表 / 撤销重做 / ?table= 直达 全都自动刷新，不存在第二处需要手动同步的地方。 */
function syncCrumbTable() {
  const el = document.getElementById('crumb-table');
  if (!el) return;
  const chev = el.querySelector('.crumb__chev');   // 先取出 ⌄ 节点：改 textContent 会把它一起清掉
  if (String(el.textContent).replace(/⌄/g, '').trim() !== ACTIVE_SRC) el.textContent = ACTIVE_SRC;
  if (chev) el.appendChild(chev);                  // 原节点挂回 —— 样式与展开时的旋转过渡都不丢
  /* 刻意不动 aria-expanded：它归 src-picker.js 的 openSrcPicker/closeSrcPicker 管，
     这里顺手写成 false 会在浮层正开着的时候把状态改错。 */
}
function toggleBatchSel(name, on) {
  // ⚠ 方案 B 改造：左栏每行 checkbox 已删，此函数保留为兼容旧 DOM 的兜底。
  //   真正修改变量走顶栏多表批处理弹窗里的勾选（走 batchPanel 的 checkbox + 直接赋值 BATCH_SEL）。
  const set = new Set(BATCH_SEL);
  on ? set.add(name) : set.delete(name);
  BATCH_SEL = Object.keys(SOURCES).filter(k => set.has(k));
  const live = document.getElementById('bp-count');
  if (live) live.textContent = String(BATCH_SEL.length);
  const tbl = document.getElementById('bp-tbl');
  if (tbl) tbl.dispatchEvent(new CustomEvent('bp-refresh', { bubbles: false }));
}
// 该表自己的配置缓存：换表不会互相污染（否则「切到 B 再切回 A」会让 A 的规则被 B 适配过）
const SRC_PIPE_CACHE = {};
const batchOpts = () => ({ extendDates: true, extendNumerics: true });
function switchSource(name) {
  if (!SOURCES[name]) return;
  if (name === ACTIVE_SRC) { DF.app.toast(`当前编辑的就是 ${name}`, 'info', 1300); return; }
  const tplRoles = activeRoles();
  // ⚠ 缓存条目必须带 id：换回时靠它把配置一条条对回步骤。曾经漏了 id，
  //   导致「切到别的表再切回来」时配置悄悄停留在别人的版本上（不报错、静默错配）。
  SRC_PIPE_CACHE[ACTIVE_SRC] = pipeline.map(s => ({ id: s.id, enabled: s.enabled, config: clone(s.config) }));
  bindSource(name);
  const src = SOURCES[name];
  // TASK 跟着源表走，否则生成的 SQL 会把数据写进上一张表的目标表
  TASK.sourceTable = src.name; TASK.targetTable = src.target;
  TASK.code = src.taskCode; TASK.name = src.taskName; TASK.upstream = [src.name];
  const cached = SRC_PIPE_CACHE[name];
  let log = [];
  if (cached) {
    pipeline.forEach(s => { const c = cached.find(x => x.id === s.id); if (c) { s.enabled = c.enabled; s.config = clone(c.config); } });
  } else {
    log = adaptPipeline(src, batchOpts(), tplRoles);
  }
  previewStepId = '__raw__';
  recompute();
  commitHistory(`切换源表为 ${name}`);
  const tail = cached ? '已恢复该表上一次的配置'
    : (log.length ? `模板已适配：${log.length} 项不适用于该表（详见多表批处理面板）` : '模板已完全适配该表');
  DF.app.toast(`已切换源表：${name} · ${src.cn} → ${src.target} —— ${tail}`, 'success', 2800);
}

/* ---------- 21 模板适配：把「一套规则」翻译成「某张表可执行的规则」 ---------- */
// 三级匹配：① 语义角色（主键/读者键/同步时间/状态） ② 同名字段 ③ 都不成立 → 显式不适用
// 额外要点：下游步骤（关联/脱敏/质量）引用的是**重命名之后**的字段名，
// 所以必须先把 renameOut 反查回模板的源字段名，否则关联左键会整条丢掉。
const ROLE_KEYS = ['pk', 'readerKey', 'syncTime', 'status'];
function renameOutOf(srcPipeline) {
  const map = srcPipeline.find(s => s.id === 'map');
  const out = {};
  Object.entries((map && map.config.renames) || {}).forEach(([k, v]) => { if (v && v !== k) out[v] = k; });
  return out;
}
function fieldResolver(target, tplRoles, renameOut) {
  const a = tplRoles || activeRoles(), t = target.roles || {};
  const ro = renameOut || {};
  const used = [];
  const push = o => { used.push(o); return o.to; };
  const res = field => {
    const origin = ro[field] || field;                         // 还原成模板里的源字段名
    const rk = ROLE_KEYS.find(k => a[k] === origin);
    if (rk) {
      if (!t[rk]) return push({ from: field, to: null, how: 'role', role: rk });
      // 若这个名字是「重命名后的产物」，目标表沿用同一个重命名，名字保持不变
      return push({ from: field, to: ro[field] ? field : t[rk], how: 'role', role: rk });
    }
    if ((target.fields || []).some(f => f.name === origin)) return push({ from: field, to: field, how: 'name' });
    return push({ from: field, to: null, how: 'name' });
  };
  return { res, used };
}
// 数值字段的目标类型由真实数据推断，不是拍脑袋给的
function inferNumericType(src, f) {
  const nums = (src.rows || []).map(r => r[f])
    .filter(v => v != null && String(v).trim() !== '')
    .map(v => String(v).replace(/[¥,元\s]/g, ''))
    .filter(v => /^-?\d+(\.\d+)?$/.test(v));
  if (!nums.length) return 'VARCHAR';
  return nums.some(v => v.includes('.')) ? 'DECIMAL(10,2)' : 'INT';
}
// 返回 { config, notes, dropped }；dropped = 「这一步在这张表上不适用」的清单（带原因）
function adaptConfig(stepId, cfg, target, opts, tplRoles, renameOut) {
  const c = clone(cfg);
  const notes = [];
  const { res, used } = fieldResolver(target, tplRoles, renameOut);
  const ro = renameOut || {};
  const t = target.roles || {};
  const o = opts || {};
  const manual = [];      // 需要人工确认、因此不自动套用的项
  if (stepId === 'map') {
    const out = {};
    Object.entries(c.renames || {}).forEach(([k, v]) => { const nk = res(k); if (nk) out[nk] = v; });
    c.renames = out;
    c.drop = (c.drop || []).map(res).filter(Boolean);
  } else if (stepId === 'codemap') {
    c.maps = (c.maps || []).map(m => { const f = res(m.field); return f ? Object.assign({}, m, { field: f }) : null; }).filter(Boolean);
  } else if (stepId === 'cast') {
    const out = {};
    Object.entries(c.casts || {}).forEach(([k, v]) => { const nk = res(k); if (nk) out[nk] = v; });
    if (o.extendNumerics) {
      (t.numerics || []).forEach(f => {
        if (out[f] !== undefined) return;
        out[f] = inferNumericType(target, f);
        notes.push(`${target.name}：按角色纳入数值字段 ${f} → ${out[f]}（类型由采样数据推断）`);
      });
    }
    c.casts = out;
  } else if (stepId === 'date') {
    const set = new Set((c.cols || []).map(res).filter(Boolean));
    if (o.extendDates) (t.dates || []).forEach(f => set.add(f));
    c.cols = [...set];
  } else if (stepId === 'dedup') {
    c.keys = (c.keys || []).map(res).filter(Boolean);
    if (c.orderBy) {
      const ob = res(c.orderBy);
      c.orderBy = ob || t.syncTime || (c.keys || [])[0] || c.orderBy;
    }
  } else if (stepId === 'join') {
    c.joins = (c.joins || []).map(j => { const lk = res(j.leftKey); return lk ? Object.assign({}, j, { leftKey: lk }) : null; }).filter(Boolean);
  } else if (stepId === 'derive') {
    c.rules = (c.rules || []).map(r => {
      if (r.mode === 'concat') {
        const srcs = (r.sources || []).map(res).filter(Boolean);
        return srcs.length ? Object.assign({}, r, { sources: srcs }) : null;
      }
      if (!r.source) return Object.assign({}, r);
      const s = res(r.source);
      if (!s) return null;
      // 提取正则（如 ^LN(\d{8}) 只认借阅流水号）是「原字段专有形态」。
      // 字段被角色替换成另一个名字后照搬，会在不报错的情况下整列派生出 NULL ——
      // 所以和值域/区间规则一样，改为「需人工确认」，不自动套用。
      if (r.mode === 'regex' && s !== r.source) {
        manual.push({ kind: 'derive', field: r.source, resolved: s, rule: 'regex', why: `提取正则「${r.pattern}」是「${r.source}」专有形态，换成 ${s} 后取不到值` });
        return null;
      }
      return Object.assign({}, r, { source: s });
    }).filter(Boolean);
  } else if (stepId === 'mask') {
    c.rules = (c.rules || []).map(r => { const f = res(r.field); return f ? Object.assign({}, r, { field: f }) : null; }).filter(Boolean);
  } else if (stepId === 'quality') {
    const kept = [];
    // ⚠ 这里必须用「模板自己的角色表」做判定，不能引用 fieldResolver 内部的闭包变量
    const A = tplRoles || activeRoles();
    (c.rules || []).forEach(r => {
      const origin = ro[r.field] || r.field;
      const rk = ROLE_KEYS.find(k => A[k] === origin);
      const f = res(r.field);
      if (!f) return;
      // 字段被角色替换成另一个名字后，「值形态相关」的规则（正则/值域/区间）不能照搬：
      // ^LN\d{11}$ 套到 return_id 上必然失败 —— 那是规则本身不适用，不是数据脏了。
      const shapeSpecific = r.type === 'regex' || r.type === 'enum' || r.type === 'range';
      if (f !== r.field && shapeSpecific) {
        manual.push({ kind: 'quality', field: r.field, resolved: f, rule: r.type, why: `值是「${r.field}」专有形态（${r.type}），换成 ${f} 后判据不成立` });
        return;
      }
      void rk;
      kept.push(Object.assign({}, r, { field: f }));
    });
    c.rules = kept;
  }
  // 去重 + 按 step 汇总不适用项，避免同一字段被报多遍
  const seen = new Set();
  const dropped = [];
  used.filter(u => u.to === null).forEach(u => {
    const k = stepId + '|' + u.from + '|' + u.how + '|' + (u.role || '');
    if (seen.has(k)) return;
    seen.add(k);
    dropped.push({ stepId, field: u.from, how: u.how, role: u.role });
  });
  return { config: c, notes, dropped, manual };
}
// 就地适配整条流水线，返回「不适用清单」（含需人工确认项）
function adaptPipeline(target, opts, tplRoles) {
  const renameOut = renameOutOf(pipeline);
  const log = [];
  pipeline.forEach(s => {
    const name = s.name;
    const r = adaptConfig(s.id, s.config, target, opts, tplRoles, renameOut);
    s.config = r.config;
    r.dropped.forEach(d => log.push(Object.assign({ step: name, reason: d.role ? `该表没有「${ROLE_LABEL[d.role]}」角色的字段` : '该表不存在同名字段' }, d)));
    r.manual.forEach(m => log.push({ step: name, field: m.field, resolved: m.resolved, manual: true, reason: m.why }));
  });
  return log;
}
// 一键把当前表重置回推荐规则，再按角色适配（用于「适配结果不满意」的回退路径）
function resetToTemplate() {
  const tplRoles = activeRoles();
  pipeline.forEach(s => { if (s.recommend) s.config = s.recommend(); });
  const log = adaptPipeline(SOURCES[ACTIVE_SRC], batchOpts(), tplRoles);
  previewStepId = '__raw__';
  recompute();
  commitHistory(`把「${SOURCES[ACTIVE_SRC].cn}」重置为推荐规则并适配`);
  DF.app.toast(`已重置为推荐规则并适配本表${log.length ? `，${log.length} 项不适用` : ''}`, 'success', 2400);
}

/* ---------- 21 批处理执行：逐表真实跑完整条流水线 ---------- */
function runBatchOn(tableName, opts) {
  const src = SOURCES[tableName];
  const tplRoles = activeRoles();
  // 保存现场（含运行模式与全量缓存，批处理结束后原样恢复）
  const live = {
    active: ACTIVE_SRC, task: clone(TASK), mode: RUNMODE,
    cache: FULL_CACHE, n: FULL_N, stats: FULL_STATS,
    order: pipeline.map(s => s.id),
    // ⚠ 每个条目必须带 id。缺了 id，下面的 find(x => x.id === s.id) 永远匹配不上，
    //   配置就会悄悄停留在「最后一张跑过的表」的版本上：现场还原失效，而且批处理
    //   从第 2 张表起会把上一张表的结果当成模板 —— 表现为去重键解析不到 → 静默不去重、
    //   日期列错位，全程不报错。这条曾经真的发生过。
    cfg: pipeline.map(s => ({ id: s.id, enabled: s.enabled, config: clone(s.config) })),
  };
  const safe = () => {
    // 无论中途是否抛异常，都必须把现场还原，否则面板会停留在「别的表」的状态
    if (ACTIVE_SRC !== live.active) bindSource(live.active);
    live.order.forEach((id, i) => {
      const j = pipeline.findIndex(s => s.id === id);
      if (j >= 0 && j !== i) { const [m] = pipeline.splice(j, 1); pipeline.splice(i, 0, m); }
    });
    pipeline.forEach(s => { const c = live.cfg.find(x => x.id === s.id); if (c) { s.enabled = c.enabled; s.config = clone(c.config); } });
    TASK = clone(live.task); RUNMODE = live.mode; FULL_CACHE = live.cache; FULL_N = live.n; FULL_STATS = live.stats;
  };
  HIST_SUSPEND++;
  let out;
  try {
    bindSource(tableName);
    const log = adaptPipeline(src, opts, tplRoles);
    TASK.sourceTable = src.name; TASK.targetTable = src.target;
    TASK.code = src.taskCode; TASK.name = src.taskName; TASK.upstream = [src.name];
    executePipeline();
    const m = computeQuality();
    const rowsIn = RAW_ROWS.length;
    const rowsOut = ((lastOutput() || {}).rows || []).length;
    const dupRemoved = stepOutputs.reduce((a, s) => a + (s.skipped ? 0 : (s.removed || 0)), 0);
    const failed = stepOutputs.reduce((a, s) => a + (s.skipped ? 0 : (s.failedCount || 0)), 0);
    let sql = '';
    try { sql = sqlText(); } catch (e) { sql = `-- 该表 SQL 生成失败：${e.message}`; }
    out = {
      ok: true, src, rowsIn, rowsOut, dupRemoved, failed,
      score: m.score, keyNulls: m.keyNulls, dups: m.dups, failedCells: m.failedCells,
      blocked: GATE.blocked, badCount: GATE.bad.length,
      ruleCount: GATE.results.length,
      skipped: log, sql,
      steps: pipeline.filter(s => s.enabled).length,
    };
  } catch (e) {
    out = { ok: false, src, error: e.message, rowsIn: (src.rows || []).length, rowsOut: 0, dupRemoved: 0, failed: 0, score: 0, blocked: false, badCount: 0, ruleCount: 0, skipped: [], sql: `-- 执行失败：${e.message}`, steps: 0 };
  } finally {
    safe();
    HIST_SUSPEND--;
  }
  return out;
}
let BATCH_RESULTS = null;
function openBatchPanel() {
  const all = Object.values(SOURCES);
  const rows = all.map(s => {
    const g = roleGapLabels(s);
    const on = BATCH_SEL.includes(s.name);
    const same = s.name === ACTIVE_SRC;
    return `<tr>
      <td><input type="checkbox" class="bp-pick" ${on ? 'checked' : ''} onchange="toggleBatchSel('${s.name}', this.checked)"></td>
      <td class="mono">${esc(s.name)}${same ? ' <span class="tag">当前</span>' : ''}</td>
      <td>${esc(s.cn)}</td>
      <td class="mono">${esc(s.target)}</td>
      <td>${g.length ? `<span class="src-item__warn">缺 ${esc(g.join('/'))}</span>` : '<span class="src-item__ok">同类</span>'}</td>
      <td class="mono">${(s.rows || []).length} 行 / ${(s.fields || []).length} 字段</td>
    </tr>`;
  }).join('');
  const enabledSteps = pipeline.filter(s => s.enabled).length;
  DF.app.modal({
    title: '🗂 多表批处理 · 把当前规则模板套用到多张同类源表',
    width: 860,
    body: `
    <div class="ov-hero ov-hero--info">
      <span style="font-size:18px;line-height:1;">📐</span>
      <div>模板 = 当前 <b>${esc(SOURCES[ACTIVE_SRC].name)}</b> 上的流水线配置（<b>${enabledSteps}</b> 步启用）。
      批处理会为每张选中的表<b>真实执行</b>整条流水线，逐表产出质量指标与可直接运行的 SQL；字段名不一致时按「语义角色 → 同名」两级匹配自动翻译，
      <b>翻译不了的会被明确标注为不适用，不会静默丢弃</b>。</div>
    </div>
    <div class="ov-label">候选源表（勾选加入批处理，共 <span id="bp-count">${BATCH_SEL.length}</span> 张）</div>
    <div class="ov-scroll" style="max-height:34vh;border:1px solid var(--neutral-200);border-radius:8px;">
      <table class="ov-table">
        <thead><tr><th style="width:34px;"></th><th>源表</th><th>业务含义</th><th>目标表（DWD）</th><th>同类判定</th><th>规模</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="ov-label" style="margin-top:14px;">同类表自动适配策略</div>
    <label class="radio-line"><input type="checkbox" id="bp-ext-dates" checked onchange="BP_OPTS_LAST.extendDates = this.checked"> 自动把目标表自己的<b>日期字段</b>纳入日期标准化（推荐）</label>
    <label class="radio-line"><input type="checkbox" id="bp-ext-nums" checked onchange="BP_OPTS_LAST.extendNumerics = this.checked"> 自动把目标表自己的<b>数值字段</b>纳入类型转换，目标类型由采样数据推断（推荐）</label>
    <div class="cfg-note" style="margin-top:8px;">生成方言：<b>${esc(D().name)}</b>${esc(D().ver ? ' ' + D().ver : '')}；可在关闭本面板后于「清洗 SQL」页切换。批处理只读取与执行，不会改动你当前表的配置（配置在结束时原样还原）。</div>`,
    actions: `<button class="btn" data-resolve>关闭</button><button class="btn" data-resolve="all">全选同类表</button><button class="btn" data-resolve="run">▶ 开始批处理</button>`,
  }).then(r => {
    if (r === 'all') {
      BATCH_SEL = Object.values(SOURCES).filter(s => !roleGapLabels(s).length).map(s => s.name);
      if (!BATCH_SEL.length) BATCH_SEL = Object.values(SOURCES).map(s => s.name);
      renderSources(); renderFields(); openBatchPanel();
      return;
    }
    if (r !== 'run') return;
    const sel = BATCH_SEL.length ? BATCH_SEL : [ACTIVE_SRC];
    // modal 关闭后 DOM 已卸载，选项值由输入时的 onchange 记进 BP_OPTS_LAST
    const opts = Object.assign({ extendDates: true, extendNumerics: true }, BP_OPTS_LAST);
    const results = sel.map(n => runBatchOn(n, opts));
    BATCH_RESULTS = results;
    recompute();
    renderSources();
    renderBatchResult(results, opts, sel);
  });
}
// 关闭面板那一刻的选项值（modal resolve 之后 DOM 已卸载）
let BP_OPTS_LAST = { extendDates: true, extendNumerics: true };
function renderBatchResult(results, opts, sel) {
  const okList = results.filter(r => r.ok);
  const blockedCnt = okList.filter(r => r.blocked).length;
  const rowsIn = results.reduce((a, r) => a + (r.rowsIn || 0), 0);
  const rowsOut = results.reduce((a, r) => a + (r.rowsOut || 0), 0);
  const dupRemoved = results.reduce((a, r) => a + (r.dupRemoved || 0), 0);
  const failed = results.reduce((a, r) => a + (r.failed || 0), 0);
  const skippedAll = results.reduce((a, r) => a + (r.skipped || []).length, 0);
  const scoreRow = okList.length ? Math.round(okList.reduce((a, r) => a + r.score, 0) / okList.length) : 0;
  const trs = results.map(r => `<tr>
    <td class="mono">${esc(r.src.name)}</td>
    <td class="mono">${esc(r.src.target)}</td>
    <td>${r.ok ? `<span class="q-item--ok">✓ 成功</span>` : `<span class="q-item--block">✕ 失败</span>`}</td>
    <td class="mono">${(r.rowsIn || 0).toLocaleString()}</td>
    <td class="mono">${(r.rowsOut || 0).toLocaleString()}</td>
    <td class="mono">${(r.dupRemoved || 0).toLocaleString()}</td>
    <td class="mono">${(r.failed || 0).toLocaleString()}</td>
    <td class="mono">${r.score ?? '—'}</td>
    <td>${r.blocked ? '<span class="q-item--block">⛔ 阻断</span>' : (r.badCount ? `<span class="q-item--warn">⚠ ${r.badCount} 条告警</span>` : (r.ruleCount ? '<span class="q-item--ok">✓ 达标</span>' : '—'))}</td>
    <td class="mono">${r.steps ?? 0} 步 / ${(r.skipped || []).length} 项不适用</td>
  </tr>`).join('');
  const detail = results.filter(r => (r.skipped || []).length).map(r => `
    <div style="margin-top:10px;">
      <div class="ov-label">${esc(r.src.name)} · 不适用 / 需人工确认的规则项（${r.skipped.length}）</div>
      ${r.skipped.map(s => `<div class="${s.manual ? 'risk-row--block' : 'risk-row--skip'}" style="display:flex;gap:8px;align-items:center;font-size:11px;padding:5px 8px;border-radius:5px;margin-bottom:3px;color:${s.manual ? 'var(--danger-700)' : 'var(--warning-700)'};">
        <b style="min-width:66px;flex-shrink:0;">${esc(s.step)}</b>
        <span style="font-family:var(--font-mono,monospace);flex-shrink:0;">${esc(s.field)}</span>
        <span style="flex:1;color:var(--neutral-500);">${esc(s.reason || '')}</span>
        ${s.manual ? '<span style="flex-shrink:0;">需人工确认</span>' : ''}
      </div>`).join('')}
    </div>`).join('');
  const mergedSql = results.map(r => `/* ================= ${r.src.name} → ${r.src.target} ================= */\n${r.sql}`).join('\n\n');
  const sqlId = 'batch-sql-out';
  DF.app.modal({
    title: `✅ 多表批处理完成 · ${results.length} 张表`,
    width: 980,
    body: `
    <div class="ov-hero ${blockedCnt ? 'ov-hero--warn' : 'ov-hero--ok'}">
      <span style="font-size:18px;line-height:1;">${blockedCnt ? '⚠' : '✓'}</span>
      <div>已在 <b>${sel.length}</b> 张源表上逐表执行完 <b>${results[0] ? results[0].steps : 0}</b> 步流水线：
      输入 <b>${rowsIn.toLocaleString()}</b> 行 → 产出 <b>${rowsOut.toLocaleString()}</b> 行，去重消除 <b>${dupRemoved.toLocaleString()}</b> 行，
      转换/解析失败 <b>${failed.toLocaleString()}</b> 处，平均质量分 <b>${scoreRow}</b>${blockedCnt ? `，其中 <b>${blockedCnt}</b> 张触发了质量门禁阻断（不会写入目标表）` : ''}。
      ${skippedAll ? `另有 <b>${skippedAll}</b> 项规则因字段不适用于具体某张表而跳过，明细见下。` : ''}</div>
    </div>
    <div class="ov-scroll">
      <table class="ov-table">
        <thead><tr><th>源表</th><th>目标表</th><th>状态</th><th>输入</th><th>产出</th><th>去重消除</th><th>失败</th><th>质量分</th><th>门禁</th><th>套用</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
      ${detail}
      <div class="ov-label" style="margin-top:16px;">合并 SQL（按表分段，可直接复制 / 下载）</div>
      <div class="sql-view" id="${sqlId}" style="max-height:34vh;font-size:10.5px;">${esc(mergedSql)}</div>
    </div>`,
    actions: `<button class="btn" data-resolve>关闭</button><button class="btn" data-resolve="copy">⧉ 复制合并 SQL</button><button class="btn btn--primary" data-resolve="dl">⤓ 下载 .sql</button>`,
  }).then(r => {
    const nb = (BATCH_RESULTS || []).length;
    const txt = (BATCH_RESULTS || []).map(x => `/* ================= ${x.src.name} → ${x.src.target} ================= */\n${x.sql}`).join('\n\n');
    if (r === 'copy') copyText(txt, `✓ 已复制 ${txt.split('\n').length} 行合并 SQL（${nb} 张表）`);
    if (r === 'dl') downloadText(txt, `batch_${nb}tables.${DIALECT}.sql`);
  });
}
function copyText(txt, okMsg) {
  const done = () => DF.app.toast(okMsg, 'success', 2200);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
  else fallbackCopy(txt, done);
}
/* ⚠ 「切换源表」的原生 <select> 与「按域分组弹窗」已废弃（2026-09-18 重构）。
   现实现全部在 assets/src-picker.js（搜索式浮层：搜索 / 分组 / 键盘导航 / 切换后果预知）：
     openSourceSwitcher(anchor)  统一入口 —— 左栏卡片与顶栏按钮都调它，浮层锚定到调用元素
     srcPickCommit(name)         提交切换，转交 switchSource()
   原先这里的 DF.app.modal 版本（及 .src-switcher-* 那套 CSS）已随之下线，不要再往回加。 */
function downloadText(txt, filename) {
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  DF.app.toast(`⤓ 已下载 ${filename}（${(txt.length / 1024).toFixed(1)} KB）`, 'success', 2200);
}

/* ---------- 20 日期歧义格式确认弹窗 ---------- */
let DA_PICK = null;          // 用户在弹窗里选择的解释（true=日在前）
let DA_BATCH = false;        // 是否同时应用到批处理清单
// 已确认过的「源表 + 歧义样本集合」指纹：同一批歧义值确认过一次就不再反复提示，
// 但采样数据变化导致出现新的歧义样本时会重新要求确认。
const DA_ACK_KEY = 'df-cleaning-da-ack';
let DA_ACK = {};
try { DA_ACK = JSON.parse(localStorage.getItem(DA_ACK_KEY) || '{}') || {}; } catch (e) { DA_ACK = {}; }
function daSignature() {
  const di = probeFields().dateInfo;
  return ACTIVE_SRC + '|' + (di.ambiguous || []).slice().sort().join(',');
}
function daPending() {
  const info = dateAmbiguityInfo();
  if (!info) return false;
  // 默认口径（口径 B = 月在前，与 ISO 8601 一致）下视为「已默认采纳」，
  // 不亮「待确认」徽标 —— 用户仍可通过弹窗或「⚙ 修改口径」主动复核。
  // 这是 B+C 的 UX 简化：用户首次进入不会因「待确认」徽标产生必须拍板的感觉。
  const dateStep = pipeline.find(s => s.id === 'date');
  if (dateStep && dateStep.config.dayFirst === false) return false;
  return !DA_ACK[daSignature()];
}
function daAck() {
  DA_ACK[daSignature()] = tsNow();
  try { localStorage.setItem(DA_ACK_KEY, JSON.stringify(DA_ACK)); } catch (e) {}
}
function dateAmbiguityInfo() {
  const di = probeFields().dateInfo;
  const amb = di.ambiguous || [];
  if (!amb.length) return null;
  const dateStep = pipeline.find(s => s.id === 'date');
  const dayFirst = !dateStep || dateStep.config.dayFirst !== false;
  const fields = di.ambiguousFields || [];
  const toks = String(pipeline.find(s => s.id === 'clean')?.config.nullTokens || NULL_TOKENS_DEFAULT)
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const affected = RAW_ROWS.filter(r => fields.some(f => {
    const t = String(r[f] ?? '').trim();
    return amb.includes(t) && !toks.includes(t.toUpperCase());
  })).length;
  const samples = amb.map(v => ({ raw: v, asDay: parseDate(v, true), asMonth: parseDate(v, false) }));
  const diff = samples.filter(s => s.asDay !== s.asMonth).length;
  // 两路佐证，专治「弹窗里的日期样例看起来不对」：
  //   mixed       —— 同一列里还存在的「只有一个可行解」的写法（说明源系统可能混用了两种写法）
  //   consistency —— 用「业务日期不晚于同步时间」这条硬约束给两个口径打分，让用户有据可依
  return { amb, fields, dayFirst, affected, samples, diff, mixed: uniqueDmySample(), consistency: conventionCheck() };
}
function daRender() {
  const info = dateAmbiguityInfo();
  const box = document.getElementById('da-body');
  if (!box || !info) return;
  const pick = DA_PICK === null ? info.dayFirst : DA_PICK;
  const raw0 = info.amb[0];
  const isoOf = v => parseDate(raw0, v) || 'NULL';
  // 卡片必须把「口径 → 同一条原始值 → 归一结果」这条因果链摆成一眼能读懂的顺序。
  // 原稿把两个大号日期悬在标题下方、副行又重复一遍 raw→value，读者无法确定哪个日期属于哪个口径
  // —— 这正是「展示的日期样例不对」的界面根因（数据其实是对的）。
  const card = (v, tag, title, sub) => `
    <div class="ov-card ${pick === v ? 'ov-card--sel' : ''}" onclick="daPick(${v})">
      <div class="ov-card__t">${pick === v ? '◉' : '◯'} 口径 ${tag} · ${title}</div>
      <div class="ov-card__s" style="margin-top:2px;">把原始值 <code>${esc(raw0)}</code> 读作 ↓</div>
      <div class="ov-card__v">${esc(isoOf(v))}</div>
      <div class="ov-card__s">${sub} · ${pick === v ? '<b>当前选中</b>' : '点击选用'}</div>
    </div>`;
  const c = info.consistency;
  const syncField = c ? c.syncF : 'sync_time';
  box.innerHTML = `
    <div class="ov-hero ov-hero--warn">
      <span style="font-size:18px;line-height:1;">⚠</span>
      <div>字段 <b>${info.fields.map(esc).join('、')}</b> 里有 <b>${info.amb.length}</b> 个歧义值
      （<code>${info.amb.map(esc).join('、')}</code>）—— 按「日-月-年」或「月-日-年」读会得到不同日期。请选定口径。</div>
    </div>
    <div class="ov-label">两种口径对同一条原始值的解释结果（点击卡片切换）</div>
    <div class="ov-grid" style="margin-bottom:12px;">
      ${card(true, 'A', 'DD-MM-YYYY（日在前，英式）', '图书馆 / 国内业务库常见口径')}
      ${card(false, 'B', 'MM-DD-YYYY（月在前，美式）', '对接外部 / 国际系统时可能出现')}
    </div>
    ${c ? `<div class="ov-result ov-result--info" style="margin-bottom:12px;">
      <div class="ov-result__row">
        <span><b>🔎 自洽性自查</b> · 约束：业务日期 ≤ 同步时间</span>
        <span class="badge ${c.badDay ? 'q-item--warn' : 'q-item--ok'}">A ${c.badDay} 个不成立</span>
        <span class="badge ${c.badMon ? 'q-item--warn' : 'q-item--ok'}">B ${c.badMon} 个不成立</span>
        ${c.badDay !== c.badMon
          ? `<span class="ov-result__hint">→ 口径 <b>${c.badDay > c.badMon ? 'B' : 'A'}</b> 与数据更自洽</span>`
          : `<span class="ov-result__hint">→ 两口径打平</span>`}
        <span class="cfg-help-icon cfg-help-icon--inline" data-help-text="enc-self-check" data-enc="1" tabindex="0" role="button" aria-label="查看自洽性自查方法"><span>❓</span></span>
      </div>
      <div id="enc-self-check" style="display:none;">用「业务日期不应晚于该行同步时间（<code>${esc(syncField)}</code>）」这条硬约束，核过采样里 <b>${c.total}</b> 个日期值：口径 A（日在前）<b style="color:${c.badDay ? 'var(--danger-700)' : 'var(--success-700)'};">${c.badDay}</b> 个不成立、口径 B（月在前）<b style="color:${c.badMon ? 'var(--danger-700)' : 'var(--success-700)'};">${c.badMon}</b> 个不成立。${c.badDay !== c.badMon ? `口径 <b>${c.badDay > c.badMon ? 'B（月在前）' : 'A（日在前）'}</b>与数据更自洽，可作为默认参考。` : '两个口径在这条约束下打平，只能按业务习惯判断。'}${c.samples.length ? `例：<code>${esc(c.samples[0].raw)}</code>（${esc(c.samples[0].field)}）所在行的 ${esc(syncField)} 是 <code>${esc(c.samples[0].sync)}</code> —— 日在前得 <code>${esc(c.samples[0].day || 'NULL')}</code>、月在前得 <code>${esc(c.samples[0].month || 'NULL')}</code>。` : ''}</div>
    </div>` : ''}
    ${info.mixed ? `<div class="ov-result ov-result--warn" style="margin-bottom:12px;">
      <div class="ov-result__row">
        <span>⚠ 同一列里还存在 <code>${esc(info.mixed.raw)}</code>（${esc(info.mixed.side)}，恒为 <b>${esc(info.mixed.iso)}</b>）—— 唯一解值不受口径影响。</span>
        <span class="cfg-help-icon cfg-help-icon--inline" data-help-text="enc-mixed" data-enc="1" tabindex="0" role="button" aria-label="查看混写说明"><span>❓</span></span>
      </div>
      <div id="enc-mixed" style="display:none;">它与上面的歧义值并存，意味着<b>源系统可能混用了两种写法</b>；若真是混写，选任何单一口径都会把其中一部分解释错。建议先回源核对这批值（可对照同一行的 <code>${esc(syncField)}</code> 等已知字段），再统一口径。</div>
    </div>` : ''}
    <div class="ov-label">影响行数：<b>${info.affected}</b> 行 · 冲突取值：<b>${info.diff}</b> 个</div>
    <div style="border:1px solid var(--neutral-200);border-radius:8px;overflow:hidden;">
      <table class="ov-table">
        <thead><tr><th>原始值</th><th>口径 A · 日在前</th><th>口径 B · 月在前</th><th>是否冲突</th></tr></thead>
        <tbody>${info.samples.map(s => `<tr>
          <td class="mono">${esc(s.raw)}</td>
          <td class="mono" style="color:${s.asDay === s.asMonth ? 'var(--neutral-600)' : 'var(--brand-700)'};font-weight:${s.asDay === s.asMonth ? 400 : 600};">${esc(s.asDay || 'NULL')}</td>
          <td class="mono" style="color:${s.asDay === s.asMonth ? 'var(--neutral-600)' : 'var(--danger-700)'};font-weight:${s.asDay === s.asMonth ? 400 : 600};">${esc(s.asMonth || 'NULL')}</td>
          <td>${s.asDay === s.asMonth ? '<span style="color:var(--neutral-400);">一致</span>' : '<span class="q-item--warn">冲突</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="cfg-note" style="margin-top:10px;">确认后会写入「日期标准化」步骤的配置，预览、质量指标与生成的 SQL 会同步改变。${BATCH_SEL.length ? `批处理清单含 ${BATCH_SEL.length} 张同类表。` : ''}</div>
    ${BATCH_SEL.length ? `<label class="radio-line" style="margin-top:6px;"><input type="checkbox" id="da-batch" ${DA_BATCH ? 'checked' : ''} onchange="DA_BATCH = this.checked"> 同时应用到批处理清单中的 ${BATCH_SEL.length} 张同类表</label>` : ''}`;
  // ⚠ ❓ helper：弹窗里 cfg-note 默认折叠（用 inline ❓ + 隐藏 div 承载"完整说明"，与 cfg-body 走同一套 attachHelpIcons）
  [...box.querySelectorAll('.cfg-note')].forEach((n, i) => {
    if (n.dataset.helped) return;
    n.dataset.helped = '1';
    n.style.display = 'none';
    const id = 'enc-cfg-note-' + i + '-' + Math.random().toString(36).slice(2, 6);
    n.id = id;
    const btn = document.createElement('span');
    btn.className = 'cfg-help-icon cfg-help-icon--inline';
    btn.setAttribute('data-help-text', id);
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', '查看说明');
    btn.innerHTML = '<span>❓</span>';
    n.parentNode.insertBefore(btn, n);
  });
  attachHelpIcons(box);
  bindInlineHelpIcons(box);
}
function daPick(v) { DA_PICK = !!v; daRender(); }
function openDateAmbiguity(force) {
  const info = dateAmbiguityInfo();
  if (!info) {
    DF.app.toast('当前采样中没有「日月均可解释」的歧义日期，无需确认', 'info', 2200);
    return;
  }
  DA_PICK = null;
  const modal = DF.app.modal({
    title: '📅 日期格式歧义确认 · 复核口径',
    width: 760,
    body: '<div id="da-body"></div>',
    actions: `<button class="btn" data-resolve>暂不处理（保持当前口径）</button><button class="btn btn--primary" data-resolve="ok">✓ 按所选口径应用</button>`,
  });
  daRender();
  modal.then(r => {
    if (r !== 'ok') return;
    const v = DA_PICK === null ? info.dayFirst : DA_PICK;
    const dateStep = pipeline.find(s => s.id === 'date');
    if (dateStep) dateStep.config.dayFirst = v;
    daAck();                                    // 记下「这批歧义值已确认」，之后不再反复提示
    const batchN = (DA_BATCH && BATCH_SEL.length) ? BATCH_SEL.length : 0;
    DA_BATCH = false;
    const label = `确认日期歧义口径为「${v ? '日在前 DD-MM-YYYY' : '月在前 MM-DD-YYYY'}」` + (batchN ? `（含 ${batchN} 张同类表）` : '');
    apply(label);
    const tail = batchN ? `，并记录为批处理清单中 ${batchN} 张表的共用口径` : '';
    DF.app.toast(`✓ 歧义日期已按「${v ? 'DD-MM-YYYY 日在前' : 'MM-DD-YYYY 月在前'}」重新解释${tail}，预览、质量指标与 SQL 已同步`, 'success', 2800);
  });
}

/* ---------- 19 键盘快捷键 ---------- */
function isTypingEl(el) {
  if (!el || !el.tagName) return false;
  const t = el.tagName.toUpperCase();
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}
function stepNav(delta) {
  const list = pipeline.filter(s => s.enabled);
  if (!list.length) return;
  const idx = list.findIndex(s => s.id === selectedStepId);
  const next = list[Math.max(0, Math.min(list.length - 1, (idx < 0 ? 0 : idx) + delta))];
  if (next) { selectStep(next.id); DF.app.toast(`已定位到「${next.name}」`, 'info', 1200); }
}
const SHORTCUTS = [
  ['撤销', ['⌘', 'Z']],
  ['重做', ['⇧', '⌘', 'Z']],
  ['保存清洗任务', ['⌘', 'S']],
  ['运行预览', ['⌘', '↵']],
  ['查看 / 收起 SQL', ['⌘', '/']],
  ['规则模板库', ['⌘', 'K']],
  ['多表批处理', ['⌘', 'B']],
  ['上一个 / 下一步', ['[', ']']],
  ['停用 / 启用当前步骤', ['\\']],
  ['切换纵向 / 横向视图', ['⌘', 'L']],
  ['快捷键帮助', ['?']],
  ['关闭浮层', ['Esc']],
];
function openShortcutHelp() {
  DF.app.modal({
    title: '⌘ 键盘快捷键',
    width: 640,
    body: `<div class="ov-hero ov-hero--info"><span style="font-size:18px;line-height:1;">⌨</span>
      <div>带 ⌘ / Ctrl 的组合键在输入框内同样生效；无修饰键的快捷键在输入框内自动让位，不会打断打字。</div></div>
      <div class="kbd-grid">
        ${SHORTCUTS.map(([name, keys]) => `<div class="kbd-row"><span>${esc(name)}</span><span class="kbd-row__keys">${keys.map(k => `<kbd>${esc(k)}</kbd>`).join('')}</span></div>`).join('')}
      </div>`,
    actions: `<button class="btn btn--primary" data-resolve>知道了</button>`,
  });
}
document.addEventListener('keydown', e => {
  const meta = e.metaKey || e.ctrlKey;
  const k = (e.key || '').toLowerCase();
  if (meta && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  // ⚠ 总闸：⇧⌘Z 已在上一行单独处理；其下的所有 ⌘X 分支一律不接收 ⇧。
  //   否则 ⇧⌘K（切换源表，绑在 assets/src-picker.js）会连带命中 ⌘K（规则模板库）→ 一次弹两个浮层。
  //   把闸设在这里而不是逐个分支补 !e.shiftKey：以后新增任何 ⇧⌘X 都不会再撞上 ⌘X。
  if (meta && e.shiftKey) return;
  if (meta && k === 'y') { e.preventDefault(); redo(); return; }
  if (meta && k === 's') { e.preventDefault(); saveTask(); return; }
  if (meta && k === 'enter') { e.preventDefault(); runPreview(); return; }
  if (meta && e.key === '/') { e.preventDefault(); toggleSqlTab(); return; }
  if (meta && k === 'k') { e.preventDefault(); openTemplateLib(); return; }
  if (meta && k === 'b') { e.preventDefault(); openBatchPanel(); return; }
  if (meta && k === 'l') { e.preventDefault(); toggleLayout(); return; }
  if (e.key === 'Escape') { closeTopModal(); return; }
  if (isTypingEl(e.target)) return;
  if (e.key === ']' ) { e.preventDefault(); stepNav(1); return; }
  if (e.key === '[' ) { e.preventDefault(); stepNav(-1); return; }
  if (e.key === '\\') { e.preventDefault(); if (selectedStepId) toggleStep(selectedStepId); return; }
  if (e.key === '?') { e.preventDefault(); openShortcutHelp(); return; }
});

// ===== 启动 =====
loadTask();
loadVersions();
applyLayout();
LAST_STATE = histState();
executePipeline();
renderAll();
renderHistoryBar();
