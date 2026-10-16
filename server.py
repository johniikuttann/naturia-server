"""
Naturia — order server.

Runs on Render (free web service) with a Neon Postgres database, or on this
PC with a local SQLite file for testing.

    python server.py

Environment variables
    DATABASE_URL     Postgres connection string (Neon). Not set → local SQLite file orders.db
    ADMIN_USER       admin login name (default: admin)
    ADMIN_PASSWORD   admin password. Not set → the admin pages are switched off
    PORT             set by Render; locally defaults to 8787

Endpoints
    POST /api/orders                    the app sends an order here (JSON)
    GET  /api/health                    "is the server up?" (also wakes it on Render)
    GET  /admin                         orders page for the shop owner        (login)
    POST /admin/orders/<id>/status      change an order's status              (login)
    GET  /admin/orders.csv              download every order as a spreadsheet (login)
    GET  /api/orders                    every order as JSON                   (login)

Prices are never taken from the phone: every item is checked and priced
against catalogue.json, which App/build_app.py exports from the product list.
"""
import base64
import contextlib
import csv
import hmac
import html
import io
import json
import os
import re
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOGUE_FILE = os.path.join(HERE, 'catalogue.json')
SQLITE_FILE = os.path.join(HERE, 'orders.db')
# Local testing only: the app's pages, so the app can also be tried in a browser.
WWW = os.path.normpath(os.path.join(HERE, '..', 'android-project', 'app', 'src', 'main', 'assets', 'www'))

ON_RENDER = 'PORT' in os.environ
HOST = '0.0.0.0' if ON_RENDER else '127.0.0.1'
PORT = int(os.environ.get('PORT', '8787'))

DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
ADMIN_USER = os.environ.get('ADMIN_USER', 'admin').strip() or 'admin'
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')

MAX_QTY = 100          # sacks per product per order
MAX_BODY = 64 * 1024
ORDERS_PER_HOUR = 20   # per phone / IP address, to stop spam
STATUSES = ['new', 'confirmed', 'dispatched', 'delivered', 'cancelled']
IST = timezone(timedelta(hours=5, minutes=30))

PHONE_RE = re.compile(r'^(?:\+?91)?[6-9]\d{9}$')
PIN_RE = re.compile(r'^[1-9]\d{5}$')


# --------------------------------------------------------------------- database
class Database:
    """Same SQL on Postgres (Neon) and SQLite (local); only placeholders differ."""

    def __init__(self, url):
        self.url = url
        self.postgres = url.startswith(('postgres://', 'postgresql://'))
        self.lock = threading.Lock()
        if self.postgres:
            import psycopg  # installed on Render from requirements.txt
            self.driver = psycopg
        self._create_table()

    def connect(self):
        if self.postgres:
            return self.driver.connect(self.url, connect_timeout=15)
        conn = sqlite3.connect(SQLITE_FILE, timeout=15)
        return conn

    def q(self, sql):
        return sql.replace('?', '%s') if self.postgres else sql

    def run(self, sql, params=(), fetch=None):
        # SQLite (local file) allows one writer at a time; Postgres handles its own locking.
        with self.lock if not self.postgres else contextlib.nullcontext():
            conn = self.connect()
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
        )''')

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


def inr(n):
    s = str(int(round(n)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        s = re.sub(r'\B(?=(\d{2})+(?!\d))', ',', head) + ',' + tail
    return '₹' + s


# --------------------------------------------------------------------- admin page
def admin_page(orders):
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
              {f'<p class="notes">Note: {html.escape(c["notes"])}</p>' if c.get("notes") else ''}</div>
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
<body><div class="wrap">
  <div class="top">
    <div><h1>Naturia — Orders</h1>
      <p class="sub">{len(orders)} order(s): {summary} · open orders worth {inr(open_value)}</p></div>
    <div><a class="btn" href="/admin/orders.csv">Download CSV</a> <a class="btn" href="/admin">Refresh</a></div>
  </div>
  {body}
</div></body></html>'''


def orders_csv(orders):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(['Order', 'Date (IST)', 'Status', 'Name', 'Phone', 'Address', 'PIN', 'Notes', 'Items', 'Total (Rs)', 'Payment'])
    for o in orders:
        c = o['customer']
        items = '; '.join(f'{i["name"]} x {i["qty"]}' for i in o['items'])
        w.writerow([o['order_id'], o['created_at'], o['status'], c['name'], c['phone'], c['address'],
                    c['pincode'], c.get('notes', ''), items, int(round(o['subtotal'])), o['payment']])
    return '﻿' + out.getvalue()  # BOM so Excel opens ₹ / Malayalam correctly


# --------------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    server_version = 'Naturia'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WWW, **kwargs)

    # helpers ---------------------------------------------------------------
    def client_ip(self):
        fwd = self.headers.get('X-Forwarded-For', '')
        return fwd.split(',')[0].strip() if fwd else self.client_address[0]

    def send_body(self, status, body, ctype, extra=None):
        data = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, data):
        self.send_body(status, json.dumps(data, ensure_ascii=False), 'application/json; charset=utf-8')

    def authorised(self):
        """HTTP Basic login for the admin pages."""
        if not ADMIN_PASSWORD:
            self.send_body(503, 'Admin is switched off: set the ADMIN_PASSWORD environment variable.',
                           'text/plain; charset=utf-8')
            return False
        header = self.headers.get('Authorization', '')
        if header.startswith('Basic '):
            try:
                user, _, pwd = base64.b64decode(header[6:]).decode('utf-8').partition(':')
            except Exception:
                user, pwd = '', ''
            if hmac.compare_digest(user, ADMIN_USER) and hmac.compare_digest(pwd, ADMIN_PASSWORD):
                return True
        self.send_body(401, 'Login required.', 'text/plain; charset=utf-8',
                       {'WWW-Authenticate': 'Basic realm="Naturia admin", charset="UTF-8"'})
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
        if path == '/api/orders':
            if self.authorised():
                return self.send_json(200, DB.list_orders())
            return
        if path in ('/admin', '/admin/'):
            if self.authorised():
                return self.send_body(200, admin_page(DB.list_orders()), 'text/html; charset=utf-8')
            return
        if path == '/admin/orders.csv':
            if self.authorised():
                name = 'naturia-orders-' + datetime.now(IST).strftime('%Y-%m-%d') + '.csv'
                return self.send_body(200, orders_csv(DB.list_orders()), 'text/csv; charset=utf-8',
                                      {'Content-Disposition': f'attachment; filename="{name}"'})
            return
        if os.path.isdir(WWW) and not ON_RENDER:
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

    # POST ------------------------------------------------------------------
    def do_POST(self):
        path = self.path.split('?', 1)[0]

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
DB = Database(DATABASE_URL)

if __name__ == '__main__':
    where = 'Postgres (DATABASE_URL)' if DB.postgres else f'SQLite file {SQLITE_FILE}'
    log(f'Naturia order server on http://{HOST}:{PORT}  ·  database: {where}  ·  '
        f'admin: {"on (user " + ADMIN_USER + ")" if ADMIN_PASSWORD else "OFF — set ADMIN_PASSWORD"}')
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
