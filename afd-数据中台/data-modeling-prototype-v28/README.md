# DataForge · 智能数据建模平台 — 高保真 UI/UX 设计稿

> **完整闭环 · 20 个页面 · 企业级 B 端设计**
> 对标：阿里云 DataWorks + 字节火山引擎 DataLeap

## 🚀 快速开始

在**本目录内**启动静态服务（`pages/` 与 `assets/` 之间是相对路径，必须在原型根目录起服务）：

```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

或直接打开根目录的 `index.html`（工作台入口）。

## 📦 项目结构

```
data-modeling-prototype-v28/
├── index.html                 ← 🌟 工作台入口（根目录版，直连 assets/）
├── pages/                     ← 20 个核心高保真页面
├── assets/
│   ├── design-tokens.css      ← 🎨 共享设计系统（颜色/字体/间距/阴影 Token）
│   ├── sidebar.css            ← 侧边栏样式
│   ├── sidebar.js             ← 侧边栏配置与挂载（所有页面的导航来源）
│   ├── app.js                 ← 页面通用交互（弹窗/导航/表格/切换）
│   ├── charts.js              ← 轻量 SVG 图表渲染
│   ├── mock-data.js           ← 全站 mock 数据（表/字段/指标/血缘/动态）
│   ├── std-modals.js          ← 数据标准相关弹窗
│   └── cleaning.js            ← 🧪 清洗页规则引擎（10 步流水线 + 方言 SQL + 撤销重做 + 多表批处理）
└── docs/
    ├── DESIGN-SYSTEM.md       ← 📖 完整设计规范
    ├── DATA-CLEANING-REVIEW.md← 🔍 清洗页对标大厂的评估报告与优化分档
    └── RESEARCH.md            ← 🔬 大厂数据中台调研笔记
```

> `index.html` 与 `pages/01-dashboard.html` 是同一个「数据建模工作台」的两处落地：前者为根目录入口，后者供侧边栏互链使用。

## 🎯 20 个核心页面

> 文件均在 `pages/` 下；根目录 `index.html` 为工作台入口。

### 总览与规划

| # | 页面 | 文件 | 说明 |
|---|------|------|------|
| 01 | **数据建模工作台** ⭐ | `01-dashboard.html` | KPI · 待办 · 团队动态 · 数仓健康度 · 大屏自适应（2K/4K） |
| 02 | **数仓分层规划** | `02-warehouse-planning.html` | 4 层架构（ODS/DWD/DWT/ADS） + 业务过程矩阵 + 数据域 |
| 02b | **数据源管理** | `02b-data-sources.html` | 28 个数据源接入状态与配置 |

### 建模与治理

| # | 页面 | 文件 | 说明 |
|---|------|------|------|
| 03 | **维度建模** ⭐ | `03-dimensional-modeling.html` | 三栏布局：树 + 列表 + 详情 |
| 04 | **关系图画布** ⭐ | `04-relation-graph.html` | ER 图可视化 · 拖拽建模 · 4 条分层泳道 |
| 05 | **物理表详情** | `05-table-detail.html` | 字段编辑 + DDL 预览 + 血缘 |
| 06 | **数据标准中心** | `06-data-standards.html` | 标准总览 + 引用统计 |
| 06a | · 实体标准 | `06a-entity-standards.html` | 12 类实体标准（图书馆业务域） |
| 06b | · 属性标准 | `06b-attribute-standards.html` | 186 项字段标准 |
| 06c | · 码值标准 | `06c-code-standards.html` | 枚举/代码表标准 |
| 06d | · 映射规则 | `06d-mapping-rules.html` | MARC / DC / CALIS 等多来源字段映射 |
| 07 | **指标体系** | `07-metrics-system.html` | 原子/派生/衍生三层架构 |
| 08 | **行业模型库** | `08-model-library.html` | 12 套行业模板一键导入 |
| 12 | **指标详情** | `12-metric-detail.html` | 业务/技术口径 + 趋势图 |
| 13 | **逆向建模** | `13-reverse-modeling.html` | 物理表 → 逻辑模型 |

### 发布、运维与开发

| # | 页面 | 文件 | 说明 |
|---|------|------|------|
| 09 | **版本对比** | `09-version-compare.html` | 双栏 diff + 颜色差异 |
| 10 | **模型发布** | `10-publish-workflow.html` | 4 步审批流 + 检查清单 |
| 11 | **血缘分析** ⭐ | `11-data-lineage.html` | 可视化血缘画布 |
| 14 | **新建模型** | `14-new-table-wizard.html` | 4 步引导 + AI 推荐 · 拖拽建表 + JOIN 画布 |
| 15 | **ODS 数据清洗** ⭐ | `15-data-cleaning.html` | 可视化 ETL：10 步流水线（映射/清理/码值映射/类型转换/日期标准化/去重/多表关联/列加工/脱敏/质量校验）+ 逐步回放预览 + 四方言 SQL 自动生成 + DQC 质量门禁 + 脏数据分流表 + 全量试跑 + 任务调度与版本回滚 |

## ✨ 设计亮点

- 🎨 **统一设计系统**：颜色 / 字体 / 间距 / 阴影 / 圆角全部 Token 化
- 📐 **4 层数仓配色**：ODS 原始数据层 蓝紫 / DWD 明细层（含宽表·维度主档） 蓝 / DWT 主题汇总层 橙 / ADS 应用层 红
- 🧩 **可复用组件**：Topbar / Tree / Drawer / Card / Table / Tabs
- 🌗 **专业企业级风格**：类似阿里云 / 火山引擎 / Databricks
- 📱 **响应式布局**：1440 / 1024 / 768 多断点，工作台额外适配 1920 / 2560 / 3840
- 🔍 **可点击原型**：所有页面互链，可直接演示
- 🧪 **清洗页是真引擎**：规则逐步真实执行，预览列头 / SQL 投影 / 质量指标同源于「列计划」，不报错也不静默失效
- 🏭 **清洗页对齐生产级**：质量规则可配阈值与「阻断/告警/继续」、失败行落 `<表名>_dirty` 隔离表并回写血缘、采样与全量试跑分离（带上限保护）、任务调度与版本 diff/回滚；SQL 按 Hive / Spark / MySQL / Doris 四种方言真实生成
- 🎛 **清洗页是「真操作」而非演示**：步骤可拖拽排序（移动前做可达性校验，不合法就拦下并说明原因）、全量变更走统一通道因此**任意操作都能撤销/重做**、`⌘Z / ⌘⇧Z / ⌘S / ⌘/` 快捷键、日期歧义格式弹出人工确认而非静默猜测；**多表批处理**按「语义角色」而非表名做同类判定，一套模板可套到多张源表并逐表真实产出指标与 SQL，翻译不了的规则显式标为「不适用 / 需人工确认」，绝不静默丢弃
- 🧭 **静默失效零容忍**：362 条运行时 DOM 断言覆盖全部四档改造（含「批处理结果与执行顺序无关」「批处理结束后现场原样还原」等护栏），每一条都验证「配置 → 预览 → SQL」三者一致

## 🎓 设计参考

调研了以下大厂实践：
- 阿里云 **DataWorks** 智能数据建模、**DQC** 数据质量
- 字节火山引擎 **DataLeap** 数据中台
- 字节 **ByteHouse** 实时数仓
- 阿里 **OneData** 指标方法论
- 阿里 Kimball **维度建模** 理论
- **Trifacta / Alteryx / Informatica** 数据准备与清洗的交互范式

## 📖 详细文档

- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — 完整设计 Token 规范、组件库使用说明、关键交互模式
- [`docs/DATA-CLEANING-REVIEW.md`](docs/DATA-CLEANING-REVIEW.md) — 清洗页对标大厂的缺陷清单（P0/P1/P2）、四档优化建议与**修复进度 + 回归证据**
- [`docs/RESEARCH.md`](docs/RESEARCH.md) — 大厂数据中台调研笔记

## 💡 使用建议

- **设计评审**：用 `index.html` 做总览，深度评审时打开具体页面
- **前端开发**：参考 `assets/design-tokens.css` 实现样式
- **产品演示**：所有页面可点击串联，形成完整业务故事
- **设计稿源文件**：建议用 Figma 重建可编辑版本（HTML 仅作高保真参考）

## 📝 License

本项目仅供设计参考使用 · MIT License
