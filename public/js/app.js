(function () {
  'use strict';

  const { escapeHtml, formatDate, formatNumber, statusOf, STATUS, LIMITS, RESIDUOS } = OV;

  const state = { beaches: [], filtered: [], status: '', city: '', query: '', map: null, openId: null };
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------------ Lista
  function normalize(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function applyFilters() {
    const q = normalize(state.query);
    state.filtered = state.beaches.filter((b) =>
      (!state.status || statusOf(b) === state.status)
      && (!state.city || b.municipio === state.city)
      && (!q || normalize(b.nome + ' ' + b.municipio).includes(q)));
    renderList();
    if (state.map) state.map.setMarkers(state.filtered, (b) => openBeach(b.id));
  }

  function renderList() {
    const list = $('#beach-list');
    if (!state.filtered.length) {
      list.innerHTML = '<li class="empty">Nenhuma praia encontrada com esses filtros.</li>';
      return;
    }
    list.innerHTML = state.filtered.map((b) => {
      const st = statusOf(b);
      const last = b.ultimoBoletim;
      return `<li><button class="beach-item" data-id="${escapeHtml(b.id)}">
        <i class="dot ${st}"></i>
        <span class="beach-item-info">
          <strong>${escapeHtml(b.nome)}</strong>
          <small>${escapeHtml(b.municipio)}${last ? ' · ' + formatDate(last.data) : ''}</small>
        </span>
        <span class="badge ${st}">${STATUS[st].short}</span>
      </button></li>`;
    }).join('');
  }

  function renderStats() {
    const count = (s) => state.beaches.filter((b) => statusOf(b) === s).length;
    const dates = state.beaches.map((b) => b.ultimoBoletim && b.ultimoBoletim.data).filter(Boolean).sort();
    $('#stat-total').textContent = state.beaches.length;
    $('#stat-ok').textContent = count('propria');
    $('#stat-bad').textContent = count('impropria');
    $('#stat-date').textContent = dates.length ? formatDate(dates[dates.length - 1]).slice(0, 5) : '—';
  }

  function renderCities() {
    const cities = [...new Set(state.beaches.map((b) => b.municipio))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('#city').insertAdjacentHTML('beforeend', cities.map((c) => `<option>${escapeHtml(c)}</option>`).join(''));
  }

  // ------------------------------------------------------------ Detalhes
  function meter(key, value) {
    if (value === null || value === undefined) return '';
    const lim = LIMITS[key];
    const max = lim.improprio * 1.5; // escala visual: verde até o satisfatório, amarelo até o limite, vermelho acima
    const pct = Math.min(100, (value / max) * 100);
    const sat = (lim.satisfatorio / max) * 100;
    const imp = (lim.improprio / max) * 100;
    return `<div class="meter">
      <div class="meter-label"><span>${lim.nome}</span><strong>${formatNumber(value)} <span class="muted small">${lim.unidade}</span></strong></div>
      <div class="meter-track" style="background:linear-gradient(90deg,var(--ok) 0 ${sat}%,#E9B949 ${sat}% ${imp}%,var(--bad) ${imp}% 100%)">
        <span class="meter-pin" style="left:${pct}%"></span>
      </div>
      <div class="meter-scale"><span>0</span><span>satisfatório até ${formatNumber(lim.satisfatorio)}</span><span>impróprio &gt; ${formatNumber(lim.improprio)}</span></div>
    </div>`;
  }

  function conditions(r) {
    const items = [
      [r.residuos && r.residuos !== 'nenhum', '🗑️', RESIDUOS[r.residuos] || RESIDUOS.nenhum],
      [r.esgoto, '🚱', r.esgoto ? 'Esgoto / língua negra visível' : 'Sem esgoto visível'],
      [r.oleo, '🛢️', r.oleo ? 'Manchas de óleo' : 'Sem manchas de óleo'],
      [r.floracaoAlgas, '🟢', r.floracaoAlgas ? 'Floração de algas' : 'Sem floração de algas'],
      [r.aguasVivas, '🪼', r.aguasVivas ? 'Presença de águas-vivas' : 'Sem águas-vivas relatadas'],
    ];
    return `<div class="conditions">${items.map(([alert, ic, text]) =>
      `<div class="condition${alert ? ' alert' : ''}"><span class="ic">${ic}</span>${escapeHtml(text)}</div>`).join('')}</div>`;
  }

  function history(reports) {
    if (reports.length < 2) return '';
    const rows = reports.slice(0, 12).map((r) => `<tr>
      <td>${formatDate(r.data)}</td>
      <td><span class="badge ${r.status}">${STATUS[r.status].short}</span></td>
      <td>${formatNumber(r.ecoli)}</td>
      <td>${formatNumber(r.coliformesTermotolerantes)}</td>
      <td>${formatNumber(r.enterococos)}</td></tr>`).join('');
    return `<div class="card"><h3>Histórico de coletas</h3><div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Situação</th><th>E. coli</th><th>Colif.</th><th>Enteroc.</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
  }

  async function openBeach(id, focusMap = true) {
    const summary = state.beaches.find((b) => b.id === id);
    if (!summary) return;
    if (focusMap && state.map) state.map.focus(summary);
    document.querySelectorAll('.beach-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));

    state.openId = id;
    $('#drawer-title').textContent = summary.nome;
    $('#drawer-sub').textContent = summary.municipio + ' · SC';
    $('#drawer-body').innerHTML = '<p class="muted">Carregando…</p>';
    openDrawer();

    let beach;
    try {
      beach = await OV.api('/api/beaches/' + encodeURIComponent(id));
      if (state.openId !== id) return; // o usuário já abriu outra praia
    } catch (e) {
      $('#drawer-body').innerHTML = `<p class="muted">Não foi possível carregar a praia: ${escapeHtml(e.message)}</p>`;
      return;
    }
    const [last] = beach.boletins;
    const st = last ? last.status : 'sem_dados';

    $('#drawer-body').innerHTML = `
      <div class="card">
        <div class="card-row">
          <span class="badge ${st}" style="font-size:.95rem;padding:8px 14px">${STATUS[st].label}</span>
          <span class="muted small">${last ? 'Coleta em ' + formatDate(last.data) : 'Nenhum boletim cadastrado'}</span>
        </div>
        ${beach.descricao ? `<p class="muted" style="margin:12px 0 0">${escapeHtml(beach.descricao)}</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <a class="btn btn-outline btn-sm" href="${OV.googleMapsLink(beach)}" target="_blank" rel="noopener">📍 Abrir no Google Maps</a>
          <a class="btn btn-outline btn-sm" href="${OV.directionsLink(beach)}" target="_blank" rel="noopener">🧭 Como chegar</a>
        </div>
      </div>
      ${last ? `
      <div class="card">
        <h3>Qualidade da água</h3>
        ${meter('ecoli', last.ecoli)}
        ${meter('coliformesTermotolerantes', last.coliformesTermotolerantes)}
        ${meter('enterococos', last.enterococos)}
        <p class="muted small" style="margin:12px 0 0">
          ${last.pontoColeta ? 'Ponto: ' + escapeHtml(last.pontoColeta) + ' · ' : ''}Fonte: ${escapeHtml(last.fonte || 'não informada')}
        </p>
      </div>
      <div class="card"><h3>Condições observadas</h3>${conditions(last)}
        ${last.observacoes ? `<p class="muted small" style="margin:12px 0 0">${escapeHtml(last.observacoes)}</p>` : ''}
      </div>` : ''}
      <div class="card"><h3>Tempo e mar agora</h3><div id="weather-slot"><p class="muted">Consultando a previsão…</p></div></div>
      ${history(beach.boletins)}`;

    try {
      const wx = await OVWeather.load(beach.lat, beach.lng);
      const slot = document.getElementById('weather-slot');
      if (slot && state.openId === id) slot.innerHTML = OVWeather.render(wx);
    } catch (e) {
      const slot = document.getElementById('weather-slot');
      if (slot) slot.innerHTML = '<p class="muted">Previsão do tempo indisponível no momento.</p>';
    }
  }

  let lastFocus = null;
  function openDrawer() {
    lastFocus = document.activeElement;
    document.body.classList.add('drawer-open');
    $('.drawer').setAttribute('aria-hidden', 'false');
    $('.drawer-close').focus();
  }
  function closeDrawer() {
    document.body.classList.remove('drawer-open');
    $('.drawer').setAttribute('aria-hidden', 'true');
    if (lastFocus) lastFocus.focus();
  }

  // ------------------------------------------------------------------ ONGs
  async function renderNgos() {
    try {
      const ngos = await OV.api('/api/ongs');
      $('#ngo-grid').innerHTML = ngos.map((n) => `<article class="ngo">
        <span class="ngo-tag">${escapeHtml(n.tema)}</span>
        <h3>${escapeHtml(n.nome)}</h3>
        <small>📍 ${escapeHtml(n.atuacao)}</small>
        <p>${escapeHtml(n.descricao)}</p>
        <a href="${escapeHtml(n.site)}" target="_blank" rel="noopener">Visitar site →</a>
      </article>`).join('');
    } catch {
      $('#ngo-grid').innerHTML = '<p class="muted">Não foi possível carregar as ONGs.</p>';
    }
  }

  // ------------------------------------------------------------------ Eventos
  function bindEvents() {
    $('#search').addEventListener('input', (e) => { state.query = e.target.value; applyFilters(); });
    $('#city').addEventListener('change', (e) => { state.city = e.target.value; applyFilters(); });
    document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      state.status = chip.dataset.status;
      applyFilters();
    }));
    $('#beach-list').addEventListener('click', (e) => {
      const item = e.target.closest('.beach-item');
      if (item) openBeach(item.dataset.id);
    });
    // Botão "Ver detalhes" dentro do balão do mapa
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-beach]');
      if (btn) openBeach(btn.dataset.openBeach, false);
      if (e.target.closest('[data-close]')) closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) closeDrawer();
    });
    const toggle = $('.nav-toggle');
    toggle.addEventListener('click', () => {
      const open = $('.nav').classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // ------------------------------------------------------------------ Início
  async function init() {
    bindEvents();
    renderNgos();

    let config = {};
    try {
      [state.beaches, config] = await Promise.all([OV.api('/api/beaches'), OV.api('/api/config')]);
    } catch (e) {
      $('#beach-list').innerHTML = `<li class="empty">Não foi possível carregar as praias: ${escapeHtml(e.message)}</li>`;
      return;
    }
    renderStats();
    renderCities();
    applyFilters();

    try {
      state.map = await OVMap.create(document.getElementById('map'), {
        googleMapsApiKey: config.googleMapsApiKey,
        onFallback: () => {
          $('#map-note').textContent = 'Mapa: OpenStreetMap. Configure GOOGLE_MAPS_API_KEY para usar o Google Maps.';
        },
        onReplace: (provider) => { state.map = provider; applyFilters(); },
      });
      applyFilters();
    } catch (e) {
      document.getElementById('map').innerHTML = '<p class="empty">Não foi possível carregar o mapa.</p>';
    }
  }

  init();
})();
