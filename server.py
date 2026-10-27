"""
Naturia — order server.

Runs on Render (free web service) with a Neon Postgres database, or on this
PC with a local SQLite file for testing.

    python server.py

Environment variables
    DATABASE_URL           Neon *pooled* connection string, used for order traffic.
                           Not set → local SQLite file orders.db
    DATABASE_URL_UNPOOLED  Neon *direct* connection string, used only to create the
                           table (schema changes must not go through the pooler).
                           Optional: falls back to DATABASE_URL.
    ADMIN_USER       older shared admin login name (default: admin)
    ADMIN_PASSWORD   older shared admin password. Optional now: it still works as a
                     back-up way into /admin, next to the accounts below
    GOOGLE_CLIENT_ID "Sign in with Google" client id (Google Cloud console). Not set →
                     the Google button is hidden
    ALLOWED_ORIGINS  extra web addresses allowed to call /api from a browser (comma separated)
    PORT             set by Render; locally defaults to 8787

Accounts live in the database (table users; passwords are stored only as scrypt hashes).
Two accounts - an admin and a customer - are created from accounts.seed.json on first start.
Customers who use Google get an account of their own the first time they sign in.

Endpoints
    POST /api/login                     username + password → session token (and cookie)
    POST /api/login/google              Google credential → session token (and cookie)
    POST /api/logout                    ends the browser session
    GET  /api/me                        who is signed in
    GET  /api/config                    public settings for the login page (Google client id)
    POST /api/password                  change your own password
    POST /api/orders                    the app sends an order here (JSON)
    GET  /api/health                    "is the server up?" (also wakes it on Render)
    GET  /api/app-version?version=X     the app asks "is a newer app published?" (drives the Update button)
    GET  /download/latest               sends the phone to the newest APK listed in update.json
    GET  /admin                         orders page for the shop owner        (login)
    POST /admin/orders/<id>/status      change an order's status              (login)
    GET  /admin/orders.csv              download every order as a spreadsheet (login)
    GET  /api/orders                    every order as JSON                   (login)

Prices are never taken from the phone: every item is checked and priced
against catalogue.json, which App/build_app.py exports from the product list.

App updates are published by editing update.json (see README) and pushing to GitHub.
"""
import base64
import contextlib
import csv
import hashlib
import hmac
import html
import io
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOGUE_FILE = os.path.join(HERE, 'catalogue.json')
UPDATE_FILE = os.path.join(HERE, 'update.json')
SEED_FILE = os.path.join(HERE, 'accounts.seed.json')
SQLITE_FILE = os.path.join(HERE, 'orders.db')
# The Naturia website (same pages as the app). Served at / so customers can also order in a browser.
WWW = os.path.join(HERE, 'www')

def load_env_file():
    """Local runs: read .env.local / .env written by `neon deploy`.

    Real environment variables (Render's settings) always win, and Render has
    no such file, so this only matters on a developer's PC.
    """
    for name in ('.env.local', '.env'):
        path = os.path.join(HERE, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, value = line.partition('=')
                key = key.strip().removeprefix('export ').strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)


load_env_file()

ON_RENDER = 'RENDER' in os.environ or 'RENDER_SERVICE_ID' in os.environ
HOST = '0.0.0.0' if ON_RENDER else '127.0.0.1'
PORT = int(os.environ.get('PORT', '8787'))

DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
DATABASE_URL_UNPOOLED = os.environ.get('DATABASE_URL_UNPOOLED', '').strip()
ADMIN_USER = os.environ.get('ADMIN_USER', 'admin').strip() or 'admin'
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
# Web addresses whose pages may call /api from a browser: the app's own address, plus any in ALLOWED_ORIGINS.
ALLOWED_ORIGINS = {'https://appassets.androidplatform.net'} | \
    {o.strip() for o in os.environ.get('ALLOWED_ORIGINS', '').split(',') if o.strip()}

SESSION_SECONDS = 30 * 24 * 3600   # how long a sign-in lasts
COOKIE = 'naturia_session'
LOGIN_TRIES = 10                   # wrong passwords per 15 minutes, per phone + username
LOGIN_TRIES_PER_IP = 40            # ...and per phone / IP address overall

MAX_QTY = 100         # sacks per product per order
MAX_BODY = 64 * 1024
ORDERS_PER_HOUR = 20   # per phone / IP address, to stop spam
STATUSES = ['new', 'confirmed', 'dispatched', 'delivered', 'cancelled']
IST = timezone(timedelta(hours=5, minutes=30))

PHONE_RE = re.compile(r'^(?:\+?91)?[6-9]\d{9}$')
PIN_RE = re.compile(r'^[1-9]\d{5}$')


# --------------------------------------------------------------------- database
class Database:
    """Same SQL on Postgres (Neon) and SQLite (local); only placeholders differ."""

    def __init__(self, url, direct_url=''):
        self.url = url
        self.direct_url = direct_url or url
        self.postgres = url.startswith(('postgres://', 'postgresql://'))
        self.lock = threading.Lock()
        if self.postgres:
            import psycopg  # installed on Render from requirements.txt
            self.driver = psycopg
        self._create_table()
        self._create_account_tables()

    def connect(self, direct=False):
        if self.postgres:
            # Order traffic goes through Neon's pooler (PgBouncer, transaction
            # mode). prepare_threshold=None turns off server-side prepared
            # statements, which a transaction pooler cannot keep track of.
            return self.driver.connect(self.direct_url if direct else self.url,
                                       connect_timeout=15, prepare_threshold=None)
        conn = sqlite3.connect(SQLITE_FILE, timeout=15)
        return conn

    def q(self, sql):
        return sql.replace('?', '%s') if self.postgres else sql

    def run(self, sql, params=(), fetch=None, direct=False):
        # SQLite (local file) allows one writer at a time; Postgres handles its own locking.
        with self.lock if not self.postgres else contextlib.nullcontext():
            conn = self.connect(direct)
            try:
                cur = conn.cursor()
                cur.execute(self.q(sql), params)
                rows = cur.fetchall() if fetch == 'all' else cur.fetchone() if fetch == 'one' else None
                conn.commit()
                return rows
            finally:
                conn.close()

    def _create_table(self):
        idcol = 'BIGSERIAL PRIMARY KEY' if self.postgres else 'INTEGER PRIMARY KEY AUTOINCREMENT'
        self.run(f'''CREATE TABLE IF NOT EXISTS orders (
            id {idcol},
            order_id TEXT UNIQUE,
            request_id TEXT UNIQUE,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL,
            customer TEXT NOT NULL,
            items TEXT NOT NULL,
            subtotal NUMERIC NOT NULL,
            payment TEXT NOT NULL
        )''', direct=True)  # schema change: direct connection, not the pooler

    def _create_account_tables(self):
        idcol = 'BIGSERIAL PRIMARY KEY' if self.postgres else 'INTEGER PRIMARY KEY AUTOINCREMENT'
        self.run(f'''CREATE TABLE IF NOT EXISTS users (
            id {idcol},
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            created_at TEXT NOT NULL
        )''', direct=True)
        self.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)', direct=True)

    # accounts ------------------------------------------------------------
    def get_user(self, username):
        row = self.run('SELECT username, password_hash, role, name, email FROM users WHERE username = ?',
                       (username,), 'one')
        return dict(zip(('username', 'password_hash', 'role', 'name', 'email'), row)) if row else None

    def add_user(self, username, password_hash, role, name, email=''):
        """Never overwrites: an account that already exists keeps its (possibly changed) password."""
        self.run('INSERT INTO users (username, password_hash, role, name, email, created_at) '
                 'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (username) DO NOTHING',
                 (username, password_hash, role, name, email, datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')))

    def set_password(self, username, password_hash):
        self.run('UPDATE users SET password_hash = ? WHERE username = ?', (password_hash, username))

    def setting(self, key, make):
        """A value kept in the database, made on first use (the sign-in signing secret)."""
        row = self.run('SELECT value FROM settings WHERE key = ?', (key,), 'one')
        if not row:
            self.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', (key, make()))
            row = self.run('SELECT value FROM settings WHERE key = ?', (key,), 'one')
        return row[0]

    # orders --------------------------------------------------------------
    def find_by_request(self, request_id):
        row = self.run('SELECT order_id, subtotal FROM orders WHERE request_id = ? AND order_id IS NOT NULL',
                       (request_id,), 'one')
        return (row[0], float(row[1])) if row else None

    def create_order(self, fields, request_id):
        """Returns (order_id, subtotal, duplicate)."""
        if request_id:
            found = self.find_by_request(request_id)
            if found:
                return found[0], found[1], True

        created = datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')
        row = self.run(
            'INSERT INTO orders (request_id, created_at, status, customer, items, subtotal, payment) '
            'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (request_id) DO NOTHING RETURNING id',
            (request_id or None, created, 'new', json.dumps(fields['customer'], ensure_ascii=False),
             json.dumps(fields['items'], ensure_ascii=False), fields['subtotal'], fields['payment']),
            'one')
        if row is None:  # the same request arrived twice at the same moment
            row = self.run('SELECT order_id, subtotal FROM orders WHERE request_id = ?', (request_id,), 'one')
            return row[0], float(row[1]), True

        order_id = f'NAT-{int(row[0]):04d}'
        self.run('UPDATE orders SET order_id = ? WHERE id = ?', (order_id, row[0]))
        return order_id, fields['subtotal'], False

    def list_orders(self):
        rows = self.run('SELECT order_id, created_at, status, customer, items, subtotal, payment '
                        'FROM orders ORDER BY id DESC', fetch='all') or []
        return [{
            'order_id': r[0], 'created_at': r[1], 'status': r[2],
            'customer': json.loads(r[3]), 'items': json.loads(r[4]),
            'subtotal': float(r[5]), 'payment': r[6],
        } for r in rows]

    def set_status(self, order_id, status):
        self.run('UPDATE orders SET status = ? WHERE order_id = ?', (status, order_id))


# --------------------------------------------------------------------- orders
def load_catalogue():
    with open(CATALOGUE_FILE, encoding='utf-8') as f:
        return {p['id']: p for p in json.load(f)}


def active_price(p):
    sale = p.get('sale_price')
    regular = float(p['regular_price'])
    if sale not in ('', None) and float(sale) < regular:
        return float(sale)
    return regular


def clean(value, limit):
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:limit]


def validate(payload, catalogue):
    errors = {}
    customer = payload.get('customer') or {}
    name = clean(customer.get('name'), 80)
    phone = re.sub(r'[\s-]', '', str(customer.get('phone') or ''))
    address = clean(customer.get('address'), 400)
    pincode = clean(customer.get('pincode'), 6)
    notes = clean(customer.get('notes'), 500)

    if len(name) < 2:
        errors['name'] = 'Please enter your name.'
    if not PHONE_RE.match(phone):
        errors['phone'] = 'Please enter a valid 10-digit mobile number.'
    if len(address) < 10:
        errors['address'] = 'Please enter your full delivery address.'
    if not PIN_RE.match(pincode):
        errors['pincode'] = 'Please enter a valid 6-digit PIN code.'

    items, subtotal = [], 0.0
    raw_items = payload.get('items')
    if not isinstance(raw_items, list) or not raw_items:
        errors['items'] = 'Your bag is empty.'
    else:
        for raw in raw_items[:50]:
            pid = str((raw or {}).get('id') or '')
            try:
                qty = int((raw or {}).get('qty'))
            except (TypeError, ValueError):
                qty = 0
            product = catalogue.get(pid)
            if not product:
                errors['items'] = 'One of the products is no longer available. Please refresh your bag.'
                break
            if qty < 1 or qty > MAX_QTY:
                errors['items'] = f'Quantity must be between 1 and {MAX_QTY} sacks for each product.'
                break
            price = active_price(product)
            subtotal += price * qty
            items.append({'id': pid, 'name': product['name'], 'qty': qty, 'price': price, 'line_total': price * qty})

    return {
        'customer': {'name': name, 'phone': phone[-10:], 'address': address, 'pincode': pincode, 'notes': notes},
        'items': items,
        'subtotal': subtotal,
        'payment': 'Cash on Delivery',
    }, errors


RATE = {}
RATE_LOCK = threading.Lock()


def rate_limited(ip):
    now = time.time()
    with RATE_LOCK:
        hits = [t for t in RATE.get(ip, []) if now - t < 3600]
        if len(hits) >= ORDERS_PER_HOUR:
            RATE[ip] = hits
            return True
        hits.append(now)
        RATE[ip] = hits
        return False


# --------------------------------------------------------------------- accounts
def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f'scrypt$16384$8$1${salt.hex()}${digest.hex()}'


def check_password(password, stored):
    try:
        _, n, r, p, salt, digest = stored.split('$')
        got = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, bytes.fromhex(digest))
    except (ValueError, AttributeError):
        return False


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def make_token(username):
    """A signed sign-in: who it is and when it ends. Cannot be forged without the secret in the database."""
    body = _b64(json.dumps({'u': username, 'e': int(time.time()) + SESSION_SECONDS}).encode())
    return body + '.' + _b64(hmac.new(SECRET, body.encode(), 'sha256').digest())


def read_token(token):
    """The username in a valid, unexpired token, else None."""
    try:
        body, sig = token.split('.')
        if not hmac.compare_digest(sig, _b64(hmac.new(SECRET, body.encode(), 'sha256').digest())):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
        return data['u'] if data['e'] > time.time() else None
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


FAILS = {}


def login_blocked(*keys):
    """Too many wrong passwords recently from this phone (and username)?"""
    now = time.time()
    with RATE_LOCK:
        for key, limit in zip(keys, (LOGIN_TRIES, LOGIN_TRIES_PER_IP)):
            FAILS[key] = [t for t in FAILS.get(key, []) if now - t < 900]
            if len(FAILS[key]) >= limit:
                return True
    return False


def note_failed_login(*keys):
    with RATE_LOCK:
        for key in keys:
            FAILS.setdefault(key, []).append(time.time())


def verify_google(credential):
    """Ask Google whether a "Sign in with Google" credential is genuine and meant for this app.
    Returns Google's profile for it, or None."""
    if not GOOGLE_CLIENT_ID or not credential:
        return None
    try:
        url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + quote(credential, safe='')
        with urllib.request.urlopen(url, timeout=10) as res:
            info = json.load(res)
        valid = (info.get('aud') == GOOGLE_CLIENT_ID
                 and info.get('iss') in ('accounts.google.com', 'https://accounts.google.com')
                 and str(info.get('email_verified')).lower() == 'true'
                 and info.get('sub') and info.get('email')
                 and float(info.get('exp', 0)) > time.time())
    except (urllib.error.URLError, OSError, ValueError, TypeError):
        return None
    return info if valid else None


def seed_accounts():
    """Create the admin and customer accounts listed in accounts.seed.json if they do not exist yet."""
    try:
        with open(SEED_FILE, encoding='utf-8-sig') as f:
            accounts = json.load(f)
    except (OSError, ValueError):
        return
    for a in accounts:
        DB.add_user(a['username'], a['password_hash'], a['role'], a['name'])


# --------------------------------------------------------------------- app updates
def read_update():
    """update.json is read on every request, so a redeploy is all it takes to publish an update."""
    try:
        with open(UPDATE_FILE, encoding='utf-8-sig') as f:  # -sig: Windows Notepad adds a BOM
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def version_tuple(text):
    """'2.1.0' -> (2, 1, 0, 0). None when there is no number in it."""
    parts = [int(p) for p in re.findall(r'\d+', str(text or ''))[:4]]
    return tuple(parts + [0] * (4 - len(parts))) if parts else None


def update_info(current):
    """Answer for the app's Update button. An update counts only when update.json
    lists a newer version AND an https APK address to download it from."""
    data = read_update()
    latest = clean(data.get('latest_version'), 20)
    newest, have = version_tuple(latest), version_tuple(current)
    available = bool(newest and have and newest > have and clean(data.get('apk_url'), 500).startswith('https://'))
    info = {'ok': True, 'update_available': available, 'latest_version': latest}
    if available:
        info.update(notes=clean(data.get('notes'), 300), download_url='/download/latest')
    return info


def inr(n):
    s = str(int(round(n)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        s = re.sub(r'\B(?=(\d{2})+(?!\d))', ',', head) + ',' + tail
    return '₹' + s


# --------------------------------------------------------------------- admin page
LOGOUT_SCRIPT = ("document.getElementById('logout').onclick=function(e){e.preventDefault();"
                 "fetch('/api/logout',{method:'POST'}).finally(function(){"
                 "try{localStorage.removeItem('naturia_token');localStorage.removeItem('naturia_user')}catch(x){}"
                 "location.href='/login.html'})}")


# Every 15 seconds the admin page asks the server for the order list; when a new order has arrived it
# reloads itself (or, if the owner is in the middle of changing a status, says so and waits).
POLL_SCRIPT = """(function(){
var seen=document.body.getAttribute('data-latest')||'',count=document.body.getAttribute('data-count')||'0',note=document.getElementById('live'),timer;
function pad(n){return(n<10?'0':'')+n}
function check(){fetch('/api/orders',{cache:'no-store'}).then(function(r){
if(r.status===401||r.status===403){note.textContent='Signed out. Please sign in again.';clearInterval(timer);return null}
return r.json()}).then(function(list){
if(!list)return;var d=new Date();note.textContent='Updates by itself, checked '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
var latest=list.length?(list[0].order_id||''):'';
if(latest!==seen||String(list.length)!==count){var a=document.activeElement;
if(a&&a.form&&/^(SELECT|BUTTON|INPUT)$/.test(a.tagName)){note.textContent='New order received. Press Refresh when you have finished here.';note.style.fontWeight='700'}
else location.reload()}}).catch(function(){})}
timer=setInterval(check,15000)})();"""


def admin_page(orders, who=''):
    counts = {s: sum(1 for o in orders if o['status'] == s) for s in STATUSES}
    open_value = sum(o['subtotal'] for o in orders if o['status'] not in ('delivered', 'cancelled'))
    summary = ' · '.join(f'{counts[s]} {s}' for s in STATUSES)

    cards = []
    for o in orders:
        c = o['customer']
        items = ''.join(f'<li>{html.escape(i["name"])} × {i["qty"]} — {inr(i["line_total"])}</li>' for i in o['items'])
        options = ''.join(f'<option value="{s}"{" selected" if s == o["status"] else ""}>{s.title()}</option>' for s in STATUSES)
        oid = html.escape(o['order_id'])
        cards.append(f'''
        <article class="order s-{html.escape(o["status"])}">
          <header>
            <strong>{oid}</strong>
            <span>{html.escape(o["created_at"])}</span>
            <span class="status">{html.escape(o["status"])}</span>
            <form method="post" action="/admin/orders/{quote(o["order_id"])}/status">
              <select name="status" aria-label="Status for {oid}">{options}</select>
              <button type="submit">Update</button>
            </form>
          </header>
          <div class="cols">
            <div><h3>Customer</h3>
              <p>{html.escape(c["name"])}<br>
              📞 <a href="tel:{html.escape(c["phone"])}">{html.escape(c["phone"])}</a><br>
              {html.escape(c["address"])}<br>PIN {html.escape(c["pincode"])}</p>
              {f'<p class="notes">Note: {html.escape(c["notes"])}</p>' if c.get("notes") else ''}
              {f'<p class="notes">Signed-in account: {html.escape(c["account"])}</p>' if c.get("account") else ''}</div>
            <div><h3>Items</h3><ul>{items}</ul>
              <p class="total">Total: {inr(o["subtotal"])} · {html.escape(o["payment"])}</p></div>
          </div>
        </article>''')
    body = ''.join(cards) or '<p class="empty">No orders yet. Orders placed in the Naturia app appear here.</p>'

    return f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Naturia — Orders</title>
<style>
  :root {{ --ivory:#FAFAF8; --beige:#F5EFEB; --border:#EBE3DB; --green:#4E7A36; --espresso:#2B1B17; --muted:#5C4A42; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--ivory); color:var(--espresso); font:15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }}
  .wrap {{ max-width:980px; margin:0 auto; padding:24px 16px 48px; }}
  .top {{ display:flex; flex-wrap:wrap; justify-content:space-between; align-items:end; gap:12px; margin-bottom:20px; }}
  h1 {{ font-family:Georgia, serif; margin:0; color:var(--green); }}
  .sub {{ color:var(--muted); margin:4px 0 0; font-size:13px; }}
  .btn {{ display:inline-block; background:var(--green); color:#fff; text-decoration:none; padding:8px 14px; border-radius:99px; font-weight:600; font-size:13px; }}
  .order {{ background:#fff; border:1px solid var(--border); border-left:5px solid var(--green); border-radius:14px; padding:14px 16px; margin-bottom:12px; }}
  .order.s-delivered {{ border-left-color:#9AA79B; }} .order.s-cancelled {{ border-left-color:#C0392B; opacity:.75; }}
  .order header {{ display:flex; flex-wrap:wrap; gap:10px; align-items:center; border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:10px; }}
  .order header span {{ color:var(--muted); font-size:13px; }}
  .status {{ background:var(--beige); color:var(--green) !important; font-weight:700; padding:2px 10px; border-radius:99px; text-transform:uppercase; font-size:11px !important; }}
  .order form {{ margin-left:auto; display:flex; gap:6px; }}
  select, button {{ font:inherit; font-size:13px; padding:5px 8px; border-radius:8px; border:1px solid var(--border); background:#fff; }}
  button {{ background:var(--green); color:#fff; border-color:var(--green); cursor:pointer; }}
  .cols {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
  @media (max-width:640px) {{ .cols {{ grid-template-columns:1fr; }} .order form {{ margin-left:0; }} }}
  h3 {{ margin:0 0 4px; font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--green); }}
  ul {{ margin:0; padding-left:18px; }} a {{ color:var(--green); }}
  .total {{ font-weight:700; margin:8px 0 0; }} .notes {{ color:var(--muted); font-style:italic; }}
  .empty {{ background:var(--beige); border:1px solid var(--border); border-radius:12px; padding:18px; }}
</style></head>
<body data-count="{len(orders)}" data-latest="{html.escape((orders[0]['order_id'] or '') if orders else '')}"><div class="wrap">
  <div class="top">
    <div><h1>Naturia — Orders</h1>
      <p class="sub">{len(orders)} order(s): {summary} · open orders worth {inr(open_value)}</p>
      {f'<p class="sub">Signed in as {html.escape(who)}</p>' if who else ''}
      <p class="sub" id="live">Updates by itself every 15 seconds.</p></div>
    <div><a class="btn" href="/admin/orders.csv">Download CSV</a> <a class="btn" href="/admin">Refresh</a>
      <a class="btn" href="/">Website</a> <a class="btn" href="/login.html" id="logout">Log out</a></div>
  </div>
  {body}
</div><script>{LOGOUT_SCRIPT}</script><script>{POLL_SCRIPT}</script></body></html>'''


def orders_csv(orders):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(['Order', 'Date (IST)', 'Status', 'Name', 'Phone', 'Address', 'PIN', 'Notes', 'Items', 'Total (Rs)', 'Payment', 'Account'])
    for o in orders:
        c = o['customer']
        items = '; '.join(f'{i["name"]} x {i["qty"]}' for i in o['items'])
        w.writerow([o['order_id'], o['created_at'], o['status'], c['name'], c['phone'], c['address'],
                    c['pincode'], c.get('notes', ''), items, int(round(o['subtotal'])), o['payment'], c.get('account', '')])
    return '﻿' + out.getvalue()  # BOM so Excel opens ₹ / Malayalam correctly


# --------------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    server_version = 'Naturia'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WWW, **kwargs)

    def list_directory(self, path):
        self.send_error(404)  # never show a folder's file list

    # helpers ---------------------------------------------------------------
    def client_ip(self):
        fwd = self.headers.get('X-Forwarded-For', '')
        return fwd.split(',')[0].strip() if fwd else self.client_address[0]

    def send_body(self, status, body, ctype, extra=None):
        data = body.encode('utf-8') if isinstance(body, str) else body
        extra = dict(extra or {})
        origin = self.headers.get('Origin', '')
        if origin in ALLOWED_ORIGINS and self.path.startswith('/api/'):  # the app's pages call /api from their own address
            extra.setdefault('Access-Control-Allow-Origin', origin)
            extra.setdefault('Vary', 'Origin')
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in extra.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, data, extra=None):
        self.send_body(status, json.dumps(data, ensure_ascii=False), 'application/json; charset=utf-8', extra)

    def session_user(self, token=''):
        """The signed-in account (from the Authorization header, the sign-in cookie, or a given token), or None."""
        header = self.headers.get('Authorization', '')
        token = token or (header[7:] if header.startswith('Bearer ') else '')
        if not token:
            try:
                cookies = SimpleCookie(self.headers.get('Cookie', ''))
            except CookieError:
                cookies = {}
            token = cookies[COOKIE].value if COOKIE in cookies else ''
        username = read_token(token) if token else None
        if not username:
            return None
        try:
            return DB.get_user(username)
        except Exception as exc:
            log(f'Database error: {exc!r}')
            return None

    def authorised(self, page=False):
        """Admin pages: an admin account is signed in, or the older shared admin login (HTTP Basic) is used."""
        user = self.session_user()
        if user and user['role'] == 'admin':
            return True
        header = self.headers.get('Authorization', '')
        if header.startswith('Basic ') and ADMIN_PASSWORD:
            try:
                name, _, pwd = base64.b64decode(header[6:]).decode('utf-8').partition(':')
            except Exception:
                name, pwd = '', ''
            if hmac.compare_digest(name, ADMIN_USER) and hmac.compare_digest(pwd, ADMIN_PASSWORD):
                return True
        if user:
            self.send_body(403, 'This account is not an admin.', 'text/plain; charset=utf-8')
        elif page and not header and 'text/html' in self.headers.get('Accept', ''):
            self.send_response(302)  # a browser: send them to the login page, then back here
            self.send_header('Location', '/login.html?next=' + quote(self.path.split('?', 1)[0]))
            self.send_header('Content-Length', '0')
            self.end_headers()
        else:
            self.send_body(401, 'Login required.', 'text/plain; charset=utf-8')
        return False

    def read_body(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return None
        return self.rfile.read(length)

    # GET -------------------------------------------------------------------
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/health':
            return self.send_json(200, {'ok': True, 'service': 'naturia-orders'})
        if path == '/api/app-version':
            version = (parse_qs(self.path.partition('?')[2]).get('version') or [''])[0]
            # Public, no login: the app's pages (another origin) read it, hence the CORS header.
            return self.send_json(200, update_info(version), {'Access-Control-Allow-Origin': '*'})
        if path == '/download/latest':
            url = clean(read_update().get('apk_url'), 500)
            if not url.startswith('https://'):
                return self.send_json(404, {'ok': False, 'message': 'No update has been published yet.'})
            self.send_response(302)
            self.send_header('Location', url)
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return
        if path == '/api/config':
            return self.send_json(200, {'ok': True, 'google_client_id': GOOGLE_CLIENT_ID})
        if path == '/api/me':
            user = self.session_user()
            if not user:
                return self.send_json(401, {'ok': False, 'message': 'Not signed in.'})
            return self.send_json(200, {'ok': True, 'username': user['username'], 'name': user['name'],
                                        'role': user['role'], 'email': user['email']})
        if path == '/api/orders':
            if self.authorised():
                return self.send_json(200, DB.list_orders())
            return
        if path in ('/admin', '/admin/'):
            if self.authorised(page=True):
                user = self.session_user()
                return self.send_body(200, admin_page(DB.list_orders(), user['name'] if user else ''),
                                      'text/html; charset=utf-8')
            return
        if path == '/admin/orders.csv':
            if self.authorised():
                name = 'naturia-orders-' + datetime.now(IST).strftime('%Y-%m-%d') + '.csv'
                return self.send_body(200, orders_csv(DB.list_orders()), 'text/csv; charset=utf-8',
                                      {'Content-Disposition': f'attachment; filename="{name}"'})
            return
        if os.path.isdir(WWW) and not path.startswith(('/api/', '/admin')):
            if path == '/':
                self.path = '/index.html'
            return super().do_GET()
        if path == '/':
            return self.send_body(200, 'Naturia order server is running.', 'text/plain; charset=utf-8')
        return self.send_json(404, {'ok': False, 'message': 'Not found'})

    def do_HEAD(self):
        if self.path.split('?', 1)[0] == '/api/health':
            self.send_response(200)
            self.end_headers()
            return
        return super().do_HEAD()

    def do_OPTIONS(self):
        """The browser's "may I?" check before the app's pages call /api (login, orders)."""
        origin = self.headers.get('Origin', '')
        self.send_response(204)
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.send_header('Access-Control-Max-Age', '600')
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Length', '0')
        self.end_headers()

    # accounts --------------------------------------------------------------
    def finish_login(self, user):
        token = make_token(user['username'])
        cookie = f'{COOKIE}={token}; Path=/; Max-Age={SESSION_SECONDS}; HttpOnly; SameSite=Lax' + ('; Secure' if ON_RENDER else '')
        self.send_json(200, {'ok': True, 'token': token, 'username': user['username'], 'name': user['name'],
                             'role': user['role']}, {'Set-Cookie': cookie})

    def account_post(self, path):
        if path == '/api/logout':
            return self.send_json(200, {'ok': True}, {'Set-Cookie': f'{COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'})
        raw = self.read_body()
        try:
            payload = json.loads((raw or b'').decode('utf-8'))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {'ok': False, 'message': 'Invalid request.'})
        ip = self.client_ip()

        if path == '/api/login':
            username = clean(payload.get('username'), 80).lower()
            password = str(payload.get('password') or '')[:200]
            keys = (f'{ip}|{username}', f'ip|{ip}')
            if login_blocked(*keys):
                return self.send_json(429, {'ok': False, 'message': 'Too many wrong attempts. Please try again in 15 minutes.'})
            user = DB.get_user(username) if username else None
            stored = (user or {}).get('password_hash') or NO_SUCH_USER_HASH
            if not (check_password(password, stored) and user and user['password_hash']):
                note_failed_login(*keys)
                return self.send_json(401, {'ok': False, 'message': 'Wrong username or password.'})
            return self.finish_login(user)

        if path == '/api/login/google':
            info = verify_google(str(payload.get('credential') or ''))
            if not info:
                return self.send_json(401, {'ok': False, 'message': 'Google sign-in did not work. Please try again.'})
            username = 'google:' + info['sub']
            if not DB.get_user(username):  # customers who sign in with Google are always plain customers
                DB.add_user(username, None, 'user', clean(info.get('name') or info['email'], 80), clean(info['email'], 120))
            return self.finish_login(DB.get_user(username))

        # /api/password
        user = self.session_user()
        if not user or not user['password_hash']:
            return self.send_json(401, {'ok': False, 'message': 'Please sign in first.'})
        new = str(payload.get('new_password') or '')[:200]
        if not check_password(str(payload.get('old_password') or ''), user['password_hash']):
            return self.send_json(403, {'ok': False, 'message': 'The current password is wrong.'})
        if len(new) < 10:
            return self.send_json(422, {'ok': False, 'message': 'The new password needs at least 10 characters.'})
        DB.set_password(user['username'], hash_password(new))
        self.send_json(200, {'ok': True})

    # POST ------------------------------------------------------------------
    def do_POST(self):
        path = self.path.split('?', 1)[0]

        if path in ('/api/login', '/api/login/google', '/api/logout', '/api/password'):
            try:
                return self.account_post(path)
            except Exception as exc:  # database unreachable
                log(f'Account error: {exc!r}')
                return self.send_json(503, {'ok': False, 'message': 'Sign-in is not available right now. Please try again in a minute.'})

        m = re.fullmatch(r'/admin/orders/([A-Za-z0-9-]{1,32})/status', path)
        if m:
            if not self.authorised():
                return
            # Only accept the form from the admin page itself.
            origin = self.headers.get('Origin') or self.headers.get('Referer') or ''
            host = self.headers.get('Host', '')
            if origin and host and host not in origin:
                return self.send_body(403, 'Forbidden.', 'text/plain; charset=utf-8')
            raw = self.read_body() or b''
            status = (parse_qs(raw.decode('utf-8', 'replace')).get('status') or [''])[0]
            if status not in STATUSES:
                return self.send_body(400, 'Unknown status.', 'text/plain; charset=utf-8')
            DB.set_status(m.group(1), status)
            self.send_response(303)
            self.send_header('Location', '/admin')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return

        if path != '/api/orders':
            return self.send_json(404, {'ok': False, 'message': 'Not found'})

        raw = self.read_body()
        if raw is None:
            return self.send_json(400, {'ok': False, 'message': 'Invalid request.'})
        try:
            payload = json.loads(raw.decode('utf-8'))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {'ok': False, 'message': 'Invalid request.'})

        fields, errors = validate(payload, CATALOGUE)
        if errors:
            return self.send_json(422, {'ok': False, 'message': 'Please check the highlighted details.', 'errors': errors})

        # Signed in? Note the account on the order. (The app sends its token in the order itself.)
        account = self.session_user(str(payload.get('token') or '')[:600])
        if account:
            fields['customer']['account'] = account['email'] or account['username']

        request_id = clean(payload.get('request_id'), 64)
        try:
            existing = DB.find_by_request(request_id) if request_id else None
        except Exception as exc:
            log(f'Database error: {exc!r}')
            return self.send_json(503, {'ok': False, 'message': 'The order could not be saved right now. Please try again in a minute.'})
        if existing:  # a retry of an order already saved — not a new order
            return self.send_json(201, {'ok': True, 'order_id': existing[0], 'subtotal': existing[1], 'duplicate': True})
        if rate_limited(self.client_ip()):
            return self.send_json(429, {'ok': False, 'message': 'Too many orders from this phone. Please try again later.'})

        try:
            order_id, subtotal, duplicate = DB.create_order(fields, request_id)
        except Exception as exc:  # database unreachable
            log(f'Database error: {exc!r}')
            return self.send_json(503, {'ok': False, 'message': 'The order could not be saved right now. Please try again in a minute.'})

        # Reply first: the order is saved, nothing after this may stop the
        # customer from getting their order number.
        self.send_json(201, {'ok': True, 'order_id': order_id, 'subtotal': subtotal, 'duplicate': duplicate})
        log(f'{"Repeat of" if duplicate else "New order"} {order_id}: {fields["customer"]["name"]}, '
            f'{len(fields["items"])} item(s), Rs. {inr(subtotal)[1:]}')

    def log_message(self, fmt, *args):
        if self.path.startswith(('/api/', '/admin')):
            log('%s %s' % (self.client_ip(), fmt % args))


def log(msg):
    try:
        print(msg, flush=True)
    except Exception:  # a console that cannot print some characters must never matter
        pass


# --------------------------------------------------------------------- start
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

if not os.path.exists(CATALOGUE_FILE):
    raise SystemExit('catalogue.json is missing — run "python build_app.py" in the App folder first.')

CATALOGUE = load_catalogue()
DB = Database(DATABASE_URL, DATABASE_URL_UNPOOLED)
SECRET = DB.setting('session_secret', lambda: secrets.token_hex(32)).encode()
NO_SUCH_USER_HASH = hash_password('no such user')  # checked against when the username is unknown, so timing gives nothing away
seed_accounts()

if __name__ == '__main__':
    where = 'Postgres (DATABASE_URL)' if DB.postgres else f'SQLite file {SQLITE_FILE}'
    log(f'Naturia order server on http://{HOST}:{PORT}  ·  database: {where}  ·  '
        f'admin: {"on (user " + ADMIN_USER + ")" if ADMIN_PASSWORD else "OFF — set ADMIN_PASSWORD"}')
    ThreadingHTTPServer.request_queue_size = 128  # a page opens ~40 connections at once; the default of 5 drops some
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
