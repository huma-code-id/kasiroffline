// Pengaturan per-device, disimpan di localStorage.
// Tidak ada secret yang di-hardcode di source — semua diisi lewat panel "Pengaturan" di app.

const STORAGE_KEY = 'kasir_config';

const DEFAULTS = {
    store_name: 'Toko Anda',
    store_address: '',
    store_phone: '',
    device_id: '',
    gas_endpoint: '',
    api_key: '',
    api_secret: '',
    default_tax_percent: 10,
    default_cashier: 'Kasir 1',
    printer_service_uuid: '',
    admin_pin_hash: '', // kosong = Pengaturan tidak terkunci
    logo_url: '', // logo toko tersinkron dari cloud (Drive) -- sama otomatis di semua device toko yang sama
    logo_local_data: null, // data URL logo yang baru dipilih di device ini, menunggu upload ke cloud
    logo_pending_upload: false,
};

function generateDeviceId() {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `POS-${rand}`;
}

export function loadConfig() {
    let stored = {};
    try {
        stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
        stored = {};
    }

    const config = { ...DEFAULTS, ...stored };

    // Device ID harus stabil per-device: generate sekali & simpan.
    if (!config.device_id) {
        config.device_id = generateDeviceId();
        saveConfig(config);
    }

    return config;
}

export function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isConfigured(config) {
    return Boolean(config.gas_endpoint && config.api_key && config.api_secret);
}
