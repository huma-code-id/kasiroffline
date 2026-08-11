import {
    initDB,
    saveTransaction,
    getTransactionsByStatus,
    getAllProducts,
    getProductById,
    upsertProduct,
    decrementStock,
} from './db.js';
import { loadConfig, saveConfig, isConfigured } from './config.js';
import { generateReceiptText, formatReceiptESCPOS, generateTestReceipt } from './receipt.js';
import {
    connectPrinter as bluetoothConnect,
    disconnectPrinter as bluetoothDisconnect,
    printText,
    isBluetoothSupported,
} from './printer.js';
import { performSync, syncTransaction, syncProduct } from './sync.js';

const { createApp, ref, computed, onMounted } = Vue;

createApp({
    setup() {
        // ========================
        // CONFIG & VIEW STATE
        // ========================
        const config = ref(loadConfig());
        const currentView = ref('kasir'); // 'kasir' | 'produk'
        const bluetoothSupported = isBluetoothSupported();

        const rupiah = (n) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');

        // ========================
        // PRODUCTS
        // ========================
        const products = ref([]); // hanya produk aktif, untuk grid kasir
        const allProducts = ref([]); // semua produk, untuk layar kelola produk
        const productSearch = ref('');
        const productCategoryFilter = ref('');
        const showProductModal = ref(false);
        const editingProductId = ref(null);
        const productForm = ref({ name: '', price: 0, category: '', stock: null });

        const loadProducts = async () => {
            allProducts.value = await getAllProducts();
            products.value = allProducts.value.filter((p) => p.active !== false);
        };

        const filteredProducts = computed(() => {
            const q = productSearch.value.trim().toLowerCase();
            return allProducts.value.filter((p) => {
                const matchesSearch = !q || p.name.toLowerCase().includes(q);
                const matchesCategory = !productCategoryFilter.value || p.category === productCategoryFilter.value;
                return matchesSearch && matchesCategory;
            });
        });

        const productCategories = computed(() => {
            const set = new Set(allProducts.value.map((p) => p.category).filter(Boolean));
            return Array.from(set).sort();
        });

        const openAddProduct = () => {
            editingProductId.value = null;
            productForm.value = { name: '', price: 0, category: '', stock: null };
            showProductModal.value = true;
        };

        const openEditProduct = (product) => {
            editingProductId.value = product.id;
            productForm.value = {
                name: product.name,
                price: product.price,
                category: product.category || '',
                stock: product.stock === null || product.stock === undefined ? null : product.stock,
            };
            showProductModal.value = true;
        };

        const pushProductSync = (product) => {
            if (isOnline.value && isConfigured(config.value)) {
                syncProduct(config.value, product);
            }
        };

        const saveProductForm = async () => {
            const name = productForm.value.name.trim();
            const price = Number(productForm.value.price);

            if (!name || Number.isNaN(price) || price < 0) {
                showNotification('Nama & harga produk wajib diisi dengan benar', 'error');
                return;
            }

            const stockValue =
                productForm.value.stock === '' || productForm.value.stock === null || productForm.value.stock === undefined
                    ? null
                    : Number(productForm.value.stock);

            const now = new Date().toISOString();
            let product;

            if (editingProductId.value) {
                const existing = await getProductById(editingProductId.value);
                product = {
                    ...existing,
                    name,
                    price,
                    category: productForm.value.category.trim(),
                    stock: stockValue,
                    updated_at: now,
                    sync_status: 'pending',
                };
            } else {
                product = {
                    id: `PRD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name,
                    price,
                    category: productForm.value.category.trim(),
                    stock: stockValue,
                    active: true,
                    updated_at: now,
                    sync_status: 'pending',
                    device_id: config.value.device_id,
                };
            }

            await upsertProduct(product);
            await loadProducts();
            showProductModal.value = false;
            showNotification('Produk disimpan', 'success');
            pushProductSync(product);
        };

        const toggleProductActive = async (product) => {
            const updated = {
                ...product,
                active: !product.active,
                updated_at: new Date().toISOString(),
                sync_status: 'pending',
            };
            await upsertProduct(updated);
            await loadProducts();
            showNotification(updated.active ? 'Produk diaktifkan' : 'Produk dinonaktifkan', 'info');
            pushProductSync(updated);
        };

        const isInCart = (productId) => cart.value.some((item) => item.id === productId);

        // ========================
        // CART
        // ========================
        const cart = ref([]);
        const discountPercent = ref(0);
        const taxPercent = ref(config.value.default_tax_percent);
        const cashierName = ref(config.value.default_cashier);
        const paymentMethod = ref('cash');

        const addToCart = (product) => {
            const existing = cart.value.find((item) => item.id === product.id);
            if (existing) {
                existing.qty++;
            } else {
                cart.value.push({ id: product.id, name: product.name, price: product.price, stock: product.stock, qty: 1 });
            }
        };

        const incrementQty = (productId) => {
            const item = cart.value.find((item) => item.id === productId);
            if (item) item.qty++;
        };

        const decrementQty = (productId) => {
            const item = cart.value.find((item) => item.id === productId);
            if (item && item.qty > 1) item.qty--;
        };

        const removeFromCart = (productId) => {
            cart.value = cart.value.filter((item) => item.id !== productId);
        };

        const clearCart = () => {
            cart.value = [];
            discountPercent.value = 0;
            taxPercent.value = config.value.default_tax_percent;
        };

        const subtotal = computed(() => cart.value.reduce((sum, item) => sum + item.price * item.qty, 0));
        const discountAmount = computed(() => Math.floor(subtotal.value * (discountPercent.value / 100)));
        const afterDiscount = computed(() => subtotal.value - discountAmount.value);
        const taxAmount = computed(() => Math.floor(afterDiscount.value * (taxPercent.value / 100)));
        const total = computed(() => afterDiscount.value + taxAmount.value);

        // ========================
        // TRANSAKSI
        // ========================
        const showReceiptModal = ref(false);
        const receiptPreview = ref('');
        const lastTransaction = ref(null);
        const pendingTransactions = ref([]);

        const refreshPendingTransactions = async () => {
            pendingTransactions.value = await getTransactionsByStatus('pending');
        };

        const completeTransaction = async () => {
            if (cart.value.length === 0) return;

            const transactionData = {
                id: `TXN-${Date.now()}`,
                timestamp: new Date().toISOString(),
                cashier: cashierName.value || 'Kasir',
                items: cart.value.map((item) => ({ id: item.id, name: item.name, price: item.price, qty: item.qty })),
                subtotal: subtotal.value,
                discount_percent: discountPercent.value,
                discount_amount: discountAmount.value,
                tax_percent: taxPercent.value,
                tax: taxAmount.value,
                total: total.value,
                payment_method: paymentMethod.value,
                device_id: config.value.device_id,
                sync_status: 'pending',
            };

            try {
                await saveTransaction(transactionData);

                for (const item of cart.value) {
                    await decrementStock(item.id, item.qty);
                }
                await loadProducts();

                receiptPreview.value = generateReceiptText(transactionData, config.value);
                lastTransaction.value = transactionData;

                if (printerConnected.value) {
                    try {
                        await printText(formatReceiptESCPOS(transactionData, config.value));
                        showNotification('Print berhasil!', 'success');
                    } catch (err) {
                        showNotification(`Error print: ${err.message}`, 'error');
                    }
                }

                showNotification('Transaksi selesai! ' + transactionData.id, 'success');
                showReceiptModal.value = true;
                clearCart();
                await refreshPendingTransactions();

                if (navigator.onLine && isConfigured(config.value)) {
                    syncTransaction(config.value, transactionData).then((ok) => {
                        if (ok && lastTransaction.value && lastTransaction.value.id === transactionData.id) {
                            lastTransaction.value.sync_status = 'synced';
                        }
                        refreshPendingTransactions();
                    });
                }
            } catch (error) {
                showNotification(`Error transaksi: ${error.message}`, 'error');
            }
        };

        const handlePrintReceipt = async () => {
            if (!lastTransaction.value) return;
            try {
                await printText(formatReceiptESCPOS(lastTransaction.value, config.value));
                showNotification('Print berhasil!', 'success');
            } catch (error) {
                showNotification(`Error print: ${error.message}`, 'error');
            }
        };

        // ========================
        // PRINTER
        // ========================
        const printerConnected = ref(false);
        const connectedPrinterName = ref('');

        const handleConnectPrinter = async () => {
            try {
                const info = await bluetoothConnect(config.value.printer_service_uuid || undefined);
                printerConnected.value = true;
                connectedPrinterName.value = info.name;
                showNotification('Printer terhubung!', 'success');
            } catch (error) {
                showNotification(`Error koneksi printer: ${error.message}`, 'error');
            }
        };

        const handleDisconnectPrinter = () => {
            bluetoothDisconnect();
            printerConnected.value = false;
            connectedPrinterName.value = '';
            showNotification('Printer terputus', 'info');
        };

        const handleTestPrinter = async () => {
            try {
                await printText(generateTestReceipt(config.value));
                showNotification('Test print berhasil!', 'success');
            } catch (error) {
                showNotification(`Error print: ${error.message}`, 'error');
            }
        };

        // ========================
        // SYNC
        // ========================
        const isOnline = ref(navigator.onLine);
        const syncing = ref(false);

        const runSync = async () => {
            if (syncing.value) return;
            syncing.value = true;
            try {
                const result = await performSync(config.value);
                if (!result.skipped) {
                    await refreshPendingTransactions();
                    await loadProducts();
                    if (result.transactions || result.productsPushed || result.productsPulled) {
                        showNotification('Sinkronisasi selesai', 'success');
                    }
                }
            } finally {
                syncing.value = false;
            }
        };

        const handleOnline = () => {
            isOnline.value = true;
            showNotification('Online - Sinkronisasi dimulai', 'success');
            runSync();
        };

        const handleOffline = () => {
            isOnline.value = false;
            showNotification('Offline - Transaksi akan di-queue', 'info');
        };

        // ========================
        // PENGATURAN
        // ========================
        const showSettingsModal = ref(false);
        const settingsForm = ref({});

        const openSettings = () => {
            settingsForm.value = { ...config.value };
            showSettingsModal.value = true;
        };

        const saveSettings = () => {
            config.value = { ...config.value, ...settingsForm.value };
            saveConfig(config.value);
            showSettingsModal.value = false;
            showNotification('Pengaturan disimpan', 'success');
            if (navigator.onLine) runSync();
        };

        // ========================
        // NOTIFIKASI
        // ========================
        const notifications = ref([]);

        const showNotification = (message, type = 'info') => {
            const id = Math.random();
            notifications.value.push({ id, message, type });
            setTimeout(() => {
                notifications.value = notifications.value.filter((n) => n.id !== id);
            }, 3000);
        };

        // ========================
        // LIFECYCLE
        // ========================
        onMounted(async () => {
            await initDB();
            await loadProducts();
            await refreshPendingTransactions();

            window.addEventListener('online', handleOnline);
            window.addEventListener('offline', handleOffline);

            setInterval(() => {
                if (isOnline.value) runSync();
            }, 30000);

            if (!isConfigured(config.value)) {
                showNotification('Lengkapi ⚙️ Pengaturan untuk mengaktifkan sinkronisasi', 'info');
            } else if (isOnline.value) {
                runSync();
            }

            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./service-worker.js').catch((err) => {
                    console.warn('Service worker gagal didaftarkan:', err);
                });
            }

            showNotification('Aplikasi siap digunakan', 'success');
        });

        return {
            config,
            currentView,
            bluetoothSupported,
            rupiah,

            products,
            filteredProducts,
            productCategories,
            productSearch,
            productCategoryFilter,
            showProductModal,
            editingProductId,
            productForm,
            openAddProduct,
            openEditProduct,
            saveProductForm,
            toggleProductActive,
            isInCart,

            cart,
            discountPercent,
            taxPercent,
            cashierName,
            paymentMethod,
            subtotal,
            discountAmount,
            taxAmount,
            total,
            addToCart,
            incrementQty,
            decrementQty,
            removeFromCart,
            clearCart,

            completeTransaction,
            showReceiptModal,
            receiptPreview,
            lastTransaction,
            handlePrintReceipt,
            pendingTransactions,

            printerConnected,
            connectedPrinterName,
            handleConnectPrinter,
            handleDisconnectPrinter,
            handleTestPrinter,

            isOnline,
            syncing,
            runSync,

            showSettingsModal,
            settingsForm,
            openSettings,
            saveSettings,

            notifications,
        };
    },
}).mount('#app');
