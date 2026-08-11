// Sinkronisasi transaksi, produk, kategori, supplier, & foto produk ke/dari backend Google Apps Script.
//
// Catatan penting soal CORS: request ke GAS Web App dikirim dengan
// Content-Type: text/plain (bukan application/json) dan TANPA custom header
// (mis. Authorization) supaya browser mengirimnya sebagai "simple request" dan
// tidak memicu CORS preflight (OPTIONS) — GAS tidak bisa merespons preflight,
// jadi kalau dipicu, semua request akan gagal karena CORS meski server-nya baik-baik saja.
// api_key tetap dikirim, hanya dipindah ke dalam body JSON, bukan header.

import { signData } from './crypto.js';
import { isConfigured } from './config.js';
import { dataURLToBase64 } from './image.js';
import {
    getTransactionsByStatus,
    updateTransactionStatus,
    getPendingProducts,
    getProductById,
    upsertProduct,
    getProductsPendingImageUpload,
    getPendingCategories,
    getCategoryById,
    upsertCategory,
    getPendingSuppliers,
    getSupplierById,
    upsertSupplier,
} from './db.js';

async function postJSON(endpoint, envelope) {
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(envelope),
        });
        return await response.json();
    } catch (error) {
        return { success: false, error: error.message || 'Network error' };
    }
}

async function buildSignedEnvelope(action, config, data) {
    return {
        action,
        device_id: config.device_id,
        api_key: config.api_key,
        timestamp: new Date().toISOString(),
        signature: await signData(data, config.api_secret),
        data,
    };
}

// ========================
// TRANSAKSI
// ========================

export async function syncTransaction(config, transaction) {
    const envelope = await buildSignedEnvelope('sync_transaction', config, transaction);
    const result = await postJSON(config.gas_endpoint, envelope);

    if (result.success) {
        await updateTransactionStatus(transaction.id, 'synced', {
            synced_at: new Date().toISOString(),
        });
        return true;
    }

    // Gagal (network/validasi) -> biarkan status apa adanya, akan dicoba lagi sync berikutnya.
    console.warn('Sync transaksi gagal:', transaction.id, result.error);
    return false;
}

export async function syncPendingTransactions(config) {
    const pending = await getTransactionsByStatus('pending');
    let syncedCount = 0;
    for (const txn of pending) {
        const ok = await syncTransaction(config, txn);
        if (ok) syncedCount++;
    }
    return syncedCount;
}

// ========================
// PRODUK
// ========================

export async function syncProduct(config, product) {
    const envelope = await buildSignedEnvelope('sync_product', config, product);
    const result = await postJSON(config.gas_endpoint, envelope);

    if (result.success) {
        await upsertProduct({ ...product, sync_status: 'synced' });
        return true;
    }

    console.warn('Sync produk gagal:', product.id, result.error);
    return false;
}

export async function pushPendingProducts(config) {
    const pending = await getPendingProducts();
    let syncedCount = 0;
    for (const product of pending) {
        const ok = await syncProduct(config, product);
        if (ok) syncedCount++;
    }
    return syncedCount;
}

export async function pullProducts(config) {
    const envelope = {
        action: 'get_products',
        device_id: config.device_id,
        api_key: config.api_key,
        timestamp: new Date().toISOString(),
    };
    const result = await postJSON(config.gas_endpoint, envelope);
    if (!result.success) return 0;

    const remoteProducts = (result.data && result.data.products) || [];
    let mergedCount = 0;

    for (const remote of remoteProducts) {
        const local = await getProductById(remote.id);

        // Produk lokal yang masih menunggu sync (belum pernah terkirim) tidak boleh
        // ditimpa oleh data lama dari server, supaya perubahan yang belum terkirim tidak hilang.
        if (local && local.sync_status === 'pending') continue;

        const remoteIsNewer = !local || new Date(remote.updated_at) > new Date(local.updated_at);
        if (remoteIsNewer) {
            // Foto lokal yang belum sempat diupload (offline) jangan ditimpa oleh data server.
            const preserved = local && local.image_pending_upload ? { image_local_data: local.image_local_data, image_pending_upload: true } : {};
            await upsertProduct({ ...remote, sync_status: 'synced', ...preserved });
            mergedCount++;
        }
    }

    return mergedCount;
}

// ========================
// FOTO PRODUK
// ========================

export async function uploadProductImage(config, product) {
    if (!product.image_local_data) return false;

    const { base64, mimeType } = dataURLToBase64(product.image_local_data);
    const payload = {
        product_id: product.id,
        filename: product.id + '.jpg',
        mime_type: mimeType,
        image_base64: base64,
    };

    const envelope = await buildSignedEnvelope('upload_product_image', config, payload);
    const result = await postJSON(config.gas_endpoint, envelope);

    if (result.success && result.data && result.data.image_url) {
        await upsertProduct({
            ...product,
            image_url: result.data.image_url,
            image_local_data: null,
            image_pending_upload: false,
        });
        return true;
    }

    console.warn('Upload foto produk gagal:', product.id, result.error);
    return false;
}

export async function pushPendingProductImages(config) {
    const pending = await getProductsPendingImageUpload();
    let count = 0;
    for (const product of pending) {
        const ok = await uploadProductImage(config, product);
        if (ok) count++;
    }
    return count;
}

// ========================
// KATEGORI
// ========================

export async function syncCategory(config, category) {
    const envelope = await buildSignedEnvelope('sync_category', config, category);
    const result = await postJSON(config.gas_endpoint, envelope);

    if (result.success) {
        await upsertCategory({ ...category, sync_status: 'synced' });
        return true;
    }

    console.warn('Sync kategori gagal:', category.id, result.error);
    return false;
}

export async function pushPendingCategories(config) {
    const pending = await getPendingCategories();
    let syncedCount = 0;
    for (const category of pending) {
        const ok = await syncCategory(config, category);
        if (ok) syncedCount++;
    }
    return syncedCount;
}

export async function pullCategories(config) {
    const envelope = {
        action: 'get_categories',
        device_id: config.device_id,
        api_key: config.api_key,
        timestamp: new Date().toISOString(),
    };
    const result = await postJSON(config.gas_endpoint, envelope);
    if (!result.success) return 0;

    const remote = (result.data && result.data.categories) || [];
    let mergedCount = 0;

    for (const remoteCategory of remote) {
        const local = await getCategoryById(remoteCategory.id);
        if (local && local.sync_status === 'pending') continue;

        const remoteIsNewer = !local || new Date(remoteCategory.updated_at) > new Date(local.updated_at);
        if (remoteIsNewer) {
            await upsertCategory({ ...remoteCategory, sync_status: 'synced' });
            mergedCount++;
        }
    }

    return mergedCount;
}

// ========================
// SUPPLIER
// ========================

export async function syncSupplier(config, supplier) {
    const envelope = await buildSignedEnvelope('sync_supplier', config, supplier);
    const result = await postJSON(config.gas_endpoint, envelope);

    if (result.success) {
        await upsertSupplier({ ...supplier, sync_status: 'synced' });
        return true;
    }

    console.warn('Sync supplier gagal:', supplier.id, result.error);
    return false;
}

export async function pushPendingSuppliers(config) {
    const pending = await getPendingSuppliers();
    let syncedCount = 0;
    for (const supplier of pending) {
        const ok = await syncSupplier(config, supplier);
        if (ok) syncedCount++;
    }
    return syncedCount;
}

export async function pullSuppliers(config) {
    const envelope = {
        action: 'get_suppliers',
        device_id: config.device_id,
        api_key: config.api_key,
        timestamp: new Date().toISOString(),
    };
    const result = await postJSON(config.gas_endpoint, envelope);
    if (!result.success) return 0;

    const remote = (result.data && result.data.suppliers) || [];
    let mergedCount = 0;

    for (const remoteSupplier of remote) {
        const local = await getSupplierById(remoteSupplier.id);
        if (local && local.sync_status === 'pending') continue;

        const remoteIsNewer = !local || new Date(remoteSupplier.updated_at) > new Date(local.updated_at);
        if (remoteIsNewer) {
            await upsertSupplier({ ...remoteSupplier, sync_status: 'synced' });
            mergedCount++;
        }
    }

    return mergedCount;
}

// ========================
// LAPORAN
// ========================

// period: 'daily' | 'monthly'. date: 'YYYY-MM-DD' (daily) atau 'YYYY-MM' (monthly).
export async function fetchReport(config, period, date) {
    const envelope = {
        action: 'get_report',
        device_id: config.device_id,
        api_key: config.api_key,
        timestamp: new Date().toISOString(),
        period,
        date,
    };
    const result = await postJSON(config.gas_endpoint, envelope);
    if (!result.success) {
        throw new Error(result.error || 'Gagal memuat laporan');
    }
    return result.data;
}

// ========================
// ORKESTRATOR
// ========================

export async function performSync(config) {
    const result = {
        transactions: 0,
        categoriesPushed: 0,
        categoriesPulled: 0,
        suppliersPushed: 0,
        suppliersPulled: 0,
        productsPushed: 0,
        imagesUploaded: 0,
        productsPulled: 0,
        skipped: false,
    };

    if (!navigator.onLine || !isConfigured(config)) {
        result.skipped = true;
        return result;
    }

    result.transactions = await syncPendingTransactions(config);

    result.categoriesPushed = await pushPendingCategories(config);
    result.categoriesPulled = await pullCategories(config);

    result.suppliersPushed = await pushPendingSuppliers(config);
    result.suppliersPulled = await pullSuppliers(config);

    // Produk dulu (buat/perbarui baris di Sheets), baru upload foto (butuh baris sudah ada
    // supaya kolom ImageUrl-nya bisa diisi), baru tarik data terbaru dari server.
    result.productsPushed = await pushPendingProducts(config);
    result.imagesUploaded = await pushPendingProductImages(config);
    result.productsPulled = await pullProducts(config);

    return result;
}
