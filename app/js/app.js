import {
    initDB,
    saveTransaction,
    getAllTransactions,
    getTransactionsByStatus,
    getAllProducts,
    getProductById,
    upsertProduct,
    decrementStock,
    getAllCategories,
    upsertCategory,
    getAllSuppliers,
    upsertSupplier,
} from './db.js';
import { loadConfig, saveConfig, isConfigured } from './config.js';
import { generateReceiptText, formatReceiptESCPOS, generateTestReceipt } from './receipt.js';
import { resizeImageToDataURL } from './image.js';
import {
    connectPrinter as bluetoothConnect,
    disconnectPrinter as bluetoothDisconnect,
    printText,
    isBluetoothSupported,
} from './printer.js';
import { performSync, syncTransaction, syncProduct, syncCategory, syncSupplier, uploadProductImage, fetchReport } from './sync.js';

const { createApp, ref, computed, onMounted } = Vue;

const todayStr = () => new Date().toISOString().slice(0, 10);

createApp({
    setup() {
        // ========================
        // CONFIG & VIEW STATE
        // ========================
        const config = ref(loadConfig());
        const currentView = ref('kasir'); // 'kasir' | 'produk' | 'kategori' | 'supplier' | 'riwayat' | 'laporan'
        const bluetoothSupported = isBluetoothSupported();

        const rupiah = (n) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');

        const switchView = (view) => {
            currentView.value = view;
            if (view === 'riwayat') loadTransactionHistory();
        };

        // ========================
        // KATEGORI
        // ========================
        const categories = ref([]);
        const showCategoryModal = ref(false);
        const editingCategoryId = ref(null);
        const categoryForm = ref({ name: '' });

        const loadCategories = async () => {
            categories.value = await getAllCategories();
        };

        const activeCategories = computed(() => categories.value.filter((c) => c.active !== false));

        const categoryNameById = (id) => {
            const cat = categories.value.find((c) => c.id === id);
            return cat ? cat.name : null;
        };

        const openAddCategory = () => {
            editingCategoryId.value = null;
            categoryForm.value = { name: '' };
            showCategoryModal.value = true;
        };

        const openEditCategory = (category) => {
            editingCategoryId.value = category.id;
            categoryForm.value = { name: category.name };
            showCategoryModal.value = true;
        };

        const saveCategoryForm = async () => {
            const name = categoryForm.value.name.trim();
            if (!name) {
                showNotification('Nama kategori wajib diisi', 'error');
                return;
            }

            const now = new Date().toISOString();
            let category;

            if (editingCategoryId.value) {
                const existing = categories.value.find((c) => c.id === editingCategoryId.value);
                category = { ...existing, name, updated_at: now, sync_status: 'pending' };
            } else {
                category = {
                    id: `CAT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name,
                    active: true,
                    updated_at: now,
                    sync_status: 'pending',
                    device_id: config.value.device_id,
                };
            }

            await upsertCategory(category);
            await loadCategories();
            showCategoryModal.value = false;
            showNotification('Kategori disimpan', 'success');

            if (navigator.onLine && isConfigured(config.value)) {
                syncCategory(config.value, category);
            }
        };

        const toggleCategoryActive = async (category) => {
            const updated = { ...category, active: !category.active, updated_at: new Date().toISOString(), sync_status: 'pending' };
            await upsertCategory(updated);
            await loadCategories();
            showNotification(updated.active ? 'Kategori diaktifkan' : 'Kategori dinonaktifkan', 'info');

            if (navigator.onLine && isConfigured(config.value)) {
                syncCategory(config.value, updated);
            }
        };

        // ========================
        // SUPPLIER
        // ========================
        const suppliers = ref([]);
        const showSupplierModal = ref(false);
        const editingSupplierId = ref(null);
        const supplierForm = ref({ name: '', phone: '', address: '', notes: '' });

        const loadSuppliers = async () => {
            suppliers.value = await getAllSuppliers();
        };

        const activeSuppliers = computed(() => suppliers.value.filter((s) => s.active !== false));

        const supplierNameById = (id) => {
            const sup = suppliers.value.find((s) => s.id === id);
            return sup ? sup.name : null;
        };

        const openAddSupplier = () => {
            editingSupplierId.value = null;
            supplierForm.value = { name: '', phone: '', address: '', notes: '' };
            showSupplierModal.value = true;
        };

        const openEditSupplier = (supplier) => {
            editingSupplierId.value = supplier.id;
            supplierForm.value = {
                name: supplier.name,
                phone: supplier.phone || '',
                address: supplier.address || '',
                notes: supplier.notes || '',
            };
            showSupplierModal.value = true;
        };

        const saveSupplierForm = async () => {
            const name = supplierForm.value.name.trim();
            if (!name) {
                showNotification('Nama supplier wajib diisi', 'error');
                return;
            }

            const now = new Date().toISOString();
            let supplier;
            const fields = {
                name,
                phone: supplierForm.value.phone.trim(),
                address: supplierForm.value.address.trim(),
                notes: supplierForm.value.notes.trim(),
            };

            if (editingSupplierId.value) {
                const existing = suppliers.value.find((s) => s.id === editingSupplierId.value);
                supplier = { ...existing, ...fields, updated_at: now, sync_status: 'pending' };
            } else {
                supplier = {
                    id: `SUP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    ...fields,
                    active: true,
                    updated_at: now,
                    sync_status: 'pending',
                    device_id: config.value.device_id,
                };
            }

            await upsertSupplier(supplier);
            await loadSuppliers();
            showSupplierModal.value = false;
            showNotification('Supplier disimpan', 'success');

            if (navigator.onLine && isConfigured(config.value)) {
                syncSupplier(config.value, supplier);
            }
        };

        const toggleSupplierActive = async (supplier) => {
            const updated = { ...supplier, active: !supplier.active, updated_at: new Date().toISOString(), sync_status: 'pending' };
            await upsertSupplier(updated);
            await loadSuppliers();
            showNotification(updated.active ? 'Supplier diaktifkan' : 'Supplier dinonaktifkan', 'info');

            if (navigator.onLine && isConfigured(config.value)) {
                syncSupplier(config.value, updated);
            }
        };

        // ========================
        // PRODUCTS
        // ========================
        const products = ref([]); // hanya produk aktif, untuk grid kasir
        const allProducts = ref([]); // semua produk, untuk layar kelola produk
        const productSearch = ref('');
        const productCategoryFilter = ref('');
        const showProductModal = ref(false);
        const editingProductId = ref(null);
        const emptyProductForm = () => ({
            name: '',
            price: 0,
            category_id: '',
            supplier_id: '',
            stock: null,
            image_local_data: null,
            image_url: '',
        });
        const productForm = ref(emptyProductForm());

        const loadProducts = async () => {
            allProducts.value = await getAllProducts();
            products.value = allProducts.value.filter((p) => p.active !== false);
        };

        const productImageSrc = (product) => product.image_local_data || product.image_url || '';

        const filteredProducts = computed(() => {
            const q = productSearch.value.trim().toLowerCase();
            return allProducts.value.filter((p) => {
                const matchesSearch = !q || p.name.toLowerCase().includes(q);
                const matchesCategory = !productCategoryFilter.value || p.category_id === productCategoryFilter.value;
                return matchesSearch && matchesCategory;
            });
        });

        const openAddProduct = () => {
            editingProductId.value = null;
            productForm.value = emptyProductForm();
            showProductModal.value = true;
        };

        const openEditProduct = (product) => {
            editingProductId.value = product.id;
            productForm.value = {
                name: product.name,
                price: product.price,
                category_id: product.category_id || '',
                supplier_id: product.supplier_id || '',
                stock: product.stock === null || product.stock === undefined ? null : product.stock,
                image_local_data: product.image_local_data || null,
                image_url: product.image_url || '',
            };
            showProductModal.value = true;
        };

        const handleProductImageChange = async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            try {
                productForm.value.image_local_data = await resizeImageToDataURL(file, 800, 0.7);
            } catch (error) {
                showNotification(`Gagal memproses foto: ${error.message}`, 'error');
            } finally {
                event.target.value = '';
            }
        };

        const removeProductImage = () => {
            productForm.value.image_local_data = null;
            productForm.value.image_url = '';
        };

        const pushProductSync = (product) => {
            if (isOnline.value && isConfigured(config.value)) {
                return syncProduct(config.value, product);
            }
            return Promise.resolve(false);
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

            const hasNewImage = Boolean(productForm.value.image_local_data);
            const now = new Date().toISOString();
            let product;

            if (editingProductId.value) {
                const existing = await getProductById(editingProductId.value);
                product = {
                    ...existing,
                    name,
                    price,
                    category_id: productForm.value.category_id || null,
                    supplier_id: productForm.value.supplier_id || null,
                    stock: stockValue,
                    updated_at: now,
                    sync_status: 'pending',
                };
                if (!hasNewImage && !productForm.value.image_url) {
                    product.image_url = ''; // foto dihapus manual lewat tombol "Hapus Foto"
                }
            } else {
                product = {
                    id: `PRD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name,
                    price,
                    category_id: productForm.value.category_id || null,
                    supplier_id: productForm.value.supplier_id || null,
                    stock: stockValue,
                    active: true,
                    updated_at: now,
                    sync_status: 'pending',
                    device_id: config.value.device_id,
                    image_url: '',
                };
            }

            if (hasNewImage) {
                product.image_local_data = productForm.value.image_local_data;
                product.image_pending_upload = true;
            }

            await upsertProduct(product);
            await loadProducts();
            showProductModal.value = false;
            showNotification('Produk disimpan', 'success');

            // Produk dulu (baris di Sheets harus ada), baru upload foto -- supaya kolom
            // ImageUrl-nya bisa ditempel ke baris yang benar. Kalau offline, keduanya
            // otomatis menyusul lewat performSync() saat online lagi.
            pushProductSync(product).then(() => {
                if (hasNewImage && navigator.onLine && isConfigured(config.value)) {
                    uploadProductImage(config.value, product).then(() => loadProducts());
                }
            });
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
        // RIWAYAT TRANSAKSI (device ini saja, dari IndexedDB lokal)
        // ========================
        const allTransactions = ref([]);
        const historyDateFrom = ref(todayStr());
        const historyDateTo = ref(todayStr());

        const loadTransactionHistory = async () => {
            allTransactions.value = await getAllTransactions();
        };

        const filteredHistory = computed(() => {
            return allTransactions.value
                .filter((t) => {
                    const day = (t.timestamp || '').slice(0, 10);
                    if (historyDateFrom.value && day < historyDateFrom.value) return false;
                    if (historyDateTo.value && day > historyDateTo.value) return false;
                    return true;
                })
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        });

        const historyTotal = computed(() => filteredHistory.value.reduce((sum, t) => sum + (t.total || 0), 0));

        const openHistoryReceipt = (txn) => {
            lastTransaction.value = txn;
            receiptPreview.value = generateReceiptText(txn, config.value);
            showReceiptModal.value = true;
        };

        // ========================
        // LAPORAN HARIAN / BULANAN (gabungan semua device, dari Google Sheets)
        // ========================
        const reportPeriod = ref('daily'); // 'daily' | 'monthly'
        const reportDate = ref(todayStr());
        const reportData = ref(null);
        const loadingReport = ref(false);

        const setReportPeriod = (period) => {
            if (reportPeriod.value === period) return;
            reportPeriod.value = period;
            reportData.value = null;
            const now = new Date();
            reportDate.value = period === 'daily' ? todayStr() : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        };

        const loadReport = async () => {
            if (!navigator.onLine) {
                showNotification('Laporan butuh koneksi internet (data gabungan semua device)', 'error');
                return;
            }
            if (!isConfigured(config.value)) {
                showNotification('Lengkapi ⚙️ Pengaturan dulu', 'error');
                return;
            }
            loadingReport.value = true;
            try {
                reportData.value = await fetchReport(config.value, reportPeriod.value, reportDate.value);
            } catch (error) {
                showNotification(`Gagal memuat laporan: ${error.message}`, 'error');
            } finally {
                loadingReport.value = false;
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
                    await loadCategories();
                    await loadSuppliers();
                    const anythingSynced =
                        result.transactions ||
                        result.productsPushed ||
                        result.productsPulled ||
                        result.categoriesPushed ||
                        result.categoriesPulled ||
                        result.suppliersPushed ||
                        result.suppliersPulled ||
                        result.imagesUploaded;
                    if (anythingSynced) {
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
            await loadCategories();
            await loadSuppliers();
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
            switchView,
            bluetoothSupported,
            rupiah,

            categories,
            activeCategories,
            categoryNameById,
            showCategoryModal,
            editingCategoryId,
            categoryForm,
            openAddCategory,
            openEditCategory,
            saveCategoryForm,
            toggleCategoryActive,

            suppliers,
            activeSuppliers,
            supplierNameById,
            showSupplierModal,
            editingSupplierId,
            supplierForm,
            openAddSupplier,
            openEditSupplier,
            saveSupplierForm,
            toggleSupplierActive,

            products,
            filteredProducts,
            productSearch,
            productCategoryFilter,
            showProductModal,
            editingProductId,
            productForm,
            productImageSrc,
            handleProductImageChange,
            removeProductImage,
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

            historyDateFrom,
            historyDateTo,
            filteredHistory,
            historyTotal,
            openHistoryReceipt,

            reportPeriod,
            reportDate,
            reportData,
            loadingReport,
            setReportPeriod,
            loadReport,

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
