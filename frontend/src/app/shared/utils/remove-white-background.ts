/**
 * Makes white (and near-white/light-gray "checkerboard" transparency
 * placeholder) pixels transparent, anywhere in the image — not just where
 * connected to the edges. Icon artwork is small and iconic (a logo, a badge),
 * so an enclosed white/gray hole (the "0" in "250", the inside of an "O") is
 * background peeking through, not an intentional white detail. AI image
 * generators sometimes draw a light-gray/white checkerboard instead of real
 * alpha to represent transparency, so a neutral (R≈G≈B) light color is
 * treated as background too, whichever shade of the checker it is.
 */
export function removeWhiteBackground(blob: Blob, threshold = 195, chromaTolerance = 20): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(blob); return; }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const minC = Math.min(r, g, b);
        const maxC = Math.max(r, g, b);
        // Near-white or light neutral gray (low saturation, high brightness).
        if (minC >= threshold && maxC - minC <= chromaTolerance) {
          data[i + 3] = 0;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((out) => resolve(out ?? blob), 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    img.src = url;
  });
}
