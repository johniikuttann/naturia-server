/**
 * Naturia (app only) — small behaviour fixes found while testing the app.
 * The website's own files are not changed; these run on top of them.
 */
(function() {
    'use strict';

    /*
     * 1. Section links that name a page, e.g. "index.html#curated" (bottom bar
     *    "Categories" / "Curated", header "Curated Collections").
     *
     * When the page is already open, scroll to the section ourselves. With the
     * theme's CSS smooth scrolling, a second fragment jump could start late or
     * land on the previously tapped section. Plain "#..." links (product tabs,
     * "On this page" lists, star ratings) are left to their own handlers.
     */
    document.addEventListener('click', function(e) {
        const link = e.target.closest && e.target.closest('a[href]');
        if (!link || e.defaultPrevented) return;

        const href = link.getAttribute('href');
        const hashAt = href.indexOf('#');
        if (hashAt <= 0) return; // no "#", or a bare "#section" link

        const url = new URL(href, window.location.href);
        if (url.pathname !== window.location.pathname || url.search !== window.location.search) return;

        const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if (!target) return;

        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.location.hash !== url.hash) {
            history.replaceState(null, '', url.hash);
        }
    });

    /*
     * 1b. Keep jumped-to sections clear of the sticky header.
     *
     * The theme reserves a fixed 7rem (112px) above section anchors, but on a
     * phone the header (logo row + search bar + category tabs) is about 170px
     * tall, so headings like "Curated For Your Plants" landed underneath it.
     * Measure the real header height and expose it to app.css.
     */
    function syncHeaderHeight() {
        const header = document.querySelector('header.sticky, #page > header');
        if (header) {
            document.documentElement.style.setProperty('--vda-header-h', header.offsetHeight + 'px');
        }
        // Also the bottom bar's height, so the cookie banner can sit above it (app.css).
        const bar = document.querySelector('.mobile-bottom-nav');
        if (bar && bar.offsetHeight) {
            document.documentElement.style.setProperty('--vda-bottom-nav-h', bar.offsetHeight + 'px');
        }
    }
    syncHeaderHeight();
    document.addEventListener('DOMContentLoaded', syncHeaderHeight);
    window.addEventListener('load', syncHeaderHeight);
    window.addEventListener('resize', syncHeaderHeight);

    /*
     * 2. Product review form: the email field was never checked, so any text
     *    (e.g. "abc") was accepted. Runs in the capture phase, before the
     *    form's own submit handler, and stops a bad email from being posted.
     */
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    document.addEventListener('submit', function(e) {
        const form = e.target.closest && e.target.closest('[data-vda-review-form]');
        if (!form) return;

        const email = form.querySelector('#email');
        if (email && email.value.trim() !== '' && !EMAIL_RE.test(email.value.trim())) {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.alert('Please enter a valid email address.');
            email.focus();
        }
    }, true);
})();
