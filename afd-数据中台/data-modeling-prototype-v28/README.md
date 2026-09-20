# DataForge · 智能数据建模平台 — 高保真 UI/UX 设计稿

> **完整闭环 · 21 个页面 · 企业级 B 端设计**
> 对标：阿里云 DataWorks + 字节火山引擎 DataLeap

## 🚀 快速开始

和 `afd-dataos/`（AFD DataOS，`npm run dev` → 5173）保持一致，本原型也是**一条 npm 命令**起服务。**零依赖、无构建**，不需要 `npm install`：

```bash
cd data-modeling-prototype-v28
npm run dev            # → http://localhost:8000/index.html
```

`npm run dev` 跑的是 `scripts/dev-server.mjs`（Node 标准库写的迷你静态服务器，无第三方依赖）。相比 `python3 -m http.server`，它多做了三件这个项目真正需要的事：

| 能力 | 为什么需要 |
|---|---|
| **`Cache-Control: no-store`** | 旧服务只发 `Last-Modified`，浏览器按「启发式新鲜度」**直接吃本地缓存不回源** → 改了 `assets/*.js` 页面还在跑旧代码，「明明修好了却还能复现」 |
| **文档根由脚本自身路径推导** | 不依赖 `cwd`。`http.server` 在 import 阶段就求值 `os.getcwd()`，被 launchd 拉起时（无「用户文件夹」授权）抛 `EPERM` **秒退崩溃循环** |
| **绑 `::` 双栈** | macOS `v6only=0` → `127.0.0.1` / `::1` / `localhost` 三种解析全通（只绑 `127.0.0.1` 时浏览器走 `::1` 会 502） |

其它入口：`npm start`（同 `dev`）、`npm run dev -- --port 8010`（换端口）；`/docs/` 与 `/assets/` 支持目录列举，方便直接翻文档。

或直接双击根目录的 `index.html`（工作台入口）—— 但 `pages/` 与 `assets/` 之间是相对路径，跳转需要起服务。

### 让 8000 长驻（开机自启）

```bash
npm run service:install     # 装 LaunchAgent 守护，崩了系统秒级拉起
npm run service:status      # 看守护状态
npm run service:restart     # 重启守护
npm run service:uninstall   # 卸载（原型文件不动，之后仍可 npm run dev）
```

> ⚠ **唯一的系统级前提：完全磁盘访问权限。**
> 本项目在 `~/Documents` 下（macOS TCC 保护区），而 launchd 拉起的进程**没有「用户文件夹」授权**——不授权时进程能起来、端口在听，但**读文件被拒，每个页面都返回 404**。
> `npm run service:install` 会自动检测这个症状，并把「需要授权的那一行 node 路径」打印给你。
> 授权位置：系统设置 → 隐私与安全性 → 完全磁盘访问权限 → 「+」→ 文件框按 ⌘⇧G → 粘贴脚本打印的路径 → 打开开关 → 再 `npm run service:restart`。
> 不想授权也没关系：`npm run dev` 在终端里启动，继承终端已有的授权，一样能用。

> ℹ️ **关于 `?v=` 缓存版本号**：现在 dev server 已发 `no-store`，正常情况下改完刷新即见；但 `15-data-cleaning.html` 里的 `?v=` 时间戳仍**必须**跟着 `cleaning.js` 的 mtime 走（`verify-legacy-fixes.js` 会校验，不会静默漏掉）。
> 一行同步命令（这台机器上 `sed -i ''` 会报 "No such file or directory"，用 `perl -pi`）：
> ```bash
> cd data-modeling-prototype-v28 && STAMP=$(stat -f "%Sm" -t "%Y%m%d-%H%M" assets/cleaning.js) \
>   && perl -pi -e "s/cleaning\.js\?v=[0-9]+-[0-9]+/cleaning.js?v=$STAMP/g" pages/15-data-cleaning.html
> ```

## 📦 项目结构

```
data-modeling-prototype-v28/
├── index.html                 ← 🌟 工作台入口（根目录版，直连 assets/）
├── package.json               ← 🚀 脚本入口：npm run dev / service:install（无 dependencies，不需要 npm install）
├── pages/                     ← 21 个核心高保真页面
├── assets/
│   ├── design-tokens.css      ← 🎨 共享设计系统（颜色/字体/间距/阴影 Token）
│   ├── sidebar.css            ← 侧边栏样式
│   ├── sidebar.js             ← 侧边栏配置与挂载（所有页面的导航来源）
│   ├── app.js                 ← 页面通用交互（弹窗/导航/表格/切换）
│   ├── charts.js              ← 轻量 SVG 图表渲染
│   ├── mock-data.js           ← 全站 mock 数据（表/字段/指标/血缘/动态）
│   ├── std-modals.js          ← 数据标准相关弹窗
│   ├── cleaning.js            ← 🧪 清洗页规则引擎（10 步流水线 + 方言 SQL + 撤销重做 + 多表批处理）
│   ├── src-picker.js          ← 🔎 源表切换器（候选 = 集成注册表 29 张 / 按数据源 12 组 / 全维度搜索 / 键盘导航 / 切换后果预知 / 「未配清洗任务」显式标注），挂在 cleaning.js 与 integration-data.js 之后
│   ├── integration-data.js    ← 🔌 数据集成共享注册表：ODS 表级事实源（29 张）+ 按数据源统计 + 同步状态变更
│   ├── file-parse.js          ← 📄 浏览器端零依赖解析引擎：CSV/TSV 编码与分隔符嗅探、XLSX 自解 ZIP+DecompressionStream、JSON
│   └── integration.css        ← 🎛️ 数据集成模块共用样式（拖拽上传 / 解析结果 / 数据源卡片操作 / ODS 全表视图）
├── scripts/
│   ├── dev-server.mjs         ← 🖥️ `npm run dev` 跑的就是它：Node 标准库静态服务器（no-store / 双栈 / 目录列举）
│   └── install-dataforge-service.sh ← 🛡️ 装 macOS LaunchAgent 守护（开机自启；缺授权时自动诊断并打印要授权的 node 路径）
└── docs/
    ├── DESIGN-SYSTEM.md       ← 📖 完整设计规范
    ├── DATA-CLEANING-REVIEW.md← 🔍 清洗页对标大厂的评估报告与优化分档
    ├── OPERATION-GUIDE-数据清洗.md ← 🧭 清洗页操作手册（第 1~10 步标准流程、速查表、常见误解）
    ├── OPERATION-GUIDE-数据集成.md ← 🧭 数据集成操作手册（数据源 / ODS 表 / 「两个分母」口径对照）
    └── RESEARCH.md            ← 🔬 大厂数据中台调研笔记
```

> `index.html` 与 `pages/01-dashboard.html` 是同一个「数据建模工作台」的两处落地：前者为根目录入口，后者供侧边栏互链使用。

## 🎯 21 个核心页面

> 文件均在 `pages/` 下；根目录 `index.html` 为工作台入口。

### 总览与规划

| # | 页面 | 文件 | 说明 |
|---|------|------|------|
| 01 | **数据建模工作台** ⭐ | `01-dashboard.html` | KPI · 待办 · 团队动态 · 数仓健康度 · 大屏自适应（2K/4K） |
| 02 | **数仓分层规划** | `02-warehouse-planning.html` | 4 层架构（ODS/DWD/DWT/ADS） + 业务过程矩阵 + 数据域 |
| 02b | **数据源管理** | `02b-data-sources.html` | 28 个数据源接入状态与配置 · 拖拽上传解析 · 删除 · 已同步表统计 |
| 02c | **ODS 数据表** | `02c-ods-tables.html` | ODS 层全表清单：来自哪个数据源 / 哪些还没同步 / 一键同步 |

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
| 15 | **ODS 数据清洗** ⭐ | `15-data-cleaning.html` | 可视化 ETL：10 步流水线（映射/清理/码值映射/类型转换/日期标准化/去重/多表关联/列加工/脱敏/质量校验）+ 逐步回放预览 + 四方言 SQL 自动生成 + DQC 质量门禁 + 脏数据分流表 + 全量试跑 + 任务调度与版本回滚 + 左栏按**数据源**选源表（候选与「数据源管理」同源，共 29 张 ODS 表；未配清洗任务的表显式标注并引导，不做假切换） |

## ✨ 设计亮点

- 🎨 **统一设计系统**：颜色 / 字体 / 间距 / 阴影 / 圆角全部 Token 化
- 📐 **4 层数仓配色**：ODS 原始数据层 蓝紫 / DWD 明细层（含宽表·维度主档） 蓝 / DWT 主题汇总层 橙 / ADS 应用层 红
- 🧩 **可复用组件**：Topbar / Tree / Drawer / Card / Table / Tabs
- 🌗 **专业企业级风格**：类似阿里云 / 火山引擎 / Databricks
- 📱 **响应式布局**：1440 / 1024 / 768 多断点，工作台额外适配 1920 / 2560 / 3840
- 🔍 **可点击原型**：所有页面互链，可直接演示
- 🧪 **清洗页是真引擎**：规则逐步真实执行，预览列头 / SQL 投影 / 质量指标同源于「列计划」，不报错也不静默失效
- 🏭 **清洗页对齐生产级**：质量规则可配阈值与「阻断/告警/继续」、失败行落 `<表名>_dirty` 隔离表并回写血缘、采样与全量试跑分离（带上限保护）、任务调度与版本 diff/回滚；SQL 按 Hive / Spark / MySQL / Doris 四种方言真实生成
- 🎛 **清洗页是「真操作」而非演示**：步骤可拖拽排序（移动前做可达性校验，不合法就拦下并说明原因）、全量变更走统一通道因此**任意操作都能撤销/重做**、`⌘Z / ⌘⇧Z / ⌘S / ⌘/ / ⇧⌘K` 快捷键、日期歧义格式弹出人工确认而非静默猜测；**多表批处理**按「语义角色」而非表名做同类判定，一套模板可套到多张源表并逐表真实产出指标与 SQL，翻译不了的规则显式标为「不适用 / 需人工确认」，绝不静默丢弃
- 🔎 **切源表是搜索式浮层而非下拉框**：左栏当前表卡片即触发器（点击 / `Enter` / `⇧⌘K`），浮层支持表名·中文名·**数据源名·源端表名**·目标表·字段名全维度检索（命中处高亮）、按**数据源**分成 12 组（组标题报「可清洗 / 本组张数」）、`↑↓` 移动 / `↵` 切换 / `Esc` 关闭；并在选中行**预知切换后果**——角色齐备度（同类 / 缺哪几个角色）+ 模板适配结果（几项规则会不适用）。后果预知在流水线克隆副本上重放，**绝不改动当前配置**
- 🔗 **清洗页与「数据源管理 / ODS 数据表」共用同一份表级事实源**：切换器的候选不再只看清洗页自带的 10 张，而是直接读 `DF.integration.ODS_TABLES`（**29 张 / 12 个数据源**）——其中 **10 张已配清洗任务**（正常切换、有角色齐备度徽标），**19 张只在 ODS 同步、还没清洗任务**（灰色虚线徽标「**未配清洗任务**」，点了**不切表**、只给一条引导 toast，**绝不做假切换**）。反向也通了：02b / 02c 里每张已同步表的「**去清洗**」现在带 `?table=<ods_id>` 跳过来——已配任务就直接落到那张表，没配就停在默认表并提示先去建任务，不再是"点了去清洗、落下来却是另一张表"
- 🔢 **两个「张数」不再打架**：数据源卡片与列表写「已同步 6 / 源端 12 张 · 还有 6 张没同步」，抽屉「库表结构」列源端的**全部**表并分「已同步 / 已建任务待同步 / 尚未纳管」三态，点行看这张表的落地情况，未纳管的可一键「纳入同步清单」（持久化，02c 即时可见）。此前抽屉里是一份写死的 7 张假表数组、点任何数据源都一样，与 ODS 注册表毫无关系，才会出现「卡片说 1 张、抽屉列 7 张」的自相矛盾
- 🧭 **静默失效零容忍**：632 条运行时 DOM 断言覆盖全部四档改造 + 数据集成模块 + 多轮 UX 简化（含「批处理结果与执行顺序无关」「批处理结束后现场原样还原」「停用正在回放的步骤必给解释性 toast」「toast hover 暂停」「默认日期口径不视为待确认」「❓ helper 默认折叠所有 cfg-note」「左栏单表 UI + 顶栏切源表」「源表切换浮层的搜索/键盘/点击提交/后果预知纯读不污染配置」「切换器候选换成集成注册表（29 张 / 12 个数据源）后，分组、徽标、计数全部按结构自适应」「标着『未配清洗任务』的表点了/回车都不切表、只给引导 toast」「`?table=` 直达：已配任务就切过去、没配就停在默认表」「跨域扩到 10 张源表后所有断言仍按结构自适应」「拖拽上传真实 XLSX/CSV 的解析结果与统计口径自洽」「删除数据源的三个入口 + 影响面 + 撤销」「02b 与 02c 共用一个表级注册表、状态变更跨页同步」「卡片/列表/抽屉三处同口径给出源端库表总数与已同步数，未纳管的表可一键纳入」「抽屉不再渲染写死的假表」等护栏），每一条都验证「配置 → 预览 → SQL」三者一致

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
- [`docs/OPERATION-GUIDE-数据清洗.md`](docs/OPERATION-GUIDE-数据清洗.md) — **清洗页操作手册**：心理模型、界面分区、第 1~10 步标准流程、逐步骤速查表、常见「看起来不对劲」与原型边界
- [`docs/OPERATION-GUIDE-数据集成.md`](docs/OPERATION-GUIDE-数据集成.md) — **数据集成模块操作手册**：数据源新增（含 Excel 拖拽解析）/ 删除与撤销 / 按数据源看同步表数 / ODS 层全表视图与「未同步」处理闭环
- [`docs/RESEARCH.md`](docs/RESEARCH.md) — 大厂数据中台调研笔记

## 💡 使用建议

- **设计评审**：用 `index.html` 做总览，深度评审时打开具体页面
- **前端开发**：参考 `assets/design-tokens.css` 实现样式
- **产品演示**：所有页面可点击串联，形成完整业务故事
- **设计稿源文件**：建议用 Figma 重建可编辑版本（HTML 仅作高保真参考）

## 📝 License

本项目仅供设计参考使用 · MIT License
