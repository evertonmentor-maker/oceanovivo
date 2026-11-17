'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuração (sobrescreva por variáveis de ambiente)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'oceanovivo2026';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const NGOS_FILE = path.join(DATA_DIR, 'ongs.json');

const STATUSES = ['propria', 'impropria', 'sem_dados'];
const RESIDUOS = ['nenhum', 'baixo', 'moderado', 'alto'];

// ---------------------------------------------------------------------------
// Armazenamento em arquivo JSON (suficiente para o MVP)
// ---------------------------------------------------------------------------
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.copyFileSync(SEED_FILE, DB_FILE);
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

let db = loadDb();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function reportsFor(beachId) {
  return db.reports
    .filter((r) => r.beachId === beachId)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}

function withLatest(beach) {
  const [latest] = reportsFor(beach.id);
  return { ...beach, ultimoBoletim: latest || null };
}

// ---------------------------------------------------------------------------
// Sessão: cookie assinado com HMAC (sem dependências extras)
// ---------------------------------------------------------------------------
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf('=');
        return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
      })
  );
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAuth(req, res, next) {
  const session = readToken(parseCookies(req.headers.cookie).ov_session);
  if (!session) return res.status(401).json({ error: 'Não autenticado.' });
  req.user = session.u;
  next();
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------
function optNumber(v, field, errors) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    errors.push(`${field} deve ser um número maior ou igual a zero.`);
    return null;
  }
  return n;
}

function str(v, max = 500) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validateBeach(body) {
  const errors = [];
  const nome = str(body.nome, 120);
  const municipio = str(body.municipio, 120);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!nome) errors.push('Nome da praia é obrigatório.');
  if (!municipio) errors.push('Município é obrigatório.');
  if (!Number.isFinite(lat) || lat < -34 || lat > 5) errors.push('Latitude inválida.');
  if (!Number.isFinite(lng) || lng < -74 || lng > -28) errors.push('Longitude inválida.');
  return { errors, value: { nome, municipio, lat, lng, descricao: str(body.descricao, 1000) } };
}

function validateReport(body) {
  const errors = [];
  const data = str(body.data, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) errors.push('Data da coleta inválida (use AAAA-MM-DD).');
  const status = STATUSES.includes(body.status) ? body.status : null;
  if (!status) errors.push('Situação inválida.');
  const residuos = RESIDUOS.includes(body.residuos) ? body.residuos : 'nenhum';
  const value = {
    data,
    status,
    ecoli: optNumber(body.ecoli, 'E. coli', errors),
    coliformesTermotolerantes: optNumber(body.coliformesTermotolerantes, 'Coliformes termotolerantes', errors),
    enterococos: optNumber(body.enterococos, 'Enterococos', errors),
    residuos,
    oleo: Boolean(body.oleo),
    esgoto: Boolean(body.esgoto),
    floracaoAlgas: Boolean(body.floracaoAlgas),
    aguasVivas: Boolean(body.aguasVivas),
    pontoColeta: str(body.pontoColeta, 200),
    fonte: str(body.fonte, 200),
    observacoes: str(body.observacoes, 1000),
  };
  return { errors, value };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// --- Público ---------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });
});

app.get('/api/beaches', (req, res) => {
  const beaches = db.beaches.map(withLatest).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  res.json(beaches);
});

app.get('/api/beaches/:id', (req, res) => {
  const beach = db.beaches.find((b) => b.id === req.params.id);
  if (!beach) return res.status(404).json({ error: 'Praia não encontrada.' });
  res.json({ ...beach, boletins: reportsFor(beach.id) });
});

app.get('/api/ongs', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(NGOS_FILE, 'utf8')));
});

// --- Autenticação ----------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  // Compara os dois campos sempre, para não vazar pelo tempo de resposta qual deles errou.
  const userOk = safeEqual(usuario || '', ADMIN_USER);
  const passOk = safeEqual(senha || '', ADMIN_PASSWORD);
  if (!(userOk && passOk)) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  res.setHeader(
    'Set-Cookie',
    `ov_session=${createToken(ADMIN_USER)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
  );
  res.json({ usuario: ADMIN_USER });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'ov_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ usuario: req.user }));

// --- Administração ---------------------------------------------------------
app.post('/api/admin/beaches', requireAuth, (req, res) => {
  const { errors, value } = validateBeach(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const beach = { id: newId('praia'), ...value };
  db.beaches.push(beach);
  saveDb();
  res.status(201).json(beach);
});

app.put('/api/admin/beaches/:id', requireAuth, (req, res) => {
  const beach = db.beaches.find((b) => b.id === req.params.id);
  if (!beach) return res.status(404).json({ error: 'Praia não encontrada.' });
  const { errors, value } = validateBeach(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  Object.assign(beach, value);
  saveDb();
  res.json(beach);
});

app.delete('/api/admin/beaches/:id', requireAuth, (req, res) => {
  const before = db.beaches.length;
  db.beaches = db.beaches.filter((b) => b.id !== req.params.id);
  if (db.beaches.length === before) return res.status(404).json({ error: 'Praia não encontrada.' });
  db.reports = db.reports.filter((r) => r.beachId !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/admin/beaches/:id/reports', requireAuth, (req, res) => {
  const beach = db.beaches.find((b) => b.id === req.params.id);
  if (!beach) return res.status(404).json({ error: 'Praia não encontrada.' });
  const { errors, value } = validateReport(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const report = { id: newId('bol'), beachId: beach.id, ...value, registradoEm: new Date().toISOString() };
  db.reports.push(report);
  saveDb();
  res.status(201).json(report);
});

app.delete('/api/admin/reports/:id', requireAuth, (req, res) => {
  const before = db.reports.length;
  db.reports = db.reports.filter((r) => r.id !== req.params.id);
  if (db.reports.length === before) return res.status(404).json({ error: 'Boletim não encontrado.' });
  saveDb();
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.listen(PORT, () => {
  console.log(`Oceano Vivo rodando em http://localhost:${PORT}`);
  console.log(`Área administrativa: http://localhost:${PORT}/admin`);
  if (!process.env.ADMIN_PASSWORD) console.log('Aviso: usando senha padrão do admin. Defina ADMIN_PASSWORD em produção.');
  if (!GOOGLE_MAPS_API_KEY) console.log('Sem GOOGLE_MAPS_API_KEY: o mapa usará OpenStreetMap (Leaflet) como alternativa.');
});
