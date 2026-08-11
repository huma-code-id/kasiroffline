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
