/**
 * Naturia - Static Site Engine
 *
 * Replaces everything the WordPress/WooCommerce backend used to render on the
 * server: the category tabs, branch selector, footer directory, product grids,
 * product pages, star ratings, rupee formatting and the cart (which now lives
 * in localStorage instead of the WooCommerce session).
 *
 * Every renderer below outputs the same markup and classes as the matching
 * PHP template, so style.css / main.css apply unchanged.
 *
 * Loaded after data.js and before main.js.
 */

(function() {
    'use strict';

    const SETTINGS   = window.VDA_SETTINGS || {};
    const BRANCHES   = window.VDA_BRANCHES || [];
    const CATEGORIES = window.VDA_CATEGORIES || [];
    const PRODUCTS   = window.VDA_PRODUCTS || [];

    const MAX_QTY = SETTINGS.maxQtyPerProduct || 10;
    const CART_KEY = 'vda_cart';
    const BRANCH_KEY = 'vda_branch';

    /* ======================================================================
       HELPERS
       ====================================================================== */

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function stripTags(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return (div.textContent || '').trim();
    }

    function storageGet(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function storageSet(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* Private mode — the session simply won't persist. */ }
    }

    function param(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    /**
     * Indian digit grouping: ₹1,14,990 rather than ₹114,990.
     * Port of vda_format_indian_price().
     */
    function formatIndian(num) {
        const negative = num < 0;
        let integer = String(Math.round(Math.abs(num)));

        if (integer.length > 3) {
            const lastThree = integer.slice(-3);
            const remainder = integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
            integer = remainder + ',' + lastThree;
        }

        return (negative ? '-' : '') + integer;
    }

    /** Port of wc_price(): WooCommerce's price markup. */
    function wcPrice(amount) {
        return '<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">'
            + esc(SETTINGS.currencySymbol || '₹') + '</span>' + formatIndian(amount) + '</bdi></span>';
    }

    function plainPrice(amount) {
        return (SETTINGS.currencySymbol || '₹') + formatIndian(amount);
    }

    /* ======================================================================
       PRODUCT MODEL
       ====================================================================== */

    function getProduct(id) {
        return PRODUCTS.find(function(p) { return p.id === id; }) || null;
    }

    function getCategory(slug) {
        return CATEGORIES.find(function(c) { return c.slug === slug; }) || null;
    }

    /** Only categories that actually contain products (hide_empty => true). */
    function activeCategories() {
        return CATEGORIES.filter(function(c) {
            return PRODUCTS.some(function(p) { return p.category === c.slug; });
        });
    }

    function isOnSale(p) {
        return p.sale_price !== '' && p.sale_price != null && Number(p.sale_price) < Number(p.regular_price);
    }

    function activePrice(p) {
        return isOnSale(p) ? Number(p.sale_price) : Number(p.regular_price);
    }

    function localReviews(p) {
        return storageGet('vda_reviews_' + p.id, []);
    }

    function allReviews(p) {
        return (p.reviews || []).concat(localReviews(p));
    }

    function averageRating(p) {
        const reviews = allReviews(p);
        if (!reviews.length) return 0;
        const total = reviews.reduce(function(sum, r) { return sum + Number(r.rating || 0); }, 0);
        return total / reviews.length;
    }

    function productUrl(p) {
        return 'product.html?id=' + encodeURIComponent(p.id);
    }

    function categoryUrl(slug) {
        return 'shop.html?category=' + encodeURIComponent(slug);
    }

    /** Port of get_price_html(), including vda_single_price_when_equal(). */
    function priceHtml(p) {
        if (isOnSale(p)) {
            return '<del aria-hidden="true">' + wcPrice(p.regular_price) + '</del> '
                + '<span class="screen-reader-text">Original price was: ' + esc(plainPrice(p.regular_price)) + '.</span>'
                + '<ins aria-hidden="true">' + wcPrice(p.sale_price) + '</ins>'
                + '<span class="screen-reader-text">Current price is: ' + esc(plainPrice(p.sale_price)) + '.</span>';
        }
        return wcPrice(activePrice(p));
    }

    const PLACEHOLDER_SVG = '<svg class="w-16 h-16 text-[#DFBA9E]" fill="none" stroke="currentColor" stroke-width="1.2" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';

    function mainImage(p) {
        return (p.images && p.images.length) ? p.images[0] : '';
    }

    /**
     * Port of vda_render_star_rating(): always exactly five glyphs, filled
     * then empty, plus the real average and review count.
     */
    function starRating(p, extraClasses) {
        const average = averageRating(p);
        const count = allReviews(p).length;
        const filled = Math.max(0, Math.min(5, Math.round(average)));
        const empty = 5 - filled;

        let html = '<div class="vda-star-rating ' + esc(extraClasses || '') + '" role="img" aria-label="Rated ' + average.toFixed(1) + ' out of 5">';
        html += '<span class="vda-star-rating-stars" aria-hidden="true">' + '★'.repeat(filled);
        if (empty > 0) {
            html += '<span class="vda-star-rating-empty">' + '☆'.repeat(empty) + '</span>';
        }
        html += '</span>';

        if (count > 0) {
            html += '<span class="vda-star-rating-count">' + average.toFixed(1) + ' &middot; ' + count + ' ' + (count === 1 ? 'review' : 'reviews') + '</span>';
        } else {
            html += '<span class="vda-star-rating-count vda-star-rating-none">No reviews yet</span>';
        }

        return html + '</div>';
    }

    /** Port of vda_get_top_rated_product_ids(). */
    function topRatedProducts(limit) {
        const rated = PRODUCTS.filter(function(p) { return allReviews(p).length > 0; })
            .sort(function(a, b) {
                return (averageRating(b) - averageRating(a)) || (allReviews(b).length - allReviews(a).length);
            });

        let list = rated.slice(0, limit);

        if (list.length < limit) {
            const rest = PRODUCTS.filter(function(p) { return list.indexOf(p) === -1; })
                .sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
            list = list.concat(rest.slice(0, limit - list.length));
        }

        return list;
    }

    /* ======================================================================
       BRANCHES (replaces the vda_branch cookie with localStorage)
       ====================================================================== */

    function getBranch(id) {
        return BRANCHES.find(function(b) { return b.shop_id === id; }) || null;
    }

    function hubBranch() {
        return getBranch(SETTINGS.fallbackShopId || 'ottapalam') || BRANCHES[0] || null;
    }

    function storedBranchId() {
        return storageGet(BRANCH_KEY, '');
    }

    function activeBranch() {
        return getBranch(storedBranchId()) || hubBranch();
    }

    function setBranch(id) {
        if (getBranch(id)) {
            storageSet(BRANCH_KEY, id);
        }
    }

    /* ======================================================================
       CART (replaces WC()->cart and the AJAX handlers in functions.php)
       ====================================================================== */

    function readCart() {
        const items = storageGet(CART_KEY, []);
        // Drop lines whose product no longer exists in data.js.
        return Array.isArray(items) ? items.filter(function(i) { return getProduct(i.id) && i.qty > 0; }) : [];
    }

    function writeCart(items) {
        storageSet(CART_KEY, items);
    }

    function cartCount() {
        return readCart().reduce(function(sum, i) { return sum + i.qty; }, 0);
    }

    function cartSubtotal() {
        return readCart().reduce(function(sum, i) {
            return sum + activePrice(getProduct(i.id)) * i.qty;
        }, 0);
    }

    /**
     * Port of vda_validate_add_to_cart_quantity(): counts what is already in
     * the bag, so the per-product cap cannot be bypassed by adding twice.
     */
    function addToCart(id, qty) {
        qty = parseInt(qty, 10) || 1;
        const items = readCart();
        const line = items.find(function(i) { return i.id === id; });
        const already = line ? line.qty : 0;

        if (already + qty > MAX_QTY) {
            return { success: false, message: 'You can order a maximum of ' + MAX_QTY + ' units of this product per order.' };
        }

        if (line) {
            line.qty += qty;
        } else {
            items.push({ key: id, id: id, qty: qty });
        }

        writeCart(items);
        renderCart();
        return { success: true };
    }

    /**
     * Port of vda_ajax_update_cart_item() / vda_ajax_remove_cart_item().
     * Returns a Promise with the same { success, data } shape the AJAX
     * endpoints returned, so main.js handles it exactly as before.
     */
    function cartAction(action, cartKey, quantity) {
        const items = readCart();
        const line = items.find(function(i) { return i.key === cartKey; });

        if (!line) {
            return Promise.resolve({ success: false, data: { message: 'That item is no longer in your bag.' } });
        }

        let capped = false;

        if (action === 'vda_remove_cart_item' || (parseInt(quantity, 10) || 0) <= 0) {
            items.splice(items.indexOf(line), 1);
        } else {
            let q = parseInt(quantity, 10);
            if (q > MAX_QTY) {
                q = MAX_QTY;
                capped = true;
            }
            line.qty = q;
        }

        writeCart(items);

        const data = { count: cartCount(), is_empty: items.length === 0, capped: capped };
        if (capped) {
            data.message = 'Only ' + MAX_QTY + ' available in stock.';
        }

        return Promise.resolve({ success: true, data: data });
    }

    /** Port of vda_render_cart_items(). */
    function cartItemsHtml() {
        const items = readCart();

        if (!items.length) {
            return '<div class="text-center py-12 text-[#8C786F]">'
                + '<svg class="w-12 h-12 mx-auto mb-3 text-[#DFBA9E]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>'
                + '<p class="font-heading text-sm font-bold text-[#2B1B17]">Your Bag is Empty</p>'
                + '<p class="text-xs mt-1 text-[#8C786F]">Add fruit peels, vegetable waste or compost mixes to feed your plants!</p>'
                + '</div>';
        }

        return items.map(function(item) {
            const p = getProduct(item.id);
            const url = productUrl(p);
            const img = mainImage(p);
            const thumb = img
                ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" width="120" height="120">'
                : PLACEHOLDER_SVG;

            return '<div class="vda-cart-item" data-vda-cart-key="' + esc(item.key) + '">'
                + '<a href="' + url + '" class="vda-cart-item-thumb" tabindex="-1" aria-hidden="true">' + thumb + '</a>'
                + '<div class="vda-cart-item-body">'
                +   '<h4 class="vda-cart-item-title"><a href="' + url + '">' + esc(p.name) + '</a></h4>'
                +   '<div class="vda-cart-item-price">' + wcPrice(activePrice(p)) + '</div>'
                +   '<div class="vda-cart-item-actions">'
                +     '<div class="vda-qty-control" role="group" aria-label="Quantity for ' + esc(p.name) + '">'
                +       '<button type="button" class="vda-qty-btn" data-vda-qty="minus" aria-label="Decrease quantity">&minus;</button>'
                +       '<input type="number" class="vda-qty-input" value="' + item.qty + '" min="1" max="' + MAX_QTY + '" step="1" inputmode="numeric" aria-label="Quantity">'
                +       '<button type="button" class="vda-qty-btn" data-vda-qty="plus" aria-label="Increase quantity">&plus;</button>'
                +     '</div>'
                +     '<button type="button" class="vda-cart-remove" data-vda-cart-remove aria-label="Remove ' + esc(p.name) + ' from bag">'
                +       '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"></path></svg>'
                +     '</button>'
                +   '</div>'
                + '</div>'
                + '</div>';
        }).join('');
    }

    /**
     * Refresh every piece of cart UI — the equivalent of the WooCommerce
     * fragments (.cart-count-badge, .mobile-cart-badge, #cart-drawer-items-list,
     * #cart-drawer-subtotal). skipItemsList keeps the rows in place on a plain
     * quantity change so the stepper being clicked is not rebuilt.
     */
    let lastCartList = null;

    ['click', 'change', 'input'].forEach(function(type) {
        document.addEventListener(type, function(e) {
            const list = e.target.closest && e.target.closest('#cart-drawer-items-list, [data-vda-cart-items]');
            if (list) lastCartList = list;
        }, true);
    });

    function renderCart(skipItemsList) {
        const count = cartCount();

        document.querySelectorAll('.cart-count-badge, .mobile-cart-badge').forEach(function(el) {
            el.textContent = count;
        });

        document.querySelectorAll('#cart-drawer-items-list, [data-vda-cart-items]').forEach(function(el) {
            // Leave alone only the list the customer is clicking in; a second
            // copy (drawer vs. Shopping Bag page) still needs the new numbers.
            if (skipItemsList && el === lastCartList) return;
            el.innerHTML = cartItemsHtml();
        });

        document.querySelectorAll('#cart-drawer-subtotal, [data-vda-cart-subtotal]').forEach(function(el) {
            el.innerHTML = wcPrice(cartSubtotal());
        });
    }

    /**
     * Ordering happens on WhatsApp (see the theme README, "Ordering happens on
     * WhatsApp, not at a checkout"). The bag is sent, itemised, to the
     * customer's active branch.
     */
    function whatsappOrderUrl() {
        const branch = activeBranch();
        const items = readCart();
        let msg = SETTINGS.messageIntro || "Hi Naturia, I am interested in";

        if (!items.length) {
            msg += ' your curated collection at ' + branch.name + '.';
        } else {
            msg = "Hi Naturia (" + branch.name + "), I would like to order:\n";
            items.forEach(function(item, i) {
                const p = getProduct(item.id);
                msg += '\n' + (i + 1) + '. ' + p.name + ' x ' + item.qty + ' - ' + plainPrice(activePrice(p) * item.qty);
            });
            msg += '\n\nSubtotal: ' + plainPrice(cartSubtotal());
            msg += '\n\nPlease confirm local availability & delivery details.';
        }

        return 'https://wa.me/' + branch.whatsapp + '?text=' + encodeURIComponent(msg);
    }

    /* ======================================================================
       SHARED CHROME — header, footer, mobile nav (header.php / footer.php)
       ====================================================================== */

    function renderChrome() {
        const page = document.body.getAttribute('data-page') || '';
        const currentCat = page === 'shop' ? param('category') : null;
        const hub = hubBranch();

        // Branch selector options (no `selected`: main.js syncs the active branch).
        document.querySelectorAll('#branch-select-dropdown').forEach(function(sel) {
            sel.innerHTML = BRANCHES.map(function(b) {
                return '<option value="' + esc(b.shop_id) + '">' + esc(b.name) + '</option>';
            }).join('');
        });

        // Hub phone in the top bar + homepage strip.
        if (hub) {
            document.querySelectorAll('[data-vda-hub-phone]').forEach(function(a) {
                a.href = 'tel:' + hub.phone_link;
                if (a.hasAttribute('data-vda-hub-phone-label')) {
                    a.textContent = a.getAttribute('data-vda-hub-phone-label').replace('%s', hub.phone);
                } else {
                    a.textContent = hub.phone;
                }
            });
            document.querySelectorAll('[data-vda-hub-maps]').forEach(function(a) {
                a.href = 'https://maps.google.com/?q=' + encodeURIComponent(hub.maps_query);
            });
            document.querySelectorAll('[data-vda-hub-whatsapp]').forEach(function(a) {
                a.href = 'https://wa.me/' + hub.whatsapp;
            });
        }

        // Header category tabs.
        const nav = document.querySelector('[data-vda-nav-cats]');
        if (nav) {
            const curated = '<a href="index.html#curated" class="nav-caramel-link' + (page === 'home' ? ' active' : '') + '"><span>✨ Curated Collections</span></a>';
            nav.innerHTML = curated + activeCategories().slice(0, 8).map(function(c) {
                return '<a href="' + categoryUrl(c.slug) + '" class="nav-caramel-link' + (currentCat === c.slug ? ' active' : '') + '"><span>' + esc(c.name) + '</span></a>';
            }).join('');
        }

        // Footer — Collections column.
        const footerCats = document.querySelector('[data-vda-footer-cats]');
        if (footerCats) {
            const cats = activeCategories().slice(0, 8);
            footerCats.innerHTML = cats.length
                ? cats.map(function(c) {
                    return '<li><a href="' + categoryUrl(c.slug) + '" class="hover:text-white transition">' + esc(c.name) + '</a></li>';
                }).join('')
                : '<li><a href="shop.html" class="hover:text-white transition">Browse the Full Catalog</a></li>';
        }

        // Footer — Ottapalam flagship hub card.
        const footerHub = document.querySelector('[data-vda-footer-hub]');
        if (footerHub && hub) {
            footerHub.innerHTML = '<div class="bg-[#3E2723]/60 p-3.5 rounded-xl border border-[#5C4A42]/40">'
                + '<div class="text-[11px] font-bold text-white mb-1">📍 Main Ottapalam Flagship Hub:</div>'
                + '<div class="text-[11px] text-[#EADDCA]">' + esc(hub.address) + '</div>'
                + '<div class="text-xs font-bold text-[#C68E17] mt-1.5">Tel: <a href="tel:' + esc(hub.phone_link) + '" class="hover:underline">' + esc(hub.phone) + '</a></div>'
                + '</div>';
        }

        // Footer — Kerala branch directory.
        const footerBranches = document.querySelector('[data-vda-footer-branches]');
        if (footerBranches) {
            footerBranches.innerHTML = BRANCHES.map(function(b, i) {
                const isLast = i === BRANCHES.length - 1;
                return '<div class="' + (isLast ? '' : 'border-b border-[#3E2723] pb-1.5') + '">'
                    + '<span class="font-bold text-white">' + esc(b.short_label) + ':</span> ' + esc(b.short_location)
                    + ' (<a href="tel:' + esc(b.phone_link) + '" class="hover:text-white transition">' + esc(b.phone) + '</a>)'
                    + '</div>';
            }).join('');
        }

        document.querySelectorAll('[data-vda-year]').forEach(function(el) {
            el.textContent = new Date().getFullYear();
        });

        // Search boxes keep the current query.
        const s = param('s');
        if (s) {
            document.querySelectorAll('input[name="s"]').forEach(function(input) { input.value = s; });
        }

        // Checkout = WhatsApp order to the active branch.
        document.addEventListener('click', function(e) {
            const btn = e.target.closest && e.target.closest('[data-vda-checkout]');
            if (!btn) return;
            e.preventDefault();
            window.open(whatsappOrderUrl(), '_blank', 'noopener');
        });

        renderCart();
    }

    /* ======================================================================
       HOMEPAGE (front-page.php)
       ====================================================================== */

    function renderHome() {
        const bubbles = document.querySelector('[data-vda-category-bubbles]');
        if (bubbles) {
            bubbles.innerHTML = activeCategories().map(function(c) {
                const inner = c.image
                    ? '<img src="' + esc(c.image) + '" alt="' + esc(c.name) + '" class="w-full h-full object-cover rounded-full" loading="lazy">'
                    : '<svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
                return '<a href="' + categoryUrl(c.slug) + '" class="category-bubble-item">'
                    + '<div class="category-bubble-circle">' + inner + '</div>'
                    + '<span class="category-bubble-title">' + esc(c.name) + '</span>'
                    + '</a>';
            }).join('');
        }

        const curated = document.querySelector('[data-vda-curated]');
        if (curated) {
            curated.innerHTML = topRatedProducts(2).map(function(p) {
                const url = productUrl(p);
                const saving = isOnSale(p) ? (Number(p.regular_price) - Number(p.sale_price)) : 0;
                const cat = getCategory(p.category);
                const img = mainImage(p);

                return '<div class="curated-product-card" data-vda-product="' + esc(p.id) + '">'
                    + (saving > 0 ? '<span class="badge-caramel-discount">Save ' + wcPrice(saving) + '</span>' : '')
                    + (p.tag ? '<span class="badge-soft-tag">' + esc(p.tag) + '</span>' : '')
                    + '<a href="' + url + '" class="curated-thumb-box" tabindex="-1" aria-hidden="true">'
                    +   (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '">' : PLACEHOLDER_SVG)
                    + '</a>'
                    + '<div class="flex flex-col flex-1">'
                    +   (cat ? '<span class="text-[11px] font-bold text-[#AF6E4D] uppercase tracking-wider mb-1">' + esc(cat.name) + '</span>' : '')
                    +   '<h3 class="curated-product-title"><a href="' + url + '">' + esc(p.name) + '</a></h3>'
                    +   starRating(p, 'mb-2')
                    +   '<div class="curated-price-row">'
                    +     '<span class="curated-price-current">' + wcPrice(activePrice(p)) + '</span>'
                    +     (saving > 0 ? '<span class="curated-price-mrp">' + wcPrice(p.regular_price) + '</span>' : '')
                    +   '</div>'
                    +   '<div class="mt-auto">'
                    +     '<a href="' + url + '" class="btn-curated-cart" aria-label="View details for ' + esc(p.name) + '">'
                    +       '<span>View Details</span>'
                    +       '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>'
                    +     '</a>'
                    +   '</div>'
                    + '</div>'
                    + '</div>';
            }).join('');
        }
    }

    /* ======================================================================
       SHOP / CATEGORY / SEARCH (archive-product.php)
       ====================================================================== */

    const SORTS = {
        'menu_order': 'Default sorting',
        'popularity': 'Sort by popularity',
        'rating': 'Sort by average rating',
        'date': 'Sort by latest',
        'price': 'Sort by price: low to high',
        'price-desc': 'Sort by price: high to low'
    };

    function sortProducts(list, orderby) {
        const sorted = list.slice();
        switch (orderby) {
            case 'popularity': sorted.sort(function(a, b) { return allReviews(b).length - allReviews(a).length; }); break;
            case 'rating': sorted.sort(function(a, b) { return averageRating(b) - averageRating(a); }); break;
            case 'date': sorted.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); }); break;
            case 'price': sorted.sort(function(a, b) { return activePrice(a) - activePrice(b); }); break;
            case 'price-desc': sorted.sort(function(a, b) { return activePrice(b) - activePrice(a); }); break;
        }
        return sorted;
    }

    function archiveCardHtml(p) {
        const cat = getCategory(p.category);
        const img = mainImage(p);

        return '<a href="' + productUrl(p) + '" data-vda-product="' + esc(p.id) + '" class="group block bg-white border border-[#EBE3DB] rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1.5 hover:bg-[#FAF7F2] hover:border-[#AF6E4D] hover:shadow-[0_16px_32px_-4px_rgba(43,27,23,0.08)] flex flex-col relative overflow-hidden">'
            + (isOnSale(p) ? '<span class="absolute top-4 left-4 bg-[#AF6E4D] text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full z-10 shadow-sm">Special Offer</span>' : '')
            + '<div class="w-full h-56 rounded-xl bg-white flex items-center justify-center p-4 mb-4 border border-[#F5EFEB] overflow-hidden group-hover:border-[#EADDCA] transition-colors">'
            +   (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" class="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-105">' : PLACEHOLDER_SVG)
            + '</div>'
            + '<div class="flex flex-col flex-1">'
            +   (cat ? '<div class="text-[11px] font-bold text-[#AF6E4D] uppercase tracking-wider mb-1 line-clamp-1">' + esc(cat.name) + '</div>' : '')
            +   '<h2 class="font-body text-[#2B1B17] font-bold text-sm leading-snug line-clamp-2 mb-2 group-hover:text-[#AF6E4D] transition-colors">' + esc(p.name) + '</h2>'
            +   starRating(p, 'mb-3')
            +   '<div class="mt-auto pt-3 border-t border-[#F5EFEB] flex items-center justify-between gap-2">'
            +     '<div class="price-container font-heading font-bold text-base text-[#AF6E4D] [&_.woocommerce-Price-currencySymbol]:text-xs [&_del]:text-xs [&_del]:text-[#8C786F] [&_del]:font-normal [&_ins]:no-underline [&_ins]:font-bold">' + priceHtml(p) + '</div>'
            +     '<div class="w-8 h-8 rounded-full bg-[#F5EFEB] group-hover:bg-[#AF6E4D] group-hover:text-white text-[#AF6E4D] flex items-center justify-center transition-colors flex-shrink-0 shadow-sm" aria-label="View Product">'
            +       '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>'
            +     '</div>'
            +   '</div>'
            + '</div>'
            + '</a>';
    }

    function renderShop() {
        const catSlug = param('category');
        const search = (param('s') || '').trim();
        const category = catSlug ? getCategory(catSlug) : null;

        let list = PRODUCTS.slice();
        let title = 'Shop';
        let crumb = '<a href="index.html">Home</a>&nbsp;&#47;&nbsp;Shop';

        if (category) {
            list = list.filter(function(p) { return p.category === category.slug; });
            title = category.name;
            crumb = '<a href="index.html">Home</a>&nbsp;&#47;&nbsp;' + esc(category.name);
        } else if (catSlug) {
            list = [];
            title = 'Shop';
        }

        if (search) {
            const q = search.toLowerCase();
            list = list.filter(function(p) {
                const cat = getCategory(p.category);
                return (p.name + ' ' + stripTags(p.short_description) + ' ' + (cat ? cat.name : '') + ' ' + (p.tag || '') + ' ' + (p.seller || '')).toLowerCase().indexOf(q) !== -1;
            });
            title = 'Search results: “' + esc(search) + '”';
            crumb = '<a href="index.html">Home</a>&nbsp;&#47;&nbsp;Search results for “' + esc(search) + '”';
        }

        document.title = stripTags(title) + ' – Naturia';

        const titleEl = document.querySelector('[data-vda-shop-title]');
        if (titleEl) titleEl.innerHTML = title;

        const crumbEl = document.querySelector('[data-vda-breadcrumb]');
        if (crumbEl) crumbEl.innerHTML = crumb;

        const descEl = document.querySelector('[data-vda-shop-desc]');
        if (descEl && category && category.description) {
            descEl.outerHTML = '<div class="archive-description text-sm text-[#5C4A42] leading-relaxed mt-2">' + category.description + '</div>';
        }

        const results = document.querySelector('[data-vda-shop-results]');
        const empty = document.querySelector('[data-vda-shop-empty]');

        if (!list.length) {
            if (results) results.hidden = true;
            if (empty) empty.hidden = false;
            return;
        }

        if (results) results.hidden = false;
        if (empty) empty.hidden = true;

        const select = document.querySelector('.woocommerce-ordering select.orderby');
        let orderby = param('orderby');
        if (!SORTS[orderby]) orderby = 'menu_order';

        if (select) {
            select.innerHTML = Object.keys(SORTS).map(function(key) {
                return '<option value="' + key + '"' + (key === orderby ? ' selected="selected"' : '') + '>' + SORTS[key] + '</option>';
            }).join('');

            select.addEventListener('change', function() {
                const params = new URLSearchParams(window.location.search);
                params.set('orderby', this.value);
                window.location.search = params.toString();
            });
        }

        const countEl = document.querySelector('[data-vda-result-count]');
        if (countEl) {
            countEl.textContent = list.length === 1 ? 'Showing the single result' : 'Showing all ' + list.length + ' results';
        }

        const grid = document.querySelector('[data-vda-shop-grid]');
        if (grid) grid.innerHTML = sortProducts(list, orderby).map(archiveCardHtml).join('');
    }

    /* ======================================================================
       SINGLE PRODUCT (single-product.php)
       ====================================================================== */

    function galleryHtml(p) {
        const images = p.images || [];

        if (!images.length) {
            return '<div class="woocommerce-product-gallery woocommerce-product-gallery--without-images">'
                + '<div class="woocommerce-product-gallery__wrapper">'
                + '<div class="woocommerce-product-gallery__image--placeholder flex items-center justify-center py-16">'
                + PLACEHOLDER_SVG.replace('w-16 h-16', 'w-40 h-40')
                + '</div></div></div>';
        }

        let html = '<div class="woocommerce-product-gallery">'
            + '<div class="woocommerce-product-gallery__wrapper">'
            + '<div class="woocommerce-product-gallery__image"><a href="' + esc(images[0]) + '" target="_blank" rel="noopener" data-vda-gallery-main><img src="' + esc(images[0]) + '" alt="' + esc(p.name) + '"></a></div>'
            + '</div>';

        if (images.length > 1) {
            html += '<ol class="flex-control-nav flex-control-thumbs">' + images.map(function(src, i) {
                return '<li><img src="' + esc(src) + '" alt="' + esc(p.name) + ' image ' + (i + 1) + '" data-vda-gallery-thumb="' + esc(src) + '" style="cursor:pointer"></li>';
            }).join('') + '</ol>';
        }

        return html + '</div>';
    }

    function tabsHtml(p) {
        const hasAttributes = p.attributes && p.attributes.length;

        let html = '<div class="woocommerce-tabs wc-tabs-wrapper">'
            + '<ul class="tabs wc-tabs" role="tablist">'
            + '<li class="description_tab active" role="presentation"><a href="#tab-description" role="tab" aria-controls="tab-description">Description</a></li>'
            + (hasAttributes ? '<li class="additional_information_tab" role="presentation"><a href="#tab-additional_information" role="tab" aria-controls="tab-additional_information">Additional information</a></li>' : '')
            + '</ul>'
            + '<div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--description panel entry-content wc-tab" id="tab-description" role="tabpanel">'
            + '<h2>Description</h2>' + (p.description || '')
            + '</div>';

        if (hasAttributes) {
            html += '<div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--additional_information panel entry-content wc-tab" id="tab-additional_information" role="tabpanel" hidden>'
                + '<h2>Additional information</h2>'
                + '<table class="woocommerce-product-attributes shop_attributes"><tbody>'
                + p.attributes.map(function(row) {
                    return '<tr class="woocommerce-product-attributes-item"><th class="woocommerce-product-attributes-item__label" scope="row">' + row[0] + '</th><td class="woocommerce-product-attributes-item__value"><p>' + row[1] + '</p></td></tr>';
                }).join('')
                + '</tbody></table></div>';
        }

        return html + '</div>';
    }

    function formatDate(iso) {
        const d = new Date(iso + 'T00:00:00');
        if (isNaN(d)) return esc(iso);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function reviewsHtml(p) {
        const reviews = allReviews(p);
        let html = '<div id="reviews" class="woocommerce-Reviews"><div id="comments">';

        if (reviews.length) {
            html += '<h2 class="woocommerce-Reviews-title">' + reviews.length + ' ' + (reviews.length === 1 ? 'review' : 'reviews') + ' for <span>' + esc(p.name) + '</span></h2>'
                + '<ol class="commentlist">'
                + reviews.map(function(r) {
                    const filled = Math.max(0, Math.min(5, Math.round(r.rating)));
                    return '<li class="review"><div class="comment_container"><div class="comment-text">'
                        + '<div class="star-rating" role="img" aria-label="Rated ' + filled + ' out of 5"><span>' + '★'.repeat(filled) + '</span>' + '☆'.repeat(5 - filled) + '</div>'
                        + '<p class="meta"><strong class="woocommerce-review__author">' + esc(r.author) + '</strong> '
                        + '<span class="woocommerce-review__dash">&ndash;</span> '
                        + '<time class="woocommerce-review__published-date">' + formatDate(r.date) + '</time></p>'
                        + '<div class="description"><p>' + esc(r.text) + '</p></div>'
                        + '</div></div></li>';
                }).join('')
                + '</ol>';
        } else {
            html += '<h2 class="woocommerce-Reviews-title">Reviews</h2><p class="woocommerce-noreviews">There are no reviews yet.</p>';
        }

        html += '</div>'
            + '<div id="review_form_wrapper"><div id="review_form"><div id="respond" class="comment-respond">'
            + '<span id="reply-title" class="comment-reply-title" role="heading" aria-level="3">' + (reviews.length ? 'Add a review' : 'Be the first to review &ldquo;' + esc(p.name) + '&rdquo;') + '</span>'
            + '<form id="commentform" class="comment-form" data-vda-review-form novalidate>'
            + '<p class="comment-notes"><span id="email-notes">Your email address will not be published.</span> Required fields are marked <span class="required">*</span></p>'
            + '<div class="comment-form-rating"><label for="rating" id="comment-form-rating-label">Your rating&nbsp;<span class="required">*</span></label>'
            + '<p class="stars" data-vda-stars>' + [1, 2, 3, 4, 5].map(function(n) {
                return '<a href="#" data-vda-star="' + n + '" aria-label="' + n + ' of 5 stars" style="font-size:1.4rem">☆</a>';
            }).join('') + '</p>'
            + '<input type="hidden" name="rating" id="rating" value=""></div>'
            + '<p class="comment-form-comment"><label for="comment">Your review&nbsp;<span class="required">*</span></label><textarea id="comment" name="comment" cols="45" rows="8" required></textarea></p>'
            + '<p class="comment-form-author"><label for="author">Name&nbsp;<span class="required">*</span></label><input id="author" name="author" type="text" value="" size="30" required></p>'
            + '<p class="comment-form-email"><label for="email">Email&nbsp;<span class="required">*</span></label><input id="email" name="email" type="email" value="" size="30" required></p>'
            + '<p class="form-submit"><input name="submit" type="submit" id="submit" class="submit" value="Submit"></p>'
            + '</form></div></div></div>'
            + '</div>';

        return html;
    }

    function relatedHtml(p) {
        let related = PRODUCTS.filter(function(r) { return r.id !== p.id && r.category === p.category; });
        if (related.length < 4) {
            related = related.concat(PRODUCTS.filter(function(r) { return r.id !== p.id && related.indexOf(r) === -1; }));
        }
        related = related.slice(0, 4);

        if (!related.length) return '';

        return '<section class="related products"><h2>Related products</h2><ul class="products columns-4">'
            + related.map(function(r) {
                const img = mainImage(r);
                return '<li class="product">'
                    + '<a href="' + productUrl(r) + '" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">'
                    +   '<div class="flex items-center justify-center h-40">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(r.name) + '" class="max-h-full object-contain">' : PLACEHOLDER_SVG) + '</div>'
                    +   '<h2 class="woocommerce-loop-product__title">' + esc(r.name) + '</h2>'
                    +   '<span class="price">' + priceHtml(r) + '</span>'
                    + '</a>'
                    + '<a href="#" data-vda-add-to-cart="' + esc(r.id) + '" class="button add_to_cart_button" aria-label="Add to cart: &ldquo;' + esc(r.name) + '&rdquo;">Add to cart</a>'
                    + '</li>';
            }).join('')
            + '</ul></section>';
    }

    function renderProduct() {
        const p = getProduct(param('id') || '');
        const holder = document.querySelector('[data-vda-product-page]');
        const missing = document.querySelector('[data-vda-product-missing]');

        if (!p) {
            if (holder) holder.hidden = true;
            if (missing) missing.hidden = false;
            return;
        }

        document.title = p.name + ' – Naturia';

        const cat = getCategory(p.category);
        const fill = function(selector, html) {
            const el = document.querySelector(selector);
            if (el) el.innerHTML = html;
        };

        holder.setAttribute('data-vda-product', p.id);
        holder.id = 'product-' + p.id;

        fill('[data-vda-breadcrumb]', '<a href="index.html">Home</a>&nbsp;&#47;&nbsp;'
            + (cat ? '<a href="' + categoryUrl(cat.slug) + '">' + esc(cat.name) + '</a>&nbsp;&#47;&nbsp;' : '')
            + esc(p.name));

        fill('[data-vda-p-badges]', (isOnSale(p) ? '<span class="bg-[#AF6E4D] text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-sm">Special Offer</span>' : '')
            + '<span class="bg-[#F5EFEB] text-[#2B1B17] text-[11px] font-bold px-3 py-1 rounded-full border border-[#EBE3DB]">100% Natural</span>');
        fill('[data-vda-p-gallery]', galleryHtml(p));
        fill('[data-vda-p-cats]', cat ? '<a href="' + categoryUrl(cat.slug) + '" rel="tag">' + esc(cat.name) + '</a>' : '');
        fill('[data-vda-p-title]', esc(p.name));
        fill('[data-vda-p-rating]', starRating(p, 'vda-star-rating--lg'));
        fill('[data-vda-p-price]', priceHtml(p));
        fill('[data-vda-p-short]', p.short_description || '');
        fill('[data-vda-p-tabs]', tabsHtml(p));
        fill('[data-vda-p-reviews-rating]', starRating(p, 'vda-star-rating--lg'));
        fill('[data-vda-p-reviews]', reviewsHtml(p));
        fill('[data-vda-p-related]', relatedHtml(p));

        fill('[data-vda-p-meta]', '<span class="sku_wrapper block">SKU: <span class="sku">' + esc(p.sku || 'N/A') + '</span></span>'
            + (cat ? '<span class="posted_in block">Category: <a href="' + categoryUrl(cat.slug) + '" rel="tag">' + esc(cat.name) + '</a></span>' : '')
            + (p.tag ? '<span class="tagged_as block">Tag: <span>' + esc(p.tag) + '</span></span>' : '')
            + (p.seller ? '<span class="sold_by block">Sold by: <span class="font-bold text-[#5C4A42]">' + p.seller + '</span></span>' : ''));

        // Add to Bag form (woocommerce_template_single_add_to_cart).
        // novalidate: Android's WebView shows no "value too large" bubble, so the checks below must speak for themselves.
        fill('#vda-add-to-cart-form', '<form class="cart" action="#" method="post" novalidate data-vda-add-form>'
            + '<div class="quantity">'
            +   '<button type="button" class="vda-step-btn vda-step-minus" data-vda-step="-1" aria-label="Decrease quantity" tabindex="-1">&minus;</button>'
            +   '<label class="screen-reader-text" for="quantity_' + esc(p.id) + '">' + esc(p.name) + ' quantity</label>'
            +   '<input type="number" id="quantity_' + esc(p.id) + '" class="input-text qty text" name="quantity" value="1" aria-label="Product quantity" min="' + (SETTINGS.minQtyPerProduct || 1) + '" max="' + MAX_QTY + '" step="1" inputmode="numeric" autocomplete="off">'
            +   '<button type="button" class="vda-step-btn vda-step-plus" data-vda-step="1" aria-label="Increase quantity" tabindex="-1">&plus;</button>'
            + '</div>'
            + '<button type="submit" name="add-to-cart" value="' + esc(p.id) + '" class="single_add_to_cart_button button alt">Add to Bag</button>'
            + '</form>');

        // Buy Now — pre-JS fallback is the hub; main.js rewires it to the active branch.
        const buy = document.querySelector('[data-vda-buy]');
        if (buy) {
            const hub = hubBranch();
            buy.setAttribute('data-vda-buy', p.id);
            buy.setAttribute('data-product', p.name);
            buy.href = 'https://wa.me/' + encodeURIComponent(hub ? hub.whatsapp : '918714620205') + '?text=' + encodeURIComponent('I am interested in ' + p.name);
        }

        // Add to Bag submit.
        document.addEventListener('submit', function(e) {
            const form = e.target.closest && e.target.closest('[data-vda-add-form]');
            if (!form) return;
            e.preventDefault();
            const qty = form.querySelector('.qty');
            const min = SETTINGS.minQtyPerProduct || 1;
            const wanted = parseInt(qty ? qty.value : 1, 10);
            if (isNaN(wanted) || wanted < min || wanted > MAX_QTY) {
                const fixed = (isNaN(wanted) || wanted < min) ? min : MAX_QTY;
                if (qty) {
                    qty.value = fixed;
                    qty.dispatchEvent(new Event('input', { bubbles: true })); // refresh the − / + buttons
                }
                window.alert('Please choose between ' + min + ' and ' + MAX_QTY + ' sacks. The quantity has been set to ' + fixed + '.');
                return;
            }
            const res = addToCart(p.id, qty ? qty.value : 1);
            if (!res.success) {
                window.alert(res.message);
                return;
            }
            document.dispatchEvent(new CustomEvent('vda:added_to_cart'));
        });

        // Description / Additional information tabs.
        document.addEventListener('click', function(e) {
            const tab = e.target.closest && e.target.closest('.wc-tabs li a');
            if (!tab) return;
            e.preventDefault();
            const target = tab.getAttribute('href');
            document.querySelectorAll('.wc-tabs li').forEach(function(li) { li.classList.remove('active'); });
            tab.parentNode.classList.add('active');
            document.querySelectorAll('.wc-tab').forEach(function(panel) {
                panel.hidden = ('#' + panel.id) !== target;
            });
        });

        // Gallery thumbnails.
        document.addEventListener('click', function(e) {
            const thumb = e.target.closest && e.target.closest('[data-vda-gallery-thumb]');
            if (!thumb) return;
            const main = document.querySelector('[data-vda-gallery-main]');
            if (!main) return;
            main.href = thumb.getAttribute('data-vda-gallery-thumb');
            main.querySelector('img').src = thumb.getAttribute('data-vda-gallery-thumb');
        });

        bindReviewForm(p);
    }

    function bindReviewForm(p) {
        document.addEventListener('click', function(e) {
            const star = e.target.closest && e.target.closest('[data-vda-star]');
            if (!star) return;
            e.preventDefault();
            const value = parseInt(star.getAttribute('data-vda-star'), 10);
            const input = document.getElementById('rating');
            if (input) input.value = value;
            document.querySelectorAll('[data-vda-star]').forEach(function(s) {
                s.textContent = parseInt(s.getAttribute('data-vda-star'), 10) <= value ? '★' : '☆';
            });
        });

        document.addEventListener('submit', function(e) {
            const form = e.target.closest && e.target.closest('[data-vda-review-form]');
            if (!form) return;
            e.preventDefault();

            const rating = parseInt(form.querySelector('#rating').value, 10);
            const comment = form.querySelector('#comment').value.trim();
            const author = form.querySelector('#author').value.trim();
            const email = form.querySelector('#email').value.trim();

            if (!rating) { window.alert('Please select a rating'); return; }
            if (!comment || !author || !email) { window.alert('Please fill in all required fields.'); return; }

            const reviews = localReviews(p);
            reviews.push({ author: author, date: new Date().toISOString().slice(0, 10), rating: rating, text: comment });
            storageSet('vda_reviews_' + p.id, reviews);

            document.querySelector('[data-vda-p-reviews]').innerHTML = reviewsHtml(p);
            document.querySelector('[data-vda-p-reviews-rating]').innerHTML = starRating(p, 'vda-star-rating--lg');
            document.querySelector('[data-vda-p-rating]').innerHTML = starRating(p, 'vda-star-rating--lg');
        });
    }

    /* ======================================================================
       BOOT
       ====================================================================== */

    // Related-product "Add to cart" buttons.
    document.addEventListener('click', function(e) {
        const btn = e.target.closest && e.target.closest('[data-vda-add-to-cart]');
        if (!btn) return;
        e.preventDefault();
        const res = addToCart(btn.getAttribute('data-vda-add-to-cart'), 1);
        if (!res.success) {
            window.alert(res.message);
            return;
        }
        document.dispatchEvent(new CustomEvent('vda:added_to_cart'));
    });

    // Keep tabs in sync when the bag changes in another tab.
    window.addEventListener('storage', function(e) {
        if (e.key === CART_KEY) renderCart();
    });

    document.addEventListener('DOMContentLoaded', function() {
        const page = document.body.getAttribute('data-page');

        renderChrome();

        if (page === 'home') renderHome();
        if (page === 'shop') renderShop();
        if (page === 'product') renderProduct();
    });

    // Public API used by main.js.
    window.VDAStore = {
        cartAction: cartAction,
        addToCart: addToCart,
        renderCart: renderCart,
        storedBranchId: storedBranchId,
        setBranch: setBranch,
        branches: BRANCHES,
        settings: SETTINGS
    };
})();
