/*
 * sampleTextDots — render a string to an offscreen canvas with the
 * given font, then sample dot positions where the pixel is dark.
 *
 * Returns an array of { x, y } in canvas-coordinate space.
 *
 * Caller controls dot density via `step` (sampling stride in px).
 * Smaller step = more dots = denser glyph but heavier morph.
 */

export interface DotPoint {
  x: number;
  y: number;
}

export interface SampleOptions {
  text: string;
  font: string; // CSS shorthand, e.g. "600 96px 'Geist Pixel Square'"
  width: number;
  height: number;
  step?: number;
  threshold?: number;
}

export function sampleTextDots({
  text,
  font,
  width,
  height,
  step = 6,
  threshold = 128,
}: SampleOptions): DotPoint[] {
  if (typeof document === 'undefined') return [];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);

  const data = ctx.getImageData(0, 0, width, height).data;
  const dots: DotPoint[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // average brightness — dark pixel means glyph
      const lum = (r + g + b) / 3;
      if (lum < threshold) dots.push({ x, y });
    }
  }
  return dots;
}
