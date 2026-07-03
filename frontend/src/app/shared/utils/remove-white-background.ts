/**
 * Makes a white (or near-white) background transparent by flood-filling from the
 * image edges — only white regions connected to the border are cleared, so white
 * details inside the subject (a plate rim, a highlight) survive untouched.
 */
export function removeWhiteBackground(blob: Blob, threshold = 240): Promise<Blob> {
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
      const { width, height } = canvas;
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      const isWhite = (pixelIndex: number): boolean =>
        data[pixelIndex] >= threshold && data[pixelIndex + 1] >= threshold && data[pixelIndex + 2] >= threshold;

      const visited = new Uint8Array(width * height);
      const stack: number[] = [];
      const seed = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const cellIndex = y * width + x;
        if (visited[cellIndex]) return;
        if (!isWhite(cellIndex * 4)) return;
        visited[cellIndex] = 1;
        stack.push(cellIndex);
      };

      for (let x = 0; x < width; x++) {
        seed(x, 0);
        seed(x, height - 1);
      }
      for (let y = 0; y < height; y++) {
        seed(0, y);
        seed(width - 1, y);
      }

      while (stack.length > 0) {
        const cellIndex = stack.pop()!;
        data[cellIndex * 4 + 3] = 0;
        const x = cellIndex % width;
        const y = Math.floor(cellIndex / width);
        seed(x + 1, y);
        seed(x - 1, y);
        seed(x, y + 1);
        seed(x, y - 1);
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
