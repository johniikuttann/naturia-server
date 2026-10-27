/**
 * Naturia - Store Data (static HTML edition)
 *
 * In the WordPress theme this data lived in the database (WooCommerce
 * products, the product_cat taxonomy and the vda_branch taxonomy). In the
 * static site it lives here, in one file, and every page renders from it:
 * the header tabs, the footer directory, the homepage category bubbles, the
 * curated grid, the shop catalogue and every product page.
 *
 * To add a product: copy one entry in VDA_PRODUCTS, give it a unique `id`
 * (used in the URL: product.html?id=...), and set its `category` to a slug
 * from VDA_CATEGORIES. To use real photos, drop them in assets/images/ and
 * put the paths in `images` (first one is the main image).
 *
 * Naturia sells dried fruit & vegetable peels and biodegradable waste in BULK
 * (25 kg and 50 kg sacks) to farmers, nurseries, compost makers and gardeners.
 *
 * NOTE: the prices and reviews below are SAMPLE entries. Replace them with
 * real figures before going live.
 */

/* ------------------------------------------------------------------
   BRANCHES — copied from the theme's branch registry snapshot
   (inc/branches/branch-migration.php). Order = display order.
   ------------------------------------------------------------------ */
window.VDA_BRANCHES = []; // App: store / collection-point feature removed.

/* Same settings the theme passed to main.js as VDA_LOCATION_DATA. */
window.VDA_SETTINGS = {
    fallbackShopId: '',
    maxRadiusKm: 40,
    ambiguousKm: 5,
    messageIntro: "Hi Naturia, I am interested in buying",
    maxQtyPerProduct: 100,   // sacks per product per order
    minQtyPerProduct: 1,
    currencySymbol: '₹'
};

/* ------------------------------------------------------------------
   CATEGORIES — replaces the product_cat taxonomy.
   `image` is optional (circle thumbnail on the homepage).
   ------------------------------------------------------------------ */
window.VDA_CATEGORIES = [
    { slug: 'fruit-peels',     name: 'Dried Fruit Peels',     image: 'assets/images/products/banana-peels.svg',           description: '<p>Sun-dried banana, citrus, mango, pomegranate and watermelon peels, supplied in bulk sacks. Light, dry and easy to store — rich in potassium, calcium and natural sugars that feed soil life.</p>' },
    { slug: 'vegetable-waste', name: 'Dried Vegetable Waste', image: 'assets/images/products/mixed-vegetable-scraps.svg', description: '<p>Dried vegetable trimmings, potato peels and onion skins in bulk. Hand-sorted with no plastic, meat or oil — ready for compost pits, farm beds and organic fertiliser making.</p>' },
    { slug: 'kitchen-extras',  name: 'Biodegradable Extras',  image: 'assets/images/products/eggshells.svg',              description: '<p>Crushed eggshells, dried coffee grounds and coconut husk in bulk: biodegradable by-products that add calcium, nitrogen and structure to your soil.</p>' },
    { slug: 'compost-mixes',   name: 'Compost Mixes',         image: 'assets/images/products/compost-starter-mix.svg',    description: '<p>Ready-balanced blends of dried peels and biodegradable waste in 50 kg sacks, for fast composting on farms, in nurseries and in large gardens.</p>' }
];

/* ------------------------------------------------------------------
   PRODUCTS — Naturia's bulk catalogue (SAMPLE prices and reviews).
   Every product is one sack; customers order up to 100 sacks each.
   regular_price = MRP per sack, sale_price = offer price per sack
   ('' when not on sale).
   ------------------------------------------------------------------ */
window.VDA_PRODUCTS = [
    {
        id: 'dried-banana-peels-50kg',
        name: 'Sun-Dried Banana Peels – 50 kg Sack',
        category: 'fruit-peels',
        tag: 'Potassium Rich',
        sku: 'NAT-FP-050',
        seller: 'Naturia',
        regular_price: 2250,
        sale_price: 1750,
        date: '2026-10-08',
        images: ['assets/images/products/banana-peels.svg'],
        short_description: '<p><strong>₹35 per kg</strong> · 50 kg sack. Sun-dried banana peels — one of the best natural sources of <strong>potassium</strong> for banana, coconut, vegetable and flowering crops.</p>',
        description: '<p>Collected from juice shops and households, then sun-dried to below 15% moisture so they store for months without rotting or smell. Supplied in breathable 50 kg sacks with no stickers, plastic or food scraps.</p><p><strong>How to use:</strong> mix into compost pits (about 1 sack per 500 kg of compost), or grind and apply 100–200 g per plant at the root zone every 6–8 weeks. They can also be soaked to make a potassium-rich liquid feed.</p><p><strong>Best for:</strong> banana, coconut, tomato, brinjal, chilli and all flowering and fruiting crops.</p>',
        attributes: [
            ['Pack Size', '50 kg sack'],
            ['Price per kg', '₹35'],
            ['Condition', 'Sun-dried, moisture below 15%'],
            ['Key Nutrients', 'Potassium, phosphorus, calcium'],
            ['Best For', 'Banana, coconut, vegetables, flowering crops'],
            ['Shelf Life', '6 months in a dry store']
        ],
        reviews: [
            { author: 'Gopalan K. (Banana farmer)', date: '2026-09-21', rating: 5, text: 'We use 6 sacks a month around our banana plants. Bunch size has clearly improved and the peels arrive properly dry.' },
            { author: 'Shalini R. (Nursery)', date: '2026-09-28', rating: 5, text: 'Clean, dry and no plastic in the sacks. Good value compared with chemical potash.' },
            { author: 'Biju Thomas', date: '2026-10-02', rating: 5, text: 'Delivered to the farm on time. Easy to store in our shed.' }
        ]
    },
    {
        id: 'dried-citrus-peels-25kg',
        name: 'Sun-Dried Orange & Citrus Peels – 25 kg Sack',
        category: 'fruit-peels',
        tag: 'Natural Pest Repellent',
        sku: 'NAT-FP-025C',
        seller: 'Naturia',
        regular_price: 1250,
        sale_price: 999,
        date: '2026-10-01',
        images: ['assets/images/products/orange-peels.svg'],
        short_description: '<p><strong>₹40 per kg</strong> · 25 kg sack. Orange and sweet-lime peels, sun-dried and crushed. Keeps <strong>ants and aphids</strong> away and adds nitrogen to compost.</p>',
        description: '<p>Dried on clean mats until brittle, so there is no mould and they keep for months. Crushed into flakes for easy spreading.</p><p><strong>How to use:</strong> spread a thin layer around seedlings and nursery beds to discourage ants and aphids, or mix 2–3 kg into every 100 kg of compost. Soak a few handfuls overnight for a mild citrus leaf spray.</p>',
        attributes: [
            ['Pack Size', '25 kg sack'],
            ['Price per kg', '₹40'],
            ['Condition', 'Sun-dried, crushed flakes'],
            ['Key Nutrients', 'Nitrogen, calcium, citrus oils'],
            ['Best For', 'Nurseries, seedlings, natural pest control'],
            ['Shelf Life', '6 months in a dry store']
        ],
        reviews: [
            { author: 'Meera Nair (Nursery owner)', date: '2026-10-05', rating: 5, text: 'Ant problems in our seedling trays have almost gone. The whole shed smells of oranges!' },
            { author: 'Anoop V.', date: '2026-10-07', rating: 4, text: 'Properly dry and well packed.' }
        ]
    },
    {
        id: 'dried-pomegranate-peels-25kg',
        name: 'Dried Pomegranate Peels – 25 kg Sack',
        category: 'fruit-peels',
        tag: '',
        sku: 'NAT-FP-025P',
        seller: 'Naturia',
        regular_price: 1100,
        sale_price: '',
        date: '2026-09-25',
        images: ['assets/images/products/pomegranate-peels.svg'],
        short_description: '<p><strong>₹44 per kg</strong> · 25 kg sack. Thick dried pomegranate rinds with natural tannins that help <strong>prevent fungal problems</strong> in soil.</p>',
        description: '<p>Collected from juice counters and dried in the sun. Thick and fibrous, so they add structure to compost and help it hold moisture.</p><p><strong>How to use:</strong> mix into compost, or powder and add 1–2 kg per 100 kg of potting mix to help protect against root rot.</p>',
        attributes: [
            ['Pack Size', '25 kg sack'],
            ['Price per kg', '₹44'],
            ['Condition', 'Sun-dried'],
            ['Key Nutrients', 'Potassium, tannins, antioxidants'],
            ['Best For', 'Compost, potting mixes, nurseries']
        ],
        reviews: []
    },
    {
        id: 'dried-mango-peels-50kg',
        name: 'Dried Mango Peels – 50 kg Sack (Seasonal)',
        category: 'fruit-peels',
        tag: 'Seasonal',
        sku: 'NAT-FP-050M',
        seller: 'Naturia',
        regular_price: 1500,
        sale_price: 1250,
        date: '2026-09-18',
        images: ['assets/images/products/mango-peels.svg'],
        short_description: '<p><strong>₹25 per kg</strong> · 50 kg sack. Dried peels from pickle and pulp makers that <strong>feed earthworms and soil microbes</strong> and break down fast in compost.</p>',
        description: '<p>Collected from home-food units making mango pickle and pulp, then dried so they can be stored and transported without fermenting.</p><p><strong>How to use:</strong> add to compost pits and vermicompost beds, layered with dry leaves. Available during the mango season only.</p>',
        attributes: [
            ['Pack Size', '50 kg sack'],
            ['Price per kg', '₹25'],
            ['Condition', 'Dried'],
            ['Key Nutrients', 'Natural sugars, potassium'],
            ['Best For', 'Compost pits, vermicompost units']
        ],
        reviews: [
            { author: 'Rajesh P. (Vermicompost unit)', date: '2026-09-26', rating: 4, text: 'Our worm beds love these. They broke down in about three weeks.' }
        ]
    },
    {
        id: 'dried-watermelon-rind-25kg',
        name: 'Dried Watermelon Rind Flakes – 25 kg Sack',
        category: 'fruit-peels',
        tag: '',
        sku: 'NAT-FP-025W',
        seller: 'Naturia',
        regular_price: 900,
        sale_price: 750,
        date: '2026-09-12',
        images: ['assets/images/products/watermelon-rinds.svg'],
        short_description: '<p><strong>₹30 per kg</strong> · 25 kg sack. Dried rind flakes that <strong>soak up water and keep compost moist</strong> in Kerala\'s heat.</p>',
        description: '<p>Rinds from juice stalls, sliced and dried into light flakes. Re-wets quickly, so it keeps compost and mulch layers from drying out.</p><p><strong>How to use:</strong> mix with dry leaves or coir pith in compost, or use as mulch under coconut and banana trees.</p>',
        attributes: [
            ['Pack Size', '25 kg sack'],
            ['Price per kg', '₹30'],
            ['Condition', 'Dried flakes'],
            ['Key Nutrients', 'Potassium, magnesium'],
            ['Best For', 'Compost moisture, mulch for trees']
        ],
        reviews: []
    },
    {
        id: 'dried-potato-peels-50kg',
        name: 'Dried Potato Peels – 50 kg Sack',
        category: 'vegetable-waste',
        tag: '',
        sku: 'NAT-VW-050P',
        seller: 'Naturia',
        regular_price: 1400,
        sale_price: 1150,
        date: '2026-10-06',
        images: ['assets/images/products/potato-peels.svg'],
        short_description: '<p><strong>₹23 per kg</strong> · 50 kg sack. Clean dried potato peels from hotel kitchens. Add <strong>potassium and starch</strong> that feed beneficial soil bacteria.</p>',
        description: '<p>Washed before peeling and dried the same day, so they will not sprout or rot in storage. No cooked food or oil.</p><p><strong>How to use:</strong> mix into compost pits and organic manure preparations. Composted, they make excellent food for all field crops.</p>',
        attributes: [
            ['Pack Size', '50 kg sack'],
            ['Price per kg', '₹23'],
            ['Condition', 'Washed, dried'],
            ['Key Nutrients', 'Potassium, phosphorus, starch'],
            ['Best For', 'Compost, organic manure making']
        ],
        reviews: [
            { author: 'Sunitha K. (Organic farm)', date: '2026-10-09', rating: 5, text: 'Very clean, no plastic at all. We order 10 sacks a month for our compost yard.' }
        ]
    },
    {
        id: 'onion-garlic-skins-25kg',
        name: 'Dried Onion & Garlic Skins – 25 kg Sack',
        category: 'vegetable-waste',
        tag: 'Plant Tonic',
        sku: 'NAT-VW-025O',
        seller: 'Naturia',
        regular_price: 1500,
        sale_price: 1250,
        date: '2026-10-03',
        images: ['assets/images/products/onion-garlic-skins.svg'],
        short_description: '<p><strong>₹50 per kg</strong> · 25 kg sack (very light — a large sack). For making <strong>natural plant tonic and pest spray</strong> at farm scale.</p>',
        description: '<p>Papery outer skins only, kept completely dry. Very light, so a 25 kg sack is a large volume.</p><p><strong>How to use:</strong> soak 1 kg in 20 litres of water for 24–48 hours, strain and spray on leaves or drench at the roots weekly. It supplies potassium, calcium and sulphur and helps against aphids and fungal spots.</p>',
        attributes: [
            ['Pack Size', '25 kg sack'],
            ['Price per kg', '₹50'],
            ['Condition', 'Dry'],
            ['Key Nutrients', 'Potassium, calcium, sulphur, quercetin'],
            ['Best For', 'Liquid plant tonic, natural pest spray'],
            ['Shelf Life', '12 months when kept dry']
        ],
        reviews: [
            { author: 'Divya S. (Vegetable farm)', date: '2026-10-06', rating: 5, text: 'Our weekly onion-skin spray keeps the chilli plants healthy.' },
            { author: 'Faisal M.', date: '2026-10-08', rating: 5, text: 'A huge sack for the price. Lasts the whole season.' }
        ]
    },
    {
        id: 'dried-mixed-vegetable-waste-50kg',
        name: 'Dried Mixed Vegetable Waste – 50 kg Sack',
        category: 'vegetable-waste',
        tag: 'Farm Bulk',
        sku: 'NAT-VW-050M',
        seller: 'Naturia',
        regular_price: 1250,
        sale_price: 999,
        date: '2026-10-10',
        images: ['assets/images/products/mixed-vegetable-scraps.svg'],
        short_description: '<p><strong>₹20 per kg</strong> · 50 kg sack. Cabbage leaves, carrot tops, gourd ends and leafy trimmings — dried, hand-sorted <strong>nitrogen-rich green material</strong> for compost and farm beds.</p>',
        description: '<p>Sorted at the market by hand (no plastic covers, rubber bands or rotten produce) and dried so it can be stored and delivered in bulk.</p><p><strong>How to use:</strong> layer with dry leaves, straw or coconut husk (1 part greens to 2 parts browns) in compost pits, keep moist and turn weekly — ready compost in 6–8 weeks. Also suitable for trench composting between crop rows.</p>',
        attributes: [
            ['Pack Size', '50 kg sack'],
            ['Price per kg', '₹20'],
            ['Condition', 'Dried, hand-sorted'],
            ['Key Nutrients', 'Nitrogen, potassium, trace minerals'],
            ['Best For', 'Compost pits, trench composting, farms'],
            ['Bulk Supply', 'Up to 100 sacks per order']
        ],
        reviews: [
            { author: 'Krishnan Kutty (Farmer)', date: '2026-09-30', rating: 5, text: 'We take 20 sacks every month for our banana and vegetable farm. Clean and consistent.' },
            { author: 'Ajith Kumar', date: '2026-10-04', rating: 5, text: 'Great for the compost yard. Black compost in under two months.' },
            { author: 'Leela T.', date: '2026-10-09', rating: 4, text: 'Good mix of greens and well dried.' }
        ]
    },
    {
        id: 'crushed-eggshell-powder-25kg',
        name: 'Crushed Eggshell Powder – 25 kg Sack',
        category: 'kitchen-extras',
        tag: 'Calcium Boost',
        sku: 'NAT-BE-025E',
        seller: 'Naturia',
        regular_price: 1750,
        sale_price: 1499,
        date: '2026-09-29',
        images: ['assets/images/products/eggshells.svg'],
        short_description: '<p><strong>₹60 per kg</strong> · 25 kg sack. Washed, dried and crushed eggshells — natural <strong>calcium</strong> that prevents blossom-end rot in tomato and brinjal.</p>',
        description: '<p>Collected from bakeries and hotels, rinsed, dried at low heat so they don\'t smell, and crushed to a coarse powder.</p><p><strong>How to use:</strong> mix 2–3 kg per 100 kg of potting mix, or apply 50–100 g per plant at planting. Also a good liming material for acidic Kerala soils.</p>',
        attributes: [
            ['Pack Size', '25 kg sack'],
            ['Price per kg', '₹60'],
            ['Condition', 'Washed, dried, crushed'],
            ['Key Nutrients', 'Calcium carbonate (about 95%)'],
            ['Best For', 'Tomato, brinjal, capsicum, acidic soils'],
            ['Shelf Life', '12 months']
        ],
        reviews: [
            { author: 'Priya Menon', date: '2026-10-01', rating: 5, text: 'No more blossom-end rot in our grow-bag tomatoes. Clean powder, no smell.' }
        ]
    },
    {
        id: 'dried-coffee-grounds-25kg',
        name: 'Dried Coffee Grounds – 25 kg Sack',
        category: 'kitchen-extras',
        tag: '',
        sku: 'NAT-BE-025C',
        seller: 'Naturia',
        regular_price: 1500,
        sale_price: 1250,
        date: '2026-10-05',
        images: ['assets/images/products/coffee-grounds.svg'],
        short_description: '<p><strong>₹50 per kg</strong> · 25 kg sack. Spent coffee grounds from cafés, dried. Add <strong>nitrogen</strong> and improve soil texture — loved by earthworms.</p>',
        description: '<p>Collected daily and dried to prevent mould. Filter-coffee and espresso grounds only, with no milk or sugar.</p><p><strong>How to use:</strong> add to compost (up to 20% of the pile) or vermicompost beds. Good for anthurium, roses and acid-loving crops.</p>',
        attributes: [
            ['Pack Size', '25 kg sack'],
            ['Price per kg', '₹50'],
            ['Condition', 'Dried'],
            ['Key Nutrients', 'Nitrogen (~2%), potassium, magnesium'],
            ['Best For', 'Compost, vermicompost, anthurium']
        ],
        reviews: [
            { author: 'Neethu J. (Anthurium grower)', date: '2026-10-08', rating: 4, text: 'Plants look greener. Sacks are well sealed.' }
        ]
    },
    {
        id: 'coconut-husk-coir-50kg',
        name: 'Coconut Husk & Coir Fibre – 50 kg Bale',
        category: 'kitchen-extras',
        tag: 'Mulch',
        sku: 'NAT-BE-050H',
        seller: 'Naturia',
        regular_price: 1200,
        sale_price: 950,
        date: '2026-09-20',
        images: ['assets/images/products/coconut-husk.svg'],
        short_description: '<p><strong>₹19 per kg</strong> · 50 kg bale. Shredded coconut husk and coir — the <strong>brown material</strong> that balances peels in compost, and long-lasting mulch.</p>',
        description: '<p>Sun-dried and shredded into 3–8 cm pieces, pressed into easy-to-carry bales.</p><p><strong>How to use:</strong> lay 5 cm thick as mulch to keep soil cool and moist, line grow bags for drainage, or mix with peels in compost (2 parts husk to 1 part peels).</p>',
        attributes: [
            ['Pack Size', '50 kg bale'],
            ['Price per kg', '₹19'],
            ['Condition', 'Sun-dried, shredded'],
            ['Key Nutrients', 'Carbon, potassium, lignin'],
            ['Best For', 'Mulch, grow-bag drainage, compost browns']
        ],
        reviews: []
    },
    {
        id: 'peel-veg-compost-starter-mix-50kg',
        name: 'Peel & Veg Compost Starter Mix – 50 kg Sack',
        category: 'compost-mixes',
        tag: 'Best Seller',
        sku: 'NAT-CM-050',
        seller: 'Naturia',
        regular_price: 2500,
        sale_price: 1999,
        date: '2026-10-11',
        images: ['assets/images/products/compost-starter-mix.svg'],
        short_description: '<p><strong>₹40 per kg</strong> · 50 kg sack. A ready-balanced blend of dried peels, vegetable waste, eggshells, coffee grounds and coconut husk. Add water and turn weekly for <strong>rich compost in about 45 days</strong>.</p>',
        description: '<p>Greens and browns are mixed in the right ratio at our facility, so farms and gardens get consistent compost without guesswork. Every batch is checked for plastic before packing.</p><p><strong>How to use:</strong> empty into a pit, drum or heap, keep it as moist as a squeezed sponge and turn weekly. In 6–7 weeks you have dark, earthy compost. Adding a little cow dung or old compost speeds it up.</p><p><strong>What\'s inside:</strong> dried banana and citrus peels, vegetable waste, crushed eggshells, coffee grounds and coconut husk.</p>',
        attributes: [
            ['Pack Size', '50 kg sack'],
            ['Price per kg', '₹40'],
            ['Contents', 'Dried peels, vegetable waste, eggshells, coffee grounds, coconut husk'],
            ['Green : Brown Ratio', '1 : 2 (balanced)'],
            ['Compost Ready In', 'About 45 days'],
            ['Best For', 'Farms, nurseries, large gardens']
        ],
        reviews: [
            { author: 'Radhakrishnan M. (Farmer)', date: '2026-09-15', rating: 5, text: 'We turned 20 sacks into compost for our coconut farm. Rich black compost in six weeks.' },
            { author: 'Anitha Nair (Nursery)', date: '2026-09-27', rating: 5, text: 'No smell when kept moist. Our seedlings are growing beautifully.' },
            { author: 'Suresh Kumar', date: '2026-10-03', rating: 5, text: 'Ordered 15 sacks — delivered to the farm gate quickly.' },
            { author: 'Joseph A.', date: '2026-10-10', rating: 5, text: 'Consistent quality from batch to batch. Exactly what a big farm needs.' }
        ]
    }
];
