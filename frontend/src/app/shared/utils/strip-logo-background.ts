/**
 * Makes the solid background behind an uploaded logo transparent so it doesn't
 * render as an opaque box on the dark nav/footer (Phase 32).
 *
 * It flood-fills inward from the image borders, clearing only pixels that are
 * contiguous with the edge and close in colour to the corner background. That
 * means interior detail of the same colour (e.g. white lettering *inside* the
 * mark) is preserved — only the surrounding box is removed.
 *
 * Conservative by design: if the corners don't agree on a background colour
 * (likely a photo with no plain background), or clearing would consume the
 * whole image, it returns the original file untouched. All processing happens
 * client-side on a canvas; on any failure it falls back to the original file.
 */
export async function stripLogoBackground(file: File): Promise<File> {
  // GIFs may be animated — a canvas would flatten them to a single frame, so
  // leave them as-is rather than silently dropping the animation.
  if (file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;

    // Already has a transparent corner → nothing to strip.
    if (data[3] === 0) return file;

    // Reference background colour = the top-left corner pixel.
    const bg = [data[0], data[1], data[2]];
    const TOL = 32; // per-channel tolerance for "same as the background"
    const matches = (idx: number): boolean => {
      if (data[idx + 3] === 0) return true; // already cleared
      return (
        Math.abs(data[idx] - bg[0]) <= TOL &&
        Math.abs(data[idx + 1] - bg[1]) <= TOL &&
        Math.abs(data[idx + 2] - bg[2]) <= TOL
      );
    };

    // Require at least 3 of 4 corners to match the reference, otherwise assume
    // there's no uniform box to strip and leave the image alone.
    const corners = [
      0,
      (width - 1) * 4,
      (height - 1) * width * 4,
      ((height - 1) * width + (width - 1)) * 4,
    ];
    if (corners.filter(matches).length < 3) return file;

    // BFS flood-fill from every border pixel.
    const visited = new Uint8Array(width * height);
    const stack: number[] = [];
    const push = (p: number): void => {
      if (!visited[p]) {
        visited[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < width; x++) {
      push(x);
      push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      push(y * width);
      push(y * width + width - 1);
    }

    let cleared = 0;
    while (stack.length) {
      const p = stack.pop() as number;
      if (!matches(p * 4)) continue;
      data[p * 4 + 3] = 0; // make transparent
      cleared++;
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (y > 0) push(p - width);
      if (y < height - 1) push(p + width);
    }

    // Nothing removed, or the whole image would vanish → keep the original.
    if (cleared === 0 || cleared === width * height) return file;

    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'logo';
    return new File([blob], `${baseName}.png`, { type: 'image/png' });
  } catch {
    return file;
  }
}
