// Generate teks struk (untuk preview modal) dan perintah ESC/POS (untuk printer thermal 58mm).

const WIDTH = 32; // 58mm thermal ~= 32 karakter per baris (font normal)

function rule(char = '=') {
    return char.repeat(WIDTH);
}

function center(text) {
    const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
    return ' '.repeat(pad) + text;
}

export function generateReceiptText(transaction, config) {
    const lines = [];
    lines.push(rule('='));
    lines.push(center(config.store_name || 'Toko Anda'));
    if (config.store_address) lines.push(center(config.store_address));
    if (config.store_phone) lines.push(center(config.store_phone));
    lines.push(rule('='));
    lines.push('');
    lines.push(`No Invoice: ${transaction.id}`);
    lines.push(`Tanggal   : ${new Date(transaction.timestamp).toLocaleString('id-ID')}`);
    lines.push(`Kasir     : ${transaction.cashier}`);
    lines.push(rule('='));

    transaction.items.forEach((item) => {
        lines.push(`${item.name} x${item.qty}`);
        lines.push(`  Rp ${(item.price * item.qty).toLocaleString('id-ID')}`);
    });

    lines.push(rule('-'));
    lines.push(`Subtotal              Rp ${transaction.subtotal.toLocaleString('id-ID')}`);
    if (transaction.discount_amount > 0) {
        lines.push(`Diskon ${transaction.discount_percent}%        - Rp ${transaction.discount_amount.toLocaleString('id-ID')}`);
    }
    if (transaction.tax > 0) {
        lines.push(`Pajak ${transaction.tax_percent}%          + Rp ${transaction.tax.toLocaleString('id-ID')}`);
    }
    lines.push(rule('='));
    lines.push(`TOTAL                 Rp ${transaction.total.toLocaleString('id-ID')}`);
    lines.push(rule('='));
    lines.push(`Pembayaran: ${transaction.payment_method.toUpperCase()}`);
    lines.push('');
    lines.push(center('Terima kasih!'));

    return lines.join('\n');
}

export function formatReceiptESCPOS(transaction, config) {
    const lines = [];
    lines.push('\x1B\x40'); // reset
    lines.push('\x1B\x61\x01'); // center align
    lines.push('\x1B\x21\x38'); // double height
    lines.push(config.store_name || 'TOKO ANDA');
    lines.push('\x1B\x21\x00'); // normal size

    if (config.store_address) lines.push(config.store_address);
    if (config.store_phone) lines.push(config.store_phone);

    lines.push('\x1B\x61\x00'); // left align
    lines.push(rule('='));
    lines.push(`No Invoice: ${transaction.id}`);
    lines.push(`Tanggal    : ${new Date(transaction.timestamp).toLocaleString('id-ID')}`);
    lines.push(`Kasir      : ${transaction.cashier}`);
    lines.push(rule('='));

    transaction.items.forEach((item) => {
        const qty = item.qty.toString();
        const subtotal = (item.price * item.qty).toString();
        const name = item.name.substring(0, 18);
        lines.push(`${name.padEnd(18)} ${qty.padStart(3)}x`);
        lines.push(`${' '.repeat(18)}Rp ${subtotal.padStart(11)}`);
    });

    lines.push(rule('-'));
    lines.push(`Subtotal         Rp ${transaction.subtotal.toString().padStart(10)}`);
    if (transaction.discount_amount > 0) {
        lines.push(`Diskon (${transaction.discount_percent}%) - Rp ${transaction.discount_amount.toString().padStart(8)}`);
    }
    if (transaction.tax > 0) {
        lines.push(`Pajak (${transaction.tax_percent}%)   + Rp ${transaction.tax.toString().padStart(8)}`);
    }

    lines.push(rule('='));
    lines.push('\x1B\x21\x38');
    lines.push(`TOTAL        Rp ${transaction.total.toString().padStart(10)}`);
    lines.push('\x1B\x21\x00');

    lines.push(rule('-'));
    lines.push(`Pembayaran   : ${transaction.payment_method.toUpperCase()}`);
    lines.push(rule('='));

    lines.push('\x1B\x61\x01');
    lines.push('Terima kasih atas pembelian Anda!');

    lines.push('\n\n\n');
    return lines.join('\n');
}

export function generateTestReceipt(config) {
    const lines = [];
    lines.push(rule('='));
    lines.push(center('TEST PRINT'));
    lines.push(center('KASIR OFFLINE'));
    lines.push(rule('='));
    lines.push('');
    lines.push(`Toko    : ${config.store_name || 'Toko Anda'}`);
    lines.push(`Tanggal : ${new Date().toLocaleString('id-ID')}`);
    lines.push('Status  : Printer OK');
    lines.push('');
    lines.push(rule('='));
    lines.push(center('Terima kasih!'));
    lines.push('\n\n');
    return lines.join('\n');
}
