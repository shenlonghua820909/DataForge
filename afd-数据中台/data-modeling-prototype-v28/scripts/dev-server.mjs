#!/usr/bin/env node
/**
 * DataForge 原型开发服务器 —— 零依赖（只用 Node 标准库，不需要 npm install）
 * ---------------------------------------------------------------------------
 * 用法：
 *   npm run dev              # 8000 端口
 *   npm run dev -- --port 8010
 *   PORT=8010 npm run dev
 *
 * 为什么不用 `python3 -m http.server`：
 *   1) http.server 在**模块导入阶段**就求值 `default=os.getcwd()`，一旦进程
 *      没有「用户文件夹」TCC 授权（例如被 launchd 拉起）就抛 EPERM 秒退；
 *      本脚本的文档根是**由 __dirname 推导的绝对路径**，全程不依赖 cwd。
 *   2) 静态 python 服务不带任何缓存头，浏览器会拿旧 HTML/JS → "改完看不到效果"。
 *      本脚本统一 `no-store`，改完直接刷新（连 ?v= 都只当保险）。
 *   3) 默认绑 IPv6 通配符 `::`：macOS `net.inet6.ip6.v6only = 0` 时
 *      127.0.0.1 / ::1 / localhost 三种解析全都通（只绑 127.0.0.1 时浏览器走 ::1 会 502）。
 */

import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..'); // 扩展根 = scripts/ 的上一级

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const PORT = Number(argOf('--port') || process.env.DATAFORGE_PORT || process.env.PORT || 8000);
const HOST = argOf('--host') || process.env.HOST || '::';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
};

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

function textPage(res, status, title, hint) {
  const body = `<!doctype html><meta charset="utf-8"><title>${status} ${title}</title>
<style>body{font:14px/1.7 -apple-system,"PingFang SC",sans-serif;color:#334155;padding:48px;max-width:720px}
h1{font-size:20px;margin:0 0 6px}code{background:#f1f5f9;padding:2px 6px;border-radius:5px}
a{color:#2563eb}</style>
<h1>${status} ${title}</h1><p>${hint}</p>
<p><a href="/index.html">← 回原型首页</a></p>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...NO_STORE });
  res.end(body);
}

function sendListing(dir, res) {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const rel = path.relative(ROOT, dir).split(path.sep).filter(Boolean).join('/');
  const up = rel ? `/${rel.split('/').slice(0, -1).join('/')}` : '';
  const rows = items
    .map((d) => {
      const href = `/${[rel, d.name].filter(Boolean).join('/')}${d.isDirectory() ? '/' : ''}`;
      return `<li><a href="${href}">${d.name}${d.isDirectory() ? '/' : ''}</a></li>`;
    })
    .join('');
  const body = `<!doctype html><meta charset="utf-8"><title>/${rel}</title>
<style>body{font:14px/1.9 -apple-system,"PingFang SC",sans-serif;color:#334155;padding:40px;max-width:820px}
h1{font-size:18px}code{background:#f1f5f9;padding:2px 6px;border-radius:5px}
ul{list-style:none;padding:0}li{padding:2px 0}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}</style>
<h1><code>/${rel}</code></h1><ul>${up ? `<li><a href="${up}">../</a></li>` : ''}${rows}</ul>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...NO_STORE });
  res.end(body);
}

function serveFile(file, st, req, res) {
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Last-Modified': st.mtime.toUTCString(),
    ...NO_STORE,
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const method = req.method || 'GET';

  res.on('finish', () => {
    const code = res.statusCode;
    console.log(`${code >= 400 ? '✗' : '·'} ${code} ${method} ${req.url} ${Date.now() - started}ms`);
  });

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://placeholder').pathname);
  } catch {
    return textPage(res, 400, 'Bad Request', 'URL 解码失败。');
  }

  const target = path.resolve(ROOT, '.' + path.posix.normalize(pathname));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return textPage(res, 403, 'Forbidden', '越出原型根目录的路径被拒绝。');
  }

  fs.stat(target, (err, st) => {
    if (err) {
      return textPage(res, 404, 'Not Found', `没有 <code>${pathname}</code>。试试 <code>/index.html</code>。`);
    }
    if (st.isDirectory()) {
      const index = path.join(target, 'index.html');
      fs.stat(index, (e2, s2) => {
        if (!e2 && s2.isFile()) return serveFile(index, s2, req, res);
        try {
          sendListing(target, res);
        } catch {
          textPage(res, 404, 'Not Found', `目录 <code>${pathname}</code> 下没有 index.html。`);
        }
      });
      return;
    }
    serveFile(target, st, req, res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ 端口 ${PORT} 已被占用，服务没起来。`);
    console.error(`    看是谁占着：  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    console.error(`    若是 launchd 守护：npm run service:restart`);
    console.error(`    或换个端口：  npm run dev -- --port 8010\n`);
    process.exit(1);
  }
  if (err.code === 'EPERM' || err.code === 'EACCES') {
    console.error(`\n  ✗ 没有权限绑定 ${HOST}:${PORT}（${err.code}）。换成 --host 127.0.0.1 试试。\n`);
    process.exit(1);
  }
  throw err;
});

server.listen({ host: HOST, port: PORT }, () => {
  let pageCount = 0;
  try {
    pageCount = fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).length;
  } catch { /* pages/ 不存在就算了 */ }
  console.log(`\n  DataForge 原型服务已启动`);
  console.log(`  ├ 根目录   ${ROOT}`);
  console.log(`  ├ 页面     ${pageCount} 个 HTML（pages/）`);
  console.log(`  ├ 地址     http://localhost:${PORT}/index.html`);
  console.log(`  │         http://localhost:${PORT}/pages/02b-data-sources.html`);
  console.log(`  └ 缓存     no-store（改完刷新即见，Ctrl+C 停止）\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n  已停止 DataForge 原型服务。');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 400).unref();
  });
}
