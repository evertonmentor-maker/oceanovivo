(function () {
  'use strict';

  const { escapeHtml, formatDate, formatNumber, statusOf, STATUS, RESIDUOS, api } = OV;
  const $ = (sel, root = document) => root.querySelector(sel);
  const state = { beaches: [], selected: null, query: '' };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function formData(form) {
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });
    form.querySelectorAll('input[type=checkbox]').forEach((c) => { data[c.name] = c.checked; });
    return data;
  }

  function handleAuthError(e) {
    if (e.status === 401) { showLogin(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ Login
  function showLogin() {
    $('#admin-view').hidden = true;
    $('#login-view').hidden = false;
    $('#usuario').focus();
  }

  async function showAdmin() {
    $('#login-view').hidden = true;
    $('#admin-view').hidden = false;
    await loadBeaches();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      await api('/api/login', { method: 'POST', body: formData(e.target) });
      e.target.reset();
      showAdmin();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  $('#logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    state.selected = null;
    showLogin();
  });

  // ------------------------------------------------------------------ Lista
  async function loadBeaches() {
    state.beaches = await api('/api/beaches');
    renderList();
  }

  function renderList() {
    const q = state.query.toLowerCase();
    const items = state.beaches.filter((b) => !q || (b.nome + ' ' + b.municipio).toLowerCase().includes(q));
    $('#admin-list').innerHTML = items.map((b) => {
      const st = statusOf(b);
      return `<li><button class="beach-item${state.selected === b.id ? ' active' : ''}" data-id="${escapeHtml(b.id)}">
        <i class="dot ${st}"></i>
        <span class="beach-item-info"><strong>${escapeHtml(b.nome)}</strong>
        <small>${escapeHtml(b.municipio)} · ${b.ultimoBoletim ? formatDate(b.ultimoBoletim.data) : 'sem boletim'}</small></span>
      </button></li>`;
    }).join('') || '<li class="empty">Nenhuma praia.</li>';
  }

  $('#admin-list').addEventListener('click', (e) => {
    const item = e.target.closest('.beach-item');
    if (item) selectBeach(item.dataset.id);
  });
  $('#admin-search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#new-beach').addEventListener('click', () => { state.selected = null; renderList(); renderBeachForm(null); });

  // ------------------------------------------------------------ Formulários
  function beachFormHtml(b) {
    const v = b || { nome: '', municipio: '', lat: '', lng: '', descricao: '' };
    return `<form id="beach-form" class="admin-panel">
      <div class="admin-panel-head"><h2>${b ? 'Dados da praia' : 'Nova praia'}</h2>
        ${b ? '<button type="button" class="btn btn-danger btn-sm" id="delete-beach">Excluir praia</button>' : ''}</div>
      <div class="admin-panel-body">
        <div class="form-grid">
          <div class="field"><label for="f-nome">Nome da praia</label><input id="f-nome" name="nome" class="input" required value="${escapeHtml(v.nome)}"></div>
          <div class="field"><label for="f-municipio">Município</label><input id="f-municipio" name="municipio" class="input" required value="${escapeHtml(v.municipio)}"></div>
          <div class="field"><label for="f-lat">Latitude</label><input id="f-lat" name="lat" class="input" inputmode="decimal" required value="${escapeHtml(v.lat)}" placeholder="-27.6290"></div>
          <div class="field"><label for="f-lng">Longitude</label><input id="f-lng" name="lng" class="input" inputmode="decimal" required value="${escapeHtml(v.lng)}" placeholder="-48.4490"></div>
          <p class="hint full muted small" style="margin:-6px 0 12px">Dica: no Google Maps, clique com o botão direito sobre a praia e copie as coordenadas.</p>
          <div class="field full"><label for="f-descricao">Descrição</label><textarea id="f-descricao" name="descricao" class="input" rows="2">${escapeHtml(v.descricao)}</textarea></div>
        </div>
        <p class="form-error" id="beach-error" role="alert"></p>
        <div class="form-actions"><button class="btn btn-dark" type="submit">${b ? 'Salvar alterações' : 'Cadastrar praia'}</button></div>
      </div>
    </form>`;
  }

  function reportFormHtml() {
    const today = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
    const residuos = Object.entries(RESIDUOS).map(([k, label]) => `<option value="${k}">${label}</option>`).join('');
    return `<form id="report-form" class="admin-panel">
      <div class="admin-panel-head"><h2>Novo boletim de balneabilidade</h2></div>
      <div class="admin-panel-body">
        <fieldset>
          <legend>Coleta</legend>
          <div class="form-grid">
            <div class="field"><label for="r-data">Data da coleta</label><input id="r-data" name="data" type="date" class="input" required value="${today}"></div>
            <div class="field"><label for="r-ponto">Ponto de coleta</label><input id="r-ponto" name="pontoColeta" class="input" placeholder="Ex.: em frente à Rua X"></div>
            <div class="field full"><label for="r-fonte">Fonte</label><input id="r-fonte" name="fonte" class="input" value="IMA-SC" placeholder="IMA-SC, laboratório, vistoria…"></div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Indicadores microbiológicos</legend>
          <div class="form-grid">
            <div class="field"><label for="r-ecoli">E. coli (NMP/100 mL)</label><input id="r-ecoli" name="ecoli" type="number" min="0" step="any" class="input" data-indicator><span class="hint">Satisfatório ≤ 800 · impróprio &gt; 2.000</span></div>
            <div class="field"><label for="r-colif">Coliformes termotolerantes (NMP/100 mL)</label><input id="r-colif" name="coliformesTermotolerantes" type="number" min="0" step="any" class="input" data-indicator><span class="hint">Satisfatório ≤ 1.000 · impróprio &gt; 2.500</span></div>
            <div class="field"><label for="r-entero">Enterococos (UFC/100 mL)</label><input id="r-entero" name="enterococos" type="number" min="0" step="any" class="input" data-indicator><span class="hint">Satisfatório ≤ 100 · impróprio &gt; 400</span></div>
          </div>
          <div class="suggestion" id="suggestion">Preencha os indicadores para ver a situação sugerida pela CONAMA 274/2000.</div>
        </fieldset>
        <fieldset>
          <legend>Situação</legend>
          <div class="field"><label for="r-status">Situação para banho</label>
            <select id="r-status" name="status" class="input" required>
              <option value="propria">Própria para banho</option>
              <option value="impropria">Imprópria para banho</option>
              <option value="sem_dados">Sem dados / não coletado</option>
            </select></div>
        </fieldset>
        <fieldset>
          <legend>Condições observadas</legend>
          <div class="field"><label for="r-residuos">Resíduos sólidos (lixo) na praia</label><select id="r-residuos" name="residuos" class="input">${residuos}</select></div>
          <div class="checks">
            <label><input type="checkbox" name="esgoto"> Esgoto / língua negra</label>
            <label><input type="checkbox" name="oleo"> Manchas de óleo</label>
            <label><input type="checkbox" name="floracaoAlgas"> Floração de algas</label>
            <label><input type="checkbox" name="aguasVivas"> Águas-vivas</label>
          </div>
          <div class="field"><label for="r-obs">Observações</label><textarea id="r-obs" name="observacoes" class="input" rows="2"></textarea></div>
        </fieldset>
        <p class="form-error" id="report-error" role="alert"></p>
        <div class="form-actions"><button class="btn btn-dark" type="submit">Publicar boletim</button></div>
      </div>
    </form>`;
  }

  function reportsHtml(reports) {
    if (!reports.length) return '<div class="admin-panel"><div class="admin-panel-body empty">Nenhum boletim cadastrado ainda.</div></div>';
    const rows = reports.map((r) => {
      const flags = [r.esgoto && 'esgoto', r.oleo && 'óleo', r.floracaoAlgas && 'algas', r.aguasVivas && 'águas-vivas',
        r.residuos && r.residuos !== 'nenhum' && 'lixo ' + r.residuos].filter(Boolean).join(', ');
      return `<tr>
        <td>${formatDate(r.data)}</td>
        <td><span class="badge ${r.status}">${STATUS[r.status].short}</span></td>
        <td>${formatNumber(r.ecoli)}</td><td>${formatNumber(r.coliformesTermotolerantes)}</td><td>${formatNumber(r.enterococos)}</td>
        <td class="small">${escapeHtml(flags || '—')}</td>
        <td class="small">${escapeHtml(r.fonte || '—')}</td>
        <td><button class="btn btn-danger btn-sm" data-delete-report="${escapeHtml(r.id)}" aria-label="Excluir boletim de ${formatDate(r.data)}">Excluir</button></td>
      </tr>`;
    }).join('');
    return `<div class="admin-panel"><div class="admin-panel-head"><h2>Boletins publicados</h2></div>
      <div class="admin-panel-body table-wrap"><table>
        <thead><tr><th>Data</th><th>Situação</th><th>E. coli</th><th>Colif.</th><th>Enteroc.</th><th>Alertas</th><th>Fonte</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
  }

  function renderBeachForm(beach) {
    $('#editor').innerHTML = beachFormHtml(beach);
    bindBeachForm(beach);
    $('#f-nome').focus();
  }

  async function selectBeach(id) {
    state.selected = id;
    renderList();
    let beach;
    try {
      beach = await api('/api/beaches/' + encodeURIComponent(id));
    } catch (e) {
      toast(e.message);
      return;
    }
    $('#editor').innerHTML = beachFormHtml(beach) + reportFormHtml() + reportsHtml(beach.boletins);
    bindBeachForm(beach);
    bindReportForm(beach);
  }

  function bindBeachForm(beach) {
    $('#beach-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#beach-error').textContent = '';
      const body = formData(e.target);
      body.lat = String(body.lat).replace(',', '.');
      body.lng = String(body.lng).replace(',', '.');
      try {
        const saved = beach
          ? await api('/api/admin/beaches/' + encodeURIComponent(beach.id), { method: 'PUT', body })
          : await api('/api/admin/beaches', { method: 'POST', body });
        toast(beach ? 'Praia atualizada.' : 'Praia cadastrada.');
        await loadBeaches();
        selectBeach(saved.id);
      } catch (err) {
        if (!handleAuthError(err)) $('#beach-error').textContent = err.message;
      }
    });
    const del = $('#delete-beach');
    if (del) del.addEventListener('click', async () => {
      if (!confirm(`Excluir "${beach.nome}" e todos os seus boletins? Esta ação não pode ser desfeita.`)) return;
      try {
        await api('/api/admin/beaches/' + encodeURIComponent(beach.id), { method: 'DELETE' });
        toast('Praia excluída.');
        state.selected = null;
        await loadBeaches();
        $('#editor').innerHTML = '<div class="admin-panel"><div class="admin-panel-body empty">Selecione uma praia à esquerda ou cadastre uma nova.</div></div>';
      } catch (err) {
        if (!handleAuthError(err)) toast(err.message);
      }
    });
  }

  function bindReportForm(beach) {
    const form = $('#report-form');
    const updateSuggestion = () => {
      const s = OV.suggestStatus({
        ecoli: form.ecoli.value, coliformesTermotolerantes: form.coliformesTermotolerantes.value, enterococos: form.enterococos.value,
      });
      const box = $('#suggestion');
      if (!s) { box.textContent = 'Preencha os indicadores para ver a situação sugerida pela CONAMA 274/2000.'; return; }
      box.innerHTML = `Situação sugerida: <span class="badge ${s.status}">${STATUS[s.status].short}</span> (${escapeHtml(s.motivo)}). `
        + 'A CONAMA também considera o histórico das últimas 5 semanas; revise antes de publicar.';
      form.status.value = s.status;
    };
    form.querySelectorAll('[data-indicator]').forEach((i) => i.addEventListener('input', updateSuggestion));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#report-error').textContent = '';
      try {
        await api(`/api/admin/beaches/${encodeURIComponent(beach.id)}/reports`, { method: 'POST', body: formData(form) });
        toast('Boletim publicado.');
        await loadBeaches();
        selectBeach(beach.id);
      } catch (err) {
        if (!handleAuthError(err)) $('#report-error').textContent = err.message;
      }
    });

  }

  // Registrado uma única vez: #editor é reaproveitado a cada praia selecionada.
  $('#editor').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-report]');
    if (!btn || !confirm('Excluir este boletim?')) return;
    try {
      await api('/api/admin/reports/' + encodeURIComponent(btn.dataset.deleteReport), { method: 'DELETE' });
      toast('Boletim excluído.');
      await loadBeaches();
      selectBeach(state.selected);
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  });

  // ------------------------------------------------------------------ Início
  api('/api/me').then(showAdmin).catch(showLogin);
})();
