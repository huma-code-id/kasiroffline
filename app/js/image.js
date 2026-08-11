// Kompres & resize foto produk di browser (pakai <canvas>) sebelum disimpan/di-upload —
// supaya IndexedDB & payload upload ke GAS tetap kecil dan ramah offline.

export function resizeImageToDataURL(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Gagal membaca file'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('File bukan gambar yang valid'));
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const width = Math.max(1, Math.round(img.width * scale));
                const height = Math.max(1, Math.round(img.height * scale));

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// "data:image/jpeg;base64,xxxx" -> { base64: "xxxx", mimeType: "image/jpeg" }
export function dataURLToBase64(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);base64/);
    return {
        base64: base64 || '',
        mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
    };
}
