三种启动方式（推荐 A）
方式 A｜最快 — 项目树双击打开 package.json，在 "dev": "vite" 这一行的左侧装订槽点绿色 ▶ → Run 'dev'。

方式 B｜可复用（适合长期开发） — 右上角配置下拉 → Edit Configurations… → + → npm → 填：Command = run，Scripts = dev，Name 随意 → Apply → 点 ▶ 运行（之后 ⌃R 一键启动）。

方式 C｜终端 — Alt+F12 打开内置终端，输入 npm run dev。

停止服务：Run 窗口左上红色 ■（⌘F2）。也可从 View → Tool Windows → npm 面板双击 dev。