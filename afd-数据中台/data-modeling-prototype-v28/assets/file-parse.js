/* ============================================================
   浏览器端文件解析引擎（零依赖）
   ------------------------------------------------------------
   回答的需求：「新增 Excel 数据源时，要能拖拽文件上传并解析文件结果展示」
   原型没有后端，所以这里做**真的前端解析**，不是假进度条：

     CSV / TSV / TXT  FileReader → 编码嗅探(BOM/UTF-8/GBK) → 分隔符嗅探 → 切行切列
     XLSX / XLSM      自写 ZIP 中央目录读取 + DecompressionStream('deflate-raw')
                      解 xl/workbook.xml（工作表名）/ sharedStrings.xml / worksheets/sheetN.xml
     JSON             对象数组 → 键并集
     XLS（BIFF8 旧二进制）  无第三方库无法可靠解析 → 明确降级，不假装成功

   统一产出结构（页面只认这一份契约）：
     { ok, degraded, fileName, fileSize, ext, encoding, delimiter,
       sheet, sheetNames[], headerRow,
       headers[], fields[{name,type,nonNullRate,sample[],note}],
       rows[][]（含表头，已裁剪）、previewRows[][], rowCount, colCount,
       pkGuess, dateCols[], nullRate, notes[] }

   ⚠ 类型推断只看「值形态 + 表头语义」，不做业务强校验——真正的口径归清洗页管。
   ============================================================ */
(function () {
  if (!window.DF) window.DF = {};

  const MAX_PREVIEW_ROWS = 200;    // 结果里保留的数据行上限（展示用）
  const MAX_SCAN = 5000;           // 类型推断采样上限

  /* ---------------- 读取 / 编码 ---------------- */
  function readArrayBuffer(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error || new Error('读取文件失败'));
      fr.readAsArrayBuffer(file);
    });
  }

  function decodeText(buf) {
    const b = new Uint8Array(buf);
    if (b.length > 2 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF)
      return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8 (BOM)' };
    if (b.length > 1 && b[0] === 0xFF && b[1] === 0xFE)
      return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16LE' };
    const utf8 = new TextDecoder('utf-8').decode(b);
    const bad8 = (utf8.match(/\uFFFD/g) || []).length;
    if (bad8 === 0) return { text: utf8, encoding: 'UTF-8' };
    try {
      const gbk = new TextDecoder('gbk').decode(b);
      const badG = (gbk.match(/\uFFFD/g) || []).length;
      if (badG <= bad8) return { text: gbk, encoding: 'GBK' };
    } catch (e) { /* 有些运行时没有 gbk 解码器 */ }
    return { text: utf8, encoding: 'UTF-8（部分字符无法解码）' };
  }

  /* ---------------- 值形态推断 ---------------- */
  const RX = {
    int: /^-?\d{1,15}$/,
    dec: /^-?\d{1,20}\.\d+$/,
    date: /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}年\d{1,2}月\d{1,2}日)([ T]\d{1,2}:\d{2}(:\d{2})?)?$/,
    dt: /\d{1,2}:\d{2}(:\d{2})?/,
    bool: /^(true|false|是|否|y|n)$/i,
  };
  const DATE_NAME = /(日期|时间|date|time|_at$|_dt$|年月)/i;
  const PK_NAME = /(id$|_id$|no$|_no$|code$|_code$|key$|号$|编号|单号|流水号|证号)/i;
  const PLACEHOLDER = /^(null|nil|none|nan|undefined|—|-|--|\?|无|空|未知)$/i;

  function classify(values) {
    let num = 0, dec = 0, date = 0, bool = 0, str = 0, n = 0;
    values.forEach(v => {
      if (v === '' || v == null) return;
      n++;
      if (RX.int.test(v)) num++;
      else if (RX.dec.test(v)) dec++;
      else if (RX.date.test(v)) date++;
      else if (RX.bool.test(v)) bool++;
      else str++;
    });
    if (!n) return 'STRING';
    if (date / n > 0.8) return 'DATE';
    if (bool / n > 0.8) return 'BOOLEAN';
    if ((num + dec) / n > 0.9) return dec / n > 0.3 ? 'DECIMAL' : 'INT';
    return 'STRING';
  }

  function uniqSample(values, k) {
    const out = [];
    for (const v of values) {
      if (v === '' || v == null) continue;
      if (!out.includes(v)) out.push(v);
      if (out.length >= k) break;
    }
    return out;
  }

  /* ---------------- 表头行探测 ----------------
     真实业务文件第一条经常是标题/说明行（"2026 年春季采购清单"），
     表头在第二三行。判据：该行非空单元格最多，且空值最少、更"像名字"。 */
  function guessHeaderRow(grid) {
    const limit = Math.min(grid.length, 10);
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < limit; i++) {
      const row = grid[i] || [];
      const filled = row.filter(c => String(c ?? '').trim() !== '').length;
      if (!filled) continue;
      const shortish = row.filter(c => String(c ?? '').trim().length <= 20 && !RX.int.test(String(c ?? '').trim())).length;
      const score = filled * 2 + shortish - i * 0.6;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /* ---------------- 统一建结果 ---------------- */
  function buildResult(opt) {
    const raw = opt.rawRows || [];
    const grid = raw.map(r => (Array.isArray(r) ? r : [r]));
    if (!grid.length) {
      return { ok: false, error: '文件里没有解析到任何数据行', fileName: opt.fileName, fileSize: opt.fileSize };
    }
    const headerRow = opt.headerRow != null ? opt.headerRow : guessHeaderRow(grid);
    const head = grid[headerRow] || [];
    const width = Math.max(head.length, ...grid.slice(0, 50).map(r => r.length));
    const headers = [];
    for (let c = 0; c < width; c++) {
      const raw0 = String(head[c] ?? '').trim();
      headers.push(raw0 || `列${c + 1}`);
    }

    // 数据行：去掉表头及其上方内容、去掉全空行
    const body = grid
      .slice(headerRow + 1)
      .filter(r => r.some(c => String(c ?? '').trim() !== ''));

    const notes = (opt.notes || []).slice();
    if (headerRow > 0) notes.push(`自动探测到第 ${headerRow + 1} 行为表头（前 ${headerRow} 行为标题/说明行，导入时按元数据行跳过）`);

    const scan = body.slice(0, MAX_SCAN);
    const fields = headers.map((name, i) => {
      let nonNull = 0;
      const vals = scan.map(r => String(r[i] ?? '').trim()).filter(v => { if (v !== '') { nonNull++; return true; } return false; });
      const type = classify(vals);
      const note = [];
      if (type === 'STRING' && vals.length && vals.filter(v => PLACEHOLDER.test(v)).length / vals.length > 0.2)
        note.push('含较多空值占位词（NULL/无/未知），清洗页会统一转空');
      if (DATE_NAME.test(name) && type === 'INT') {
        const sampleNum = Number(vals[0]);
        if (sampleNum > 20000 && sampleNum < 60000) note.push('表头是日期语义但值为 5 位数字，疑似 Excel 日期序列号，导入时按 DATE 解析');
      }
      return {
        name, type,
        nonNullRate: scan.length ? nonNull / scan.length : 0,
        sample: uniqSample(vals, 3),
        note: note.join('；'),
      };
    });

    // 主键猜测：全非空 + 值唯一 + 名字像主键，优先名前像主键的
    let pkGuess = null;
    fields.forEach((f, i) => {
      if (f.nonNullRate < 1) return;
      const vals = scan.map(r => String(r[i] ?? '').trim());
      if (vals.length < 3) return;
      if (new Set(vals).size !== vals.length) return;
      const nameHit = PK_NAME.test(f.name) || PK_NAME.test(headers[i] || '');
      if (nameHit) pkGuess = pkGuess || headers[i];
    });

    const dateCols = fields.filter(f => f.type === 'DATE' || (DATE_NAME.test(f.name) && f.type !== 'STRING')).map(f => f.name);

    // 空值率
    let cells = 0, empty = 0;
    scan.forEach(r => { for (let i = 0; i < width; i++) { cells++; if (String(r[i] ?? '').trim() === '') empty++; } });

    return {
      ok: true,
      degraded: !!opt.degraded,
      fileName: opt.fileName,
      fileSize: opt.fileSize,
      ext: opt.ext,
      encoding: opt.encoding || 'UTF-8',
      delimiter: opt.delimiter || null,
      sheet: opt.sheet || null,
      sheetNames: opt.sheetNames || [],
      headerRow,
      headers,
      fields,
      rows: grid,
      previewRows: body.slice(0, 8),
      rowCount: body.length,
      colCount: width,
      pkGuess,
      dateCols,
      nullRate: cells ? empty / cells : 0,
      notes,
      parsedAt: new Date().toISOString(),
      ms: opt.ms || null,
    };
  }

  /* ---------------- 分隔符文件 ---------------- */
  function sniffDelimiter(text) {
    const line = (text.split(/\r?\n/).find(l => l.trim()) || '').slice(0, 4000);
    const cands = [',', '\t', ';', '|'];
    let best = ',', bestN = -1;
    cands.forEach(d => {
      const n = line.split(d).length - 1;
      if (n > bestN) { bestN = n; best = d; }
    });
    return bestN <= 0 ? ',' : best;
  }

  function splitCsvLine(line, d) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseDelimitedText(text, meta) {
    const d = meta.delimiter || sniffDelimiter(text);
    const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    const rows = [];
    let buf = null;
    lines.forEach(line => {
      if (buf !== null) {
        buf += '\n' + line;
        if ((buf.match(/"/g) || []).length % 2 === 0) { rows.push(splitCsvLine(buf, d)); buf = null; }
        return;
      }
      if (line.trim() === '' && !rows.length) return;
      if ((line.match(/"/g) || []).length % 2 === 1) { buf = line; return; }
      rows.push(splitCsvLine(line, d));
    });
    if (buf !== null) rows.push(splitCsvLine(buf, d));
    // ⚠ 展开顺序：meta 在前、delimiter 在后。meta.delimiter 可能是 undefined（CSV 未显式指定），
    //   放后面会把嗅探出来的分隔符覆盖掉 → 结果框里永远显示 null。
    return buildResult({ ...meta, rawRows: rows, delimiter: d });
  }

  /* ---------------- ZIP（XLSX 容器） ---------------- */
  const u16 = (dv, o) => dv.getUint16(o, true);
  const u32 = (dv, o) => dv.getUint32(o, true);

  function findEOCD(dv) {
    const max = Math.min(dv.byteLength, 66000);
    for (let i = dv.byteLength - 22; i >= dv.byteLength - max && i >= 0; i--) {
      if (u32(dv, i) === 0x06054b50) return i;
    }
    return -1;
  }

  function listEntries(dv) {
    const eocd = findEOCD(dv);
    if (eocd < 0) throw new Error('不是有效的 ZIP/XLSX（未找到 EOCD 记录）');
    const count = u16(dv, eocd + 10);
    let off = u32(dv, eocd + 16);
    const out = [];
    for (let i = 0; i < count; i++) {
      if (u32(dv, off) !== 0x02014b50) break;
      const method = u16(dv, off + 10);
      const csize = u32(dv, off + 20);
      const nlen = u16(dv, off + 28);
      const elen = u16(dv, off + 30);
      const clen = u16(dv, off + 32);
      const lho = u32(dv, off + 42);
      const name = new TextDecoder('utf-8').decode(new Uint8Array(dv.buffer, dv.byteOffset + off + 46, nlen));
      out.push({ name, method, csize, lho });
      off += 46 + nlen + elen + clen;
    }
    return out;
  }

  async function readEntry(dv, entry) {
    const o = entry.lho;
    if (u32(dv, o) !== 0x04034b50) throw new Error('本地文件头损坏：' + entry.name);
    const nlen = u16(dv, o + 26), elen = u16(dv, o + 28);
    const start = o + 30 + nlen + elen;
    const raw = new Uint8Array(dv.buffer, dv.byteOffset + start, entry.csize);
    if (entry.method === 0) return new TextDecoder('utf-8').decode(raw);
    if (entry.method !== 8) throw new Error('不支持的压缩方式 ' + entry.method + '：' + entry.name);
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 DecompressionStream，无法解压 XLSX');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder('utf-8').decode(await new Response(stream).arrayBuffer());
  }

  const xml = t => new DOMParser().parseFromString(t, 'application/xml');
  const colIdx = ref => {
    let n = 0;
    for (const ch of (ref.match(/^[A-Z]+/) || ['A'])[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  async function parseXlsxBuffer(buf, meta) {
    const t0 = performance.now();
    const dv = new DataView(buf);
    const entries = listEntries(dv);
    const byName = {};
    entries.forEach(e => { byName[e.name.replace(/\\/g, '/')] = e; });
    const get = async n => (byName[n] ? await readEntry(dv, byName[n]) : null);

    const wbXml = await get('xl/workbook.xml');
    if (!wbXml) throw new Error('缺少 xl/workbook.xml，可能不是标准 XLSX 文件');
    const wbDoc = xml(wbXml);

    const relMap = {};
    const relsXml = await get('xl/_rels/workbook.xml.rels');
    if (relsXml) {
      [...xml(relsXml).getElementsByTagName('*')].forEach(el => {
        if (el.nodeName === 'Relationship') {
          let t = (el.getAttribute('Target') || '').replace(/^\.\//, '');
          if (t.startsWith('/')) t = t.slice(1); else if (!t.startsWith('xl/')) t = 'xl/' + t;
          relMap[el.getAttribute('Id')] = t;
        }
      });
    }

    const sheetEls = [...wbDoc.getElementsByTagName('*')].filter(el => el.nodeName === 'sheet');
    const sheets = sheetEls.map((s, i) => {
      const rid = s.getAttribute('r:id') || s.getAttribute('rId') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      return { name: s.getAttribute('name') || ('Sheet' + (i + 1)), path: relMap[rid] || null };
    });
    if (!sheets.length) throw new Error('workbook.xml 里没有工作表');

    // 共享字符串
    let shared = [];
    const ssXml = await get('xl/sharedStrings.xml');
    if (ssXml) {
      [...xml(ssXml).getElementsByTagName('*')]
        .filter(el => el.nodeName === 'si')
        .forEach(si => {
          shared.push([...si.getElementsByTagName('*')].filter(e => e.nodeName === 't').map(t => t.textContent).join(''));
        });
    }

    async function readSheet(path) {
      let p = path;
      let doc = null;
      if (p && byName[p]) doc = xml(await readEntry(dv, byName[p]));
      if (!doc) {
        const alt = entries.find(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
        if (!alt) throw new Error('找不到工作表 XML');
        doc = xml(await readEntry(dv, alt));
      }
      const rows = [];
      [...doc.getElementsByTagName('*')].filter(el => el.nodeName === 'row').forEach(rowEl => {
        const cells = [];
        let seq = 0;
        [...rowEl.getElementsByTagName('*')].filter(el => el.nodeName === 'c').forEach(c => {
          const ref = c.getAttribute('r');
          const ci = ref ? colIdx(ref) : seq;
          seq = ci + 1;
          const t = c.getAttribute('t');
          let v = '';
          if (t === 'inlineStr') {
            v = [...c.getElementsByTagName('*')].filter(e => e.nodeName === 't').map(x => x.textContent).join('');
          } else {
            const vEl = [...c.getElementsByTagName('*')].find(e => e.nodeName === 'v');
            const raw = vEl ? vEl.textContent : '';
            if (t === 's') v = shared[Number(raw)] != null ? shared[Number(raw)] : '';
            else if (t === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
            else v = raw;
          }
          cells[ci] = v;
        });
        for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
        rows.push(cells);
      });
      return rows;
    }

    const rawRows = await readSheet(sheets[0].path);
    const res = buildResult({
      rawRows,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      ext: meta.ext,
      encoding: 'UTF-8 (OOXML)',
      sheet: sheets[0].name,
      sheetNames: sheets.map(s => s.name),
      ms: Math.round(performance.now() - t0),
      notes: sheets.length > 1 ? [`工作簿含 ${sheets.length} 个工作表，当前解析「${sheets[0].name}」`] : [],
    });
    res.zipEntries = entries.length;
    return res;
  }

  /* ---------------- JSON ---------------- */
  function parseJsonText(text, meta) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON 语法错误：' + e.message, fileName: meta.fileName, fileSize: meta.fileSize }; }
    let arr = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : (Array.isArray(data.rows) ? data.rows : null));
    if (!arr) {
      const k = data && typeof data === 'object' ? Object.keys(data).find(k => Array.isArray(data[k])) : null;
      arr = k ? data[k] : [data];
    }
    const keys = [];
    arr.slice(0, 200).forEach(o => { if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (!keys.includes(k)) keys.push(k); }); });
    const rawRows = [keys, ...arr.map(o => keys.map(k => {
      const v = o ? o[k] : '';
      if (v == null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }))];
    return buildResult({ rawRows, ...meta, notes: ['JSON 已按对象键并集展开为二维表'] });
  }

  /* ---------------- 降级（XLS 等） ---------------- */
  function degraded(meta) {
    return {
      ok: false, degraded: true,
      error: `${meta.ext.toUpperCase()} 是二进制专有格式，纯前端无法可靠解析`,
      hint: '接入真实后端时由解析服务处理；原型里可点「载入示例文件」查看等价的解析结果展示。',
      fileName: meta.fileName, fileSize: meta.fileSize, ext: meta.ext,
    };
  }

  /* ---------------- 示例文件（无真实文件也能演示闭环） ---------------- */
  const SAMPLE_CSV = `2026年春季文献采购清单（图书馆采编部）
采购单号,题名,ISBN,出版社,单价,复本数,采购日期,经办人
CG2026001,数字图书馆建设与实践,978-7-121-39001-2,电子工业出版社,68.00,3,2026-03-02,赵雪
CG2026002,知识图谱：方法、实践与应用,978-7-302-55001-8,清华大学出版社,89.50,2,2026-03-02,赵雪
CG2026003,图书馆数据治理实务,978-7-111-72001-4,机械工业出版社,75.00,4,2026-03-05,李明
CG2026004,元数据：概念与应用,978-7-5013-7201-9,国家图书馆出版社,56.00,3,2026-03-05,李明
CG2026005,人工智能与知识服务,978-7-04-058001-1,高等教育出版社,98.00,2,2026-03-08,王芳
CG2026006,信息检索与利用,978-7-03-070001-9,科学出版社,62.00,5,2026-03-08,王芳
CG2026007,数字资源长期保存,978-7-5200-0001-7,中国社会科学出版社,71.00,3,2026-03-11,赵雪
CG2026008,高校图书馆服务创新,978-7-5654-0001-3,东北财经大学出版社,58.00,4,2026-03-11,赵雪
CG2026009,图书分类法（第五版）,978-7-5013-0001-1,国家图书馆出版社,128.00,2,2026-03-14,李明
CG2026010,学术评价与计量分析,978-7-5097-0001-6,社会科学文献出版社,84.00,3,2026-03-14,李明`;

  function parseSample() {
    const meta = { fileName: '2026-spring-采购单.xlsx', fileSize: 1_284_500, ext: 'xlsx', encoding: 'UTF-8 (OOXML)', sheet: '采购明细', sheetNames: ['采购明细', '汇总统计'], ms: 412 };
    const res = parseDelimitedText(SAMPLE_CSV, meta);
    res.degraded = false;
    res.sample = true;
    res.notes = (res.notes || []).concat(['【示例数据】未上传真实文件，展示的是等价结构的示例解析结果']);
    return res;
  }

  /* ---------------- 对外 ---------------- */
  async function parse(file, opts) {
    opts = opts || {};
    const name = file.name || 'unnamed';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const meta = { fileName: name, fileSize: file.size, ext };
    try {
      if (['csv', 'tsv', 'txt', 'dat'].includes(ext)) {
        const buf = await readArrayBuffer(file);
        const d = decodeText(buf);
        return parseDelimitedText(d.text, { ...meta, encoding: d.encoding, delimiter: ext === 'tsv' ? '\t' : opts.delimiter });
      }
      if (ext === 'json') {
        const buf = await readArrayBuffer(file);
        const d = decodeText(buf);
        return parseJsonText(d.text, { ...meta, encoding: d.encoding });
      }
      if (ext === 'xlsx' || ext === 'xlsm') {
        return await parseXlsxBuffer(await readArrayBuffer(file), meta);
      }
      return degraded(meta);
    } catch (e) {
      return {
        ok: false, degraded: true,
        error: (e && e.message) || String(e),
        hint: ext === 'xlsx' ? '文件可能被加密、损坏，或使用了非标准压缩；可另存为标准 .xlsx 后重试。' : '可另存为 CSV 后重试。',
        fileName: name, fileSize: file.size, ext,
      };
    }
  }

  window.DF.fileParse = {
    parse,
    parseTextCsv: (text, name) => parseDelimitedText(text, { fileName: name || 'inline.csv', fileSize: text.length, ext: 'csv' }),
    sample: parseSample,
    SAMPLE_CSV,
    _internal: { decodeText, sniffDelimiter, splitCsvLine, buildResult, classify, guessHeaderRow, listEntries },
  };
})();
