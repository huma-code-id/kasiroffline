// Sinkronisasi transaksi & produk ke/dari backend Google Apps Script.
//
// Catatan penting soal CORS: request ke GAS Web App dikirim dengan
// Content-Type: text/plain (bukan application/json) dan TANPA custom header
// (mis. Authorization) supaya browser mengirimnya sebagai "simple request" dan
// tidak memicu CORS preflight (OPTIONS) — GAS tidak bisa merespons preflight,
// jadi kalau dipicu, semua request akan gagal karena CORS meski server-nya baik-baik saja.
// api_key tetap dikirim, hanya dipindah ke dalam body JSON, bukan header.

import { signData } from './crypto.js';
import { isConfigured } from './config.js';
import {
    getTransactionsByStatus,
    updateTransactionStatus,
    getPendingProducts,
    getProductById,
    upsertProduct,
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
            await upsertProduct({ ...remote, sync_status: 'synced' });
            mergedCount++;
        }
    }

    return mergedCount;
}

// ========================
// ORKESTRATOR
// ========================

export async function performSync(config) {
    const result = { transactions: 0, productsPushed: 0, productsPulled: 0, skipped: false };

    if (!navigator.onLine || !isConfigured(config)) {
        result.skipped = true;
        return result;
    }

    result.transactions = await syncPendingTransactions(config);
    result.productsPushed = await pushPendingProducts(config);
    result.productsPulled = await pullProducts(config);

    return result;
}
