// Lapisan IndexedDB: object store `transactions`, `products`, `categories`, `suppliers`.
// Semua fungsi mengembalikan Promise supaya bisa dipakai dengan async/await di app.js.

const DB_NAME = 'KasirOfflineDB';
const DB_VERSION = 2;

let dbInstance = null;

export function initDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('transactions')) {
                const store = db.createObjectStore('transactions', { keyPath: 'id' });
                store.createIndex('sync_status', 'sync_status', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }

            if (!db.objectStoreNames.contains('products')) {
                const store = db.createObjectStore('products', { keyPath: 'id' });
                store.createIndex('sync_status', 'sync_status', { unique: false });
                store.createIndex('active', 'active', { unique: false });
            }

            if (!db.objectStoreNames.contains('categories')) {
                const store = db.createObjectStore('categories', { keyPath: 'id' });
                store.createIndex('sync_status', 'sync_status', { unique: false });
            }

            if (!db.objectStoreNames.contains('suppliers')) {
                const store = db.createObjectStore('suppliers', { keyPath: 'id' });
                store.createIndex('sync_status', 'sync_status', { unique: false });
            }
        };
    });
}

function getStore(storeName, mode = 'readonly') {
    const tx = dbInstance.transaction([storeName], mode);
    return tx.objectStore(storeName);
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ========================
// TRANSACTIONS
// ========================

export async function saveTransaction(transaction) {
    return requestToPromise(getStore('transactions', 'readwrite').add(transaction));
}

export async function getAllTransactions() {
    return requestToPromise(getStore('transactions').getAll());
}

export async function getTransactionsByStatus(status) {
    const store = getStore('transactions');
    const index = store.index('sync_status');
    return requestToPromise(index.getAll(status));
}

export async function updateTransactionStatus(id, newStatus, extra = {}) {
    const store = getStore('transactions', 'readwrite');
    const data = await requestToPromise(store.get(id));
    if (!data) return;
    Object.assign(data, { sync_status: newStatus }, extra);
    return requestToPromise(store.put(data));
}

// ========================
// PRODUCTS
// ========================

export async function getAllProducts() {
    return requestToPromise(getStore('products').getAll());
}

export async function getActiveProducts() {
    const all = await getAllProducts();
    return all.filter((p) => p.active !== false);
}

export async function getProductById(id) {
    return requestToPromise(getStore('products').get(id));
}

// Tambah baru atau timpa produk yang sudah ada (dipakai UI lokal & saat merge dari server).
export async function upsertProduct(product) {
    return requestToPromise(getStore('products', 'readwrite').put(product));
}

export async function getPendingProducts() {
    const store = getStore('products');
    const index = store.index('sync_status');
    return requestToPromise(index.getAll('pending'));
}

export async function markProductSynced(id) {
    const store = getStore('products', 'readwrite');
    const data = await requestToPromise(store.get(id));
    if (!data) return;
    data.sync_status = 'synced';
    return requestToPromise(store.put(data));
}

// Kurangi stok produk setelah transaksi (boleh jadi negatif, tidak diblokir — hanya indikator UI).
export async function decrementStock(productId, qty) {
    const store = getStore('products', 'readwrite');
    const product = await requestToPromise(store.get(productId));
    if (!product || product.stock === null || product.stock === undefined) return;
    product.stock -= qty;
    product.updated_at = new Date().toISOString();
    product.sync_status = 'pending';
    return requestToPromise(store.put(product));
}

// Produk yang punya foto lokal menunggu upload ke Drive (dibuat/diedit saat offline).
export async function getProductsPendingImageUpload() {
    const all = await getAllProducts();
    return all.filter((p) => p.image_pending_upload && p.image_local_data);
}

// ========================
// CATEGORIES
// ========================

export async function getAllCategories() {
    return requestToPromise(getStore('categories').getAll());
}

export async function getActiveCategories() {
    const all = await getAllCategories();
    return all.filter((c) => c.active !== false);
}

export async function getCategoryById(id) {
    if (!id) return null;
    return requestToPromise(getStore('categories').get(id));
}

export async function upsertCategory(category) {
    return requestToPromise(getStore('categories', 'readwrite').put(category));
}

export async function getPendingCategories() {
    const store = getStore('categories');
    const index = store.index('sync_status');
    return requestToPromise(index.getAll('pending'));
}

// ========================
// SUPPLIERS
// ========================

export async function getAllSuppliers() {
    return requestToPromise(getStore('suppliers').getAll());
}

export async function getActiveSuppliers() {
    const all = await getAllSuppliers();
    return all.filter((s) => s.active !== false);
}

export async function getSupplierById(id) {
    if (!id) return null;
    return requestToPromise(getStore('suppliers').get(id));
}

export async function upsertSupplier(supplier) {
    return requestToPromise(getStore('suppliers', 'readwrite').put(supplier));
}

export async function getPendingSuppliers() {
    const store = getStore('suppliers');
    const index = store.index('sync_status');
    return requestToPromise(index.getAll('pending'));
}
