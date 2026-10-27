/**
 * Naturia (app only) — checkout.
 *
 * The bag page (cart.html) gets a "Delivery Details" form. Placing an order
 * sends the bag + customer details to the Naturia order server:
 *   - inside the Android app: through the native bridge (window.PeelMarketNative),
 *     which posts to the server address in App/app-config.json;
 *   - in a normal browser (pages served by server.py): straight to /api/orders.
 * The server re-prices every item itself, so prices from the phone are never trusted.
 */
(function() {
    'use strict';

    const CART_KEY = 'vda_cart';
    const PHONE_RE = /^(?:\+?91)?[6-9]\d{9}$/;
    const PIN_RE = /^[1-9]\d{5}$/;

    function readCart() {
        try {
            const items = JSON.parse(window.localStorage.getItem(CART_KEY) || '[]');
            const known = (window.VDA_PRODUCTS || []).map(function(p) { return p.id; });
            return Array.isArray(items) ? items.filter(function(i) { return known.indexOf(i.id) !== -1 && i.qty > 0; }) : [];
        } catch (e) {
            return [];
        }
    }

    function signInToken() {
        try { return window.localStorage.getItem('naturia_token') || ''; } catch (e) { return ''; }
    }

    function clearCart() {
        try { window.localStorage.setItem(CART_KEY, '[]'); } catch (e) { /* ignore */ }
        if (window.VDAStore) window.VDAStore.renderCart();
    }

    /* ------------------------------------------------------------------
       Sending the order
       ------------------------------------------------------------------ */
    const pending = {};
    let seq = 0;

    /*
     * One id per checkout attempt. If the reply is lost and the customer taps
     * Place Order again, the server recognises the id and returns the order it
     * already saved, so no duplicate is created. A new id is made after a
     * successful order or when the bag changes.
     */
    let requestId = null;
    let requestBag = '';

    function requestIdFor(items) {
        const bag = JSON.stringify(items);
        if (!requestId || bag !== requestBag) {
            requestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            requestBag = bag;
        }
        return requestId;
    }

    // Called by the native bridge when the server answers.
    window.PeelMarketOrder = {
        _done: function(id, status, body) {
            const resolve = pending[id];
            delete pending[id];
            if (resolve) resolve({ status: status, body: body });
        }
    };

    function send(payload) {
        const json = JSON.stringify(payload);

        if (window.PeelMarketNative && typeof window.PeelMarketNative.placeOrder === 'function') {
            return new Promise(function(resolve) {
                const id = 'o' + (++seq);
                pending[id] = resolve;
                window.PeelMarketNative.placeOrder(json, id);
            });
        }

        return fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: json
        }).then(function(res) {
            return res.text().then(function(text) { return { status: res.status, body: text }; });
        }).catch(function() {
            return { status: 0, body: '' };
        });
    }

    /* ------------------------------------------------------------------
       Form
       ------------------------------------------------------------------ */
    function fieldError(form, name, message) {
        const input = form.querySelector('[name="' + name + '"]');
        const slot = form.querySelector('[data-error-for="' + name + '"]');
        if (input) {
            input.classList.toggle('is-invalid', !!message);
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
        }
        if (slot) {
            slot.textContent = message || '';
            slot.hidden = !message;
        }
    }

    function showMessage(form, message) {
        const box = form.querySelector('[data-vda-order-message]');
        if (!box) return;
        box.textContent = message || '';
        box.hidden = !message;
    }

    function validate(form) {
        const v = {
            name: form.name.value.trim(),
            phone: form.phone.value.replace(/[\s-]/g, ''),
            address: form.address.value.trim(),
            pincode: form.pincode.value.trim(),
            notes: form.notes.value.trim()
        };
        const errors = {};
        if (v.name.length < 2) errors.name = 'Please enter your name.';
        if (!PHONE_RE.test(v.phone)) errors.phone = 'Please enter a valid 10-digit mobile number.';
        if (v.address.length < 10) errors.address = 'Please enter your full delivery address.';
        if (!PIN_RE.test(v.pincode)) errors.pincode = 'Please enter a valid 6-digit PIN code.';

        ['name', 'phone', 'address', 'pincode'].forEach(function(f) { fieldError(form, f, errors[f]); });
        return { values: v, errors: errors };
    }

    function refreshEmptyState() {
        const section = document.querySelector('[data-vda-order]');
        if (!section || !section.querySelector('[data-vda-order-success]').hidden) return;
        const empty = readCart().length === 0;
        section.querySelector('[data-vda-order-form]').hidden = empty;
        section.querySelector('[data-vda-order-empty]').hidden = !empty;
    }

    function bindForm() {
        const section = document.querySelector('[data-vda-order]');
        if (!section) return;
        const form = section.querySelector('[data-vda-order-form]');
        const button = form.querySelector('[type="submit"]');
        const buttonLabel = button.querySelector('span');

        // Clear a field's error as soon as the customer edits it.
        form.addEventListener('input', function(e) {
            if (e.target.name) fieldError(form, e.target.name, '');
            showMessage(form, '');
        });

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            showMessage(form, '');

            const items = readCart();
            if (!items.length) {
                refreshEmptyState();
                return;
            }

            const check = validate(form);
            if (Object.keys(check.errors).length) {
                const first = form.querySelector('.is-invalid');
                if (first) first.focus();
                return;
            }

            button.disabled = true;
            buttonLabel.textContent = 'Placing order…';
            // The free server sleeps when idle and can take up to a minute to
            // wake; tell the customer instead of leaving the button looking stuck.
            const slowTimer = window.setTimeout(function() {
                buttonLabel.textContent = 'Connecting to server… (up to a minute)';
            }, 4000);

            const lines = items.map(function(i) { return { id: i.id, qty: i.qty }; });

            send({
                request_id: requestIdFor(lines),
                customer: check.values,
                items: lines,
                token: signInToken() // lets the server note the signed-in account on the order
            }).then(function(res) {
                let data = {};
                try { data = JSON.parse(res.body || '{}'); } catch (err) { data = {}; }

                if (res.status === 201 && data.ok) {
                    requestId = null;
                    clearCart();
                    form.reset();
                    form.hidden = true;
                    const success = section.querySelector('[data-vda-order-success]');
                    success.querySelector('[data-vda-order-id]').textContent = data.order_id;
                    success.querySelector('[data-vda-order-phone]').textContent = check.values.phone.slice(-10);
                    success.hidden = false;
                    // Wait for the form to collapse, then centre the message so
                    // the sticky header never covers it.
                    window.requestAnimationFrame(function() {
                        success.scrollIntoView({ block: 'center' });
                    });
                    return;
                }

                if (res.status === 422 && data.errors) {
                    Object.keys(data.errors).forEach(function(f) { fieldError(form, f, data.errors[f]); });
                    showMessage(form, data.errors.items || data.message || 'Please check your details.');
                    return;
                }

                if (res.status === 0) {
                    showMessage(form, 'Could not reach the order server. Please check your connection and try again. Your bag has been kept.');
                } else {
                    showMessage(form, (data && data.message) || 'Something went wrong while placing your order. Please try again.');
                }
            }).finally(function() {
                window.clearTimeout(slowTimer);
                button.disabled = false;
                buttonLabel.textContent = 'Place Order';
            });
        });

        // Keep the form / empty note in sync with the bag.
        const subtotal = document.querySelector('[data-vda-cart-subtotal]');
        if (subtotal && window.MutationObserver) {
            new MutationObserver(refreshEmptyState).observe(subtotal, { childList: true, characterData: true, subtree: true });
        }
        window.addEventListener('storage', refreshEmptyState);
        refreshEmptyState();

        // Arriving from the drawer's "Place Order" (cart.html#vda-order): the
        // browser jumps to the form before the bag rows are drawn above it,
        // which then pushes the form down out of view. Scroll again now that
        // the page is complete.
        if (window.location.hash === '#vda-order') {
            window.requestAnimationFrame(function() {
                section.scrollIntoView({ block: 'start' });
            });
        }
    }

    /* ------------------------------------------------------------------
       Drawer "Place Order" button: on the bag page itself, close the
       drawer and scroll to the form instead of reloading.
       ------------------------------------------------------------------ */
    document.addEventListener('click', function(e) {
        const link = e.target.closest && e.target.closest('[data-vda-place-order]');
        if (!link) return;
        const section = document.querySelector('[data-vda-order]');
        if (!section) return; // other pages: follow the link to cart.html#vda-order
        e.preventDefault();
        const close = document.getElementById('cart-drawer-close');
        if (close) close.click();
        section.scrollIntoView({ block: 'start' });
    });

    document.addEventListener('DOMContentLoaded', bindForm);
})();
