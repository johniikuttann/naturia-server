# Naturia — order server

Receives orders from the Naturia Android app **and the Naturia website**, stores them in a
Postgres database (Neon), and gives the shop owner a password-protected orders page. Orders from
the app and the website land in the same list. Customers and the shop owner can sign in
(username + password, or Google); only an admin account sees the orders.

**Live:** https://naturia-orders.onrender.com (orders page: `/admin`). Render service
`naturia-orders` (free, Singapore), auto-deployed from this repository's `main` branch. Database:
Neon project `naturia` (Singapore).

## Endpoints

| URL | What it does | Login |
|---|---|---|
| `GET /` and the other pages | The Naturia website, served from the `www/` folder. Ordering there uses the same `/api/orders` | — |
| `POST /api/orders` | The app and the website send orders here | — |
| `GET /api/health` | "Is the server up?" (also wakes it on Render's free plan) | — |
| `GET /login.html` | Sign-in page (website and app). Admins get an **Open admin orders** button | — |
| `POST /api/login`, `/api/login/google`, `/api/logout`, `/api/password` | Sign in, sign in with Google, sign out, change your own password | — |
| `GET /api/me`, `/api/config` | Who is signed in; public settings for the login page | — |
| `GET /admin` | Orders page: change status, call customers (browsers are sent to the login page first) | admin |
| `GET /admin/orders.csv` | Download every order as a spreadsheet | admin |
| `GET /api/orders` | Every order as JSON | admin |
| `GET /api/app-version?version=2.0.0` | The app asks "is a newer app published?" Drives the **Update app** button | — |
| `GET /download/latest` | Sends the phone to the APK named in `update.json` | — |

## Settings (environment variables)

| Name | Meaning |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host has `-pooler`), used for order traffic. Without it the server uses a local file `orders.db` (testing only) |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection string, used only to create the table. Optional |
| `ADMIN_USER` | Older shared admin login name (default `admin`) |
| `ADMIN_PASSWORD` | Older shared admin password. Still works as a back-up way into `/admin`, next to the admin account below |
| `GOOGLE_CLIENT_ID` | Turns on "Sign in with Google" (see below). Without it the Google button is hidden |
| `ALLOWED_ORIGINS` | Extra web addresses allowed to call `/api` from a browser (comma separated). The app's own address is built in |
| `PORT` | Set automatically by Render |

## Accounts and sign-in

Accounts are stored in the database (tables `users` and `settings`). Passwords are kept only as
scrypt hashes, never as text. Signing in gives a signed token (30 days) that the app keeps on the
phone; the website also gets a cookie so `/admin` opens in the browser.

- **Two accounts are created on first start** from `accounts.seed.json`: one `admin` and one
  customer (`user`). The file holds only the usernames and password *hashes*. A password that is
  changed later is never overwritten by a restart. The first passwords were handed to the owner
  privately, not stored in this repository.
- **Roles.** `admin`: sees the shop and `/admin` (all orders). `user`: sees the shop only. People
  who sign in with Google become `user` accounts. Orders placed while signed in note the account.
- **The orders page updates itself.** `/admin` checks for new orders every 15 seconds and reloads when
  one arrives (if you are in the middle of changing a status it waits and tells you instead).
- **Change a password:** sign in → **Account → Change password**.
- **Wrong passwords:** 10 wrong tries per phone and username in 15 minutes, then a 15 minute wait.
- **Make a new account:** run a small script to make a hash (`hashlib.scrypt`, see `hash_password`
  in `server.py`) and add the entry to `accounts.seed.json`.
- **The older shared admin login** (`ADMIN_USER` / `ADMIN_PASSWORD`) still opens `/admin`. Remove
  `ADMIN_PASSWORD` in Render's Environment tab once you no longer want it.

### Turning on "Sign in with Google"

1. Google Cloud console → create a project → **APIs & Services → OAuth consent screen** (External)
   → fill in the app name and your email.
2. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized
   JavaScript origins** add `https://naturia-orders.onrender.com`. Copy the **Client ID**.
3. Render → service → **Environment** → add `GOOGLE_CLIENT_ID` = that Client ID. The server
   restarts and the Google button appears on the sign-in page.

Google may refuse to open its sign-in inside an Android WebView. The website works in any browser.
For a reliable button inside the app itself, the Android code needs Google's own sign-in library
(a new build of the app).

## Deploy on Render

`render.yaml` describes everything: Render → **New → Blueprint** → choose this repository →
paste the Neon connection string for `DATABASE_URL` → **Apply**. Render creates a random
`ADMIN_PASSWORD`; find it under the service's **Environment** tab.

## Run locally

```bash
python server.py
```

The server runs at http://localhost:8787 (set `ADMIN_PASSWORD` to open `/admin`).

- **With Neon:** this folder is linked to the Neon project `naturia` (`neon.ts`, `.neon`).
  `neon deploy` writes `DATABASE_URL` / `DATABASE_URL_UNPOOLED` to `.env.local`, which the server
  reads automatically. It needs `pip install -r requirements.txt` (psycopg). `.env.local` holds the
  database password and is never committed.
- **Without Neon:** no extra packages needed. Orders go to a local `orders.db` file.

## The website (`www/`)

`www/` holds the same pages as the app. Edit a page or `www/assets/js/data.js` (products), commit
and push; Render redeploys and the website changes. **When you change a price, change
`catalogue.json` too**: the website shows `data.js`, but the server charges `catalogue.json`.

## Publishing an app update

The app shows a green **Update app** button only when `update.json` lists a newer version than
the one installed. Nothing else needs changing on the server.

The newest APK lives in this repository as `apk/Naturia.apk`. `update.json` says which version it is.

1. In the Android project raise `versionCode` and `versionName` in `app/build.gradle`, and set
   `APP_VERSION` in `assets/js/app-update.js` to the same `versionName`.
2. Build the APK and sign it with the **same keystore** as before (otherwise phones refuse it).
3. Publish it with one command (it checks that the file is an APK, that its version number is the
   one you typed, and that the version is not older than the last one):

   ```bash
   python publish_apk.py C:\path\to\Naturia.apk 2.1.0 "Short line shown under the button"
   ```
4. Commit and push (`git add apk update.json`, `git commit -m "App 2.1.0"`, `git push`). Render
   redeploys in about 2 minutes; the button then appears on phones with an older version. Tapping it
   downloads the APK; Android asks to install it (the first time, it also asks to allow installs
   from the browser).

`https://naturia-orders.onrender.com/download/latest` always gives the newest APK, so it is the link
to share with new customers. If `apk_url` is empty, or the file is broken, no phone sees a button.
To switch updates off, set `latest_version` back to the version people already have. Each version
stays in the git history, so an old one can be brought back.

`client/app-update.js` is the app side. Copy it to the Android project's `assets/js/` and load it
after `app-fixes.js` on every page. The sign-in files (`www/login.html`, `www/assets/js/auth.js`,
and the script line for `auth.js` on every page) must be copied into the app the same way. Phones can only get the button by installing one new APK that
contains it; after that, every later update arrives through the button.

## Updating prices or products

`catalogue.json` is generated by `App/build_app.py` from the product list. The server prices
every order from this file, never from the phone. After changing products, rebuild, then commit
and push `catalogue.json`; Render redeploys automatically.
