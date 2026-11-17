/*
 * Previsão do tempo e condições do mar via Open-Meteo (gratuito, sem chave de API).
 * https://open-meteo.com
 */
(function () {
  'use strict';

  const WMO = {
    0: ['☀️', 'Céu limpo'], 1: ['🌤️', 'Predomínio de sol'], 2: ['⛅', 'Parcialmente nublado'], 3: ['☁️', 'Nublado'],
    45: ['🌫️', 'Nevoeiro'], 48: ['🌫️', 'Nevoeiro'],
    51: ['🌦️', 'Garoa fraca'], 53: ['🌦️', 'Garoa'], 55: ['🌦️', 'Garoa forte'],
    61: ['🌧️', 'Chuva fraca'], 63: ['🌧️', 'Chuva'], 65: ['🌧️', 'Chuva forte'],
    66: ['🌧️', 'Chuva congelante'], 67: ['🌧️', 'Chuva congelante'],
    71: ['🌨️', 'Neve'], 73: ['🌨️', 'Neve'], 75: ['🌨️', 'Neve'], 77: ['🌨️', 'Neve'],
    80: ['🌦️', 'Pancadas de chuva'], 81: ['🌧️', 'Pancadas de chuva'], 82: ['⛈️', 'Pancadas fortes'],
    95: ['⛈️', 'Trovoadas'], 96: ['⛈️', 'Trovoadas com granizo'], 99: ['⛈️', 'Trovoadas com granizo'],
  };
  const DIRS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const cache = new Map();

  function describe(code) { return WMO[code] || ['🌡️', '—']; }
  function compass(deg) { return deg == null ? '' : DIRS[Math.round(deg / 45) % 8]; }
  function fmt(v, unit, digits = 0) { return v == null ? '—' : `${Number(v).toFixed(digits).replace('.', ',')}${unit}`; }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open-Meteo ' + res.status);
    return res.json();
  }

  async function load(lat, lng) {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.data;

    const tz = 'America%2FSao_Paulo';
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max'
      + `&past_days=1&forecast_days=3&timezone=${tz}`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}`
      + `&current=wave_height,wave_direction,wave_period,sea_surface_temperature&timezone=${tz}`;

    const [forecast, marine] = await Promise.all([
      fetchJson(forecastUrl),
      fetchJson(marineUrl).catch(() => null), // o ponto pode cair em terra; o mar é opcional
    ]);
    const data = { forecast, marine };
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  function render({ forecast, marine }) {
    const c = forecast.current;
    const d = forecast.daily;
    const m = marine && marine.current ? marine.current : {};
    const [icon, text] = describe(c.weather_code);
    // Com past_days=1, o índice 0 é ontem e o 1 é hoje.
    const rain24h = (d.precipitation_sum[0] || 0) + (d.precipitation_sum[1] || 0);
    const days = [1, 2, 3].filter((i) => d.time[i]).map((i) => {
      const [ic, tx] = describe(d.weather_code[i]);
      const label = i === 1 ? 'Hoje' : new Date(d.time[i] + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' });
      return `<div><strong>${label}</strong><span class="fc-icon" title="${tx}">${ic}</span>
        ${fmt(d.temperature_2m_max[i], '°')} / <span class="muted">${fmt(d.temperature_2m_min[i], '°')}</span><br>
        <span class="muted small">💧 ${fmt(d.precipitation_probability_max[i], '%')}</span></div>`;
    }).join('');

    return `
      <div class="card-row" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:2.2rem">${icon}</span>
          <div><strong style="font-family:var(--font-head);font-size:1.6rem">${fmt(c.temperature_2m, '°C')}</strong><br>
          <span class="muted small">${text} · sensação ${fmt(c.apparent_temperature, '°')}</span></div>
        </div>
      </div>
      <div class="weather-grid">
        <div class="wx"><span>Vento</span><strong>${fmt(c.wind_speed_10m, ' km/h')} ${compass(c.wind_direction_10m)}</strong></div>
        <div class="wx"><span>Umidade</span><strong>${fmt(c.relative_humidity_2m, '%')}</strong></div>
        <div class="wx"><span>Índice UV (máx.)</span><strong>${fmt(d.uv_index_max[1], '', 1)}</strong></div>
        <div class="wx"><span>Ondas</span><strong>${fmt(m.wave_height, ' m', 1)}</strong></div>
        <div class="wx"><span>Período das ondas</span><strong>${fmt(m.wave_period, ' s')}</strong></div>
        <div class="wx"><span>Temp. da água</span><strong>${fmt(m.sea_surface_temperature, '°C', 1)}</strong></div>
      </div>
      <div class="forecast">${days}</div>
      ${rain24h >= 5 ? `<div class="rain-alert">🌧️ Choveu ${fmt(rain24h, ' mm', 1)} desde ontem. Evite o banho de mar até 24 h depois de chuva forte, mesmo em praias próprias.</div>` : ''}
      <p class="muted small" style="margin:10px 0 0">Fonte: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>. Previsão estimada para as coordenadas da praia.</p>`;
  }

  window.OVWeather = { load, render };
})();
