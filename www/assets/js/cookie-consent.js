/**
 * Venu's Digital Arcade — Cookie Consent Engine
 *
 * Behaviour:
 *  - Nothing optional runs until the visitor actively allows it.
 *  - Scripts marked <script type="text/plain" data-vda-consent="analytics">
 *    are inert to the browser and are only activated after consent.
 *  - Choices persist in localStorage and can be reopened from the footer.
 *  - "Reject all" is offered with the same prominence as "Accept all".
 */
(function () {
    'use strict';

    var CONFIG = window.VDA_CONSENT_CONFIG || {};
    var STORAGE_KEY = CONFIG.storageKey || 'vda_cookie_consent';
    var VERSION = String(CONFIG.version || '1');
    var CATEGORIES = CONFIG.categories || ['necessary', 'functional', 'analytics', 'marketing'];

    var OPTIONAL = CATEGORIES.filter(function (c) { return c !== 'necessary'; });

    var lastFocused = null;

    /* ---------------------------------------------------------------- state */

    function readConsent() {
        try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;

            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;

            // A version bump invalidates old consent and re-prompts.
            if (String(parsed.v) !== VERSION) return null;

            return parsed;
        } catch (e) {
            return null;
        }
    }

    function writeConsent(choices) {
        var payload = { v: VERSION, ts: new Date().toISOString(), necessary: true };

        OPTIONAL.forEach(function (category) {
            payload[category] = !!choices[category];
        });

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            // Private browsing — consent applies for this page view only.
        }

        return payload;
    }

    /* -------------------------------------------------------- script gating */

    /**
     * Activate scripts whose category has been consented to.
     * A blocked script is inert because its type is text/plain; we clone it
     * into a real <script> so the browser executes it.
     */
    function releaseScripts(consent) {
        var blocked = document.querySelectorAll('script[type="text/plain"][data-vda-consent]');

        Array.prototype.forEach.call(blocked, function (node) {
            var category = node.getAttribute('data-vda-consent');

            if (!consent[category]) {
                return;
            }

            var activated = document.createElement('script');
            var src = node.getAttribute('data-vda-src');

            Array.prototype.forEach.call(node.attributes, function (attr) {
                if (['type', 'data-vda-consent', 'data-vda-src'].indexOf(attr.name) === -1) {
                    activated.setAttribute(attr.name, attr.value);
                }
            });

            if (src) {
                activated.src = src;
            } else {
                activated.textContent = node.textContent;
            }

            node.parentNode.replaceChild(activated, node);
        });
    }

    function applyConsent(consent) {
        releaseScripts(consent);

        document.documentElement.setAttribute(
            'data-vda-consent-state',
            OPTIONAL.filter(function (c) { return consent[c]; }).join(' ') || 'necessary-only'
        );

        document.dispatchEvent(new CustomEvent('vda:consentUpdated', { detail: consent }));
    }

    /* ------------------------------------------------------------------- ui */

    function el(id) { return document.getElementById(id); }

    function show(node) {
        if (!node) return;
        node.hidden = false;
        node.classList.remove('hidden');
    }

    function hide(node) {
        if (!node) return;
        node.hidden = true;
        node.classList.add('hidden');
    }

    function showBanner() { show(el('vda-cookie-banner')); }
    function hideBanner() { hide(el('vda-cookie-banner')); }

    function openPreferences() {
        var panel = el('vda-cookie-preferences');
        if (!panel) return;

        lastFocused = document.activeElement;

        // Reflect saved choices; unsaved optional categories stay unticked.
        var consent = readConsent();
        OPTIONAL.forEach(function (category) {
            var box = panel.querySelector('[data-vda-consent-category="' + category + '"]');
            if (box) {
                box.checked = consent ? !!consent[category] : false;
            }
        });

        show(panel);
        document.body.style.overflow = 'hidden';

        var focusable = panel.querySelector('input:not([disabled]), button');
        if (focusable) focusable.focus();
    }

    function closePreferences() {
        var panel = el('vda-cookie-preferences');
        if (!panel) return;

        hide(panel);
        document.body.style.overflow = '';

        if (lastFocused && typeof lastFocused.focus === 'function') {
            lastFocused.focus();
        }

        // If they closed without ever deciding, keep asking.
        if (!readConsent()) {
            showBanner();
        }
    }

    function collectFromPanel() {
        var panel = el('vda-cookie-preferences');
        var choices = {};

        OPTIONAL.forEach(function (category) {
            var box = panel ? panel.querySelector('[data-vda-consent-category="' + category + '"]') : null;
            choices[category] = box ? box.checked : false;
        });

        return choices;
    }

    function decide(choices) {
        var consent = writeConsent(choices);
        applyConsent(consent);
        hideBanner();
        closePreferences();
    }

    function allOf(value) {
        var choices = {};
        OPTIONAL.forEach(function (category) { choices[category] = value; });
        return choices;
    }

    /* -------------------------------------------------------------- wiring */

    function onAction(event) {
        var trigger = event.target.closest ? event.target.closest('[data-vda-consent-action]') : null;
        if (!trigger) return;

        var action = trigger.getAttribute('data-vda-consent-action');

        if (action === 'accept-all') {
            event.preventDefault();
            decide(allOf(true));
        } else if (action === 'reject-all') {
            event.preventDefault();
            decide(allOf(false));
        } else if (action === 'save') {
            event.preventDefault();
            decide(collectFromPanel());
        } else if (action === 'open-preferences') {
            event.preventDefault();
            hideBanner();
            openPreferences();
        } else if (action === 'close-preferences') {
            event.preventDefault();
            closePreferences();
        }
    }

    function init() {
        document.addEventListener('click', onAction);

        document.addEventListener('keydown', function (e) {
            var panel = el('vda-cookie-preferences');
            if (e.key === 'Escape' && panel && !panel.hidden) {
                closePreferences();
            }
        });

        var consent = readConsent();

        if (consent) {
            applyConsent(consent);
        } else {
            showBanner();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public handle so the footer link (or any other control) can reopen it.
    window.VDAConsent = {
        open: openPreferences,
        get: readConsent
    };
})();
