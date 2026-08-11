// HMAC-SHA256 signing via Web Crypto API (built-in browser, tidak perlu library luar).
// PENTING: implementasi ini harus persis cocok dengan hmacSHA256Hex() di gas/sync-endpoint.gs
// (server pakai Utilities.computeHmacSha256Signature, bukan computeDigest biasa).

export async function hmacSHA256Hex(message, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

// Bangun signature untuk sebuah data object: sign atas JSON.stringify(data)
// SEBELUM field signature ditambahkan (data tidak boleh sudah punya field `signature`).
export async function signData(data, secret) {
    return hmacSHA256Hex(JSON.stringify(data), secret);
}

// SHA-256 biasa (bukan HMAC, tanpa secret key) — dipakai untuk hash PIN kunci Pengaturan.
// Ini proteksi level "cegah staf toko iseng ubah pengaturan", BUKAN keamanan kelas
// enterprise — siapa pun yang buka DevTools & baca localStorage bisa lihat hash-nya.
export async function sha256Hex(message) {
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(message));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
