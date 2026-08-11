// Lapisan IndexedDB: object store `transactions` dan `products`.
// Semua fungsi mengembalikan Promise supaya bisa dipakai dengan async/await di app.js.

const DB_NAME = 'KasirOfflineDB';
const DB_VERSION = 1;

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
