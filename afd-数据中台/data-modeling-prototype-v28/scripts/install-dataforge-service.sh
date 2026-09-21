#!/usr/bin/env bash
# DataForge 原型服务守护 · 一键安装 / 卸载
# ---------------------------------------------------------------------------
# 让 DataForge 静态原型在 macOS 上长驻（开机自启、崩了自动拉起），
# 用的是项目自带的 Node dev server（脚本里叫 dev-server.mjs，
# 也就是 `npm run dev` 跑的那一个），不用 python、不用构建。
#
# 用法（在你的 iTerm 里执行）：
#   npm run service:install      # 等价于 bash scripts/install-dataforge-service.sh
#   npm run service:uninstall
#   npm run service:restart      # 改完配置想重启守护时
#   npm run service:status
#
# ── ⚠ 唯一的系统级前提：完全磁盘访问权限 ─────────────────────────────────
#   launchd 拉起的进程**没有「用户文件夹」授权**，而本项目在 ~/Documents 下
#   （属于 macOS TCC 保护区）。不授权的话进程能起来、端口在听，但**读文件被拒
#   → 每个页面都返回 404**。安装脚本会自动检测这个症状并告诉你该授权哪个文件。
#   授权位置：系统设置 → 隐私与安全性 → 完全磁盘访问权限 → 「+」
#             把脚本打印出来的 node 路径加进去并打开开关。
#   不想授权也行：直接用 `npm run dev`（在终端里跑，继承终端已有的授权）。
# ---------------------------------------------------------------------------
set -euo pipefail

LABEL="com.shenlonghua.dataforge-8000"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY="$SCRIPT_DIR/dev-server.mjs"
PORT="${DATAFORGE_PORT:-8000}"
LOG_BASE="$HOME/.workbuddy/logs/dataforge-${PORT}"

# ---- 卸载 ----
if [[ "${1:-}" == "--uninstall" ]]; then
  echo "==> 卸载 ${LABEL}"
  launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ 已卸载（plist 已删除；原型文件未动）"
  echo "  之后仍可用 npm run dev 手动启动。"
  exit 0
fi

# ---- preflight：定位 node ----
NODE_BIN="${DATAFORGE_NODE:-}"
if [[ -z "$NODE_BIN" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  else
    NODE_BIN="$(ls -1 "$HOME"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo "✗ 找不到可执行的 node，请先装 Node 或设 DATAFORGE_NODE=<路径>"; exit 1; }
if command -v /usr/bin/python3 >/dev/null 2>&1; then
  NODE_REAL="$(/usr/bin/python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$NODE_BIN")"
else
  NODE_REAL="$NODE_BIN"
fi
[[ -f "$ENTRY" ]] || { echo "✗ 缺少 $ENTRY"; exit 1; }
[[ -d "$DOC_ROOT" ]] || { echo "✗ 项目目录不存在：$DOC_ROOT"; exit 1; }
mkdir -p "$HOME/.workbuddy/logs"

echo "==> node      $("$NODE_REAL" -v)"
echo "==> 服务入口  $ENTRY"
echo "==> 文档根    $DOC_ROOT"
echo "==> 端口      $PORT"

# ---- 写 plist ----
# ⚠ 关键设计（别改）：
#   1) ProgramArguments 直接指向 node 真实二进制 + 脚本，**不经 shell**
#      → TCC 的授权对象唯一确定（就是上面那个 node 路径）。
#   2) 不设 WorkingDirectory、也不用 `python3 -m http.server`：
#      http.server 在 import 阶段求值 os.getcwd()，在未授权进程里会抛 EPERM
#      导致秒退崩溃循环（历史故障：runs=644 / last exit=1）。
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_REAL}</string>
    <string>${ENTRY}</string>
    <string>--port</string>
    <string>${PORT}</string>
  </array>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>RunAtLoad</key>
  <true/>

  <!-- ⚠ macOS Sonoma 起 LaunchAgent 必须显式声明可在哪些 SessionType 下运行；
       漏了会被 launchd 静默拒绝（Load failed: 5: Input/output error）。 -->
  <key>LimitLoadToSessionType</key>
  <array>
    <string>Aqua</string>
    <string>Background</string>
    <string>LoginWindow</string>
    <string>StandardIO</string>
    <string>System</string>
  </array>

  <key>StandardOutPath</key>
  <string>${LOG_BASE}.out.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_BASE}.err.log</string>
</dict>
</plist>
PLISTEOF
chmod 644 "$PLIST"
echo "==> plist     $PLIST"
plutil -lint "$PLIST"

# ---- 让位 + 装载（幂等）----
lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null | xargs -r -I{} kill -TERM {} 2>/dev/null || true
sleep 1
launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || true

if launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null; then
  echo "✓ launchctl bootstrap 成功"
elif launchctl load -w "$PLIST" 2>/dev/null; then
  echo "✓ launchctl load 成功（fallback）"
else
  echo "✗ launchctl 加载失败 —— 见 ${LOG_BASE}.err.log"
  exit 1
fi

# ---- 健康检查 + 自动诊断 ----
sleep 2
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://127.0.0.1:${PORT}/index.html" || echo 000)"
echo ""
echo "==> 健康检查  HTTP $CODE"
case "$CODE" in
  200)
    echo "✓ 安装完成，8000 端口已常驻（开机自启）。"
    echo "  地址：http://localhost:${PORT}/index.html"
    ;;
  404)
    echo "⚠ 服务在跑，但每个页面都 404 —— 这是「完全磁盘访问」没授权的典型症状："
    echo "  launchd 进程读不到 ${DOC_ROOT}（macOS TCC 保护区）。"
    echo ""
    echo "  修法：系统设置 → 隐私与安全性 → 完全磁盘访问权限 → 点「+」"
    echo "        在文件框里按 ⌘⇧G，粘贴下面这行，回车、选中、打开，并确认开关是开的："
    echo ""
    echo "        ${NODE_REAL}"
    echo ""
    echo "        然后执行：npm run service:restart"
    echo "  不行的话：直接用 npm run dev（终端启动，继承终端已有的授权）。"
    ;;
  000)
    echo "✗ 端口没监听。看日志：tail -20 ${LOG_BASE}.err.log"
    ;;
  *)
    echo "⚠ 非预期状态码 ${CODE}，看日志：tail -20 ${LOG_BASE}.err.log"
    ;;
esac
echo ""
echo "  状态：npm run service:status"
echo "  重启：npm run service:restart"
echo "  卸载：npm run service:uninstall"
