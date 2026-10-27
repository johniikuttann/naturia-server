/**
 * Naturia (app only) — "Update app" button.
 *
 * Asks the order server whether a newer app is published (GET /api/app-version).
 * The button does not exist on the page unless the server says yes. Tapping it
 * opens the APK download in the phone's browser; Android then asks to install it.
 *
 * Every release: set APP_VERSION to the versionName in android-project/app/build.gradle.
 * Copy this file to assets/js/ and load it after app-fixes.js on every page.
 */
(function() {
    'use strict';

    const APP_VERSION = '2.0.0';
    const SERVER = 'https://naturia-orders.onrender.com';

    let button = null;

    function show(info) {
        if (!button) {
            const style = document.createElement('style');
            style.textContent =
                '.vda-update-btn{position:fixed;left:12px;right:12px;bottom:calc(var(--vda-bottom-nav-h,64px) + 12px);' +
                'z-index:9998;display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px 16px;' +
                'border-radius:14px;background:#4E7A36;color:#fff;font:700 15px/1.3 system-ui,sans-serif;' +
                'text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.25)}' +
                '.vda-update-btn small{font-weight:400;font-size:12px;opacity:.9}' +
                '.vda-update-btn[hidden]{display:none}';
            document.head.appendChild(style);
            button = document.createElement('a');
            button.className = 'vda-update-btn';
            document.body.appendChild(button);
        }
        button.href = SERVER + info.download_url;
        button.textContent = 'Update app' + (info.latest_version ? ' to v' + info.latest_version : '');
        if (info.notes) {
            const note = document.createElement('small');
            note.textContent = info.notes;
            button.appendChild(note);
        }
        button.hidden = false;
    }

    function check() {
        if (!window.PeelMarketNative) return; // a normal browser has nothing to update
        const ctl = window.AbortController ? new AbortController() : null;
        const timer = ctl ? window.setTimeout(function() { ctl.abort(); }, 20000) : 0;
        fetch(SERVER + '/api/app-version?version=' + encodeURIComponent(APP_VERSION), {
            cache: 'no-store',
            signal: ctl ? ctl.signal : undefined
        }).then(function(res) {
            return res.ok ? res.json() : null;
        }).then(function(info) {
            if (info && info.update_available && info.download_url) show(info);
            else if (button) button.hidden = true;
        }).catch(function() {
            /* offline or the free server is still waking up: no button this time */
        }).finally(function() {
            window.clearTimeout(timer);
        });
    }

    document.addEventListener('DOMContentLoaded', check);
})();
