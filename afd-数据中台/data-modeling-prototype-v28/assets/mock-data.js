/* ========================================================================
   DataForge · Mock Data Layer
   ----------------------------------------------------------------------
   完整的业务 Mock 数据集，用于 Demo 商演。所有数据均贴近真实业务。
   ======================================================================== */

window.DF = window.DF || {};

(function () {
  // ====== 读者 ======
  const userNames = ['王芳', '李明', '张磊', '陈雪', '赵强', '刘洋', '孙静', '周强', '吴敏', '郑伟', '钱晨', '马莉'];
  const avatars = ['avatar--blue', 'avatar--green', 'avatar--orange', 'avatar--red', 'avatar--purple'];
  const cities = ['北京', '上海', '广州', '深圳', '杭州', '成都', '南京', '武汉', '西安', '重庆', '苏州', '青岛'];

  const users = Array.from({ length: 28 }, (_, i) => {
    const name = userNames[i % userNames.length];
    return {
      id: `u${10000 + i}`,
      name,
      avatar: avatars[i % avatars.length],
      role: ['数据架构师', '数据工程师', '数据分析师', '业务方', 'DBA', '产品经理'][i % 6],
      dept: ['交易业务组', '读者增长组', '书目中心', '营销中心', '数据架构组', '基础平台组'][i % 6],
      online: i % 3 === 0,
    };
  });
  // 当前读者
  const me = users[0];

  // ====== 模型表 ======
  // 结构：id, name, type, layer, domain, owner, fields, ddl, ...
  const tableDefs = [
    // ODS
    { id: 'ods_bib_record', name: 'ods_bib_record', cn: '书目主表', layer: 'ods', type: 'ods', domain: '书目域', process: '编目', rows: 85432, size: '1.2 TB', owner: users[5], fields: 32, status: 'published', lastSync: '2 分钟前' },
    { id: 'ods_patron_info', name: 'ods_patron_info', cn: '读者主表', layer: 'ods', type: 'ods', domain: '读者域', process: '注册', rows: 248000, size: '820 GB', owner: users[3], fields: 28, status: 'published', lastSync: '5 分钟前' },
    { id: 'ods_loan_event', name: 'ods_loan_event', cn: '借还事件流', layer: 'ods', type: 'ods', domain: '流通域', process: '借还事件', rows: 124500, size: '680 GB', owner: users[4], fields: 18, status: 'published', lastSync: '实时' },
    { id: 'ods_opac_log', name: 'ods_opac_log', cn: 'OPAC 检索日志', layer: 'ods', type: 'ods', domain: '书目域', process: 'OPAC 检索', rows: 1852000, size: '2.4 TB', owner: users[6], fields: 24, status: 'published', lastSync: '1 分钟前' },

    // DWD（维度/主档表并入本层，前缀统一为 dwd_）
    { id: 'dwd_patron', name: 'dwd_patron_df', cn: '读者主维度', layer: 'dwd', type: 'dwd', domain: '读者域', process: '读者主档', rows: 248000, size: '12 GB', owner: users[0], fields: 18, status: 'published', lastSync: '1 小时前' },
    { id: 'dwd_bib', name: 'dwd_bib_df', cn: '书目维度', layer: 'dwd', type: 'dwd', domain: '书目域', process: '书目主档', rows: 86420, size: '8 GB', owner: users[2], fields: 24, status: 'published', lastSync: '2 小时前' },
    { id: 'dwd_location', name: 'dwd_location_df', cn: '馆藏地维度', layer: 'dwd', type: 'dwd', domain: '馆藏域', process: '馆藏地主档', rows: 8420, size: '2 GB', owner: users[5], fields: 16, status: 'published', lastSync: '3 小时前' },
    { id: 'dwd_date', name: 'dwd_date_df', cn: '日期维度', layer: 'dwd', type: 'dwd', domain: '公共', process: '日期', rows: 3650, size: '120 MB', owner: users[1], fields: 12, status: 'published', lastSync: '每天 0 点' },
    { id: 'dwd_callno', name: 'dwd_callno_df', cn: '索书号维度', layer: 'dwd', type: 'dwd', domain: '公共', process: '索书号', rows: 3420, size: '80 MB', owner: users[3], fields: 10, status: 'published', lastSync: '每周一' },
    { id: 'dwd_acquisition', name: 'dwd_acquisition_df', cn: '获取方式维度', layer: 'dwd', type: 'dwd', domain: '采访域', process: '获取方式', rows: 320, size: '40 MB', owner: users[4], fields: 12, status: 'published', lastSync: '昨天' },
    { id: 'dwd_subject', name: 'dwd_subject_df', cn: '学科主题维度', layer: 'dwd', type: 'dwd', domain: '主题域', process: '学科主档', rows: 1240, size: '120 MB', owner: users[2], fields: 14, status: 'published', lastSync: '昨天' },

    // DWD
    { id: 'dwd_bib_unified', name: 'dwd_bib_unified_df', cn: '书目统一明细', layer: 'dwd', type: 'dwd', domain: '书目域', process: '编目统一', rows: 85432, size: '420 GB', owner: users[0], fields: 28, status: 'published', lastSync: '1 小时前', isCore: true },
    { id: 'dwd_loan_circ', name: 'dwd_loan_circ_df', cn: '流通明细', layer: 'dwd', type: 'dwd', domain: '流通域', process: '借还', rows: 78920, size: '380 GB', owner: users[1], fields: 24, status: 'published', lastSync: '30 分钟前' },
    { id: 'dwd_fine_trans', name: 'dwd_fine_trans_df', cn: '罚款明细', layer: 'dwd', type: 'dwd', domain: '流通域', process: '违章', rows: 8420, size: '48 GB', owner: users[5], fields: 22, status: 'review', lastSync: '草稿' },
    { id: 'dwd_patron_behavior', name: 'dwd_patron_behavior_df', cn: '读者行为明细', layer: 'dwd', type: 'dwd', domain: '读者域', process: '行为日志', rows: 1852000, size: '2.8 TB', owner: users[6], fields: 26, status: 'published', lastSync: '实时' },
    { id: 'dwd_patron_login', name: 'dwd_patron_login_df', cn: '读者登录明细', layer: 'dwd', type: 'dwd', domain: '读者域', process: '登录', rows: 426000, size: '180 GB', owner: users[6], fields: 16, status: 'published', lastSync: '5 分钟前' },
    { id: 'dwd_bib_view', name: 'dwd_bib_view_df', cn: '书目检索明细', layer: 'dwd', type: 'dwd', domain: '书目域', process: 'OPAC 检索', rows: 642000, size: '320 GB', owner: users[2], fields: 18, status: 'published', lastSync: '10 分钟前' },
    { id: 'dwd_hold_transfer', name: 'dwd_hold_transfer_df', cn: '馆藏调拨明细', layer: 'dwd', type: 'dwd', domain: '馆藏域', process: '调拨', rows: 78920, size: '120 GB', owner: users[4], fields: 22, status: 'published', lastSync: '20 分钟前' },
    { id: 'dwd_shelving_done', name: 'dwd_shelving_done_df', cn: '上架完成明细', layer: 'dwd', type: 'dwd', domain: '馆藏域', process: '上架', rows: 76240, size: '98 GB', owner: users[4], fields: 20, status: 'published', lastSync: '15 分钟前' },
    { id: 'dwd_resv_add', name: 'dwd_resv_add_df', cn: '预约明细', layer: 'dwd', type: 'dwd', domain: '流通域', process: '预约', rows: 186200, size: '64 GB', owner: users[6], fields: 14, status: 'draft', lastSync: '草稿' },

    // DWT
    { id: 'dwt_loan_daily', name: 'dwt_loan_daily_df', cn: '借还日汇总', layer: 'dwt', type: 'dwt', domain: '流通域', process: '日借还', rows: 365, size: '12 GB', owner: users[0], fields: 16, status: 'published', lastSync: '今日' },
    { id: 'dwt_patron_borrow_daily', name: 'dwt_patron_borrow_daily_df', cn: '读者借阅日汇总', layer: 'dwt', type: 'dwt', domain: '流通域', process: '借阅汇总', rows: 186420, size: '32 GB', owner: users[1], fields: 22, status: 'published', lastSync: '今日' },
    { id: 'dwt_patron_active_30d', name: 'dwt_patron_active_30d_df', cn: '读者 30 日活跃', layer: 'dwt', type: 'dwt', domain: '读者域', process: '活跃汇总', rows: 248000, size: '48 GB', owner: users[3], fields: 20, status: 'review', lastSync: '审批中' },
    { id: 'dwt_hold_circ_daily', name: 'dwt_hold_circ_daily_df', cn: '馆藏流通日表', layer: 'dwt', type: 'dwt', domain: '馆藏域', process: '馆藏流通', rows: 8420, size: '8 GB', owner: users[5], fields: 18, status: 'published', lastSync: '今日' },
    { id: 'dwt_visit_7d', name: 'dwt_visit_7d_df', cn: '7 日到馆', layer: 'dwt', type: 'dwt', domain: '读者域', process: '到馆', rows: 245680, size: '28 GB', owner: users[6], fields: 14, status: 'published', lastSync: '昨日' },
    { id: 'dwt_return_daily', name: 'dwt_return_daily_df', cn: '归还日汇总', layer: 'dwt', type: 'dwt', domain: '流通域', process: '归还汇总', rows: 365, size: '8 GB', owner: users[1], fields: 14, status: 'published', lastSync: '今日' },

    // ADS
    { id: 'ads_patron_profile', name: 'ads_patron_profile_df', cn: '读者画像', layer: 'ads', type: 'application', domain: '读者域', process: '画像服务', rows: 248000, size: '24 GB', owner: users[3], fields: 32, status: 'published', lastSync: 'T+1' },
    { id: 'ads_bib_recommend', name: 'ads_bib_recommend_df', cn: '图书推荐宽表', layer: 'ads', type: 'application', domain: '书目域', process: '推荐', rows: 186420, size: '32 GB', owner: users[4], fields: 28, status: 'published', lastSync: '实时' },
    { id: 'ads_search_funnel', name: 'ads_search_funnel_df', cn: '检索漏斗', layer: 'ads', type: 'application', domain: '书目域', process: '漏斗', rows: 365, size: '4 GB', owner: users[6], fields: 16, status: 'published', lastSync: '今日' },
    { id: 'ads_lib_report', name: 'ads_lib_report_df', cn: '馆情日报', layer: 'ads', type: 'application', domain: '全馆', process: '馆情报表', rows: 365, size: '6 GB', owner: users[0], fields: 24, status: 'published', lastSync: '今日' },
    { id: 'ads_dashboard_ceo', name: 'ads_ceo_dashboard_df', cn: 'CEO 驾驶舱', layer: 'ads', type: 'application', domain: '全公司', process: '高管看板', rows: 365, size: '4 GB', owner: users[7], fields: 18, status: 'published', lastSync: '今日' },
  ];

  // ====== 字段定义 ======
  // 给 dwd_bib_unified 完整的字段定义（书目统一明细 / MARC21 标准）
  const dwdTradeOrderFields = [
    { name: 'bib_id', cn: '书目记录 ID', type: 'STRING', length: 20, pk: true, nn: true, std: 'std_bib_id', comment: '书目记录唯一标识' },
    { name: 'isbn', cn: 'ISBN', type: 'STRING', length: 13, std: 'std_isbn', comment: '国际标准书号(13位)' },
    { name: 'issn', cn: 'ISSN', type: 'STRING', length: 8, std: 'std_issn', comment: '国际标准连续出版物号' },
    { name: 'title', cn: '正题名', type: 'STRING', length: 500, nn: true, comment: '主要题名(MARC21 245$a)' },
    { name: 'subtitle', cn: '副题名', type: 'STRING', length: 500, comment: '副题名(MARC21 245$b)' },
    { name: 'parallel_title', cn: '并列题名', type: 'STRING', length: 500, comment: '并列题名(MARC21 245$d)' },
    { name: 'author_id', cn: '主要责任者 ID', type: 'STRING', length: 20, fk: 'dwd_patron.author_id', nn: true, comment: '外键关联作者主档' },
    { name: 'author_name', cn: '主要责任者', type: 'STRING', length: 200, comment: '主要责任者姓名' },
    { name: 'publisher_id', cn: '出版社 ID', type: 'STRING', length: 20, fk: 'dwd_location.publisher_id', comment: '外键关联出版社' },
    { name: 'publisher_name', cn: '出版者', type: 'STRING', length: 200, comment: '出版者名称' },
    { name: 'pub_year', cn: '出版年', type: 'INT', std: 'std_year', comment: '出版年份(MARC21 008/7-10)' },
    { name: 'pub_place', cn: '出版地', type: 'STRING', length: 100, comment: '出版地(MARC21 264$a)' },
    { name: 'language', cn: '语种', type: 'STRING', length: 3, std: 'std_language_iso639', comment: 'ISO 639 语种代码(chi/eng/jpn)' },
    { name: 'clc_code', cn: '中图分类号', type: 'STRING', length: 20, fk: 'dwd_callno.clc_code', std: 'std_clc', comment: '中图法分类号' },
    { name: 'subject_id', cn: '主题词 ID', type: 'STRING', length: 20, fk: 'dwd_subject.subject_id', std: 'std_subject_id', comment: '主题词' },
    { name: 'doc_type', cn: '文献类型', type: 'STRING', length: 4, std: 'std_doc_type', comment: 'a=专著 c=期刊 m=学位论文' },
    { name: 'carrier_type', cn: '载体类型', type: 'STRING', length: 2, std: 'std_carrier_type', comment: '纸张/电子/缩微/视听' },
    { name: 'price', cn: '定价', type: 'DECIMAL(18,2)', measure: true, std: 'std_money', comment: '定价(元)' },
    { name: 'page_count', cn: '页数', type: 'INT', measure: true, comment: '正文页数(MARC21 300$a)' },
    { name: 'marc_xml', cn: 'MARC21 原始记录', type: 'TEXT', comment: 'MARC21 ISO 2709 格式原始记录' },
    { name: 'status', cn: '书目状态', type: 'STRING', length: 16, std: 'std_bib_status', comment: '草稿/已发布/已剔旧' },
    { name: 'is_first_edition', cn: '是否初版本', type: 'BOOLEAN', comment: 'Y=初版 N=再版' },
    { name: 'access_level', cn: '访问级别', type: 'STRING', length: 8, std: 'std_access_level', comment: '公开/内部/受限' },
    { name: 'source_system', cn: '来源系统', type: 'STRING', length: 16, comment: '汇文/ALEPH/读秀/CALIS/采访录入' },
    { name: 'catalog_date', cn: '编目日期', type: 'DATE', std: 'std_date', comment: '编目完成日期' },
    { name: 'cataloger_id', cn: '编目员 ID', type: 'STRING', length: 20, comment: '编目员工号' },
    { name: 'gmt_create', cn: '入库时间', type: 'TIMESTAMP', nn: true, comment: '系统入库时间' },
    { name: 'gmt_modified', cn: '最后修改', type: 'TIMESTAMP', nn: true, comment: '最后修改时间' },
    { name: 'ds', cn: '数据日期', type: 'STRING', length: 8, partition: true, nn: true, std: 'std_date', comment: 'yyyymmdd 分区' },
  ];

  // 给其它表生成通用字段（基于 tableName 推断字段名）
  function generateFields(tableName, count) {
    const types = ['STRING', 'BIGINT', 'INT', 'DECIMAL(18,2)', 'TIMESTAMP', 'DOUBLE'];
    const standards = ['std_reader_id', 'std_amt_yuan', 'std_datetime', 'std_date', 'std_order_status'];
    // 推断字段名（基于表名后缀 + 顺序）
    const tpl = FIELD_NAME_TEMPLATES[tableName] || defaultFieldTemplate(tableName);
    return Array.from({ length: count }, (_, i) => {
      const isPK = i === 0;
      const isPart = i === count - 1;
      const isMeasure = i === 4 || i === 5;
      const t = tpl(i);
      return {
        name: t.name,
        cn: t.cn,
        type: t.type || (isPK ? 'STRING' : types[i % types.length]),
        length: t.length || (isPK ? 32 : null),
        pk: isPK,
        nn: isPK || isPart,
        measure: isMeasure,
        partition: isPart,
        std: i % 3 === 0 ? standards[i % standards.length] : null,
        comment: t.comment || `${t.cn}`,
      };
    });
  }

  // 默认字段名模板（基于表名后缀推断）
  function defaultFieldTemplate(tableName) {
    const entity = tableName.split('_').pop() || 'id'; // dwd_patron_df -> df
    // 提取业务域关键词
    let prefix = '';
    if (/patron|reader|user/i.test(tableName)) prefix = 'reader';
    else if (/loan|circ|borrow|return/i.test(tableName)) prefix = 'loan';
    else if (/fine|violation/i.test(tableName)) prefix = 'fine';
    else if (/reserve|hold|item/i.test(tableName)) prefix = 'hold';
    else if (/behavior|action|log|event/i.test(tableName)) prefix = 'behavior';
    else if (/view|recommend|search/i.test(tableName)) prefix = 'view';
    else prefix = entity;
    return (i) => {
      const seq = i + 1;
      const suffix = i === 0 ? 'id' : `field_${seq}`;
      return {
        name: i === 0 ? `${prefix}_id` : `${prefix}_${suffix}`,
        cn: i === 0 ? `${prefix} ID` : `${prefix} 字段 ${seq}`,
      };
    };
  }

  // 表名 → 字段模板映射
  const FIELD_NAME_TEMPLATES = {
    'dwd_loan_circ': (i) => {
      const arr = [
        { name: 'loan_id', cn: '借阅 ID' },
        { name: 'reader_id', cn: '读者证号' },
        { name: 'item_id', cn: '单册 ID' },
        { name: 'bib_id', cn: '书目 ID' },
        { name: 'op_type', cn: '操作类型' },
        { name: 'op_time', cn: '操作时间' },
        { name: 'loc_code', cn: '馆藏地' },
        { name: 'due_date', cn: '应还日期' },
        { name: 'return_date', cn: '实还日期' },
        { name: 'renew_cnt', cn: '续借次数' },
        { name: 'overdue_days', cn: '逾期天数' },
        { name: 'fine_amt', cn: '罚款金额' },
        { name: 'device_id', cn: '设备 ID' },
        { name: 'op_staff', cn: '操作员' },
        { name: 'is_renewal', cn: '是否续借' },
        { name: 'is_lost', cn: '是否遗失' },
        { name: 'ds', cn: '数据日期' },
        { name: 'gmt_create', cn: '入库时间' },
        { name: 'gmt_modified', cn: '最后更新' },
        { name: 'source_system', cn: '来源系统' },
      ];
      return i < arr.length ? { ...arr[i], type: 'STRING', length: 32, comment: arr[i].cn } : { name: `field_${i + 1}`, cn: `字段 ${i + 1}` };
    },
    'dwd_fine_trans': (i) => {
      const arr = [
        { name: 'fine_id', cn: '罚款 ID' },
        { name: 'reader_id', cn: '读者证号' },
        { name: 'loan_id', cn: '借阅 ID' },
        { name: 'fine_type', cn: '罚款类型' },
        { name: 'fine_amt', cn: '罚款金额' },
        { name: 'pay_amt', cn: '实付金额' },
        { name: 'pay_time', cn: '缴费时间' },
        { name: 'pay_channel', cn: '缴费渠道' },
        { name: 'loc_code', cn: '馆藏地' },
        { name: 'op_staff', cn: '经办员' },
        { name: 'status', cn: '状态' },
        { name: 'remark', cn: '备注' },
        { name: 'ds', cn: '数据日期' },
        { name: 'gmt_create', cn: '入库时间' },
        { name: 'gmt_modified', cn: '最后更新' },
        { name: 'source_system', cn: '来源系统' },
      ];
      return i < arr.length ? { ...arr[i], type: 'STRING', length: 32, comment: arr[i].cn } : { name: `field_${i + 1}`, cn: `字段 ${i + 1}` };
    },
    'dwd_patron_behavior': (i) => {
      const arr = [
        { name: 'event_id', cn: '行为事件 ID' },
        { name: 'reader_id', cn: '读者证号' },
        { name: 'event_type', cn: '事件类型' },
        { name: 'event_time', cn: '事件时间' },
        { name: 'page_url', cn: '页面 URL' },
        { name: 'bib_id', cn: '相关书目' },
        { name: 'search_keyword', cn: '检索词' },
        { name: 'session_id', cn: '会话 ID' },
        { name: 'device_type', cn: '设备类型' },
        { name: 'ip_addr', cn: 'IP 地址' },
        { name: 'duration_sec', cn: '停留秒数' },
        { name: 'is_login', cn: '是否登录' },
        { name: 'loc_code', cn: '访问馆藏地' },
        { name: 'ds', cn: '数据日期' },
        { name: 'gmt_create', cn: '入库时间' },
        { name: 'gmt_modified', cn: '最后更新' },
      ];
      return i < arr.length ? { ...arr[i], type: 'STRING', length: 32, comment: arr[i].cn } : { name: `field_${i + 1}`, cn: `字段 ${i + 1}` };
    },
  };

  // ===== 真实化字段集：dwd_patron（读者主维度）=====
  const dimPatronFields = [
    { name: 'reader_id', cn: '读者证号', type: 'STRING', length: 20, pk: true, nn: true, std: 'std_reader_id', comment: '读者唯一标识' },
    { name: 'reader_name', cn: '读者姓名', type: 'STRING', length: 100, nn: true, comment: '读者真实姓名' },
    { name: 'reader_type', cn: '读者类型', type: 'STRING', length: 8, std: 'std_reader_type', comment: '学生/教师/校友/校外/职工' },
    { name: 'gender', cn: '性别', type: 'STRING', length: 4, std: 'std_gender', comment: 'M/F/N(未说明)' },
    { name: 'id_type', cn: '证件类型', type: 'STRING', length: 16, std: 'std_id_type', comment: '身份证/护照/军官证' },
    { name: 'id_no', cn: '证件号', type: 'STRING', length: 32, comment: '证件号码(脱敏存储)' },
    { name: 'dept_code', cn: '院系代码', type: 'STRING', length: 16, fk: 'dwd_location.dept_code', comment: '所属院系/单位' },
    { name: 'dept_name', cn: '院系名称', type: 'STRING', length: 100, comment: '院系全称' },
    { name: 'campus_code', cn: '校区代码', type: 'STRING', length: 8, fk: 'dwd_location.campus_code', comment: '所在校区(邯郸/枫林/江湾/张江)' },
    { name: 'card_status', cn: '借阅证状态', type: 'STRING', length: 8, std: 'std_card_status', comment: '正常/挂失/过期/注销' },
    { name: 'register_date', cn: '注册日期', type: 'DATE', comment: '办证日期' },
    { name: 'expire_date', cn: '到期日期', type: 'DATE', comment: '借阅证到期日' },
    { name: 'total_borrow', cn: '累计借阅', type: 'BIGINT', measure: true, comment: '历史借阅总册次' },
    { name: 'current_borrow', cn: '在借册数', type: 'INT', measure: true, comment: '当前未还册数' },
    { name: 'overdue_cnt', cn: '逾期次数', type: 'INT', measure: true, comment: '累计逾期次数' },
    { name: 'total_fine', cn: '累计罚款', type: 'DECIMAL(18,2)', measure: true, comment: '历史违章罚款(元)' },
    { name: 'last_visit', cn: '最后到馆', type: 'TIMESTAMP', comment: '最后一次入馆时间' },
    { name: 'gmt_modified', cn: '最后更新', type: 'TIMESTAMP', nn: true, comment: '系统更新时间' },
  ];

  // ===== dwd_bib（书目维度，MARC21 完整字段集）=====
  const dimBibFields = [
    { name: 'bib_id', cn: '书目记录 ID', type: 'STRING', length: 20, pk: true, nn: true, std: 'std_bib_id', comment: 'MARC 001 控制号' },
    { name: 'isbn', cn: 'ISBN', type: 'STRING', length: 13, std: 'std_isbn', comment: '国际标准书号(13位)' },
    { name: 'issn', cn: 'ISSN', type: 'STRING', length: 8, std: 'std_issn', comment: '国际标准连续出版物号' },
    { name: 'title', cn: '正题名', type: 'STRING', length: 500, nn: true, comment: 'MARC 245$a' },
    { name: 'subtitle', cn: '副题名', type: 'STRING', length: 500, comment: 'MARC 245$b' },
    { name: 'parallel_title', cn: '并列题名', type: 'STRING', length: 500, comment: 'MARC 245$d' },
    { name: 'author', cn: '主要责任者', type: 'STRING', length: 200, comment: 'MARC 100$a' },
    { name: 'corp_author', cn: '团体作者', type: 'STRING', length: 200, comment: 'MARC 110$a' },
    { name: 'publisher', cn: '出版者', type: 'STRING', length: 200, comment: 'MARC 260$b / 264$b' },
    { name: 'pub_year', cn: '出版年', type: 'INT', std: 'std_year', comment: 'MARC 008/7-10' },
    { name: 'pub_place', cn: '出版地', type: 'STRING', length: 100, comment: 'MARC 264$a' },
    { name: 'language', cn: '语种', type: 'STRING', length: 3, std: 'std_language_iso639', comment: 'ISO 639 语种' },
    { name: 'clc_code', cn: '中图分类号', type: 'STRING', length: 20, std: 'std_clc', comment: '中图法分类号' },
    { name: 'subject_id', cn: '主题词 ID', type: 'STRING', length: 20, fk: 'dwd_subject.subject_id', comment: '主题词' },
    { name: 'doc_type', cn: '文献类型', type: 'STRING', length: 4, std: 'std_doc_type', comment: 'a=专著 c=期刊 m=学位论文' },
    { name: 'carrier_type', cn: '载体类型', type: 'STRING', length: 2, std: 'std_carrier_type', comment: '纸张/电子/缩微' },
    { name: 'page_count', cn: '页数', type: 'INT', measure: true, comment: 'MARC 300$a' },
    { name: 'price', cn: '定价', type: 'DECIMAL(18,2)', measure: true, std: 'std_money', comment: 'MARC 020$c' },
    { name: 'series', cn: '丛编', type: 'STRING', length: 200, comment: 'MARC 490$a' },
    { name: 'abstract', cn: '摘要', type: 'TEXT', comment: 'MARC 520' },
    { name: 'source_system', cn: '来源系统', type: 'STRING', length: 16, comment: '汇文/ALEPH/读秀/CALIS' },
    { name: 'catalog_date', cn: '编目日期', type: 'DATE', comment: 'MARC 008/5-7' },
    { name: 'gmt_create', cn: '入库时间', type: 'TIMESTAMP', nn: true, comment: '系统入库时间' },
    { name: 'gmt_modified', cn: '最后更新', type: 'TIMESTAMP', nn: true, comment: '系统更新时间' },
  ];

  // ===== dwd_location（馆藏地维度）=====
  const dimLocationFields = [
    { name: 'loc_code', cn: '馆藏地代码', type: 'STRING', length: 16, pk: true, nn: true, std: 'std_location', comment: '馆藏地唯一标识' },
    { name: 'loc_name', cn: '馆藏地名称', type: 'STRING', length: 100, nn: true, comment: '文图/理图/医图/江湾/张江' },
    { name: 'parent_loc', cn: '父级馆藏地', type: 'STRING', length: 16, comment: '总馆/分馆/院系分馆' },
    { name: 'campus_code', cn: '校区代码', type: 'STRING', length: 8, comment: '邯郸/枫林/江湾/张江' },
    { name: 'building', cn: '楼宇', type: 'STRING', length: 100, comment: '馆舍楼宇' },
    { name: 'floor', cn: '楼层', type: 'STRING', length: 16, comment: '所在楼层' },
    { name: 'room', cn: '房间/区域', type: 'STRING', length: 100, comment: '阅览室/书库/走廊' },
    { name: 'capacity', cn: '座位数', type: 'INT', measure: true, comment: '阅览座位总数' },
    { name: 'collection_size', cn: '馆藏量', type: 'BIGINT', measure: true, comment: '当前馆藏册数' },
    { name: 'opening_hours', cn: '开放时间', type: 'STRING', length: 200, comment: '周一至周日开放时间' },
    { name: 'is_open', cn: '是否开放', type: 'BOOLEAN', comment: '当前是否开放' },
    { name: 'manager', cn: '负责人', type: 'STRING', length: 50, comment: '馆长/室主任' },
    { name: 'contact_phone', cn: '联系电话', type: 'STRING', length: 20, comment: '联系电话' },
    { name: 'opac_url', cn: 'OPAC 链接', type: 'STRING', length: 200, comment: '本馆 OPAC 检索地址' },
    { name: 'gmt_create', cn: '创建时间', type: 'TIMESTAMP', nn: true, comment: '记录创建时间' },
    { name: 'gmt_modified', cn: '最后更新', type: 'TIMESTAMP', nn: true, comment: '系统更新时间' },
  ];

  // ===== dwd_date（日期维度）=====
  const dimDateFields = [
    { name: 'date_key', cn: '日期键', type: 'STRING', length: 8, pk: true, nn: true, std: 'std_date', comment: 'yyyyMMdd' },
    { name: 'date_value', cn: '完整日期', type: 'DATE', nn: true, comment: '日期值' },
    { name: 'year', cn: '年', type: 'INT', std: 'std_year', comment: '4 位年份' },
    { name: 'quarter', cn: '季度', type: 'INT', std: 'std_quarter', comment: '1-4 季度' },
    { name: 'month', cn: '月', type: 'INT', std: 'std_month', comment: '1-12 月份' },
    { name: 'month_name', cn: '月份名', type: 'STRING', length: 16, comment: '一月/January' },
    { name: 'week_of_year', cn: '年内周', type: 'INT', comment: 'ISO 周编号' },
    { name: 'day_of_week', cn: '星期', type: 'INT', std: 'std_day_of_week', comment: '1=周一 7=周日' },
    { name: 'day_name', cn: '星期名', type: 'STRING', length: 16, comment: '周一/Monday' },
    { name: 'is_workday', cn: '是否工作日', type: 'BOOLEAN', comment: 'Y=工作日 N=休息日' },
    { name: 'is_holiday', cn: '是否节假日', type: 'BOOLEAN', comment: 'Y=法定节假日' },
    { name: 'fiscal_year', cn: '财年', type: 'INT', comment: '财年(4 月起)' },
  ];

  // ===== ods_bib_record（书目原始记录，汇文/ALEPH 接入）=====
  const odsBibRecordFields = [
    { name: 'record_id', cn: '原始记录 ID', type: 'STRING', length: 24, pk: true, nn: true, comment: '汇文/ALEPH 原始记录号' },
    { name: 'marc_xml', cn: 'MARC21 原始 XML', type: 'TEXT', comment: 'MARC21 ISO 2709 / MARCXML 原文' },
    { name: 'isbn_raw', cn: 'ISBN 原文', type: 'STRING', length: 20, comment: '带连字符原文(待清洗)' },
    { name: 'title_raw', cn: '题名原文', type: 'STRING', length: 500, nn: true, comment: 'MARC 245 字段全文' },
    { name: 'author_raw', cn: '责任者原文', type: 'STRING', length: 500, comment: 'MARC 100/110/700 字段' },
    { name: 'publisher_raw', cn: '出版者原文', type: 'STRING', length: 500, comment: 'MARC 260/264$b' },
    { name: 'pub_year_raw', cn: '出版年原文', type: 'STRING', length: 20, comment: 'MARC 008/7-10 待解析' },
    { name: 'lang_code_raw', cn: '语种原文', type: 'STRING', length: 10, comment: 'MARC 008/35-37 3位代码' },
    { name: 'clc_raw', cn: '中图分类号原文', type: 'STRING', length: 50, comment: 'MARC 090/089 待清洗' },
    { name: 'source_system', cn: '来源系统', type: 'STRING', length: 16, std: 'std_source_system', nn: true, comment: '汇文/ALEPH/读秀/CALIS' },
    { name: 'ingest_time', cn: '接入时间', type: 'TIMESTAMP', nn: true, comment: '入库时间' },
    { name: 'is_valid', cn: '是否合法', type: 'BOOLEAN', comment: 'Y=合法 N=待清洗' },
    { name: 'ds', cn: '数据日期', type: 'STRING', length: 8, partition: true, nn: true, std: 'std_date', comment: 'yyyymmdd' },
  ];

  // ===== ods_patron_info（读者原始记录，汇文/一卡通接入）=====
  const odsPatronInfoFields = [
    { name: 'record_id', cn: '原始记录 ID', type: 'STRING', length: 24, pk: true, nn: true, comment: '汇文读者主键' },
    { name: 'reader_id_raw', cn: '读者证号原文', type: 'STRING', length: 32, comment: '待清洗(含前缀/连字符)' },
    { name: 'name_raw', cn: '姓名原文', type: 'STRING', length: 100, nn: true, comment: '一卡通同步' },
    { name: 'id_no_raw', cn: '证件号原文', type: 'STRING', length: 32, comment: '身份证/学工号(脱敏存储)' },
    { name: 'dept_raw', cn: '院系原文', type: 'STRING', length: 200, comment: '一卡通同步的院系全称' },
    { name: 'card_type_raw', cn: '证件类型原文', type: 'STRING', length: 20, comment: '学生/教师/职工' },
    { name: 'phone_raw', cn: '手机号原文', type: 'STRING', length: 20, comment: '已脱敏' },
    { name: 'email_raw', cn: '邮箱原文', type: 'STRING', length: 100, comment: '已脱敏' },
    { name: 'register_date_raw', cn: '注册日期原文', type: 'STRING', length: 20, comment: '待解析为标准日期' },
    { name: 'source_system', cn: '来源系统', type: 'STRING', length: 16, std: 'std_source_system', nn: true, comment: '汇文/一卡通/calis' },
    { name: 'ingest_time', cn: '接入时间', type: 'TIMESTAMP', nn: true, comment: '入库时间' },
    { name: 'is_valid', cn: '是否合法', type: 'BOOLEAN', comment: 'Y=合法 N=待清洗' },
    { name: 'ds', cn: '数据日期', type: 'STRING', length: 8, partition: true, nn: true, std: 'std_date', comment: 'yyyymmdd' },
  ];

  // ===== dwd_callno（索书号维度）=====
  const dimCallnoFields = [
    { name: 'callno', cn: '索书号', type: 'STRING', length: 50, pk: true, nn: true, std: 'std_callno', comment: '中图法+著者号' },
    { name: 'clc_code', cn: '中图法分类号', type: 'STRING', length: 20, std: 'std_clc', comment: '中图法字母+数字' },
    { name: 'clc_name', cn: '类目名称', type: 'STRING', length: 200, comment: '类目中文名' },
    { name: 'author_code', cn: '著者号', type: 'STRING', length: 16, comment: '著者四角号码' },
    { name: 'main_class', cn: '一级大类', type: 'STRING', length: 2, comment: 'A-V 22 大类' },
    { name: 'sub_class', cn: '二级类目', type: 'STRING', length: 8, comment: '二级细分' },
    { name: 'subject_id', cn: '主题词 ID', type: 'STRING', length: 20, fk: 'dwd_subject.subject_id', comment: '主题词关联' },
    { name: 'book_cnt', cn: '馆藏册数', type: 'INT', measure: true, comment: '本类目馆藏总册数' },
    { name: 'gmt_modified', cn: '最后更新', type: 'TIMESTAMP', nn: true, comment: '更新时间' },
    { name: 'ds', cn: '数据日期', type: 'STRING', length: 8, partition: true, std: 'std_date', comment: 'yyyymmdd 分区' },
  ];

  // ===== dwt_loan_daily（借还日汇总）=====
  const dwsLoanDailyFields = [
    { name: 'ds', cn: '数据日期', type: 'STRING', length: 8, pk: true, nn: true, partition: true, std: 'std_date', comment: 'yyyymmdd 分区' },
    { name: 'loc_code', cn: '馆藏地', type: 'STRING', length: 16, pk: true, fk: 'dwd_location.loc_code', comment: '汇总粒度' },
    { name: 'borrow_cnt', cn: '借出册次', type: 'BIGINT', measure: true, comment: '当日借出总册次' },
    { name: 'return_cnt', cn: '归还册次', type: 'BIGINT', measure: true, comment: '当日归还总册次' },
    { name: 'renew_cnt', cn: '续借册次', type: 'BIGINT', measure: true, comment: '当日续借总册次' },
    { name: 'overdue_cnt', cn: '逾期册次', type: 'BIGINT', measure: true, comment: '当日产生逾期册次' },
    { name: 'active_patron_cnt', cn: '活跃读者数', type: 'INT', measure: true, comment: '当日有借阅行为的读者去重数' },
    { name: 'new_patron_cnt', cn: '新增读者数', type: 'INT', measure: true, comment: '当日新办证读者数' },
    { name: 'visit_patron_cnt', cn: '到馆读者数', type: 'INT', measure: true, comment: '当日门禁入馆读者去重数' },
    { name: 'cn_book_ratio', cn: '中文图书占比', type: 'DECIMAL(5,2)', measure: true, comment: '中文图书借阅占比' },
    { name: 'en_book_ratio', cn: '英文图书占比', type: 'DECIMAL(5,2)', measure: true, comment: '英文图书借阅占比' },
    { name: 'jp_book_ratio', cn: '日文图书占比', type: 'DECIMAL(5,2)', measure: true, comment: '日文图书借阅占比' },
    { name: 'avg_borrow_days', cn: '平均借阅天数', type: 'DECIMAL(5,2)', measure: true, comment: '当日借出图书平均借期' },
    { name: 'peak_hour', cn: '高峰小时', type: 'INT', comment: '当日借还量高峰小时(0-23)' },
    { name: 'fine_amt', cn: '当日罚款金额', type: 'DECIMAL(18,2)', measure: true, comment: '当日违章罚款总额' },
    { name: 'gmt_create', cn: '入库时间', type: 'TIMESTAMP', nn: true, comment: '系统入库时间' },
  ];

  // ===== dwt_patron_borrow_daily（读者借阅日汇总）=====
  const dwsPatronBorrowDailyFields = [
    { name: 'reader_id', cn: '读者证号', type: 'STRING', length: 20, pk: true, nn: true, fk: 'dwd_patron.reader_id', std: 'std_reader_id', comment: '汇总粒度' },
    { name: 'ds', cn: '数据日期', type: 'STRING', length: 8, pk: true, nn: true, partition: true, std: 'std_date', comment: 'yyyymmdd 分区' },
    { name: 'dept_code', cn: '院系代码', type: 'STRING', length: 16, fk: 'dwd_location.dept_code', comment: '所属院系' },
    { name: 'reader_type', cn: '读者类型', type: 'STRING', length: 8, std: 'std_reader_type', comment: '学生/教师/校友' },
    { name: 'borrow_cnt', cn: '当日借出册次', type: 'BIGINT', measure: true, comment: '当日借出总册次' },
    { name: 'return_cnt', cn: '当日归还册次', type: 'BIGINT', measure: true, comment: '当日归还总册次' },
    { name: 'renew_cnt', cn: '当日续借册次', type: 'BIGINT', measure: true, comment: '当日续借总册次' },
    { name: 'overdue_cnt', cn: '当日逾期册次', type: 'INT', measure: true, comment: '当日逾期未还册次' },
    { name: 'fine_amt', cn: '当日罚款', type: 'DECIMAL(18,2)', measure: true, comment: '当日违章罚款' },
    { name: 'current_borrow', cn: '当前在借', type: 'INT', measure: true, comment: '统计时点未还册数' },
    { name: 'total_borrow_year', cn: '年内累计借阅', type: 'INT', measure: true, comment: '本年度累计借阅册次' },
    { name: 'first_borrow_bib', cn: '首借书 ID', type: 'STRING', length: 20, fk: 'dwd_bib.bib_id', comment: '本年度首次借阅的书目' },
    { name: 'last_borrow_time', cn: '最近借阅', type: 'TIMESTAMP', comment: '本日内最近一次借阅时间' },
    { name: 'active_minutes', cn: '活跃时长', type: 'INT', measure: true, comment: '当日在馆活跃时长(分钟)' },
    { name: 'cn_book_ratio', cn: '中文图书占比', type: 'DECIMAL(5,2)', measure: true, comment: '当日借阅中文图书占比' },
    { name: 'en_book_ratio', cn: '英文图书占比', type: 'DECIMAL(5,2)', measure: true, comment: '当日借阅英文图书占比' },
    { name: 'jp_book_ratio', cn: '日文图书占比', type: 'DECIMAL(5,2)', measure: true, comment: '当日借阅日文图书占比' },
    { name: 'other_lang_ratio', cn: '其他语种占比', type: 'DECIMAL(5,2)', measure: true, comment: '其他语种占比' },
    { name: 'is_first_borrow', cn: '是否首借', type: 'BOOLEAN', comment: 'Y=当日为读者首次借阅' },
    { name: 'visit_cnt', cn: '当日到馆次数', type: 'INT', measure: true, comment: '当日门禁刷卡次数' },
    { name: 'gmt_create', cn: '入库时间', type: 'TIMESTAMP', nn: true, comment: '系统入库时间' },
    { name: 'gmt_modified', cn: '最后更新', type: 'TIMESTAMP', nn: true, comment: '系统更新时间' },
  ];

  // ===== ads_patron_profile（读者画像）=====
  const adsPatronProfileFields = [
    { name: 'reader_id', cn: '读者证号', type: 'STRING', length: 20, pk: true, nn: true, fk: 'dwd_patron.reader_id', std: 'std_reader_id', comment: '画像主键' },
    { name: 'reader_name', cn: '读者姓名', type: 'STRING', length: 100, comment: '冗余姓名' },
    { name: 'reader_type', cn: '读者类型', type: 'STRING', length: 8, std: 'std_reader_type', comment: '学生/教师/校友' },
    { name: 'dept_code', cn: '院系代码', type: 'STRING', length: 16, fk: 'dwd_location.dept_code', comment: '所属院系' },
    { name: 'campus_code', cn: '校区', type: 'STRING', length: 8, comment: '所在校区' },
    { name: 'active_score', cn: '活跃度评分', type: 'DECIMAL(5,2)', measure: true, comment: '0-100 综合活跃度评分' },
    { name: 'borrow_score', cn: '借阅偏好', type: 'DECIMAL(5,2)', measure: true, comment: '借阅量/频次评分' },
    { name: 'visit_score', cn: '到馆偏好', type: 'DECIMAL(5,2)', measure: true, comment: '到馆频次评分' },
    { name: 'total_borrow_cnt', cn: '累计借阅', type: 'INT', measure: true, comment: '历史借阅总册次' },
    { name: 'borrow_cnt_30d', cn: '近 30 日借阅', type: 'INT', measure: true, comment: '近 30 日借阅册次' },
    { name: 'return_cnt_30d', cn: '近 30 日归还', type: 'INT', measure: true, comment: '近 30 日归还册次' },
    { name: 'overdue_cnt_30d', cn: '近 30 日逾期', type: 'INT', measure: true, comment: '近 30 日逾期册次' },
    { name: 'avg_borrow_days', cn: '平均借期', type: 'DECIMAL(5,2)', measure: true, comment: '平均借阅天数' },
    { name: 'favorite_subject', cn: '偏好主题', type: 'STRING', length: 50, fk: 'dwd_subject.subject_id', comment: '中图法主类偏好' },
    { name: 'favorite_lang', cn: '偏好语种', type: 'STRING', length: 8, std: 'std_language_iso639', comment: 'chi/eng/jpn' },
    { name: 'borrow_peak_hour', cn: '借阅高峰', type: 'INT', comment: '0-23 借阅高峰小时' },
    { name: 'last_visit_days', cn: '距上次到馆', type: 'INT', measure: true, comment: '距上次到馆天数' },
    { name: 'rec_active', cn: '近 7 日活跃', type: 'BOOLEAN', comment: 'Y=近 7 日有借阅或到馆' },
    { name: 'rec_recommend_bib', cn: '最近推荐书目', type: 'STRING', length: 20, fk: 'dwd_bib.bib_id', comment: '推荐系统最近输出' },
    { name: 'recommend_score', cn: '推荐接受度', type: 'DECIMAL(5,2)', measure: true, comment: '推荐书目接受率' },
    { name: 'ranking_score', cn: '综合排名', type: 'DECIMAL(8,2)', measure: true, comment: '用于排行榜' },
    { name: 'profile_tags', cn: '画像标签', type: 'STRING', length: 500, comment: 'JSON 数组字符串' },
    { name: 'segment_code', cn: '读者分群', type: 'STRING', length: 16, std: 'std_patron_segment', comment: '高频/普通/沉默/流失' },
    { name: 'risk_level', cn: '违约风险', type: 'STRING', length: 8, std: 'std_risk_level', comment: '高/中/低' },
    { name: 'preference_vector', cn: '偏好向量', type: 'TEXT', comment: '推荐系统偏好 embedding' },
    { name: 'model_version', cn: '模型版本', type: 'STRING', length: 16, comment: '生成画像的模型版本号' },
    { name: 'ds', cn: '数据日期', type: 'STRING', length: 8, partition: true, std: 'std_date', comment: 'yyyymmdd' },
    { name: 'gmt_modified', cn: '最后更新', type: 'TIMESTAMP', nn: true, comment: '画像更新时间' },
  ];

  // 给所有表添加 fields
  tableDefs.forEach(t => {
    if (t.id === 'dwd_bib_unified') {
      t.fields = dwdTradeOrderFields;
    } else if (t.id === 'dwd_patron') {
      t.fields = dimPatronFields;
    } else if (t.id === 'dwd_bib') {
      t.fields = dimBibFields;
    } else if (t.id === 'dwd_location') {
      t.fields = dimLocationFields;
    } else if (t.id === 'dwd_date') {
      t.fields = dimDateFields;
    } else if (t.id === 'dwd_callno') {
      t.fields = dimCallnoFields;
    } else if (t.id === 'dwt_loan_daily') {
      t.fields = dwsLoanDailyFields;
    } else if (t.id === 'dwt_patron_borrow_daily') {
      t.fields = dwsPatronBorrowDailyFields;
    } else if (t.id === 'ads_patron_profile') {
      t.fields = adsPatronProfileFields;
    } else if (t.id === 'ods_bib_record') {
      t.fields = odsBibRecordFields;
    } else if (t.id === 'ods_patron_info') {
      t.fields = odsPatronInfoFields;
    } else {
      t.fields = generateFields(t.id, t.fields);
    }
  });

  // ====== 指标 ======
  const metrics = [
    // 原子指标 - 交易域
    { id: 'pay_amt_sum', name: 'pay_amt_sum', cn: '支付金额', type: 'atomic', domain: '交易域', process: '支付', unit: '元', formula: 'SUM(pay_amt)', desc: '借阅支付金额总和' },
    { id: 'order_amt_sum', name: 'order_amt_sum', cn: '借阅金额', type: 'atomic', domain: '交易域', process: '下单', unit: '元', formula: 'SUM(order_amt)', desc: '借阅总金额' },
    { id: 'order_cnt', name: 'order_cnt', cn: '借阅数', type: 'atomic', domain: '交易域', process: '下单', unit: '笔', formula: 'COUNT(order_id)', desc: '借阅总数' },
    { id: 'user_cnt', name: 'user_cnt', cn: '读者数', type: 'atomic', domain: '读者域', process: '登录', unit: '人', formula: 'COUNT(DISTINCT reader_id)', desc: '读者数' },
    { id: 'refund_amt_sum', name: 'refund_amt_sum', cn: '退款金额', type: 'atomic', domain: '交易域', process: '退款', unit: '元', formula: 'SUM(refund_amt)', desc: '退款金额总和' },
    { id: 'pay_user_cnt', name: 'pay_user_cnt', cn: '支付读者数', type: 'atomic', domain: '交易域', process: '支付', unit: '人', formula: 'COUNT(DISTINCT reader_id)', desc: '实际支付读者数' },
    { id: 'visit_cnt', name: 'visit_cnt', cn: '访问次数', type: 'atomic', domain: '读者域', process: '浏览', unit: '次', formula: 'COUNT(*)', desc: '页面访问次数' },
    { id: 'login_cnt', name: 'login_cnt', cn: '登录次数', type: 'atomic', domain: '读者域', process: '登录', unit: '次', formula: 'COUNT(*)', desc: '登录次数' },

    // 派生指标
    { id: 'gmv_daily', name: 'gmv_daily', cn: 'GMV (每日)', type: 'derived', domain: '交易域', process: '支付', atomic: 'pay_amt_sum', period: '1d', scope: '全平台', unit: '元', trend: 12.4, value: 8642, formula: 'SUM(pay_amt) WHERE status IN (20,30,40) GROUP BY ds' },
    { id: 'gmv_30d', name: 'gmv_30d', cn: 'GMV (30日)', type: 'derived', domain: '交易域', process: '支付', atomic: 'pay_amt_sum', period: '30d', scope: '全平台', unit: '元', trend: 8.2, value: 24586, formula: 'SUM(pay_amt) 30d ROLLING' },
    { id: 'order_cnt_daily', name: 'order_cnt_daily', cn: '借阅数 (每日)', type: 'derived', domain: '交易域', process: '下单', atomic: 'order_cnt', period: '1d', scope: '全平台', unit: '笔', trend: -2.4, value: 8420, formula: 'COUNT(order_id) GROUP BY ds' },
    { id: 'pay_user_daily', name: 'pay_user_daily', cn: '支付读者 (每日)', type: 'derived', domain: '交易域', process: '支付', atomic: 'pay_user_cnt', period: '1d', scope: '全平台', unit: '人', trend: 5.6, value: 3240, formula: 'COUNT(DISTINCT reader_id) GROUP BY ds' },
    { id: 'active_user_30d', name: 'active_user_30d', cn: '月活读者', type: 'derived', domain: '读者域', process: '登录', atomic: 'user_cnt', period: '30d', scope: '全平台', unit: '人', trend: 3.8, value: 186420 },
    { id: 'dau', name: 'dau', cn: '日活读者 (DAU)', type: 'derived', domain: '读者域', process: '登录', atomic: 'user_cnt', period: '1d', scope: '全平台', unit: '人', trend: 2.1, value: 48620 },
    { id: 'retention_7d', name: 'retention_7d', cn: '7日留存率', type: 'derived', domain: '读者域', process: '登录', period: '7d', scope: '全平台', unit: '%', trend: 0.5, value: 32.4 },
    { id: 'shop_revenue_daily', name: 'shop_revenue_daily', cn: '馆藏地日营收', type: 'derived', domain: '交易域', process: '支付', atomic: 'pay_amt_sum', period: '1d', scope: '按馆藏地', unit: '元', trend: 8.2, value: 1248 },

    // 衍生指标
    { id: 'gmv_yoy_growth', name: 'gmv_yoy_growth', cn: 'GMV 同比增长', type: 'compound', domain: '交易域', formula: '(gmv_daily - gmv_daily_yoy) / gmv_daily_yoy', unit: '%', trend: 4.2, value: 18.6 },
    { id: 'gmv_dod_growth', name: 'gmv_dod_growth', cn: 'GMV 环比增长', type: 'compound', domain: '交易域', formula: '(gmv_today - gmv_yesterday) / gmv_yesterday', unit: '%', trend: 1.8, value: 2.4 },
    { id: 'discount_rate', name: 'discount_rate', cn: '优惠率', type: 'compound', domain: '交易域', formula: 'discount_amt / order_amt', unit: '%', trend: 0.4, value: 8.6 },
    { id: 'arpu', name: 'arpu', cn: 'ARPU', type: 'compound', domain: '读者域', formula: 'gmv / pay_user_cnt', unit: '元/人', trend: 2.1, value: 268 },
    { id: 'conversion_rate', name: 'conversion_rate', cn: '转化率', type: 'compound', domain: '读者域', formula: 'pay_user_cnt / visit_cnt', unit: '%', trend: 0.6, value: 3.8 },
    { id: 'refund_rate', name: 'refund_rate', cn: '退款率', type: 'compound', domain: '交易域', formula: 'refund_amt / order_amt', unit: '%', trend: -0.2, value: 1.4 },
  ];

  // ====== 待办事项 ======
  const todos = [
    { id: 1, type: 'approval', title: '审批 @李明 提交的 dwd_bib_unified 模型', desc: 'v3.3 草稿，含 3 个新字段、1 个删除、2 个修改', priority: 'urgent', time: '2 小时前', link: '05-table-detail.html?id=dwd_bib_unified' },
    { id: 2, type: 'review', title: '补全 dwd_patron 读者维度表的标准代码', desc: '5 个枚举字段尚未关联 std_gender / std_reader_type 等标准', priority: 'medium', time: '5 小时前', link: '05-table-detail.html?id=dwd_patron' },
    { id: 3, type: 'metric', title: 'GMV 派生指标口径核对 - @产品部', desc: '业务方对 GMV 是否包含运费存在异议', priority: 'high', time: '昨天 16:42', link: '07-metrics-system.html' },
    { id: 4, type: 'review', title: '交易域 DWD 层 v2.4 升级方案评审', desc: '涉及 18 个表的字段重命名，建议团队会议讨论', priority: 'medium', time: '昨天 14:20', link: '02-warehouse-planning.html' },
    { id: 5, type: 'standard', title: '应用表 ads_patron_profile 字段命名规范化', desc: '检测到 4 个字段不符合 snake_case 规范', priority: 'low', time: '2 天前', link: '06-data-standards.html' },
    { id: 6, type: 'metric', title: '指标 ARPU 业务口径待确认', desc: '@运营组 反馈口径需调整', priority: 'low', time: '3 天前', link: '12-metric-detail.html?id=arpu' },
    { id: 7, type: 'lineage', title: '修复 dwd_user_behavior 血缘断裂', desc: '上游表 ods_opac_log 字段映射异常', priority: 'high', time: '3 天前', link: '11-data-lineage.html?center=dwd_user_behavior' },
  ];

  // ====== 团队活动 ======
  const activities = [
    { user: users[1], action: '发布了', target: 'dwd_loan_circ_df', meta: '交易域 · DWD · v3.2 · 15分钟前', type: 'publish' },
    { user: users[3], action: '提交了', target: 'dwt_user_active_30d', meta: '读者域 · DWT · 待审批 · 1小时前', type: 'review' },
    { user: users[2], action: '创建了', target: 'dwd_bib', meta: '书目域 · DWD · 草稿 · 2小时前', type: 'create' },
    { user: users[6], action: '更新了指标', target: 'GMV_D-1', meta: '派生指标 · v2.0 → v2.1 · 3小时前', type: 'update' },
    { user: users[7], action: '导入了', target: '零售电商行业模型', meta: '86 个模型 · 12 主题域 · 昨天', type: 'import' },
    { user: users[4], action: '提交了', target: 'dwd_trade_refund_df', meta: '交易域 · DWD · 草稿 · 昨天', type: 'create' },
    { user: users[0], action: '评审通过', target: 'dwd_acquisition_df', meta: '营销域 · DWD · v1.2 · 2天前', type: 'publish' },
    { user: users[5], action: '回滚了', target: 'dwt_return_daily_df v2.5', meta: 'v2.5 → v2.4 · 3天前', type: 'rollback' },
  ];

  // ====== KPI 历史数据（用于趋势图） ======
  function genTrend(days, base, volatility) {
    const today = new Date();
    const arr = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const noise = (Math.random() - 0.5) * volatility;
      const value = base * (1 + noise);
      arr.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        value: Math.round(value * 100) / 100,
      });
    }
    return arr;
  }
  const kpiTrends = {
    gmv: genTrend(30, 8420, 0.18),
    tables: genTrend(30, 340, 0.04),
    dau: genTrend(30, 48600, 0.06),
    orders: genTrend(30, 8420, 0.12),
  };

  // ====== 数据域 ======
  const domains = [
    { id: 'trade', name: '交易域', code: 'trade', color: 'var(--brand-500)', icon: '📦', models: 42, progress: 88, processes: ['下单', '支付', '退款', '发货', '签收'] },
    { id: 'user', name: '读者域', code: 'user', color: 'var(--success-500)', icon: '👤', models: 36, progress: 86, processes: ['注册', '登录', '行为', '留存', '画像'] },
    { id: 'product', name: '书目域', code: 'product', color: 'var(--warning-500)', icon: '🛍', models: 28, progress: 78, processes: ['书目主档', '类目', '浏览', '加购'] },
    { id: 'marketing', name: '营销域', code: 'marketing', color: 'var(--info-500)', icon: '📣', models: 22, progress: 69, processes: ['活动', '优惠券', '推荐'] },
    { id: 'logistics', name: '物流域', code: 'logistics', color: 'var(--danger-500)', icon: '🚚', models: 14, progress: 50, processes: ['揽收', '运输', '派送', '签收'] },
    { id: 'finance', name: '财务域', code: 'finance', color: 'var(--neutral-500)', icon: '💰', models: 8, progress: 33, processes: ['结算', '对账', '发票'] },
  ];

  // ====== 业务过程 ======
  const businessProcesses = [
    { id: 'order_create', name: '下单', cn: '下单', dim: ['user', 'product', 'shop', 'date', 'geo', 'channel'], status: 'modeled' },
    { id: 'pay_success', name: '支付', cn: '支付', dim: ['user', 'product', 'shop', 'date', 'geo', 'channel'], status: 'modeled' },
    { id: 'refund_apply', name: '退款', cn: '退款', dim: ['user', 'product', 'shop', 'date'], status: 'modeling' },
    { id: 'logistics_ship', name: '发货', cn: '发货', dim: ['user', 'product', 'shop', 'date', 'geo'], status: 'modeled' },
    { id: 'logistics_signed', name: '签收', cn: '签收', dim: ['user', 'product', 'shop', 'date', 'geo'], status: 'modeling' },
    { id: 'page_view', name: '浏览', cn: '浏览', dim: ['user', 'product', 'shop', 'date', 'channel'], status: 'modeled' },
    { id: 'cart_add', name: '加购', cn: '加购', dim: [], status: 'todo' },
    { id: 'favorite_add', name: '收藏', cn: '收藏', dim: [], status: 'todo' },
  ];

  // ====== 字段标准 ======
  const standards = [
    { id: 'std_reader_id', cn: '读者唯一标识', en: 'reader_id', type: 'STRING', length: 32, refCount: 186, owner: users[0] },
    { id: 'std_reader_name', cn: '读者姓名', en: 'reader_name', type: 'STRING', length: 64, refCount: 142, owner: users[0] },
    { id: 'std_user_phone', cn: '读者手机号', en: 'user_phone', type: 'STRING', length: 16, refCount: 98, owner: users[3] },
    { id: 'std_amt_yuan', cn: '金额(元)', en: '*_amt', type: 'DECIMAL(18,2)', unit: '元', refCount: 312, owner: users[2] },
    { id: 'std_amt_fen', cn: '金额(分)', en: '*_amt_fen', type: 'BIGINT', unit: '分', refCount: 24, owner: users[2] },
    { id: 'std_order_status', cn: '借阅状态', en: 'order_status', type: 'STRING', length: 4, refCount: 46, owner: users[6] },
    { id: 'std_datetime', cn: '日期时间', en: '*_time', type: 'TIMESTAMP', refCount: 268, owner: users[0] },
    { id: 'std_date', cn: '业务日期', en: 'ds/dt', type: 'STRING', length: 8, refCount: 312, owner: users[0] },
    { id: 'std_gender', cn: '性别', en: 'gender', type: 'STRING', length: 2, refCount: 28, owner: users[3], status: 'review' },
    { id: 'std_geo_region', cn: '行政区划', en: 'region_code', type: 'STRING', length: 8, refCount: 86, owner: users[7] },
    { id: 'std_device_type', cn: '设备类型', en: 'device_type', type: 'STRING', length: 16, refCount: 42, owner: users[3] },
    { id: 'std_gender', cn: '读者性别', en: 'gender', type: 'STRING', length: 2, refCount: 18, owner: users[3] },
  ];

  // ====== 行业模型 ======
  const industryModels = [
    { name: '零售电商 · 全域数据模型', desc: '阿里电商中台方法论，覆盖交易、书目、读者、营销、库存 5 大主题域', models: 86, refCount: 1240, rating: 4.9, version: 'v3.2', industry: '零售', color: '#1E66F5' },
    { name: '金融信贷风控模型', desc: '覆盖客户、账户、交易、风控 4 大域', models: 64, refCount: 856, rating: 4.8, version: 'v2.4', industry: '金融', color: '#18A957' },
    { name: '智慧物流运输模型', desc: '借阅、运单、仓储、运输、配送全链路', models: 42, refCount: 624, rating: 4.7, version: 'v1.8', industry: '物流', color: '#F59E0B' },
    { name: '字节增长分析模型', desc: '字节跳动数据驱动方法论沉淀', models: 56, refCount: 1840, rating: 4.9, version: 'v4.0', industry: '互联网', color: '#0EA5E9' },
    { name: '便利店新零售模型', desc: '线下门店 + 线上配送融合场景', models: 48, refCount: 286, rating: 4.8, version: 'v1.2', industry: '零售', color: '#92400E' },
    { name: '保险业务核心模型', desc: '保单、理赔、续保全周期', models: 35, refCount: 412, rating: 4.6, version: 'v2.1', industry: '金融', color: '#1E40AF' },
    { name: '直播电商实时模型', desc: '直播间、流量、书目、转化', models: 36, refCount: 928, rating: 4.9, version: 'v1.0', industry: '零售', color: '#BE185D' },
    { name: '智能制造 IoT 模型', desc: '设备数据采集 + OEE 分析', models: 47, refCount: 528, rating: 4.7, version: 'v1.5', industry: '制造', color: '#4338CA' },
    { name: '互联网医院数据模型', desc: '患者、医生、处方、问诊', models: 24, refCount: 156, rating: 4.5, version: 'v1.0', industry: '医疗', color: '#15803D' },
    { name: '网约车运营模型', desc: '借阅、轨迹、计价、司机画像', models: 35, refCount: 642, rating: 4.7, version: 'v2.0', industry: '出行', color: '#6D28D9' },
    { name: 'CRM 客户运营模型', desc: 'RFM 分层 + 营销自动化', models: 45, refCount: 384, rating: 4.6, version: 'v2.2', industry: '营销', color: '#B91C1C' },
    { name: '证券交易分析模型', desc: '行情、借阅、持仓、收益', models: 23, refCount: 198, rating: 4.4, version: 'v1.3', industry: '金融', color: '#0E7490' },
  ];

  // ====== 血缘关系（基于表依赖） ======
  // upstream: 上游表 id 列表; downstream: 下游表 id 列表
  const lineage = {
    dwd_bib_unified: {
      upstream: ['ods_bib_record', 'dwd_patron', 'dwd_bib', 'dwd_location', 'dwd_date', 'dwd_callno', 'dwd_acquisition'],
      downstream: ['dwt_loan_daily', 'dwt_patron_borrow_daily', 'dwt_hold_circ_daily', 'ads_patron_profile', 'ads_bib_recommend', 'ads_lib_report'],
    },
    dwd_loan_circ: {
      upstream: ['ods_bib_record', 'dwd_patron'],
      downstream: ['dwt_loan_daily', 'dwt_return_daily'],
    },
    dwd_user_behavior: {
      upstream: ['ods_opac_log', 'dwd_patron'],
      downstream: ['dwt_user_active_30d', 'dwt_retain_7d', 'ads_bib_recommend', 'ads_funnel_daily'],
    },
    dwt_loan_daily: {
      upstream: ['dwd_bib_unified', 'dwd_loan_circ'],
      downstream: ['ads_lib_report', 'ads_dashboard_ceo'],
    },
    dwt_patron_borrow_daily: {
      upstream: ['dwd_bib_unified', 'dwd_patron'],
      downstream: ['ads_patron_profile', 'ads_bib_recommend'],
    },
    ads_patron_profile: {
      upstream: ['dwt_patron_borrow_daily', 'dwt_user_active_30d', 'dwd_user_behavior'],
      downstream: [],
    },
    ads_bib_recommend: {
      upstream: ['dwd_bib_unified', 'dwt_patron_borrow_daily', 'dwd_user_behavior'],
      downstream: [],
    },
  };

  // ====== 系统通知 ======
  const notifications = [
    { type: 'approval', title: '李明 提交了 dwd_bib_unified v3.3', time: '15 分钟前', read: false, link: '10-publish-workflow.html' },
    { type: 'mention', title: '陈雪 在指标 ARPU 业务口径 中 @了你', time: '1 小时前', read: false, link: '12-metric-detail.html?id=arpu' },
    { type: 'success', title: 'dwt_loan_daily 调度任务执行成功', time: '2 小时前', read: true, link: '01-dashboard.html' },
    { type: 'warning', title: 'ods_logistics_event 同步延迟超阈值', time: '3 小时前', read: true, link: '11-data-lineage.html' },
  ];

  // ====== 导出 ======
  DF.data = {
    me,
    users,
    tables: tableDefs,
    metrics,
    todos,
    activities,
    kpiTrends,
    domains,
    businessProcesses,
    standards,
    industryModels,
    lineage,
    notifications,
  };

  // ====== 工具方法 ======
  DF.utils = {
    /** 查找表 */
    findTable(id) {
      return DF.data.tables.find(t => t.id === id);
    },
    /** 查找指标 */
    findMetric(id) {
      return DF.data.metrics.find(m => m.id === id);
    },
    /** 格式化数字 */
    formatNumber(n) {
      if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
      if (n >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
      return n.toString();
    },
    /** 格式化金额 */
    formatMoney(n) {
      return '¥ ' + DF.utils.formatNumber(n);
    },
    /** 格式化百分比 */
    formatPercent(n) {
      return n.toFixed(1) + '%';
    },
    /** 获取层级颜色 */
    layerColor(layer) {
      const map = { ods: '#8AABFF', dwd: '#1E66F5', dwt: '#F59E0B', ads: '#E5484D' };
      return map[layer] || '#9AA5B8';
    },
    /** 获取层级名称 */
    layerName(layer) {
      const map = { ods: 'ODS · 原始数据层', dwd: 'DWD · 明细层（含宽表/主档）', dwt: 'DWT · 主题汇总层', ads: 'ADS · 应用层' };
      return map[layer] || layer;
    },
    /** 获取状态徽章 */
    statusBadge(status) {
      const map = {
        published: { class: 'pill--published', text: '已发布' },
        review: { class: 'pill--review', text: '审批中' },
        draft: { class: 'pill--draft', text: '草稿' },
        offline: { class: 'pill--offline', text: '已下线' },
        archived: { class: 'pill--archived', text: '已归档' },
      };
      return map[status] || { class: 'pill--draft', text: '草稿' };
    },
  };
})();
