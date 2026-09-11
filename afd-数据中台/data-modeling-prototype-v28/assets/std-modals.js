// ============ 数据标准 4 子页面共享 Modal 库 ============
// 06a 实体 / 06b 属性 / 06c 码值 / 06d 映射 共用
// 依赖：DF.app.toast / DF.app.modal

(function() {
  if (!window.DF) window.DF = {};
  const NS = DF.stdModals = {};

  // ====== 通用样式注入（modal 内用）======
  const CSS = `
    .stdm-overlay { position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:grid;place-items:center;animation:fadeIn .2s; }
    .stdm-dialog { background:#fff;border-radius:12px;width:880px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 48px rgba(0,0,0,.2);animation:scaleIn .2s;overflow:hidden; }
    .stdm-header { padding:16px 24px;border-bottom:1px solid #EEF1F6;display:flex;align-items:center;gap:12px; }
    .stdm-header h3 { flex:1;font-size:15px;font-weight:600;color:#111728;margin:0; }
    .stdm-close { width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#6B7691;font-size:18px;line-height:1; }
    .stdm-close:hover { background:#F1F5F9; }
    .stdm-body { padding:20px 24px;overflow-y:auto;flex:1; }
    .stdm-footer { padding:12px 24px;border-top:1px solid #EEF1F6;background:#F7F9FC;display:flex;align-items:center;gap:8px; }
    .stdm-footer .stdm-progress { flex:1;font-size:12px;color:#6B7691; }
    .stdm-info { padding:10px 14px;background:#F0F9FF;border-left:3px solid #2563EB;border-radius:4px;font-size:12px;color:#1E40AF;line-height:1.6;margin-top:12px; }
    .stdm-warn { padding:8px 12px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:4px;font-size:11px;color:#92400E;margin-top:10px; }
    .stdm-input,.stdm-select,.stdm-textarea { padding:7px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;background:#fff;color:#111728;width:100%;box-sizing:border-box; }
    .stdm-input:focus,.stdm-select:focus,.stdm-textarea:focus { outline:none;border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.1); }
    .stdm-input.is-mono { font-family:var(--font-mono); }
    .stdm-textarea { min-height:60px;resize:vertical; }
    .stdm-form-grid { display:grid;grid-template-columns:1fr 1fr;gap:14px 16px; }
    .stdm-form-grid .full { grid-column:1 / -1; }
    .stdm-field { display:flex;flex-direction:column;gap:5px; }
    .stdm-field__label { font-size:12px;font-weight:500;color:#374151; }
    .stdm-field__label .req { color:#EF4444; }
    .stdm-field__hint { font-size:11px;color:#94A3B8; }
    .stdm-table { width:100%;border-collapse:collapse;font-size:12px;background:#fff;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden; }
    .stdm-table th { background:#F1F5F9;padding:8px 10px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #E2E8F0; }
    .stdm-table td { padding:6px 10px;border-bottom:1px solid #F1F5F9;vertical-align:middle; }
    .stdm-table tr:last-child td { border-bottom:none; }
    .stdm-table input,.stdm-table select { padding:5px 7px;border:1px solid #E2E8F0;border-radius:4px;font-size:12px;width:100%;box-sizing:border-box; }
    .stdm-add-row { margin-top:8px;padding:6px 12px;border:1px dashed #CBD5E1;border-radius:6px;background:transparent;color:#475569;cursor:pointer;font-size:12px;width:100%; }
    .stdm-add-row:hover { border-color:#2563EB;color:#2563EB;background:#F8FAFF; }
    .stdm-row-del { color:#94A3B8;background:transparent;border:none;cursor:pointer;font-size:16px;padding:0 6px; }
    .stdm-row-del:hover { color:#EF4444; }
    .stdm-preview { background:#0F172A;color:#E2E8F0;padding:14px 16px;border-radius:6px;font-family:var(--font-mono);font-size:12px;line-height:1.7;overflow-x:auto;max-height:260px;overflow-y:auto; }
    .stdm-preview .kw { color:#C084FC; } .stdm-preview .str { color:#86EFAC; } .stdm-preview .cmt { color:#64748B;font-style:italic; } .stdm-preview .num { color:#FCD34D; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // ====== 弹窗工厂 ======
  function open({ title, body, footer, width = 880 }) {
    const overlay = document.createElement('div');
    overlay.className = 'stdm-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'stdm-dialog';
    if (width) dlg.style.width = width + 'px';
    dlg.innerHTML = `
      <div class="stdm-header">
        <h3>${title}</h3>
        <button class="stdm-close" data-act="close">×</button>
      </div>
      <div class="stdm-body">${body}</div>
      <div class="stdm-footer">${footer || ''}</div>
    `;
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.dataset.act === 'close') overlay.remove(); });
    return { overlay, dlg, body: dlg.querySelector('.stdm-body'), footer: dlg.querySelector('.stdm-footer') };
  }

  // ====== 1. 06a 新建实体标准（3 步：基本信息 / 字段 / 预览）======
  NS.newEntity = function(prefill = {}) {
    const state = { step: 1, info: { code: prefill.code || '', cn: prefill.cn || '', en: '', desc: '' }, rows: [] };
    function render() {
      const titleMap = { 1: '🗂️ 新建实体标准 · 基本信息', 2: '🗂️ 新建实体标准 · 字段定义', 3: '🗂️ 新建实体标准 · 预览提交' };
      const stepBody = renderStep();
      const footer = state.step < 3
        ? `<div class="stdm-progress">第 ${state.step} / 3 步</div>
           ${state.step > 1 ? '<button class="btn btn--sm" data-act="prev">← 上一步</button>' : ''}
           <button class="btn btn--primary btn--sm" data-act="next">下一步 →</button>`
        : `<div class="stdm-progress">第 3 / 3 步</div>
           <button class="btn btn--sm" data-act="close">取消</button>
           <button class="btn btn--primary btn--sm" data-act="submit">✓ 提交审核</button>`;
      const m = open({ title: titleMap[state.step], body: stepBody, footer });
      bindModal(m);
    }
    function renderStep() {
      if (state.step === 1) {
        return `
          <div class="stdm-form-grid">
            <div class="stdm-field">
              <label class="stdm-field__label">实体编码 <span class="req">*</span></label>
              <input class="stdm-input is-mono" id="ne-code" value="${state.info.code}" placeholder="如 std_bib" />
              <span class="stdm-field__hint">命名规范：std_ 前缀 + 业务域，如 std_bib / std_pat / std_hold</span>
            </div>
            <div class="stdm-field">
              <label class="stdm-field__label">中文名称 <span class="req">*</span></label>
              <input class="stdm-input" id="ne-cn" value="${state.info.cn}" placeholder="如 图书（编目记录）" />
            </div>
            <div class="stdm-field full">
              <label class="stdm-field__label">英文名称</label>
              <input class="stdm-input is-mono" id="ne-en" value="${state.info.en}" placeholder="如 Bibliographic Record" />
            </div>
            <div class="stdm-field full">
              <label class="stdm-field__label">说明</label>
              <textarea class="stdm-textarea" id="ne-desc" placeholder="实体的业务含义、字段边界、引用规范...">${state.info.desc}</textarea>
            </div>
          </div>
          <div class="stdm-info">💡 实体是业务核心数据结构的抽象（如"图书"、"读者"），下一步将为它定义标准字段。</div>
        `;
      } else if (state.step === 2) {
        return `
          <div class="stdm-info">为该实体定义标准字段（至少 1 个）。示例已预填 2 个常用字段，可继续添加。</div>
          <div style="margin-top:14px;">
            <table class="stdm-table" id="ne-rows">
              <thead><tr>
                <th style="width:170px;">字段编码 <span style="color:#EF4444;">*</span></th>
                <th style="width:200px;">中文名 <span style="color:#EF4444;">*</span></th>
                <th style="width:140px;">数据类型</th>
                <th style="width:60px;">必填</th>
                <th style="width:50px;"></th>
              </tr></thead>
              <tbody>
                ${state.rows.map((r, i) => `
                  <tr data-idx="${i}">
                    <td><input data-field="code" value="${r.code||''}" placeholder="如 std_bib_id" /></td>
                    <td><input data-field="cn" value="${r.cn||''}" placeholder="如 书目记录 ID" /></td>
                    <td><select data-field="type">
                      ${['STRING(20)','STRING(50)','STRING(200)','STRING(500)','STRING(13)','INT','BIGINT','DECIMAL(18,2)','DATE','TIMESTAMP','TEXT','CODE'].map(o => `<option ${r.type===o?'selected':''}>${o}</option>`).join('')}
                    </select></td>
                    <td><input type="checkbox" data-field="req" ${r.req?'checked':''} /></td>
                    <td><button class="stdm-row-del" data-act="del">×</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <button class="stdm-add-row" data-act="add">+ 添加字段</button>
          </div>
        `;
      } else {
        const ddl = `
<span class="cmt">-- 实体标准: ${state.info.cn || state.info.code}</span>
<span class="cmt">-- 编码: ${state.info.code} | 创建人: 王芳 | ${new Date().toISOString().slice(0,10)}</span>
<span class="cmt">-- 字段数: ${state.rows.length}</span>

<span class="kw">CREATE TABLE</span> ${state.info.code || 'std_ent_xxx'} (
  <span class="str">id</span>          <span class="kw">BIGINT</span>      <span class="kw">COMMENT</span> <span class="str">'主键 ID'</span>,
${state.rows.map((r, i) => `  <span class="str">${r.code || `field_${i+1}`}</span>  <span class="kw">${r.type || 'STRING'}</span>${r.req ? ' <span class="kw">NOT NULL</span>' : ''}  <span class="kw">COMMENT</span> <span class="str">'${r.cn || ''}'</span>${i === state.rows.length - 1 ? '' : ','}`).join('\n')}
  <span class="str">created_at</span>  <span class="kw">TIMESTAMP</span>   <span class="kw">COMMENT</span> <span class="str">'创建时间'</span>,
  <span class="str">updated_at</span>  <span class="kw">TIMESTAMP</span>   <span class="kw">COMMENT</span> <span class="str">'更新时间'</span>,
  <span class="str">ds</span>           <span class="kw">STRING</span>       <span class="kw">COMMENT</span> <span class="str">'数据日期'</span>
) <span class="kw">COMMENT</span> <span class="str">'${state.info.cn || ''}'</span>;
        `.trim();
        return `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="stdm-field"><label class="stdm-field__label">实体编码</label><div class="text-mono" style="font-size:13px;color:#1E40AF;">${state.info.code || '—'}</div></div>
            <div class="stdm-field"><label class="stdm-field__label">中文名称</label><div style="font-size:13px;">${state.info.cn || '—'}</div></div>
            <div class="stdm-field full"><label class="stdm-field__label">英文名称</label><div class="text-mono" style="font-size:12px;color:#475569;">${state.info.en || '—'}</div></div>
            <div class="stdm-field"><label class="stdm-field__label">字段数</label><div style="font-size:13px;font-weight:600;color:#10B981;">${state.rows.length}</div></div>
            <div class="stdm-field"><label class="stdm-field__label">必填字段</label><div style="font-size:13px;font-weight:600;color:#1E40AF;">${state.rows.filter(r => r.req).length}</div></div>
          </div>
          <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">📜 DDL 预览</div>
          <pre class="stdm-preview">${ddl}</pre>
          <div class="stdm-warn">⚠ 提交后进入"待审核"状态，需经数据治理委员会复核后发布。</div>
        `;
      }
    }
    function bindModal(m) {
      m.overlay.querySelectorAll('[data-act]').forEach(el => {
        el.onclick = () => {
          const a = el.dataset.act;
          if (a === 'close') return m.overlay.remove();
          if (a === 'prev') { state.step--; render(); return; }
          if (a === 'next') {
            if (state.step === 1) {
              if (!state.info.code && !document.getElementById('ne-code').value) return DF.app.toast('请填写实体编码', 'warning');
              if (!/^std_/.test(document.getElementById('ne-code').value)) return DF.app.toast('编码必须以 std_ 开头', 'warning');
              if (!document.getElementById('ne-cn').value) return DF.app.toast('请填写中文名称', 'warning');
              state.info.code = document.getElementById('ne-code').value;
              state.info.cn = document.getElementById('ne-cn').value;
              state.info.en = document.getElementById('ne-en').value;
              state.info.desc = document.getElementById('ne-desc').value;
              // 预填 2 行示例
              if (state.rows.length === 0) {
                const prefix = state.info.code.replace(/^std_/, '').split('_')[0] || 'x';
                state.rows = [
                  { code: `std_${prefix}_id`, cn: '记录 ID', type: 'STRING(20)', req: true },
                  { code: `std_${prefix}_name`, cn: '名称', type: 'STRING(200)', req: true },
                ];
              }
            } else if (state.step === 2) {
              if (state.rows.length === 0) return DF.app.toast('请至少添加 1 个字段', 'warning');
              for (let i = 0; i < state.rows.length; i++) {
                if (!state.rows[i].code) return DF.app.toast(`第 ${i+1} 行：字段编码不能为空`, 'warning');
                if (!state.rows[i].cn) return DF.app.toast(`第 ${i+1} 行：中文名不能为空`, 'warning');
              }
            }
            state.step++;
            render();
          }
          if (a === 'submit') {
            const arr = JSON.parse(localStorage.getItem('df_new_entities') || '[]');
            arr.push({ id: 'std_ent_' + Date.now(), ...state.info, fields: state.rows, status: '待审核', creator: '王芳', createdAt: new Date().toISOString().slice(0, 10) });
            localStorage.setItem('df_new_entities', JSON.stringify(arr));
            m.overlay.remove();
            DF.app.toast(`✓ 实体「${state.info.cn}」已提交审核（${state.rows.length} 个字段）`, 'success', 3000);
          }
          if (a === 'add') { state.rows.push({}); render(); }
          if (a === 'del') {
            const idx = +el.closest('tr').dataset.idx;
            state.rows.splice(idx, 1);
            render();
          }
        };
      });
      // 行编辑
      if (state.step === 2) {
        m.body.querySelectorAll('tr[data-idx]').forEach(tr => {
          const idx = +tr.dataset.idx;
          tr.querySelectorAll('[data-field]').forEach(el => {
            el.oninput = () => {
              const f = el.dataset.field;
              state.rows[idx][f] = el.type === 'checkbox' ? el.checked : el.value;
            };
          });
        });
      }
    }
    render();
  };

  // ====== 2. 06b 新建属性标准（1 步表单）======
  NS.newAttribute = function() {
    const state = { code: '', cn: '', en: '', type: 'STRING', len: '', req: true, codeRef: '', desc: '' };
    const body = `
      <div class="stdm-form-grid">
        <div class="stdm-field">
          <label class="stdm-field__label">属性编码 <span class="req">*</span></label>
          <input class="stdm-input is-mono" id="na-code" placeholder="如 std_bib_isbn" />
          <span class="stdm-field__hint">命名规范：std_ 前缀 + 业务域 + 字段名</span>
        </div>
        <div class="stdm-field">
          <label class="stdm-field__label">中文名 <span class="req">*</span></label>
          <input class="stdm-input" id="na-cn" placeholder="如 ISBN（13 位）" />
        </div>
        <div class="stdm-field full">
          <label class="stdm-field__label">英文名</label>
          <input class="stdm-input is-mono" id="na-en" placeholder="如 ISBN 13-digit" />
        </div>
        <div class="stdm-field">
          <label class="stdm-field__label">数据类型 <span class="req">*</span></label>
          <select class="stdm-select" id="na-type">
            ${['STRING','INT','BIGINT','DECIMAL','DATE','TIMESTAMP','TEXT','CODE'].map(t => `<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="stdm-field">
          <label class="stdm-field__label">长度</label>
          <input class="stdm-input" id="na-len" placeholder="如 20" />
        </div>
        <div class="stdm-field">
          <label class="stdm-field__label">是否必填</label>
          <select class="stdm-select" id="na-req"><option value="1">必填</option><option value="0">选填</option></select>
        </div>
        <div class="stdm-field">
          <label class="stdm-field__label">引用码值</label>
          <input class="stdm-input is-mono" id="na-ref" placeholder="如 std_doc_type" />
        </div>
        <div class="stdm-field full">
          <label class="stdm-field__label">说明</label>
          <textarea class="stdm-textarea" id="na-desc" placeholder="属性的业务含义、约束、引用规范..."></textarea>
        </div>
      </div>
    `;
    const m = open({
      title: '📋 新建属性标准',
      body,
      footer: `<div class="stdm-progress">属性标准 · 字段级定义</div>
               <button class="btn btn--sm" data-act="close">取消</button>
               <button class="btn btn--primary btn--sm" data-act="submit">✓ 提交审核</button>`
    });
    m.overlay.querySelector('[data-act="submit"]').onclick = () => {
      const get = id => document.getElementById(id).value;
      if (!get('na-code')) return DF.app.toast('请填写属性编码', 'warning');
      if (!/^std_/.test(get('na-code'))) return DF.app.toast('编码必须以 std_ 开头', 'warning');
      if (!get('na-cn')) return DF.app.toast('请填写中文名', 'warning');
      const rec = {
        id: 'std_attr_' + Date.now(),
        code: get('na-code'),
        cn: get('na-cn'),
        en: get('na-en'),
        type: get('na-type'),
        len: get('na-len'),
        req: get('na-req') === '1',
        codeRef: get('na-ref'),
        desc: get('na-desc'),
        status: '待审核',
        creator: '王芳',
        createdAt: new Date().toISOString().slice(0, 10),
      };
      const arr = JSON.parse(localStorage.getItem('df_new_attributes') || '[]');
      arr.push(rec);
      localStorage.setItem('df_new_attributes', JSON.stringify(arr));
      m.overlay.remove();
      DF.app.toast(`✓ 属性「${rec.cn}」已提交审核`, 'success', 3000);
    };
  };

  // ====== 3. 06c 新建码表（2 步）======
  NS.newCodeTable = function() {
    const state = { step: 1, info: { code: '', cn: '', desc: '' }, rows: [] };
    function render() {
      const titleMap = { 1: '🔢 新建码表 · 基本信息', 2: '🔢 新建码表 · 码值定义' };
      const body = state.step === 1 ? `
        <div class="stdm-form-grid">
          <div class="stdm-field">
            <label class="stdm-field__label">码表编码 <span class="req">*</span></label>
            <input class="stdm-input is-mono" id="ct-code" value="${state.info.code}" placeholder="如 std_doc_type" />
            <span class="stdm-field__hint">命名规范：std_ 前缀 + 业务域 + _type</span>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">码表名称 <span class="req">*</span></label>
            <input class="stdm-input" id="ct-cn" value="${state.info.cn}" placeholder="如 文献类型" />
          </div>
          <div class="stdm-field full">
            <label class="stdm-field__label">说明</label>
            <textarea class="stdm-textarea" id="ct-desc" placeholder="码表的业务含义、适用范围...">${state.info.desc}</textarea>
          </div>
        </div>
      ` : `
        <div class="stdm-info">定义码表的码值列表（至少 1 条）。示例已预填 2 条，可继续添加/删除。</div>
        <div style="margin-top:14px;">
          <table class="stdm-table" id="ct-rows">
            <thead><tr>
              <th style="width:140px;">码值编码 <span style="color:#EF4444;">*</span></th>
              <th style="width:200px;">标签 <span style="color:#EF4444;">*</span></th>
              <th>描述</th>
              <th style="width:80px;">排序</th>
              <th style="width:50px;"></th>
            </tr></thead>
            <tbody>
              ${state.rows.map((r, i) => `
                <tr data-idx="${i}">
                  <td><input data-field="code" value="${r.code||''}" placeholder="如 01" /></td>
                  <td><input data-field="label" value="${r.label||''}" placeholder="如 图书" /></td>
                  <td><input data-field="desc" value="${r.desc||''}" placeholder="说明" /></td>
                  <td><input data-field="order" value="${r.order||i+1}" /></td>
                  <td><button class="stdm-row-del" data-act="del">×</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <button class="stdm-add-row" data-act="add">+ 添加码值</button>
        </div>
        <div class="stdm-warn" style="margin-top:14px;">⚠ 码表发布后，引用该码值的所有表字段将自动同步。</div>
      `;
      const m = open({
        title: titleMap[state.step],
        body,
        footer: state.step < 2
          ? `<div class="stdm-progress">第 1 / 2 步</div><button class="btn btn--primary btn--sm" data-act="next">下一步 →</button>`
          : `<div class="stdm-progress">第 2 / 2 步 · ${state.info.cn || '新码表'}</div>
             <button class="btn btn--sm" data-act="prev">← 上一步</button>
             <button class="btn btn--sm" data-act="close">取消</button>
             <button class="btn btn--primary btn--sm" data-act="submit">✓ 提交审核 (${state.rows.length})</button>`
      });
      m.overlay.querySelectorAll('[data-act]').forEach(el => {
        el.onclick = () => {
          const a = el.dataset.act;
          if (a === 'close') return m.overlay.remove();
          if (a === 'prev') { state.step--; render(); return; }
          if (a === 'next') {
            if (!document.getElementById('ct-code').value) return DF.app.toast('请填写码表编码', 'warning');
            if (!/^std_/.test(document.getElementById('ct-code').value)) return DF.app.toast('编码必须以 std_ 开头', 'warning');
            if (!document.getElementById('ct-cn').value) return DF.app.toast('请填写码表名称', 'warning');
            state.info.code = document.getElementById('ct-code').value;
            state.info.cn = document.getElementById('ct-cn').value;
            state.info.desc = document.getElementById('ct-desc').value;
            if (state.rows.length === 0) {
              state.rows = [
                { code: '01', label: '选项一', desc: '示例码值', order: 1 },
                { code: '02', label: '选项二', desc: '示例码值', order: 2 },
              ];
            }
            state.step++;
            render();
          }
          if (a === 'submit') {
            if (state.rows.length === 0) return DF.app.toast('请至少添加 1 个码值', 'warning');
            for (let i = 0; i < state.rows.length; i++) {
              if (!state.rows[i].code) return DF.app.toast(`第 ${i+1} 行：码值编码不能为空`, 'warning');
              if (!state.rows[i].label) return DF.app.toast(`第 ${i+1} 行：标签不能为空`, 'warning');
            }
            const arr = JSON.parse(localStorage.getItem('df_new_code_tables') || '[]');
            arr.push({ id: 'std_code_' + Date.now(), ...state.info, values: state.rows, status: '待审核', creator: '王芳', createdAt: new Date().toISOString().slice(0, 10) });
            localStorage.setItem('df_new_code_tables', JSON.stringify(arr));
            m.overlay.remove();
            DF.app.toast(`✓ 码表「${state.info.cn}」已提交审核（${state.rows.length} 个码值）`, 'success', 3000);
          }
          if (a === 'add') { state.rows.push({}); render(); }
          if (a === 'del') {
            const idx = +el.closest('tr').dataset.idx;
            state.rows.splice(idx, 1);
            render();
          }
        };
      });
      if (state.step === 2) {
        m.body.querySelectorAll('tr[data-idx]').forEach(tr => {
          const idx = +tr.dataset.idx;
          tr.querySelectorAll('[data-field]').forEach(el => {
            el.oninput = () => {
              const f = el.dataset.field;
              state.rows[idx][f] = el.value;
            };
          });
        });
      }
    }
    render();
  };

  // ====== 4. 06d 新建映射规则（3 步）======
  NS.newMapping = function() {
    const state = { step: 1, info: { name: '', src: 'MARC21', tgt: '本馆标准', desc: '' }, rows: [] };
    function render() {
      const titleMap = { 1: '🔄 新建映射规则 · 基本信息', 2: '🔄 新建映射规则 · 字段映射', 3: '🔄 新建映射规则 · 预览提交' };
      const body = renderStep();
      const m = open({
        title: titleMap[state.step],
        body,
        footer: state.step < 3
          ? `<div class="stdm-progress">第 ${state.step} / 3 步</div>
             ${state.step > 1 ? '<button class="btn btn--sm" data-act="prev">← 上一步</button>' : ''}
             <button class="btn btn--primary btn--sm" data-act="next">下一步 →</button>`
          : `<div class="stdm-progress">第 3 / 3 步 · ${state.info.name || '新规则'}</div>
             <button class="btn btn--sm" data-act="close">取消</button>
             <button class="btn btn--primary btn--sm" data-act="submit">✓ 提交审核 (${state.rows.length})</button>`
      });
      m.overlay.querySelectorAll('[data-act]').forEach(el => {
        el.onclick = () => {
          const a = el.dataset.act;
          if (a === 'close') return m.overlay.remove();
          if (a === 'prev') { state.step--; render(); return; }
          if (a === 'next') {
            if (state.step === 1) {
              if (!document.getElementById('mp-name').value) return DF.app.toast('请填写规则名称', 'warning');
              state.info.name = document.getElementById('mp-name').value;
              state.info.src = document.getElementById('mp-src').value;
              state.info.tgt = document.getElementById('mp-tgt').value;
              state.info.desc = document.getElementById('mp-desc').value;
              if (state.rows.length === 0) {
                state.rows = [
                  { src: '020$a', dst: 'std_bib_isbn', rule: '截取前 13 位' },
                  { src: '245$a', dst: 'std_bib_title', rule: '直接映射' },
                ];
              }
            } else if (state.step === 2) {
              if (state.rows.length === 0) return DF.app.toast('请至少添加 1 条映射', 'warning');
              for (let i = 0; i < state.rows.length; i++) {
                if (!state.rows[i].src) return DF.app.toast(`第 ${i+1} 行：源字段不能为空`, 'warning');
                if (!state.rows[i].dst) return DF.app.toast(`第 ${i+1} 行：目标字段不能为空`, 'warning');
              }
            }
            state.step++;
            render();
          }
          if (a === 'submit') {
            const arr = JSON.parse(localStorage.getItem('df_new_mappings') || '[]');
            arr.push({ id: 'std_map_' + Date.now(), ...state.info, mappings: state.rows, status: '待审核', creator: '王芳', createdAt: new Date().toISOString().slice(0, 10) });
            localStorage.setItem('df_new_mappings', JSON.stringify(arr));
            m.overlay.remove();
            DF.app.toast(`✓ 映射规则「${state.info.name}」已提交审核（${state.rows.length} 条映射）`, 'success', 3000);
          }
          if (a === 'add') { state.rows.push({}); render(); }
          if (a === 'del') {
            const idx = +el.closest('tr').dataset.idx;
            state.rows.splice(idx, 1);
            render();
          }
        };
      });
      if (state.step === 2) {
        m.body.querySelectorAll('tr[data-idx]').forEach(tr => {
          const idx = +tr.dataset.idx;
          tr.querySelectorAll('[data-field]').forEach(el => {
            el.oninput = () => {
              const f = el.dataset.field;
              state.rows[idx][f] = el.value;
            };
          });
        });
      }
    }
    function renderStep() {
      if (state.step === 1) {
        return `
          <div class="stdm-form-grid">
            <div class="stdm-field full">
              <label class="stdm-field__label">规则名称 <span class="req">*</span></label>
              <input class="stdm-input" id="mp-name" value="${state.info.name}" placeholder="如 MARC21 → 本馆书目 字段映射" />
            </div>
            <div class="stdm-field">
              <label class="stdm-field__label">源标准</label>
              <select class="stdm-select" id="mp-src">
                ${['MARC21','CNMARC','Dublin Core','CALIS','OAI-PMH','Z39.50','本馆自定义'].map(s => `<option ${state.info.src===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="stdm-field">
              <label class="stdm-field__label">目标标准</label>
              <select class="stdm-select" id="mp-tgt">
                ${['本馆标准','本馆命名规范','CALIS 中图法','CNMARC'].map(s => `<option ${state.info.tgt===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="stdm-field full">
              <label class="stdm-field__label">说明</label>
              <textarea class="stdm-textarea" id="mp-desc" placeholder="映射规则的用途、转换逻辑...">${state.info.desc}</textarea>
            </div>
          </div>
        `;
      } else if (state.step === 2) {
        return `
          <div class="stdm-info">定义字段级映射关系：源标准字段 → 本馆标准字段 + 转换规则。</div>
          <div style="margin-top:14px;">
            <table class="stdm-table" id="mp-rows">
              <thead><tr>
                <th style="width:170px;">源字段 <span style="color:#EF4444;">*</span></th>
                <th style="width:200px;">目标字段 <span style="color:#EF4444;">*</span></th>
                <th>转换规则</th>
                <th style="width:50px;"></th>
              </tr></thead>
              <tbody>
                ${state.rows.map((r, i) => `
                  <tr data-idx="${i}">
                    <td><input data-field="src" value="${r.src||''}" placeholder="如 020$a" /></td>
                    <td><input data-field="dst" value="${r.dst||''}" placeholder="如 std_bib_isbn" /></td>
                    <td><input data-field="rule" value="${r.rule||''}" placeholder="如 截取前 13 位" /></td>
                    <td><button class="stdm-row-del" data-act="del">×</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <button class="stdm-add-row" data-act="add">+ 添加映射</button>
          </div>
        `;
      } else {
        const ddl = state.rows.map((r, i) => `<span class="cmt">-- ${i+1}. ${r.src} → ${r.dst} ${r.rule ? `(${r.rule})` : ''}</span>`).join('\n');
        return `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
            <div class="stdm-field full"><label class="stdm-field__label">规则名称</label><div style="font-size:14px;font-weight:600;">${state.info.name}</div></div>
            <div class="stdm-field"><label class="stdm-field__label">源标准</label><div style="font-size:13px;">${state.info.src}</div></div>
            <div class="stdm-field"><label class="stdm-field__label">目标标准</label><div style="font-size:13px;">${state.info.tgt}</div></div>
            <div class="stdm-field"><label class="stdm-field__label">映射条数</label><div style="font-size:13px;font-weight:600;color:#10B981;">${state.rows.length}</div></div>
          </div>
          <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">📜 转换规则预览</div>
          <pre class="stdm-preview">${ddl}</pre>
          <div class="stdm-warn">⚠ 提交后进入"待审核"状态，复旦大学图书馆技术部 + 数据治理委员会复核后发布。</div>
        `;
      }
    }
    render();
  };

  // ====== 5. 通用导入向导（1 步选择 + 1 步确认）======
  NS.importStd = function(scope, sources) {
    // sources: [{ key, icon, name, desc, stds: [{code, name, type}] }]
    const state = { picked: new Set(), srcKey: null };
    function render(step) {
      if (step === 1) {
        const m = open({
          title: `📥 导入${scope}标准`,
          body: `
            <div style="font-size:13px;color:#475569;margin-bottom:12px;">选择要导入的标准来源（共 ${sources.length} 大类）：</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${sources.map(s => `
                <div class="std-source-card" data-src="${s.key}" style="border:2px solid ${state.srcKey === s.key ? '#2563EB' : '#E2E8F0'};border-radius:8px;padding:12px 14px;cursor:pointer;background:${state.srcKey === s.key ? '#EFF6FF' : '#fff'};display:flex;align-items:center;gap:12px;transition:all .15s;">
                  <div style="font-size:24px;">${s.icon}</div>
                  <div style="flex:1;">
                    <div style="font-size:14px;font-weight:600;color:#111728;">${s.name} <span class="pill pill--code" style="margin-left:4px;">${s.stds.length} 条</span></div>
                    <div style="font-size:12px;color:#6B7691;margin-top:2px;">${s.desc}</div>
                  </div>
                  <div style="color:${state.srcKey === s.key ? '#2563EB' : '#94A3B8'};font-size:18px;">${state.srcKey === s.key ? '●' : '○'}</div>
                </div>
              `).join('')}
            </div>
          `,
          footer: `<div class="stdm-progress">第 1 / 2 步</div><button class="btn btn--primary btn--sm" data-act="next">下一步 →</button>`
        });
        m.overlay.querySelectorAll('.std-source-card').forEach(card => {
          card.onclick = () => { state.srcKey = card.dataset.src; render(1); };
        });
        m.overlay.querySelector('[data-act="next"]').onclick = () => {
          if (!state.srcKey) return DF.app.toast('请选择来源', 'warning');
          const src = sources.find(s => s.key === state.srcKey);
          src.stds.forEach(s => state.picked.add(s.code));
          render(2);
        };
        m.overlay.querySelector('[data-act="close"]').onclick = () => m.overlay.remove();
      } else {
        const src = sources.find(s => s.key === state.srcKey);
        const m = open({
          title: `📥 导入${src.name}`,
          body: `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#DBEAFE;color:#1E40AF;border-radius:6px;font-size:12px;font-weight:600;margin-bottom:12px;">
              ${src.icon} 来源：${src.name}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div style="font-size:13px;color:#475569;">共 ${src.stds.length} 条，已选 <b style="color:#1E40AF;">${state.picked.size}</b> 条</div>
              <button class="btn btn--sm" data-act="toggle" style="padding:3px 10px;font-size:11px;">全选/取消</button>
            </div>
            <div style="max-height:340px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
              <table class="stdm-table" style="border:none;border-radius:0;">
                <thead><tr><th style="width:36px;"></th><th style="width:200px;">编码</th><th>名称</th></tr></thead>
                <tbody>
                  ${src.stds.map(s => `
                    <tr data-std="${s.code}" style="cursor:pointer;">
                      <td style="text-align:center;"><input type="checkbox" ${state.picked.has(s.code) ? 'checked' : ''} /></td>
                      <td class="text-mono" style="color:#1E40AF;font-size:11px;">${s.code}</td>
                      <td>${s.name}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <div class="stdm-info" style="margin-top:12px;">💡 导入后这些标准会进入"待审核"状态，治理委员会复核后落标到本馆表。</div>
          `,
          footer: `<div class="stdm-progress">第 2 / 2 步</div>
                   <button class="btn btn--sm" data-act="prev">← 上一步</button>
                   <button class="btn btn--sm" data-act="close">取消</button>
                   <button class="btn btn--primary btn--sm" data-act="submit">✓ 确认导入 (${state.picked.size})</button>`
        });
        m.overlay.querySelectorAll('tr[data-std]').forEach(tr => {
          const cb = tr.querySelector('input');
          tr.onclick = e => { if (e.target.tagName !== 'INPUT') { cb.checked = !cb.checked; cb.onchange(); } };
          cb.onchange = () => { if (cb.checked) state.picked.add(tr.dataset.std); else state.picked.delete(tr.dataset.std); m.footer.querySelector('[data-act="submit"]').textContent = `✓ 确认导入 (${state.picked.size})`; };
        });
        m.overlay.querySelector('[data-act="toggle"]').onclick = () => {
          const all = src.stds.every(s => state.picked.has(s.code));
          if (all) src.stds.forEach(s => state.picked.delete(s.code));
          else src.stds.forEach(s => state.picked.add(s.code));
          render(2);
        };
        m.overlay.querySelector('[data-act="prev"]').onclick = () => render(1);
        m.overlay.querySelector('[data-act="close"]').onclick = () => m.overlay.remove();
        m.overlay.querySelector('[data-act="submit"]').onclick = () => {
          if (state.picked.size === 0) return DF.app.toast('请至少勾选 1 条', 'warning');
          const imported = JSON.parse(localStorage.getItem('df_imported_stds') || '[]');
          const newOnes = src.stds.filter(s => state.picked.has(s.code)).map(s => ({
            id: 'std_imp_' + Date.now() + '_' + s.code,
            scope, type: s.type, code: s.code, cn: s.name,
            source: src.name, status: '待审核', creator: '王芳', createdAt: new Date().toISOString().slice(0, 10),
          }));
          imported.push(...newOnes);
          localStorage.setItem('df_imported_stds', JSON.stringify(imported));
          m.overlay.remove();
          DF.app.toast(`✓ 已导入 ${newOnes.length} 条「${src.name}」标准到${scope}`, 'success', 3500);
        };
      }
    }
    render(1);
  };

  // ====== 6. 通用落标检查 ======
  NS.complianceCheck = function(scope) {
    // 真实感数据：按 scope 模拟扫描结果
    const scan = {
      '实体': { details: [
        { item: 'std_bib → 12 张表', rate: 96, tables: 12, fields: 28 },
        { item: 'std_pat → 6 张表', rate: 100, tables: 6, fields: 18 },
        { item: 'std_hold → 8 张表', rate: 88, tables: 8, fields: 22 },
        { item: 'std_loan → 4 张表', rate: 92, tables: 4, fields: 14 },
      ], gaps: ['std_hold 复本号字段落标率 78%', 'std_loan 违章类型字段落标率 84%'] },
      '属性': { details: [
        { item: 'std_bib_isbn → 12 处引用', rate: 98, tables: 8, fields: 12 },
        { item: 'std_bib_clc → 10 处引用', rate: 96, tables: 10, fields: 10 },
        { item: 'std_author_name → 18 处引用', rate: 88, tables: 12, fields: 18 },
        { item: 'std_location → 24 处引用', rate: 84, tables: 6, fields: 24 },
      ], gaps: ['std_location 馆藏地点落标率 84%', 'std_callno 索书号落标率 78%'] },
      '码值': { details: [
        { item: 'std_doc_type → 6 处引用', rate: 100, tables: 6, fields: 6 },
        { item: 'std_loan_status → 4 处引用', rate: 96, tables: 4, fields: 4 },
        { item: 'std_reader_type → 5 处引用', rate: 92, tables: 5, fields: 5 },
        { item: 'std_gender → 8 处引用', rate: 88, tables: 8, fields: 8 },
      ], gaps: ['std_publisher_country 出版国别码值不完整'] },
      '映射': { details: [
        { item: 'MARC21 → 本馆 020 ISBN', rate: 96, tables: 12, fields: 12 },
        { item: 'MARC21 → 本馆 245 题名', rate: 92, tables: 12, fields: 12 },
        { item: 'MARC21 → 本馆 100 作者', rate: 88, tables: 8, fields: 8 },
        { item: 'CNMARC → 本馆 通用映射', rate: 80, tables: 10, fields: 10 },
      ], gaps: ['CNMARC 701 字段映射缺失', 'Dublin Core → 本馆 缺 5 个元素映射'] },
    };
    const s = scan[scope] || scan['属性'];
    const totalFields = s.details.reduce((sum, d) => sum + d.fields, 0);
    const pct = Math.round(s.details.reduce((sum, d) => sum + d.rate * d.fields, 0) / totalFields);
    const compliant = s.details.filter(d => d.rate >= 95).length;
    const partial = s.details.filter(d => d.rate >= 80 && d.rate < 95).length;
    const missing = s.details.filter(d => d.rate < 80).length;
    const color = pct >= 95 ? '#10B981' : pct >= 85 ? '#F59E0B' : '#EF4444';
    const grade = pct >= 95 ? '优秀' : pct >= 85 ? '良好' : '需改进';

    const m = open({
      title: `✓ 落标检查 · ${scope}标准`,
      body: `
        <div style="display:grid;grid-template-columns:180px 1fr;gap:24px;align-items:center;padding:20px;background:linear-gradient(135deg,#F0F9FF,#EFF6FF);border-radius:10px;margin-bottom:20px;">
          <div style="position:relative;width:160px;height:160px;margin:0 auto;">
            <svg width="160" height="160" viewBox="0 0 160 160">
              <circle cx="80" cy="80" r="68" fill="none" stroke="#E2E8F0" stroke-width="14"/>
              <circle cx="80" cy="80" r="68" fill="none" stroke="${color}" stroke-width="14"
                stroke-dasharray="${2 * Math.PI * 68 * pct / 100} ${2 * Math.PI * 68}"
                stroke-dashoffset="${2 * Math.PI * 68 / 4}"
                stroke-linecap="round" transform="rotate(-90 80 80)"/>
              <text x="80" y="78" text-anchor="middle" font-size="32" font-weight="700" fill="${color}">${pct}%</text>
              <text x="80" y="100" text-anchor="middle" font-size="12" fill="#6B7691">${grade}</text>
            </svg>
          </div>
          <div>
            <div style="font-size:14px;color:#475569;margin-bottom:12px;">扫描范围：<b>${s.details.length}</b> 项 ${scope}标准 × <b>${s.details.reduce((a, d) => a + d.tables, 0)}</b> 张引用表</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
              <div style="padding:12px;background:#fff;border-radius:6px;border-left:3px solid #10B981;">
                <div style="font-size:20px;font-weight:600;color:#10B981;">${compliant}</div>
                <div style="font-size:11px;color:#6B7691;">已落标</div>
              </div>
              <div style="padding:12px;background:#fff;border-radius:6px;border-left:3px solid #F59E0B;">
                <div style="font-size:20px;font-weight:600;color:#F59E0B;">${partial}</div>
                <div style="font-size:11px;color:#6B7691;">部分落标</div>
              </div>
              <div style="padding:12px;background:#fff;border-radius:6px;border-left:3px solid #EF4444;">
                <div style="font-size:20px;font-weight:600;color:#EF4444;">${missing}</div>
                <div style="font-size:11px;color:#6B7691;">未落标</div>
              </div>
            </div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">📋 详细结果</div>
        <div style="max-height:240px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          <table class="stdm-table" style="border:none;border-radius:0;">
            <thead><tr><th>检查项</th><th style="width:90px;">落标率</th><th style="width:100px;">状态</th></tr></thead>
            <tbody>
              ${s.details.map(d => `
                <tr>
                  <td>
                    <div style="font-size:12px;font-weight:500;">${d.item}</div>
                    <div style="font-size:11px;color:#94A3B8;margin-top:2px;">涉及 ${d.tables} 张表 / ${d.fields} 个字段</div>
                  </td>
                  <td class="text-mono" style="font-weight:600;color:${d.rate >= 95 ? '#10B981' : d.rate >= 85 ? '#F59E0B' : '#EF4444'};">${d.rate}%</td>
                  <td>${d.rate >= 95 ? '<span style="color:#10B981;">✓ 已落标</span>' : d.rate >= 80 ? '<span style="color:#F59E0B;">⚠ 部分落标</span>' : '<span style="color:#EF4444;">✗ 待补全</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${s.gaps.length ? `<div style="margin-top:14px;padding:10px 12px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:4px;font-size:12px;color:#92400E;">
          <b>⚠ 建议处理：</b><ul style="margin:6px 0 0 16px;line-height:1.7;">${s.gaps.map(g => `<li>${g}</li>`).join('')}</ul>
        </div>` : ''}
      `,
      footer: `<div class="stdm-progress">扫描耗时 ${380 + Math.floor(Math.random() * 200)}ms</div>
               <button class="btn btn--sm" data-act="rescan">🔄 重新扫描</button>
               <button class="btn btn--sm" data-act="export">📥 导出报告</button>
               <button class="btn btn--primary btn--sm" data-act="close">关闭</button>`
    });
    m.overlay.querySelector('[data-act="rescan"]').onclick = () => { m.overlay.remove(); NS.complianceCheck(scope); };
    m.overlay.querySelector('[data-act="export"]').onclick = () => DF.app.toast(`✓ 报告已导出：compliance_${scope}_${new Date().toISOString().slice(0,10)}.xlsx`, 'success', 3000);
  };

  // ====== 7. 通用导出 ======
  NS.exportFile = function(scope, format = 'CSV') {
    const m = open({
      title: `📤 导出${scope}`,
      body: `
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">选择导出格式与范围：</div>
        <div class="stdm-form-grid">
          <div class="stdm-field">
            <label class="stdm-field__label">导出格式</label>
            <select class="stdm-select" id="exp-fmt">
              ${format === 'CSV' ? '<option>CSV</option><option>Excel (.xlsx)</option><option>JSON</option>' :
                format === 'DDL' ? '<option>SQL DDL</option><option>Markdown</option><option>JSON</option>' :
                format === 'XSLT' ? '<option>XSLT</option><option>JSON Mapping</option><option>YAML</option>' :
                '<option>CSV</option><option>Excel</option><option>JSON</option>'}
            </select>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">范围</label>
            <select class="stdm-select" id="exp-scope">
              <option>当前页全部</option>
              <option>已选中的</option>
              <option>已落标</option>
              <option>全部（含未审核）</option>
            </select>
          </div>
          <div class="stdm-field full">
            <label class="stdm-field__label">包含字段</label>
            <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px;padding-top:6px;">
              <label><input type="checkbox" checked /> 编码</label>
              <label><input type="checkbox" checked /> 中文名</label>
              <label><input type="checkbox" checked /> 英文名</label>
              <label><input type="checkbox" /> 引用规范</label>
              <label><input type="checkbox" /> 创建人</label>
              <label><input type="checkbox" /> 创建时间</label>
            </div>
          </div>
        </div>
        <div class="stdm-info" style="margin-top:14px;">💡 导出后文件会下载到本地，可用于治理委员会评审、ISO 2709 交换、汇文/ALEPH 系统对接。</div>
      `,
      footer: `<div class="stdm-progress">${scope} · 预估 218 条</div>
               <button class="btn btn--sm" data-act="close">取消</button>
               <button class="btn btn--primary btn--sm" data-act="submit">📥 确认导出</button>`
    });
    m.overlay.querySelector('[data-act="submit"]').onclick = () => {
      m.overlay.remove();
      const fmt = document.getElementById('exp-fmt').value;
      DF.app.toast(`✓ 已导出 218 条${scope}（${fmt} 格式），文件：${scope.toLowerCase()}_export_${new Date().toISOString().slice(0,10)}.${fmt.toLowerCase().includes('excel') ? 'xlsx' : fmt.toLowerCase().includes('sql') ? 'sql' : fmt.toLowerCase().includes('xslt') ? 'xslt' : 'csv'}`, 'success', 3500);
    };
  };

  // ====== 8. 批量落标 / 批量绑定 ======
  NS.batchApply = function(scope, count = 0) {
    const m = open({
      title: `📋 批量${scope}`,
      body: `
        <div class="stdm-info">批量${scope}会作用于 <b>${count || '218'}</b> 项已审核通过的标准。是否继续？</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
          <div class="stdm-field">
            <label class="stdm-field__label">作用域</label>
            <select class="stdm-select">
              <option>本馆全部数据表</option>
              <option>仅指定数据域</option>
              <option>仅 ODS 层</option>
              <option>预览影响范围</option>
            </select>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">冲突策略</label>
            <select class="stdm-select">
              <option>覆盖现有</option>
              <option>跳过冲突</option>
              <option>合并（保留原值）</option>
            </select>
          </div>
        </div>
        <div style="margin-top:14px;padding:12px;background:#F8FAFC;border-radius:6px;">
          <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;">📊 预估影响</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:12px;">
            <div><b style="font-size:18px;color:#1E40AF;">342</b><br><span style="color:#94A3B8;">数据表</span></div>
            <div><b style="font-size:18px;color:#1E40AF;">5,860</b><br><span style="color:#94A3B8;">字段</span></div>
            <div><b style="font-size:18px;color:#10B981;">+128</b><br><span style="color:#94A3B8;">新增落标</span></div>
            <div><b style="font-size:18px;color:#F59E0B;">~12s</b><br><span style="color:#94A3B8;">预计耗时</span></div>
          </div>
        </div>
      `,
      footer: `<div class="stdm-progress">${scope} · ${count || 218} 项</div>
               <button class="btn btn--sm" data-act="close">取消</button>
               <button class="btn btn--primary btn--sm" data-act="submit">▶ 开始执行</button>`
    });
    m.overlay.querySelector('[data-act="submit"]').onclick = () => {
      m.overlay.remove();
      DF.app.toast(`⏳ 正在执行批量${scope}，预计 12 秒...`, 'info', 2000);
      setTimeout(() => DF.app.toast(`✓ 批量${scope}完成：128 张表已落标，3 张表跳过（冲突）`, 'success', 3500), 1500);
    };
  };

  // ====== 9. 同步到各表（06c）======
  NS.syncCode = function() {
    const tables = [
      { name: 'ods_bib_record', code: 'doc_type', count: 184720 },
      { name: 'dwd_bib_unified', code: 'doc_type', count: 184720 },
      { name: 'dwt_bib_dim', code: 'doc_type', count: 184720 },
      { name: 'ods_loan_trans', code: 'loan_status', count: 89632 },
      { name: 'dwt_loan_daily', code: 'loan_status', count: 89632 },
    ];
    const m = open({
      title: '🔄 同步码值到各表',
      body: `
        <div class="stdm-info">将本馆全部 <b>12</b> 个码表的最新码值同步到引用它们的 <b>${tables.length}</b> 张数据表，确保码值一致性。</div>
        <div style="max-height:280px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;margin-top:14px;">
          <table class="stdm-table" style="border:none;border-radius:0;">
            <thead><tr><th>表名</th><th style="width:140px;">码值字段</th><th style="width:120px;">影响行数</th><th style="width:80px;">状态</th></tr></thead>
            <tbody>
              ${tables.map(t => `
                <tr>
                  <td class="text-mono" style="font-size:12px;">${t.name}</td>
                  <td class="text-mono" style="font-size:11px;color:#1E40AF;">${t.code}</td>
                  <td class="text-mono" style="font-size:12px;">${t.count.toLocaleString()}</td>
                  <td><span style="color:#10B981;">✓ 待同步</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `,
      footer: `<div class="stdm-progress">预计耗时 8 秒</div>
               <button class="btn btn--sm" data-act="close">取消</button>
               <button class="btn btn--primary btn--sm" data-act="submit">🔄 开始同步</button>`
    });
    m.overlay.querySelector('[data-act="submit"]').onclick = () => {
      m.overlay.remove();
      DF.app.toast('⏳ 正在同步 12 个码表到 ' + tables.length + ' 张表...', 'info', 2000);
      setTimeout(() => DF.app.toast(`✓ 同步完成：${tables.length} 张表已更新，新增 8 个码值条目，删除 3 个过期条目`, 'success', 3500), 1500);
    };
  };

  // ====== 10. 对比国标（06c）======
  NS.compareNational = function() {
    const diffs = [
      { code: 'std_doc_type', ours: '图书 / 期刊 / 论文 / 古籍 / 电子资源 / 音视频 / 地图 / 标准', nst: '图书 / 连续出版物 / 学位论文 / 古籍 / 电子资源 / 音视频 / 地图 / 标准 / 其他', status: 'diff' },
      { code: 'std_loan_status', ours: '在借 / 归还 / 续借 / 逾期 / 丢失 / 剔旧', nst: '在借 / 归还 / 续借 / 逾期 / 丢失 / 剔旧 / 注销', status: 'partial' },
      { code: 'std_reader_type', ours: '学生 / 教职工 / 校友 / 访客 / 馆际互借', nst: '学生 / 教职工 / 校外读者 / 馆际互借 / 其他', status: 'diff' },
    ];
    const m = open({
      title: '🆚 本馆码表 vs 国标 对比',
      body: `
        <div class="stdm-info">对比本馆码表与 <b>GB/T 33190-2016 数字图书馆资源建设与服务规范</b>，共发现 <b style="color:#EF4444;">${diffs.length}</b> 项差异。</div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;margin-top:14px;">
          <table class="stdm-table" style="border:none;border-radius:0;">
            <thead><tr><th style="width:160px;">码表</th><th>本馆</th><th>国标</th><th style="width:80px;">状态</th></tr></thead>
            <tbody>
              ${diffs.map(d => `
                <tr>
                  <td class="text-mono" style="font-size:12px;color:#1E40AF;">${d.code}</td>
                  <td style="font-size:11px;">${d.ours}</td>
                  <td style="font-size:11px;">${d.nst}</td>
                  <td>${d.status === 'diff' ? '<span style="color:#EF4444;">✗ 差异</span>' : '<span style="color:#F59E0B;">⚠ 部分</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="stdm-warn" style="margin-top:12px;">⚠ 建议：与国标对齐以提升数据互操作性。点击"一键对齐"将自动同步到国标最新版。</div>
      `,
      footer: `<div class="stdm-progress">${diffs.length} 项差异 · 国标 GB/T 33190-2016</div>
               <button class="btn btn--sm" data-act="close">关闭</button>
               <button class="btn btn--primary btn--sm" data-act="submit">🔄 一键对齐</button>`
    });
    m.overlay.querySelector('[data-act="submit"]').onclick = () => {
      m.overlay.remove();
      DF.app.toast('⏳ 正在对齐 ' + diffs.length + ' 项码表到国标...', 'info', 2000);
      setTimeout(() => DF.app.toast(`✓ 对齐完成：3 项已更新，2 项保留本馆业务定义（标注"特殊业务"）`, 'success', 3500), 1500);
    };
  };

  // ====== 11. 引用统计（06a modal 内）======
  NS.fieldStats = function(field) {
    const stats = [
      { table: 'ods_bib_record', count: 184720, sample: '978-7-100-12345-6' },
      { table: 'dwd_bib_unified', count: 184720, sample: '978-7-302-56789-0' },
      { table: 'dwt_bib_dim', count: 184720, sample: '978-7-04-98765-4' },
      { table: 'ads_bib_search_idx', count: 184720, sample: '978-7-5087-12345-6' },
      { table: 'ods_loan_trans', count: 89632, sample: '978-7-5327-89012-3' },
    ];
    const total = stats.reduce((s, x) => s + x.count, 0);
    const m = open({
      title: `📊 字段引用统计 · ${field}`,
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
          <div style="padding:12px;background:#F0F9FF;border-radius:6px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#1E40AF;">${stats.length}</div>
            <div style="font-size:11px;color:#6B7691;">引用表数</div>
          </div>
          <div style="padding:12px;background:#D1FAE5;border-radius:6px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#10B981;">${total.toLocaleString()}</div>
            <div style="font-size:11px;color:#6B7691;">覆盖行数</div>
          </div>
          <div style="padding:12px;background:#FEF3C7;border-radius:6px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#F59E0B;">99.8%</div>
            <div style="font-size:11px;color:#6B7691;">空值率</div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">📋 各表引用详情</div>
        <div style="max-height:240px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          <table class="stdm-table" style="border:none;border-radius:0;">
            <thead><tr><th>表名</th><th style="width:120px;">行数</th><th>示例</th></tr></thead>
            <tbody>
              ${stats.map(s => `
                <tr>
                  <td class="text-mono" style="font-size:12px;">${s.table}</td>
                  <td class="text-mono" style="font-size:12px;">${s.count.toLocaleString()}</td>
                  <td class="text-mono" style="font-size:11px;color:#94A3B8;">${s.sample}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `,
      footer: `<div class="stdm-progress">字段 ${field} · 实时统计</div>
               <button class="btn btn--sm" data-act="export">📥 导出 CSV</button>
               <button class="btn btn--primary btn--sm" data-act="close">关闭</button>`
    });
    m.overlay.querySelector('[data-act="export"]').onclick = () => {
      m.overlay.remove();
      DF.app.toast(`✓ 已导出 ${field} 引用统计`, 'success');
    };
  };

  // ====== 12. 关系图（06b）======
  NS.attrGraph = function(field) {
    const nodes = [
      { id: 'std_attr', x: 60, y: 100, w: 130, h: 50, fill: '#DBEAFE', stroke: '#1E40AF', label: 'std_attr_xxx', sub: '属性标准中心' },
      { id: 'ods_bib', x: 280, y: 40, w: 110, h: 40, fill: '#FEF3C7', stroke: '#92400E', label: 'ods_bib_record' },
      { id: 'dwd_bib', x: 280, y: 100, w: 110, h: 40, fill: '#D1FAE5', stroke: '#065F46', label: 'dwd_bib_unified' },
      { id: 'dwt_bib', x: 280, y: 160, w: 110, h: 40, fill: '#FCE7F3', stroke: '#9F1239', label: 'dwt_bib_dim' },
      { id: 'ads_bib', x: 280, y: 220, w: 110, h: 40, fill: '#F3E8FF', stroke: '#6B21A8', label: 'ads_bib_search' },
      { id: 'marc', x: 460, y: 130, w: 100, h: 40, fill: '#FEE2E2', stroke: '#EF4444', label: 'MARC21' },
    ];
    const edges = [
      { from: 'std_attr', to: 'ods_bib' }, { from: 'std_attr', to: 'dwd_bib' },
      { from: 'std_attr', to: 'dwt_bib' }, { from: 'std_attr', to: 'ads_bib' },
      { from: 'ods_bib', to: 'marc', label: 'MARC21' },
    ];
    const svgEdges = edges.map(e => {
      const a = nodes.find(n => n.id === e.from);
      const b = nodes.find(n => n.id === e.to);
      const ax = a.x + a.w, ay = a.y + a.h / 2;
      const bx = b.x, by = b.y + b.h / 2;
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#94A3B8" stroke-width="1.5" marker-end="url(#arr)"/>`;
    }).join('');
    const svgNodes = nodes.map(n => `
      <g>
        <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.5" rx="4"/>
        <text x="${n.x + n.w/2}" y="${n.y + n.h/2 - 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#111728" font-family="system-ui">${n.label}</text>
        ${n.sub ? `<text x="${n.x + n.w/2}" y="${n.y + n.h/2 + 10}" text-anchor="middle" font-size="9" fill="#6B7691">${n.sub}</text>` : ''}
      </g>
    `).join('');

    const m = open({
      title: '🕸️ 属性引用关系图',
      body: `
        <div class="stdm-info">属性 <b>${field || 'std_bib_isbn'}</b> 被 <b>4</b> 张表引用，关联 <b>1</b> 个外部标准。点击节点可查看详情。</div>
        <div style="background:#FAFBFC;border:1px solid #E2E8F0;border-radius:6px;margin-top:12px;padding:8px;">
          <svg width="600" height="280" viewBox="0 0 600 280">
            <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#94A3B8"/></marker></defs>
            ${svgEdges}
            ${svgNodes}
          </svg>
        </div>
        <div style="display:flex;gap:14px;font-size:11px;color:#6B7691;margin-top:8px;justify-content:center;">
          <span>🟦 属性标准</span>
          <span>🟨 ODS 原始数据层</span>
          <span>🟩 DWD 明细层</span>
          <span>🟪 ADS 应用层</span>
          <span>🟥 外部标准</span>
        </div>
      `,
      footer: `<div class="stdm-progress">关系图 · ${field || 'std_bib_isbn'}</div>
               <button class="btn btn--sm" data-act="export">📥 导出 SVG</button>
               <button class="btn btn--primary btn--sm" data-act="close">关闭</button>`
    });
    m.overlay.querySelector('[data-act="export"]').onclick = () => DF.app.toast('✓ 关系图已导出', 'success');
  };

  // ====== 13. 复制到剪贴板（真实）======
  NS.copy = function(text, label = '标签') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => DF.app.toast(`✓ 已复制${label}到剪贴板：${text.slice(0, 30)}${text.length > 30 ? '...' : ''}`, 'success', 2500),
        () => fallbackCopy(text, label)
      );
    } else fallbackCopy(text, label);
  };
  function fallbackCopy(text, label) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); DF.app.toast(`✓ 已复制${label}`, 'success'); }
    catch (e) { DF.app.toast('复制失败，请手动复制', 'warning'); }
    document.body.removeChild(ta);
  }

  // ====== 14. 提交修订（06a modal 内）======
  NS.submitRevision = function(field) {
    const m = open({
      title: `✏️ 提交修订 · ${field || '字段'}`,
      body: `
        <div class="stdm-form-grid">
          <div class="stdm-field">
            <label class="stdm-field__label">修订类型</label>
            <select class="stdm-select">
              <option>修改字段名</option>
              <option>修改数据类型</option>
              <option>调整长度</option>
              <option>补充说明</option>
              <option>新增引用</option>
              <option>废弃字段</option>
            </select>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">影响范围</label>
            <select class="stdm-select">
              <option>仅本馆</option>
              <option>同步到所有引用表</option>
            </select>
          </div>
          <div class="stdm-field full">
            <label class="stdm-field__label">变更说明 <span class="req">*</span></label>
            <textarea class="stdm-textarea" placeholder="请说明本次修订的原因、业务背景、影响评估..."></textarea>
          </div>
        </div>
        <div class="stdm-warn" style="margin-top:14px;">⚠ 修订提交后进入审核队列：初审（王芳）→ 复核（治理委员会）→ 发布。预计 1-3 个工作日。</div>
      `,
      footer: `<div class="stdm-progress">${field || '字段'} · 修订工单</div>
               <button class="btn btn--sm" data-act="close">取消</button>
               <button class="btn btn--primary btn--sm" data-act="submit">📤 提交工单</button>`
    });
    m.overlay.querySelector('[data-act="submit"]').onclick = () => {
      m.overlay.remove();
      DF.app.toast(`✓ 修订工单已提交：${field || '字段'} · 工单号 REV-${Date.now().toString().slice(-6)}`, 'success', 3500);
    };
  };

  // ====== 15. 06d 测试转换 ======
  NS.testConvert = function(rule) {
    const samples = [
      { src: '020$a', val: '978-7-100-12345-6 (paperback)', out: '9787100123456' },
      { src: '020$a', val: 'ISBN 978-7-302-56789-0', out: '9787302567890' },
      { src: '020$a', val: '7-5087-1234-5 (invalid length)', out: '⚠ 长度不符，需 13 位' },
    ];
    const m = open({
      title: `▶ 测试转换 · ${rule || '020$a → std_bib_isbn'}`,
      body: `
        <div class="stdm-info">使用真实样本测试转换规则，验证映射正确性。</div>
        <div style="max-height:340px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;margin-top:14px;">
          <table class="stdm-table" style="border:none;border-radius:0;">
            <thead><tr><th style="width:80px;">源字段</th><th>输入值</th><th>输出值</th><th style="width:80px;">结果</th></tr></thead>
            <tbody>
              ${samples.map(s => `
                <tr>
                  <td class="text-mono" style="font-size:11px;color:#1E40AF;">${s.src}</td>
                  <td class="text-mono" style="font-size:11px;">${s.val}</td>
                  <td class="text-mono" style="font-size:11px;color:${s.out.startsWith('⚠') ? '#EF4444' : '#10B981'};">${s.out}</td>
                  <td>${s.out.startsWith('⚠') ? '<span style="color:#EF4444;">✗ 失败</span>' : '<span style="color:#10B981;">✓ 成功</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:14px;">
          <div style="padding:10px;background:#D1FAE5;border-radius:6px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#10B981;">2</div>
            <div style="font-size:11px;color:#6B7691;">成功</div>
          </div>
          <div style="padding:10px;background:#FEE2E2;border-radius:6px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#EF4444;">1</div>
            <div style="font-size:11px;color:#6B7691;">失败</div>
          </div>
          <div style="padding:10px;background:#F0F9FF;border-radius:6px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#1E40AF;">67%</div>
            <div style="font-size:11px;color:#6B7691;">成功率</div>
          </div>
        </div>
      `,
      footer: `<div class="stdm-progress">规则：${rule || '020$a → std_bib_isbn'}</div>
               <button class="btn btn--sm" data-act="more">📝 加载更多样本</button>
               <button class="btn btn--primary btn--sm" data-act="close">关闭</button>`
    });
    m.overlay.querySelector('[data-act="more"]').onclick = () => DF.app.toast('已加载 20 条额外样本', 'info');
  };

  // ====== 16. 06d 批量转换 ======
  NS.batchConvert = function() {
    const m = open({
      title: '▶ 批量转换',
      body: `
        <div class="stdm-info">批量执行 <b>86</b> 条映射规则，对 <b>184,720</b> 行 MARC21 原始记录进行转换。预计耗时 <b>~45 秒</b>。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
          <div class="stdm-field">
            <label class="stdm-field__label">源数据</label>
            <select class="stdm-select"><option>MARC21 原始记录 (ods_marc_record)</option><option>CNMARC 原始记录</option><option>Dublin Core XML</option></select>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">目标表</label>
            <select class="stdm-select"><option>dwd_bib_unified</option><option>ods_bib_record</option></select>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">错误处理</label>
            <select class="stdm-select"><option>记录到错误表</option><option>跳过并继续</option><option>中止</option></select>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">并发度</label>
            <select class="stdm-select"><option>4</option><option>8</option><option>16</option></select>
          </div>
        </div>
        <div style="margin-top:14px;padding:12px;background:#F8FAFC;border-radius:6px;">
          <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;">📊 预估</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:12px;">
            <div><b style="font-size:18px;color:#1E40AF;">184,720</b><br><span style="color:#94A3B8;">总行数</span></div>
            <div><b style="font-size:18px;color:#1E40AF;">86</b><br><span style="color:#94A3B8;">规则数</span></div>
            <div><b style="font-size:18px;color:#10B981;">~178k</b><br><span style="color:#94A3B8;">预估成功</span></div>
            <div><b style="font-size:18px;color:#F59E0B;">~45s</b><br><span style="color:#94A3B8;">预计耗时</span></div>
          </div>
        </div>
      `,
      footer: `<div class="stdm-progress">86 条规则 · 184,720 行</div>
               <button class="btn btn--sm" data-act="close">取消</button>
               <button class="btn btn--primary btn--sm" data-act="submit">▶ 开始转换</button>`
    });
    m.overlay.querySelector('[data-act="submit"]').onclick = () => {
      m.overlay.remove();
      DF.app.toast('⏳ 批量转换启动，4 协程并行...', 'info', 2000);
      setTimeout(() => DF.app.toast('✓ 批量转换完成：178,243 成功 / 6,477 失败（记录到 err_bib_convert_log）', 'success', 4000), 2500);
    };
  };

  // ====== 17. 搜索过滤（替换 topbar search）======
  NS.search = function(scope, hint, allItems, onSelect) {
    const m = open({
      title: `🔍 搜索${scope}`,
      body: `
        <input class="stdm-input" id="srch-input" placeholder="${hint || '输入编码、中文名...'}" style="margin-bottom:10px;font-size:14px;padding:10px 14px;" />
        <div id="srch-results" style="max-height:380px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;">
          <div style="padding:24px;text-align:center;color:#94A3B8;font-size:12px;">输入关键词开始搜索...</div>
        </div>
      `,
      footer: `<div class="stdm-progress" id="srch-stats">共 ${allItems.length} 条</div>
               <button class="btn btn--primary btn--sm" data-act="close">关闭</button>`
    });
    const render = (q) => {
      const results = allItems.filter(it => !q || it.toLowerCase().includes(q.toLowerCase()));
      const html = results.length
        ? results.slice(0, 50).map((r, i) => `<div class="srch-item" data-idx="${i}" style="padding:10px 14px;border-bottom:1px solid #F1F5F9;cursor:pointer;font-size:13px;">${highlight(r, q)}</div>`).join('')
        : `<div style="padding:24px;text-align:center;color:#94A3B8;font-size:12px;">未找到匹配项</div>`;
      m.body.querySelector('#srch-results').innerHTML = html;
      m.footer.querySelector('#srch-stats').textContent = `共 ${results.length} 条${q ? `（关键词：${q}）` : ''}`;
      m.body.querySelectorAll('.srch-item').forEach(el => {
        el.onclick = () => { onSelect && onSelect(results[+el.dataset.idx]); m.overlay.remove(); };
        el.onmouseenter = () => el.style.background = '#F0F9FF';
        el.onmouseleave = () => el.style.background = '';
      });
    };
    function highlight(text, q) {
      if (!q) return text;
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return text.replace(re, '<mark style="background:#FEF3C7;color:#92400E;">$1</mark>');
    }
    m.body.querySelector('#srch-input').oninput = e => render(e.target.value);
    m.body.querySelector('#srch-input').focus();
  };

  // ====== 18. 矩阵单元格详情（06d）======
  NS.matrixCell = function(m) {
    const m2 = open({
      title: `🔄 映射详情 · ${m.src} → ${m.tgt}`,
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div class="stdm-field">
            <label class="stdm-field__label">源字段（${m.srcStandard || 'MARC21'}）</label>
            <div class="text-mono" style="font-size:14px;color:#1E40AF;font-weight:600;">${m.src}</div>
          </div>
          <div class="stdm-field">
            <label class="stdm-field__label">目标字段（${m.tgtStandard || '本馆'}）</label>
            <div class="text-mono" style="font-size:14px;color:#10B981;font-weight:600;">${m.tgt}</div>
          </div>
          <div class="stdm-field full">
            <label class="stdm-field__label">转换规则</label>
            <div style="font-size:13px;line-height:1.6;padding:8px 12px;background:#F8FAFC;border-radius:4px;">${m.rule}</div>
          </div>
          <div class="stdm-field full">
            <label class="stdm-field__label">示例</label>
            <div class="text-mono" style="font-size:12px;padding:8px 12px;background:#F0F9FF;border-radius:4px;color:#1E40AF;">${m.ex}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;">
          <div style="padding:10px;background:#F8FAFC;border-radius:6px;text-align:center;">
            <div style="font-size:18px;font-weight:700;color:#1E40AF;">${m.count || 184720}</div>
            <div style="font-size:11px;color:#6B7691;">引用次数</div>
          </div>
          <div style="padding:10px;background:#F8FAFC;border-radius:6px;text-align:center;">
            <div style="font-size:18px;font-weight:700;color:#${m.st === 'auto' ? '10B981' : m.st === 'manual' ? 'F59E0B' : '94A3B8'};">${m.st === 'auto' ? '自动' : m.st === 'manual' ? '手动' : '未映射'}</div>
            <div style="font-size:11px;color:#6B7691;">状态</div>
          </div>
          <div style="padding:10px;background:#F8FAFC;border-radius:6px;text-align:center;">
            <div style="font-size:18px;font-weight:700;color:#1E40AF;">${m.coverage || 96}%</div>
            <div style="font-size:11px;color:#6B7691;">覆盖率</div>
          </div>
        </div>
        <div class="stdm-info">💡 此规则影响 <b>ods_marc_record</b>、<b>dwd_bib_unified</b>、<b>dwt_bib_dim</b> 三张表，共 <b>184,720</b> 行数据。</div>
      `,
      footer: `<div class="stdm-progress">${m.src} → ${m.tgt}</div>
               <button class="btn btn--sm" data-act="test">▶ 测试</button>
               <button class="btn btn--sm" data-act="copy">📋 复制</button>
               <button class="btn btn--sm" data-act="edit">✏️ 编辑</button>
               <button class="btn btn--primary btn--sm" data-act="close">关闭</button>`
    });
    m2.overlay.querySelector('[data-act="test"]').onclick = () => { m2.overlay.remove(); NS.testConvert(m.src + ' → ' + m.tgt); };
    m2.overlay.querySelector('[data-act="copy"]').onclick = () => NS.copy(`${m.src} → ${m.tgt} | ${m.rule}`, '映射规则');
    m2.overlay.querySelector('[data-act="edit"]').onclick = () => DF.app.toast('编辑模式开发中', 'info');
  };

})();
