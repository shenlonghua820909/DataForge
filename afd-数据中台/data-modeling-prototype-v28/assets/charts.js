/* ========================================================================
   DataForge · SVG Charts
   ----------------------------------------------------------------------
   纯 SVG 图表库（不依赖第三方），用于 Demo 商演：
   - lineChart      折线图
   - barChart       柱状图
   - areaChart      面积图
   - donutChart     环形图
   - sankeyChart    桑基图（血缘）
   - funnelChart    漏斗图
   - sparkline      迷你图
   ======================================================================== */

(function () {
  if (!window.DF) window.DF = {};

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }

  function clear(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  // ===== 折线图 =====
  function lineChart(container, data, opts = {}) {
    clear(container);
    const w = opts.width || container.clientWidth || 600;
    const h = opts.height || 240;
    const pad = { l: 40, r: 16, t: 20, b: 30 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const values = data.map(d => d.value);
    const max = Math.max(...values) * 1.1;
    const min = 0;
    const stepX = iw / Math.max(1, data.length - 1);
    const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });

    // 网格
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ih / 4) * i;
      svg.appendChild(svgEl('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, stroke: '#EEF1F6', 'stroke-width': 1, 'stroke-dasharray': i === 4 ? '0' : '3 3' }));
      const val = max - (max / 4) * i;
      const lbl = svgEl('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#9AA5B8', 'font-family': 'Inter' }, formatVal(val));
      svg.appendChild(lbl);
    }
    // X 轴 labels
    const stepLbl = Math.ceil(data.length / 6);
    data.forEach((d, i) => {
      if (i % stepLbl !== 0 && i !== data.length - 1) return;
      const x = pad.l + stepX * i;
      svg.appendChild(svgEl('text', { x, y: h - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#9AA5B8', 'font-family': 'Inter' }, d.date));
    });

    // 折线
    const points = data.map((d, i) => `${pad.l + stepX * i},${pad.t + ih - (d.value - min) / (max - min) * ih}`);
    svg.appendChild(svgEl('polyline', { points: points.join(' '), fill: 'none', stroke: opts.color || '#1E66F5', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

    // 区域填充
    if (opts.area !== false) {
      const areaPoints = `M${pad.l},${pad.t + ih} L${points.join(' L')} L${pad.l + stepX * (data.length - 1)},${pad.t + ih} Z`;
      const grad = svgEl('defs');
      const lg = svgEl('linearGradient', { id: 'grad-' + Math.random().toString(36).slice(2, 7), x1: 0, y1: 0, x2: 0, y2: 1 });
      const color = opts.color || '#1E66F5';
      lg.appendChild(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.25 }));
      lg.appendChild(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
      grad.appendChild(lg);
      svg.appendChild(grad);
      svg.insertBefore(svgEl('path', { d: areaPoints, fill: `url(#${lg.getAttribute('id')})` }), svg.firstChild.nextSibling);
    }

    // 最后一个点高亮
    if (opts.highlightLast !== false) {
      const lastX = pad.l + stepX * (data.length - 1);
      const lastY = pad.t + ih - (data[data.length - 1].value - min) / (max - min) * ih;
      svg.appendChild(svgEl('circle', { cx: lastX, cy: lastY, r: 6, fill: opts.color || '#1E66F5', opacity: 0.2 }));
      svg.appendChild(svgEl('circle', { cx: lastX, cy: lastY, r: 3, fill: opts.color || '#1E66F5' }));
    }

    container.appendChild(svg);
  }

  // ===== 柱状图 =====
  function barChart(container, data, opts = {}) {
    clear(container);
    const w = opts.width || container.clientWidth || 400;
    const h = opts.height || 200;
    const pad = { l: 60, r: 16, t: 20, b: 30 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const max = Math.max(...data.map(d => d.value)) * 1.1;
    const barW = iw / data.length * 0.6;
    const gap = iw / data.length * 0.4;
    const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });

    data.forEach((d, i) => {
      const x = pad.l + (barW + gap) * i + gap / 2;
      const barH = (d.value / max) * ih;
      const y = pad.t + ih - barH;
      const color = d.color || opts.color || '#1E66F5';
      const rect = svgEl('rect', { x, y, width: barW, height: barH, fill: color, rx: 4, opacity: 0.85 });
      svg.appendChild(rect);
      // 标签
      svg.appendChild(svgEl('text', { x: x + barW / 2, y: h - 12, 'text-anchor': 'middle', 'font-size': 10, fill: '#6B7691', 'font-family': 'Inter' }, d.label));
      // 数值
      if (d.value) {
        svg.appendChild(svgEl('text', { x: x + barW / 2, y: y - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#4C5670', 'font-weight': 600, 'font-family': 'Inter' }, formatVal(d.value)));
      }
    });

    container.appendChild(svg);
  }

  // ===== 环形图 =====
  function donutChart(container, data, opts = {}) {
    clear(container);
    const w = opts.width || container.clientWidth || 220;
    const h = opts.height || 220;
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 12;
    const innerR = r * 0.6;
    const total = data.reduce((s, d) => s + d.value, 0);
    const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });

    let acc = 0;
    data.forEach(d => {
      const start = (acc / total) * 2 * Math.PI - Math.PI / 2;
      acc += d.value;
      const end = (acc / total) * 2 * Math.PI - Math.PI / 2;
      const large = end - start > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const xi1 = cx + innerR * Math.cos(end);
      const yi1 = cy + innerR * Math.sin(end);
      const xi2 = cx + innerR * Math.cos(start);
      const yi2 = cy + innerR * Math.sin(start);
      const d2 = `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi1},${yi1} A${innerR},${innerR} 0 ${large} 0 ${xi2},${yi2} Z`;
      svg.appendChild(svgEl('path', { d: d2, fill: d.color, opacity: 0.9 }));
    });

    // 中心文字
    if (opts.center) {
      svg.appendChild(svgEl('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 700, fill: '#111728', 'font-family': 'Inter' }, opts.center));
      svg.appendChild(svgEl('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', 'font-size': 11, fill: '#9AA5B8', 'font-family': 'Inter' }, opts.centerSub || ''));
    }
    container.appendChild(svg);
  }

  // ===== 漏斗图 =====
  function funnelChart(container, data, opts = {}) {
    clear(container);
    const w = opts.width || container.clientWidth || 400;
    const h = opts.height || 240;
    const max = Math.max(...data.map(d => d.value));
    const min = Math.min(...data.map(d => d.value));
    const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });

    const stageH = h / data.length;
    data.forEach((d, i) => {
      const ratio = d.value / max;
      const nextRatio = i < data.length - 1 ? data[i + 1].value / max : ratio * 0.6;
      const w1 = w * ratio * 0.85;
      const w2 = w * nextRatio * 0.85;
      const cx = w / 2;
      const y = stageH * i + 4;
      const h2 = stageH - 8;
      const path = `M${cx - w1 / 2},${y} L${cx + w1 / 2},${y} L${cx + w2 / 2},${y + h2} L${cx - w2 / 2},${y + h2} Z`;
      const color = d.color || ['#1E66F5', '#5BC0BE', '#F59E0B', '#E5484D', '#6B7691'][i % 5];
      svg.appendChild(svgEl('path', { d: path, fill: color, opacity: 0.9 }));
      svg.appendChild(svgEl('text', { x: cx, y: y + h2 / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', 'font-weight': 600, 'font-family': 'Inter' }, `${d.label} · ${formatVal(d.value)}`));
    });
    container.appendChild(svg);
  }

  // ===== 迷你图 =====
  function sparkline(container, data, opts = {}) {
    clear(container);
    const w = opts.width || container.clientWidth || 100;
    const h = opts.height || 24;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const stepX = w / (data.length - 1);
    const points = data.map((v, i) => `${i * stepX},${h - ((v - min) / (max - min) * h * 0.9 + h * 0.05)}`);
    const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, style: 'display:block' });
    const color = opts.color || '#1E66F5';
    svg.appendChild(svgEl('polyline', { points: points.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.5 }));
    container.appendChild(svg);
  }

  // ===== 桑基图（简化版） =====
  function sankeyChart(container, data, opts = {}) {
    // data: { nodes: [{id,name,layer}], links: [{source,target,value}] }
    clear(container);
    const w = opts.width || container.clientWidth || 700;
    const h = opts.height || 400;
    const pad = 40;
    const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });

    // 简单的层级布局
    const layers = ['ods', 'dwd', 'dwt', 'ads'];
    const layerColor = { ods: '#8AABFF', dwd: '#1E66F5', dwt: '#F59E0B', ads: '#E5484D' };
    const layerX = { ods: 0.06, dwd: 0.38, dwt: 0.68, ads: 0.94 };
    const nodes = data.nodes || [];
    const nodeById = {};
    nodes.forEach(n => nodeById[n.id] = { ...n, x: w * (layerX[n.layer] || 0.5), y: 0 });

    // 按层级分组
    const groups = {};
    nodes.forEach(n => { (groups[n.layer] = groups[n.layer] || []).push(n); });
    Object.keys(groups).forEach(l => {
      const ns = groups[l];
      const gap = (h - pad * 2) / (ns.length + 1);
      ns.forEach((n, i) => { n.y = pad + gap * (i + 1); });
    });

    // 绘制 link（先画）
    (data.links || []).forEach(l => {
      const s = nodeById[l.source];
      const t = nodeById[l.target];
      if (!s || !t) return;
      const path = `M${s.x + 8},${s.y} C${(s.x + t.x) / 2},${s.y} ${(s.x + t.x) / 2},${t.y} ${t.x - 8},${t.y}`;
      const color = (layerColor[s.layer] || '#9AA5B8') + '88';
      svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: color, 'stroke-width': Math.max(2, l.value / 50), opacity: 0.5 }));
    });
    // 绘制 node
    nodes.forEach(n => {
      svg.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 8, fill: layerColor[n.layer] || '#1E66F5', stroke: '#fff', 'stroke-width': 2 }));
      svg.appendChild(svgEl('text', { x: n.x + 12, y: n.y + 4, 'font-size': 11, fill: '#34405A', 'font-family': 'Inter' }, n.name));
    });

    // 图例
    const legendY = h - 16;
    let lx = pad;
    layers.forEach(l => {
      svg.appendChild(svgEl('circle', { cx: lx, cy: legendY, r: 5, fill: layerColor[l] }));
      svg.appendChild(svgEl('text', { x: lx + 10, y: legendY + 4, 'font-size': 10, fill: '#6B7691', 'font-family': 'Inter' }, l.toUpperCase()));
      lx += 80;
    });

    container.appendChild(svg);
  }

  function formatVal(v) {
    if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return v.toFixed(0);
  }

  DF.charts = { lineChart, barChart, donutChart, funnelChart, sparkline, sankeyChart, formatVal };
})();
