/* Utilitários compartilhados entre o site público e a área administrativa. */
(function () {
  'use strict';

  const STATUS = {
    propria: { label: 'Própria para banho', short: 'Própria', color: '#13925A' },
    impropria: { label: 'Imprópria para banho', short: 'Imprópria', color: '#D93F4C' },
    sem_dados: { label: 'Sem dados recentes', short: 'Sem dados', color: '#6B7C8C' },
  };

  // Resolução CONAMA 274/2000 — limites para águas salinas (por 100 mL).
  // "satisfatorio": limite da categoria satisfatória; "improprio": valor que torna a última amostra imprópria.
  const LIMITS = {
    ecoli: { nome: 'E. coli', unidade: 'NMP/100 mL', satisfatorio: 800, improprio: 2000 },
    coliformesTermotolerantes: { nome: 'Coliformes termotolerantes', unidade: 'NMP/100 mL', satisfatorio: 1000, improprio: 2500 },
    enterococos: { nome: 'Enterococos', unidade: 'UFC/100 mL', satisfatorio: 100, improprio: 400 },
  };

  const RESIDUOS = {
    nenhum: 'Sem resíduos visíveis',
    baixo: 'Pouco lixo na areia',
    moderado: 'Lixo moderado na areia',
    alto: 'Muito lixo na areia',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  function formatNumber(n) {
    return n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR');
  }

  function statusOf(beach) {
    return beach.ultimoBoletim ? beach.ultimoBoletim.status : 'sem_dados';
  }

  /**
   * Sugere a situação a partir dos indicadores (critério de amostra única da CONAMA 274).
   * A decisão final continua com quem cadastra o boletim.
   */
  function suggestStatus(values) {
    const measured = Object.keys(LIMITS).filter((k) => values[k] !== null && values[k] !== undefined && values[k] !== '');
    if (!measured.length) return null;
    const over = measured.filter((k) => Number(values[k]) > LIMITS[k].improprio);
    if (over.length) return { status: 'impropria', motivo: over.map((k) => LIMITS[k].nome).join(', ') + ' acima do limite' };
    const attention = measured.filter((k) => Number(values[k]) > LIMITS[k].satisfatorio);
    if (attention.length) {
      return { status: 'propria', motivo: 'dentro do limite, mas ' + attention.map((k) => LIMITS[k].nome).join(', ') + ' acima do nível satisfatório (atenção)' };
    }
    return { status: 'propria', motivo: 'todos os indicadores em nível satisfatório' };
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Erro ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Falha ao carregar ' + src));
      document.head.appendChild(s);
    });
  }

  function loadCss(href) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function googleMapsLink(beach) {
    return `https://www.google.com/maps/search/?api=1&query=${beach.lat},${beach.lng}`;
  }

  function directionsLink(beach) {
    return `https://www.google.com/maps/dir/?api=1&destination=${beach.lat},${beach.lng}`;
  }

  window.OV = {
    STATUS, LIMITS, RESIDUOS,
    escapeHtml, formatDate, formatNumber, statusOf, suggestStatus,
    api, loadScript, loadCss, googleMapsLink, directionsLink,
  };
})();
