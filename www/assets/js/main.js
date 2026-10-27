/**
 * Naturia - Main JavaScript Engine (Modern Caramel & Beige Edition)
 *
 * Static HTML edition: identical behaviour to the WordPress theme's main.js,
 * except that the admin-ajax.php calls now go to window.VDAStore (site.js),
 * which keeps the cart and the chosen branch in localStorage.
 */

document.addEventListener('DOMContentLoaded', function() {
    'use strict';

    // 1. Initialize Swiper.js for Lifestyle Hero Banner Carousel
    if (typeof Swiper !== 'undefined') {
        new Swiper('.hero-promo-swiper', {
            loop: true,
            autoplay: {
                delay: 5000,
                disableOnInteraction: false,
            },
            pagination: {
                el: '.swiper-pagination',
                clickable: true,
            },
            speed: 700,
        });
    }

    // 2. Off-Canvas Mini-Cart Drawer Controller
    const cartOffcanvas = document.getElementById('ld-module-cart-offcanvas');
    const cartOverlay = document.getElementById('cart-drawer-overlay');

    function openCartDrawer() {
        if (cartOffcanvas && cartOverlay) {
            cartOffcanvas.classList.add('is-active');
            cartOverlay.classList.add('is-active');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeCartDrawer() {
        if (cartOffcanvas && cartOverlay) {
            cartOffcanvas.classList.remove('is-active');
            cartOverlay.classList.remove('is-active');
            document.body.style.overflow = '';
        }
    }

    /**
     * Delegated click handling.
     *
     * Previously each .cart-toggle-btn was bound individually at DOMContentLoaded.
     * WooCommerce cart fragments replace matched elements outright, so any toggle
     * that ever ends up inside a fragment loses its listener and silently stops
     * opening the drawer. Delegation survives every DOM replacement.
     */
    document.addEventListener('click', function(e) {
        if (!e.target.closest) {
            return;
        }

        if (e.target.closest('.cart-toggle-btn')) {
            e.preventDefault();
            openCartDrawer();
            return;
        }

        if (e.target.closest('#cart-drawer-close') || e.target.closest('#cart-drawer-overlay')) {
            e.preventDefault();
            closeCartDrawer();
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeCartDrawer();
        }
    });

    /**
     * React to cart activity: open the drawer as feedback that the item was
     * added (site.js fires this after "Add to Bag" / "Add to cart").
     */
    document.addEventListener('vda:added_to_cart', function() {
        openCartDrawer();
    });

    /**
     * 2b. Cart drawer quantity + remove controls (AJAX).
     *
     * All handling is delegated from document because the drawer's item list is
     * a WooCommerce fragment — it gets replaced wholesale on every cart change,
     * so any listener bound directly to a row would be destroyed on first use.
     */
    function setCartBusy(busy) {
        const list = document.getElementById('cart-drawer-items-list');
        if (!list) return;
        list.style.opacity = busy ? '0.5' : '';
        list.style.pointerEvents = busy ? 'none' : '';
    }

    /**
     * Swap in refreshed fragments.
     *
     * skipItemsList keeps the drawer's item rows in place. On a simple quantity
     * change nothing in a row actually changes (the row shows the unit price,
     * not the line total), so replacing the list would only destroy and rebuild
     * the very stepper the customer is clicking — causing visible flicker and
     * dropping focus mid-interaction.
     */
    function applyFragments(fragments, skipItemsList) {
        if (window.VDAStore) {
            VDAStore.renderCart(skipItemsList);
        }
    }

    function postCart(action, cartKey, quantity) {
        // Cart state lives in localStorage (site.js) instead of the WooCommerce session.
        return VDAStore.cartAction(action, cartKey, quantity);
    }

    /*
     * Quantity changes are applied to the input immediately and the server call
     * is debounced.
     *
     * Previously every click fired its own request and further clicks were
     * ignored while one was in flight, so tapping + three times meant three
     * sequential WordPress round trips — each recalculating cart totals — with
     * the list dimmed and unclickable throughout. Tapping + five times now
     * updates the number instantly and sends a single request for the final
     * value.
     */
    const QTY_DEBOUNCE_MS = 450;
    const pendingQty = {};
    let qtyTimer = null;

    function flushQtyUpdates() {
        const keys = Object.keys(pendingQty);

        keys.forEach(function(cartKey) {
            const quantity = pendingQty[cartKey];
            delete pendingQty[cartKey];

            postCart('vda_update_cart_item', cartKey, quantity)
                .then(function(res) {
                    if (!res || !res.success) {
                        if (res && res.data && res.data.message) {
                            window.alert(res.data.message);
                        }
                        return;
                    }

                    // Rebuild the rows only when they genuinely changed: the line
                    // was removed, or the server capped the quantity we asked for.
                    const needsRowRefresh = (quantity <= 0) || !!res.data.capped;
                    applyFragments(res.data.fragments, !needsRowRefresh);

                    if (res.data.capped && res.data.message) {
                        window.alert(res.data.message);
                    }
                })
                .catch(function() {
                    window.location.reload();
                });
        });
    }

    function scheduleQtyUpdate(cartKey, quantity) {
        if (typeof VDAStore === 'undefined') return;

        pendingQty[cartKey] = quantity;
        clearTimeout(qtyTimer);
        qtyTimer = setTimeout(flushQtyUpdates, QTY_DEBOUNCE_MS);
    }

    function removeCartItem(cartKey) {
        if (typeof VDAStore === 'undefined') return;

        // Removal genuinely changes the rows, so the brief busy state is honest.
        setCartBusy(true);

        postCart('vda_remove_cart_item', cartKey)
            .then(function(res) {
                if (res && res.success) {
                    applyFragments(res.data.fragments, false);
                } else if (res && res.data && res.data.message) {
                    window.alert(res.data.message);
                }
            })
            .catch(function() {
                window.location.reload();
            })
            .finally(function() {
                setCartBusy(false);
            });
    }

    function cartKeyFor(el) {
        const row = el.closest('[data-vda-cart-key]');
        return row ? row.getAttribute('data-vda-cart-key') : null;
    }

    document.addEventListener('click', function(e) {
        if (!e.target.closest) return;

        const removeBtn = e.target.closest('[data-vda-cart-remove]');
        if (removeBtn) {
            e.preventDefault();
            const key = cartKeyFor(removeBtn);
            if (key) removeCartItem(key);
            return;
        }

        const qtyBtn = e.target.closest('[data-vda-qty]');
        if (qtyBtn) {
            e.preventDefault();
            const key = cartKeyFor(qtyBtn);
            const input = qtyBtn.parentNode.querySelector('.vda-qty-input');
            if (!key || !input) return;

            const step = qtyBtn.getAttribute('data-vda-qty') === 'plus' ? 1 : -1;
            const max = parseInt(input.getAttribute('max'), 10);
            let next = (parseInt(input.value, 10) || 1) + step;

            if (next < 1) next = 0; // 0 removes the line, handled server-side.
            if (!isNaN(max) && next > max) return;

            // Show the new number straight away; the server call is debounced,
            // so holding + feels instant instead of one round trip per click.
            input.value = next > 0 ? next : 1;
            scheduleQtyUpdate(key, next);
        }
    });

    // Typing directly into the quantity box.
    document.addEventListener('change', function(e) {
        if (!e.target.classList || !e.target.classList.contains('vda-qty-input')) return;

        const key = cartKeyFor(e.target);
        if (!key) return;

        let value = parseInt(e.target.value, 10);
        if (isNaN(value) || value < 0) value = 1;

        const max = parseInt(e.target.getAttribute('max'), 10);
        if (!isNaN(max) && value > max) value = max;

        e.target.value = value;
        scheduleQtyUpdate(key, value);
    });

    /**
     * 2c. Product page quantity stepper (minus / plus around WooCommerce's own
     * quantity input). Purely local — it only adjusts the field before the form
     * is submitted, so no AJAX is involved here.
     */
    function clampQty(input, value) {
        const min = parseInt(input.getAttribute('min'), 10);
        const max = parseInt(input.getAttribute('max'), 10);

        if (!isNaN(min) && value < min) value = min;
        if (!isNaN(max) && value > max) value = max;

        return value;
    }

    function syncStepperState(wrapper) {
        const input = wrapper.querySelector('.qty');
        if (!input) return;

        const min = parseInt(input.getAttribute('min'), 10);
        const max = parseInt(input.getAttribute('max'), 10);
        const current = parseInt(input.value, 10) || 0;

        const minus = wrapper.querySelector('.vda-step-minus');
        const plus = wrapper.querySelector('.vda-step-plus');

        if (minus) minus.disabled = !isNaN(min) && current <= min;
        if (plus) plus.disabled = !isNaN(max) && current >= max;
    }

    document.addEventListener('click', function(e) {
        if (!e.target.closest) return;

        const stepBtn = e.target.closest('[data-vda-step]');
        if (!stepBtn) return;

        e.preventDefault();

        const wrapper = stepBtn.closest('.quantity');
        const input = wrapper ? wrapper.querySelector('.qty') : null;
        if (!input) return;

        const step = parseInt(stepBtn.getAttribute('data-vda-step'), 10) || 0;
        const next = clampQty(input, (parseInt(input.value, 10) || 0) + step);

        if (next !== (parseInt(input.value, 10) || 0)) {
            input.value = next;
            // WooCommerce (and variation handling) listen for change on .qty.
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        syncStepperState(wrapper);
    });

    // Keep the buttons' disabled state correct when typed into directly.
    document.addEventListener('input', function(e) {
        if (!e.target.classList || !e.target.classList.contains('qty')) return;
        const wrapper = e.target.closest('.quantity');
        if (wrapper) syncStepperState(wrapper);
    });

    document.querySelectorAll('.quantity').forEach(syncStepperState);

    // 3. Kerala Boutique Branch Selector AJAX Handler
    const branchSelector = document.getElementById('branch-select-dropdown');
    if (branchSelector) {
        branchSelector.addEventListener('change', function() {
            const selectedBranch = this.value;

            // Persist the choice (the vda_branch cookie in the WordPress build).
            if (typeof VDAStore !== 'undefined') {
                VDAStore.setBranch(selectedBranch);
            }

            /*
             * No local re-render here. The LocationCommerce module below
             * has its own delegated 'change' listener on
             * [data-vda-branch-select] which updates the labels and
             * WhatsApp links, so duplicating that would mean two pieces
             * of code writing the same DOM.
             */
        });
    }

    // 4. WhatsApp Concierge Order / Inquiry Link Generator
    const whatsappBtns = document.querySelectorAll('.whatsapp-order-btn');
    whatsappBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            // If already handled by LocationCommerce, let native href or handler proceed
            if (this.tagName.toLowerCase() === 'a' && this.href && this.href.includes('wa.me')) {
                return;
            }
            e.preventDefault();
            const product = this.dataset.product || 'Curated Product';
            const price = this.dataset.price || '';
            const phone = this.dataset.whatsappNumber || '918714620205'; // Default to Ottapalam Hub
            const text = encodeURIComponent(`Hi Naturia, I would like to enquire about "${product}" (Price: ${price}). Please check stock & delivery options for my Kerala location.`);
            window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
        });
    });

    // 5. LocationCommerce Geolocation & Dynamic Store Routing Module
    (function() {
        if (typeof VDAStore === 'undefined' || !VDAStore.branches.length) {
            return;
        }

        // Same shape the theme localised from PHP, now built from data.js.
        const VDA_LOCATION_DATA = {
            branches:       VDAStore.branches,
            activeShopId:   VDAStore.storedBranchId(),
            hasCookie:      !!VDAStore.storedBranchId(),
            maxRadiusKm:    VDAStore.settings.maxRadiusKm,
            ambiguousKm:    VDAStore.settings.ambiguousKm,
            messageIntro:   VDAStore.settings.messageIntro,
            fallbackShopId: VDAStore.settings.fallbackShopId
        };

        const branches      = VDA_LOCATION_DATA.branches || [];
        // stock and names are gone from the payload: filtering is server-side,
        // so the catalogue's branch availability is no longer published to the
        // browser at all. Product names come from the button's own data-product.
        const activeShopId  = VDA_LOCATION_DATA.activeShopId || '';
        const hasCookie     = !!VDA_LOCATION_DATA.hasCookie;
        // wp_localize_script() casts top-level scalars to strings, so coerce back to numbers.
        const maxRadiusKm   = parseFloat(VDA_LOCATION_DATA.maxRadiusKm) || 40;
        const ambiguousKm   = parseFloat(VDA_LOCATION_DATA.ambiguousKm) || 5;
        const messageIntro  = VDA_LOCATION_DATA.messageIntro || "Hi Naturia, I am interested in";
        const fallbackId    = VDA_LOCATION_DATA.fallbackShopId || 'ottapalam';

        let currentActiveBranchId = null;

        /**
         * Haversine formula to compute great-circle distance in kilometers
         */
        function calculateDistanceKm(lat1, lon1, lat2, lon2) {
            const R = 6371; // Earth radius in KM
            const dLat = (lat2 - lat1) * (Math.PI / 180);
            const dLon = (lon2 - lon1) * (Math.PI / 180);
            const a = 
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        /**
         * Find branch by shop_id
         */
        function getBranchById(id) {
            return branches.find(function(b) { return b.shop_id === id; }) || null;
        }

        /**
         * Apply branch selection: Filter grid, rewrite WhatsApp buttons, sync header dropdown
         * Skips re-render if active branch hasn't changed.
         */
        function applyBranch(branch, persistSession) {
            if (!branch || !branch.shop_id) {
                return;
            }

            // Skip re-render if branch hasn't changed
            if (currentActiveBranchId === branch.shop_id) {
                return;
            }

            currentActiveBranchId = branch.shop_id;

            /*
             * No sessionStorage here any more. The branch lives in the vda_branch
             * cookie, which is the only copy the SERVER can read — and the server
             * is what filters the catalogue now. sessionStorage was invisible to
             * PHP and could disagree with the cookie, which is exactly the split
             * brain this rewrite removes. persistSession is kept in the signature
             * so callers read unchanged; the cookie write happens server-side in
             * the switch/resolve AJAX handlers.
             */

            /*
             * 1. Product filtering — REMOVED, now server-side.
             *
             * This used to hide cards with display:none using a stock matrix
             * localised into every page. That approach had three problems: the
             * whole catalogue's branch availability was published to anyone who
             * opened devtools; WooCommerce had already paginated before the
             * hiding ran, so a branch stocking 6 of 24 items showed a sparse
             * page and a misleading paginator; and nothing stopped a customer
             * buying a hidden product.
             *
             * inc/branches/branch-query.php now filters the query itself via
             * pre_get_posts, so out-of-branch products never reach the page and
             * the add-to-cart guard blocks them server-side. The
             * data-vda-product attributes stay in the templates as useful
             * debugging markers.
             */

            // 2. Rewire WhatsApp Concierge Buttons ([data-vda-buy])
            const buyButtons = document.querySelectorAll('[data-vda-buy]');
            buyButtons.forEach(function(btn) {
                const pid = btn.getAttribute('data-vda-buy');
                const productName = btn.getAttribute('data-product')
                    || document.querySelector('h1')?.textContent?.trim()
                    || 'Curated Product';

                const message = encodeURIComponent(messageIntro + ' "' + productName + '" at ' + branch.name + '. Please confirm local availability & delivery details.');
                const whatsappUrl = 'https://wa.me/' + branch.whatsapp + '?text=' + message;

                if (btn.tagName.toLowerCase() === 'a') {
                    btn.href = whatsappUrl;
                    btn.target = '_blank';
                }
                btn.setAttribute('data-vda-whatsapp', branch.whatsapp);
                btn.setAttribute('data-vda-active-branch', branch.shop_id);

                // Non-anchor triggers (front-page curated <button> cards) are dispatched by the
                // legacy click handler above, which reads data-whatsapp-number. Keep it in sync
                // so those buttons route to the resolved branch instead of the hardcoded default.
                btn.setAttribute('data-whatsapp-number', branch.whatsapp);
            });

            // 3. Sync Header UI & Dropdown ([data-vda-branch-select], [data-vda-branch-label])
            const branchSelects = document.querySelectorAll('[data-vda-branch-select], #branch-select-dropdown');
            branchSelects.forEach(function(sel) {
                if (sel.value !== branch.shop_id) {
                    sel.value = branch.shop_id;
                }
            });

            const branchLabels = document.querySelectorAll('[data-vda-branch-label]');
            branchLabels.forEach(function(lbl) {
                lbl.textContent = branch.name;
            });
        }

        /**
         * Handle Geolocation resolution
         */
        /**
         * Tell the server which branch GPS resolved to.
         *
         * The server re-validates the shop_id against the active branch list and
         * writes the vda_branch cookie. The client proposes; the server decides.
         * A reload follows only when branch mode is on, because the catalogue is
         * rendered server-side and must be re-fetched to reflect the new branch.
         */
        function reportResolvedBranch(shopId) {
            VDAStore.setBranch(shopId);
        }

        /**
         * Handle Geolocation resolution
         */
        function resolveGeolocation() {
            /*
             * A cookie means this visitor has already been placed — by their own
             * choice, by a previous GPS answer, or by the IP fallback on the
             * server. Asking again would let GPS quietly override a deliberate
             * manual choice, so the prompt only ever appears on a first visit.
             */
            if (hasCookie) {
                const known = getBranchById(activeShopId);
                if (known) {
                    applyBranch(known, false);
                    return;
                }
            }

            if (!navigator.geolocation) {
                fallbackToDefault('GEOLOCATION_UNSUPPORTED');
                return;
            }

            navigator.geolocation.getCurrentPosition(
                function(position) {
                    const userLat = position.coords.latitude;
                    const userLng = position.coords.longitude;

                    // Calculate distances to all branches
                    const branchesWithDist = [];
                    branches.forEach(function(b) {
                        if (typeof b.lat === 'number' && typeof b.lng === 'number') {
                            const d = calculateDistanceKm(userLat, userLng, b.lat, b.lng);
                            branchesWithDist.push(Object.assign({}, b, { distanceKm: d }));
                        }
                    });

                    if (branchesWithDist.length === 0) {
                        fallbackToDefault('NO_BRANCH_COORDINATES');
                        return;
                    }

                    // Sort ascending by distance
                    branchesWithDist.sort(function(a, b) {
                        return a.distanceKm - b.distanceKm;
                    });

                    const nearest = branchesWithDist[0];

                    // Check maxRadiusKm constraint
                    if (nearest.distanceKm > maxRadiusKm) {
                        fallbackToDefault('OUT_OF_RADIUS');
                        return;
                    }

                    // Apply immediately so the page is never in a loading state,
                    // then persist the answer server-side.
                    applyBranch(nearest, false);
                    reportResolvedBranch(nearest.shop_id);

                    // §5.4: Thrissur cluster handling - detect ambiguous nearby branches within ambiguousKm
                    const candidateBranches = branchesWithDist.filter(function(b) {
                        return (b.distanceKm - nearest.distanceKm) <= ambiguousKm;
                    });

                    if (candidateBranches.length > 1) {
                        const ambiguousEvent = new CustomEvent('vda:branchAmbiguous', {
                            detail: {
                                primaryBranch: nearest,
                                candidateBranches: candidateBranches,
                                userLocation: { lat: userLat, lng: userLng }
                            },
                            bubbles: true
                        });
                        document.dispatchEvent(ambiguousEvent);
                    }
                },
                function(error) {
                    // Silent fallback on permission denial, timeout, or position error
                    fallbackToDefault(error ? error.code : 'POSITION_ERROR');
                },
                {
                    enableHighAccuracy: false,
                    timeout: 7000,
                    maximumAge: 300000 // Cache for 5 minutes
                }
            );
        }

        /**
         * Silent fallback to Ottapalam main hub without error alerts or breaking UI
         */
        function fallbackToDefault(reason) {
            const fallbackBranch = getBranchById(fallbackId) || branches[0];
            if (fallbackBranch) {
                applyBranch(fallbackBranch, false);
            }
        }

        // Attach listener to manual branch dropdown changes
        document.addEventListener('change', function(e) {
            if (e.target && (e.target.matches('[data-vda-branch-select]') || e.target.id === 'branch-select-dropdown')) {
                const selectedId = e.target.value;
                const manualBranch = getBranchById(selectedId);
                if (manualBranch) {
                    // User manual selection overrides GPS for the session
                    applyBranch(manualBranch, true);
                }
            }
        });

        // Initialize geolocation matching
        resolveGeolocation();
    })();
});


