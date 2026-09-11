CREATE EXTERNAL TABLE `dwd.dwd_fdulib_rfid_cloud_elib5_loan_log`(
  `id` bigint,
  `action_type` string COMMENT '操作类型',
  `item_id` bigint COMMENT '馆藏id',
  `catalogue_id` bigint COMMENT '书目id',
  `reader_id` bigint COMMENT '读者id',
  `reader_barcode` string COMMENT '读者条码号',
  `item_barcode` string COMMENT '馆藏条码号',
  `permanent_location_code` string COMMENT '发生地',
  `permanent_library_code` string COMMENT '发生馆',
  `renewal_count` bigint COMMENT '续借次数',
  `loan_date` string COMMENT '借出时间',
  `due_date` string COMMENT '应还时间',
  `return_date` string COMMENT '归还时间',
  `action_date` string COMMENT '操作日期',
  `create_time` string,
  `creator` string,
  `source` string COMMENT '来源系统',
  `synchronous_time_hive` string COMMENT 'hive同步时间')
ROW FORMAT SERDE
  'org.apache.hadoop.hive.ql.io.orc.OrcSerde'
WITH SERDEPROPERTIES (
    'field.delim'='\t',
    'serialization.format'='\t')
         STORED AS INPUTFORMAT
  'org.apache.hadoop.hive.ql.io.orc.OrcInputFormat'
OUTPUTFORMAT
  'org.apache.hadoop.hive.ql.io.orc.OrcOutputFormat'
LOCATION
  'hdfs://10.55.102.72:9003/data/hive/warehouse/null'
TBLPROPERTIES (
  'orc.compress'='SNAPPY',
  'transient_lastDdlTime'='1788904587')