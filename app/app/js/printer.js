// Koneksi & print ke printer thermal Bluetooth (Web Bluetooth API).
//
// Catatan: printer thermal murah punya service/characteristic UUID yang tidak standar
// antar merk. Prototype lama pakai `filters: [{ name: /thermal/i }]` — itu TIDAK valid
// di spek Web Bluetooth (name harus exact string, bukan RegExp), jadi requestDevice akan
// gagal filter dan tidak pernah menampilkan printer apapun. Di sini dipakai
// `acceptAllDevices: true` supaya user bisa pilih printer dari daftar semua device
// Bluetooth di sekitar (pola umum untuk printer thermal yang tidak advertise service UUID).

const KNOWN_PRINTER_SERVICES = [
    'ffff',
    '000018f0-0000-1000-8000-00805f9b34fb', // umum dipakai printer thermal generic
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART, umum di printer BLE murah
    '0000ff00-0000-1000-8000-00805f9b34fb',
];

let characteristic = null;
let deviceName = null;

export function isBluetoothSupported() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function isPrinterConnected() {
    return characteristic !== null;
}

export function getConnectedPrinterName() {
    return deviceName;
}

export async function connectPrinter(customServiceUUID) {
    if (!isBluetoothSupported()) {
        throw new Error('Browser ini tidak mendukung Web Bluetooth (coba Chrome/Edge)');
    }

    const optionalServices = customServiceUUID
        ? [customServiceUUID, ...KNOWN_PRINTER_SERVICES]
        : KNOWN_PRINTER_SERVICES;

    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices,
    });

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();

    let writableChar = null;
    for (const service of services) {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
                writableChar = char;
                break;
            }
        }
        if (writableChar) break;
    }

    if (!writableChar) {
        throw new Error('Tidak menemukan characteristic yang bisa ditulis pada printer ini. Coba isi "Service UUID kustom" di Pengaturan sesuai dokumentasi printer.');
    }

    characteristic = writableChar;
    deviceName = device.name || 'Printer Bluetooth';

    device.addEventListener('gattserverdisconnected', () => {
        characteristic = null;
        deviceName = null;
    });

    return { name: deviceName };
}

export function disconnectPrinter() {
    characteristic = null;
    deviceName = null;
}

export async function printText(text) {
    if (!characteristic) {
        throw new Error('Printer tidak terhubung');
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const chunkSize = 20; // batas aman payload BLE write per-call

    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        if (characteristic.properties.writeWithoutResponse) {
            await characteristic.writeValueWithoutResponse(chunk);
        } else {
            await characteristic.writeValue(chunk);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
