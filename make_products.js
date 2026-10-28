// Makes products.json (the list the Android app reads from GET /api/products) out of www/assets/js/data.js.
// Run it after changing a product on the website:   node make_products.js
// (The sample customer reviews in data.js are left out on purpose.)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = path.join(__dirname, 'www', 'assets', 'js', 'data.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(source, 'utf8'), sandbox);
const { VDA_CATEGORIES, VDA_PRODUCTS } = sandbox.window;

const out = {
  categories: VDA_CATEGORIES.map(c => ({ slug: c.slug, name: c.name, image: c.image || '', description: c.description || '' })),
  products: VDA_PRODUCTS.map(p => ({
    id: p.id, name: p.name, category: p.category, tag: p.tag || '', sku: p.sku || '',
    regular_price: p.regular_price, sale_price: p.sale_price === undefined ? '' : p.sale_price,
    date: p.date || '', images: p.images || [],
    short_description: p.short_description || '', description: p.description || '', attributes: p.attributes || []
  }))
};
fs.writeFileSync(path.join(__dirname, 'products.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`products.json: ${out.categories.length} categories, ${out.products.length} products`);
