"""Oceano Vivo - backend Flask (equivalente ao server.js), para rodar no PythonAnywhere.

No PythonAnywhere o arquivo WSGI deve conter:
    import sys
    sys.path.insert(0, '/home/SEU_USUARIO/oceanovivo')
    from app import app as application
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
DB_FILE = os.path.join(DATA_DIR, 'db.json')
SEED_FILE = os.path.join(DATA_DIR, 'seed.json')
NGOS_FILE = os.path.join(DATA_DIR, 'ongs.json')
SECRET_FILE = os.path.join(DATA_DIR, '.session_secret')

ADMIN_USER = os.environ.get('ADMIN_USER', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'oceanovivo2026')
GOOGLE_MAPS_API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY', '')
SESSION_TTL = 8 * 60 * 60  # 8 horas, em segundos

STATUSES = ('propria', 'impropria', 'sem_dados')
RESIDUOS = ('nenhum', 'baixo', 'moderado', 'alto')

_lock = threading.Lock()


def _session_secret():
    """Chave fixa (env ou arquivo) para o login sobreviver a reinícios e a vários processos."""
    env = os.environ.get('SESSION_SECRET')
    if env:
        return env.encode()
    if not os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, 'w') as f:
            f.write(secrets.token_hex(32))
    with open(SECRET_FILE) as f:
        return f.read().strip().encode()


SESSION_SECRET = _session_secret()


# --- Armazenamento em arquivo JSON -------------------------------------------
def load_db():
    if not os.path.exists(DB_FILE):
        shutil.copyfile(SEED_FILE, DB_FILE)
    with open(DB_FILE, encoding='utf-8') as f:
        return json.load(f)


def save_db(db):
    tmp = DB_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DB_FILE)


def new_id(prefix):
    return f'{prefix}_{secrets.token_hex(6)}'


def reports_for(db, beach_id):
    items = [r for r in db['reports'] if r['beachId'] == beach_id]
    return sorted(items, key=lambda r: r['data'], reverse=True)


def with_latest(db, beach):
    reports = reports_for(db, beach['id'])
    return {**beach, 'ultimoBoletim': reports[0] if reports else None}


# --- Sessão: cookie assinado com HMAC (mesmo formato do server.js) -------------
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def _sign(value: str) -> str:
    return _b64(hmac.new(SESSION_SECRET, value.encode(), hashlib.sha256).digest())


def create_token(user):
    payload = _b64(json.dumps({'u': user, 'exp': int((time.time() + SESSION_TTL) * 1000)}).encode())
    return f'{payload}.{_sign(payload)}'


def read_token(token):
    if not token or '.' not in token:
        return None
    payload, _, signature = token.partition('.')
    if not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        data = json.loads(_unb64(payload))
    except (ValueError, TypeError):
        return None
    return data if data.get('exp', 0) > time.time() * 1000 else None


def safe_equal(a, b):
    return hmac.compare_digest(
        hashlib.sha256(str(a).encode()).digest(), hashlib.sha256(str(b).encode()).digest()
    )


def current_user():
    session = read_token(request.cookies.get('ov_session'))
    return session['u'] if session else None


# --- Validação ---------------------------------------------------------------
def opt_number(v, field, errors):
    if v is None or v == '':
        return None
    try:
        n = float(v)
        if n != n or n in (float('inf'), float('-inf')) or n < 0:
            raise ValueError
    except (TypeError, ValueError):
        errors.append(f'{field} deve ser um número maior ou igual a zero.')
        return None
    return int(n) if n == int(n) else n


def text(v, maximum=500):
    return v.strip()[:maximum] if isinstance(v, str) else ''


def to_float(v):
    try:
        n = float(v)
        return n if n == n and n not in (float('inf'), float('-inf')) else None
    except (TypeError, ValueError):
        return None


def validate_beach(body):
    errors = []
    nome = text(body.get('nome'), 120)
    municipio = text(body.get('municipio'), 120)
    lat = to_float(body.get('lat'))
    lng = to_float(body.get('lng'))
    if not nome:
        errors.append('Nome da praia é obrigatório.')
    if not municipio:
        errors.append('Município é obrigatório.')
    if lat is None or lat < -34 or lat > 5:
        errors.append('Latitude inválida.')
    if lng is None or lng < -74 or lng > -28:
        errors.append('Longitude inválida.')
    value = {'nome': nome, 'municipio': municipio, 'lat': lat, 'lng': lng,
             'descricao': text(body.get('descricao'), 1000)}
    return errors, value


def validate_report(body):
    errors = []
    data = text(body.get('data'), 10)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', data):
        errors.append('Data da coleta inválida (use AAAA-MM-DD).')
    status = body.get('status') if body.get('status') in STATUSES else None
    if not status:
        errors.append('Situação inválida.')
    value = {
        'data': data,
        'status': status,
        'ecoli': opt_number(body.get('ecoli'), 'E. coli', errors),
        'coliformesTermotolerantes': opt_number(
            body.get('coliformesTermotolerantes'), 'Coliformes termotolerantes', errors),
        'enterococos': opt_number(body.get('enterococos'), 'Enterococos', errors),
        'residuos': body.get('residuos') if body.get('residuos') in RESIDUOS else 'nenhum',
        'oleo': bool(body.get('oleo')),
        'esgoto': bool(body.get('esgoto')),
        'floracaoAlgas': bool(body.get('floracaoAlgas')),
        'aguasVivas': bool(body.get('aguasVivas')),
        'pontoColeta': text(body.get('pontoColeta'), 200),
        'fonte': text(body.get('fonte'), 200),
        'observacoes': text(body.get('observacoes'), 1000),
    }
    return errors, value


# --- App -----------------------------------------------------------------------
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024


@app.after_request
def security_headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return resp


def err(message, status):
    return jsonify({'error': message}), status


def unauthorized():
    return err('Não autenticado.', 401)


def body_json():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


# Público
@app.get('/api/config')
def api_config():
    return jsonify({'googleMapsApiKey': GOOGLE_MAPS_API_KEY})


@app.get('/api/beaches')
def api_beaches():
    with _lock:
        db = load_db()
    beaches = [with_latest(db, b) for b in db['beaches']]
    beaches.sort(key=lambda b: b['nome'].lower())
    return jsonify(beaches)


@app.get('/api/beaches/<beach_id>')
def api_beach(beach_id):
    with _lock:
        db = load_db()
    beach = next((b for b in db['beaches'] if b['id'] == beach_id), None)
    if not beach:
        return err('Praia não encontrada.', 404)
    return jsonify({**beach, 'boletins': reports_for(db, beach_id)})


@app.get('/api/ongs')
def api_ongs():
    with open(NGOS_FILE, encoding='utf-8') as f:
        return jsonify(json.load(f))


# Autenticação
@app.post('/api/login')
def api_login():
    body = body_json()
    user_ok = safe_equal(body.get('usuario') or '', ADMIN_USER)
    pass_ok = safe_equal(body.get('senha') or '', ADMIN_PASSWORD)
    if not (user_ok and pass_ok):
        return err('Usuário ou senha incorretos.', 401)
    resp = jsonify({'usuario': ADMIN_USER})
    resp.set_cookie('ov_session', create_token(ADMIN_USER), max_age=SESSION_TTL,
                    httponly=True, samesite='Strict', path='/')
    return resp


@app.post('/api/logout')
def api_logout():
    resp = jsonify({'ok': True})
    resp.set_cookie('ov_session', '', max_age=0, httponly=True, samesite='Strict', path='/')
    return resp


@app.get('/api/me')
def api_me():
    user = current_user()
    return jsonify({'usuario': user}) if user else unauthorized()


# Administração
@app.post('/api/admin/beaches')
def admin_create_beach():
    if not current_user():
        return unauthorized()
    errors, value = validate_beach(body_json())
    if errors:
        return err(' '.join(errors), 400)
    with _lock:
        db = load_db()
        beach = {'id': new_id('praia'), **value}
        db['beaches'].append(beach)
        save_db(db)
    return jsonify(beach), 201


@app.put('/api/admin/beaches/<beach_id>')
def admin_update_beach(beach_id):
    if not current_user():
        return unauthorized()
    errors, value = validate_beach(body_json())
    with _lock:
        db = load_db()
        beach = next((b for b in db['beaches'] if b['id'] == beach_id), None)
        if not beach:
            return err('Praia não encontrada.', 404)
        if errors:
            return err(' '.join(errors), 400)
        beach.update(value)
        save_db(db)
    return jsonify(beach)


@app.delete('/api/admin/beaches/<beach_id>')
def admin_delete_beach(beach_id):
    if not current_user():
        return unauthorized()
    with _lock:
        db = load_db()
        before = len(db['beaches'])
        db['beaches'] = [b for b in db['beaches'] if b['id'] != beach_id]
        if len(db['beaches']) == before:
            return err('Praia não encontrada.', 404)
        db['reports'] = [r for r in db['reports'] if r['beachId'] != beach_id]
        save_db(db)
    return jsonify({'ok': True})


@app.post('/api/admin/beaches/<beach_id>/reports')
def admin_create_report(beach_id):
    if not current_user():
        return unauthorized()
    errors, value = validate_report(body_json())
    with _lock:
        db = load_db()
        beach = next((b for b in db['beaches'] if b['id'] == beach_id), None)
        if not beach:
            return err('Praia não encontrada.', 404)
        if errors:
            return err(' '.join(errors), 400)
        report = {'id': new_id('bol'), 'beachId': beach['id'], **value,
                  'registradoEm': datetime.now(timezone.utc).isoformat(timespec='milliseconds')
                  .replace('+00:00', 'Z')}
        db['reports'].append(report)
        save_db(db)
    return jsonify(report), 201


@app.delete('/api/admin/reports/<report_id>')
def admin_delete_report(report_id):
    if not current_user():
        return unauthorized()
    with _lock:
        db = load_db()
        before = len(db['reports'])
        db['reports'] = [r for r in db['reports'] if r['id'] != report_id]
        if len(db['reports']) == before:
            return err('Boletim não encontrado.', 404)
        save_db(db)
    return jsonify({'ok': True})


@app.route('/api/<path:_>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def api_not_found(_):
    return err('Rota não encontrada.', 404)


# Arquivos estáticos (equivale ao express.static com extensions: ['html'])
@app.get('/')
def index():
    return send_from_directory(PUBLIC_DIR, 'index.html')


@app.get('/<path:path>')
def static_files(path):
    full = os.path.join(PUBLIC_DIR, path)
    if not os.path.isfile(full) and os.path.isfile(full + '.html'):
        path += '.html'
    return send_from_directory(PUBLIC_DIR, path)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 3000)))
