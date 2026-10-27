/**
 * Naturia — sign-in helper, loaded on every page (website and app).
 *
 * Keeps the sign-in token in the phone/browser, talks to the order server, and shows
 * an "Account" entry in the bottom menu and the header ("Sign in", or the first name).
 * The sign-in page itself is login.html.
 */
(function() {
    'use strict';

    const TOKEN = 'naturia_token';
    const USER = 'naturia_user';
    // The app's pages run from their own address, so there the server is named in full.
    const SERVER = window.PeelMarketNative ? 'https://naturia-orders.onrender.com' : '';

    function read(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }

    function store(key, value) {
        try {
            if (value === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, value);
        } catch (e) { /* private browsing: stay signed out */ }
    }

    function saved() {
        try { return JSON.parse(read(USER) || 'null'); } catch (e) { return null; }
    }

    function call(path, body) {
        const headers = { 'Content-Type': 'application/json' };
        const token = read(TOKEN);
        if (token) headers.Authorization = 'Bearer ' + token;
        return fetch(SERVER + path, {
            method: body ? 'POST' : 'GET',
            headers: headers,
            body: body ? JSON.stringify(body) : undefined,
            cache: 'no-store'
        }).then(function(res) {
            return res.json().catch(function() { return {}; }).then(function(data) {
                data.status = res.status;
                return data;
            });
        }).catch(function() {
            return { ok: false, status: 0, message: 'Could not reach the server. Please check your internet and try again.' };
        });
    }

    window.NaturiaAuth = {
        server: SERVER,
        adminUrl: SERVER + '/admin',
        user: saved,
        call: call,
        signedIn: function(data) {
            store(TOKEN, data.token);
            store(USER, JSON.stringify({ name: data.name, role: data.role, username: data.username }));
        },
        signedOut: function() {
            store(TOKEN, null);
            store(USER, null);
        }
    };

    /* ------------------------------------------------------------------
       "Account" entry in the header (computers) and the bottom menu (phones)
       ------------------------------------------------------------------ */
    function decorate() {
        const user = saved();
        const first = user ? (user.name || 'Account').split(' ')[0].slice(0, 12) : 'Sign in';

        document.querySelectorAll('a').forEach(function(a) {
            if (!a.hasAttribute('data-naturia-account') && !/My Account/.test(a.textContent)) return;
            a.setAttribute('data-naturia-account', '');
            a.setAttribute('href', 'login.html');
            const spans = a.querySelectorAll('span');
            if (spans.length >= 2) {
                spans[0].textContent = user ? 'Signed in' : 'Welcome';
                spans[1].textContent = first;
            }
        });

        const nav = document.querySelector('.mobile-bottom-nav');
        if (!nav) return;
        let item = nav.querySelector('[data-naturia-nav]');
        if (!item) {
            item = document.createElement('a');
            item.className = 'mobile-nav-btn';
            item.setAttribute('data-naturia-nav', '');
            item.setAttribute('href', 'login.html');
            item.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
                '<path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg><span></span>';
            nav.appendChild(item);
        }
        item.lastElementChild.textContent = first;
    }

    document.addEventListener('DOMContentLoaded', function() {
        decorate();
        // Still signed in? (the account may have been removed, or the sign-in may have run out)
        if (!read(TOKEN)) return;
        call('/api/me').then(function(data) {
            if (data.status === 401) {
                window.NaturiaAuth.signedOut();
            } else if (data.ok) {
                store(USER, JSON.stringify({ name: data.name, role: data.role, username: data.username }));
            }
            decorate();
        });
    });
})();
