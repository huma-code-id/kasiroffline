// Export Laporan ke Excel (.xlsx) & PDF -- pakai library CDN (SheetJS & jsPDF+autotable),
// makanya cuma bisa jalan saat online (Laporan sendiri memang sudah butuh online).

function paymentMethodLabel(pm) {
    return (pm || 'lainnya').toUpperCase();
}

function periodLabel(period, date) {
    if (period === 'monthly') {
        const [y, m] = (date || '').split('-');
        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        return `${names[Number(m) - 1] || m} ${y}`;
    }
    return date || '';
}

export function exportReportToExcel(reportData, config, period, date) {
    if (!window.XLSX) {
        throw new Error('Library Excel belum siap dimuat (perlu koneksi internet), coba lagi sebentar');
    }

    const wb = XLSX.utils.book_new();
    const label = periodLabel(period, date);

    const summaryRows = [
        ['Toko', config.store_name || ''],
        ['Periode', label],
        [],
        ['Total Omzet', reportData.total_omzet],
        ['Jumlah Transaksi', reportData.total_transaksi],
        ['Total Diskon', reportData.total_diskon],
        ['Total Pajak', reportData.total_pajak],
        [],
        ['Per Metode Pembayaran'],
        ['Metode', 'Jumlah Transaksi', 'Total'],
        ...reportData.by_payment_method.map((pm) => [paymentMethodLabel(pm.method), pm.count, pm.total]),
        [],
        ['Per Kasir'],
        ['Kasir', 'Jumlah Transaksi', 'Total'],
        ...reportData.by_cashier.map((c) => [c.cashier, c.count, c.total]),
        [],
        ['Produk Terlaris'],
        ['Produk', 'Qty Terjual', 'Total'],
        ...reportData.top_products.map((p) => [p.name, p.qty, p.total]),
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Ringkasan');

    const txRows = [
        ['ID Transaksi', 'Waktu', 'Kasir', 'Metode', 'Total', 'Uang Diterima', 'Kembalian', 'Bukti'],
        ...(reportData.transactions || []).map((t) => [
            t.id,
            new Date(t.timestamp).toLocaleString('id-ID'),
            t.cashier,
            paymentMethodLabel(t.payment_method),
            t.total,
            t.cash_received === null ? '' : t.cash_received,
            t.change_amount === null ? '' : t.change_amount,
            t.proof_url || '',
        ]),
    ];
    const txSheet = XLSX.utils.aoa_to_sheet(txRows);
    XLSX.utils.book_append_sheet(wb, txSheet, 'Transaksi');

    const filename = `Laporan-${(config.store_name || 'Toko').replace(/[^a-z0-9]+/gi, '-')}-${label.replace(/\s+/g, '-')}.xlsx`;
    XLSX.writeFile(wb, filename);
}

export function exportReportToPdf(reportData, config, period, date) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('Library PDF belum siap dimuat (perlu koneksi internet), coba lagi sebentar');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const label = periodLabel(period, date);
    const rupiah = (n) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');

    doc.setFontSize(14);
    doc.text(config.store_name || 'Toko Anda', 14, 16);
    doc.setFontSize(10);
    doc.text(`Laporan Periode: ${label}`, 14, 23);

    doc.autoTable({
        startY: 28,
        head: [['Ringkasan', '']],
        body: [
            ['Total Omzet', rupiah(reportData.total_omzet)],
            ['Jumlah Transaksi', String(reportData.total_transaksi)],
            ['Total Diskon', rupiah(reportData.total_diskon)],
            ['Total Pajak', rupiah(reportData.total_pajak)],
        ],
        theme: 'plain',
        styles: { fontSize: 9 },
    });

    let nextY = doc.lastAutoTable.finalY + 6;

    if (reportData.by_payment_method.length > 0) {
        doc.autoTable({
            startY: nextY,
            head: [['Metode Pembayaran', 'Jumlah', 'Total']],
            body: reportData.by_payment_method.map((pm) => [paymentMethodLabel(pm.method), String(pm.count), rupiah(pm.total)]),
            styles: { fontSize: 9 },
        });
        nextY = doc.lastAutoTable.finalY + 6;
    }

    if (reportData.top_products.length > 0) {
        doc.autoTable({
            startY: nextY,
            head: [['Produk Terlaris', 'Qty', 'Total']],
            body: reportData.top_products.map((p) => [p.name, String(p.qty), rupiah(p.total)]),
            styles: { fontSize: 9 },
        });
        nextY = doc.lastAutoTable.finalY + 6;
    }

    const transactions = reportData.transactions || [];
    if (transactions.length > 0) {
        doc.autoTable({
            startY: nextY,
            head: [['Waktu', 'Kasir', 'Metode', 'Total', 'Bukti']],
            body: transactions.map((t) => [
                new Date(t.timestamp).toLocaleString('id-ID'),
                t.cashier,
                paymentMethodLabel(t.payment_method),
                rupiah(t.total),
                t.proof_url ? 'Ada' : '-',
            ]),
            styles: { fontSize: 8 },
        });
    }

    const filename = `Laporan-${(config.store_name || 'Toko').replace(/[^a-z0-9]+/gi, '-')}-${label.replace(/\s+/g, '-')}.pdf`;
    doc.save(filename);
}
