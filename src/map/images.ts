import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Small generated images the style needs: an occupation hatch and a victory
 * point marker. Drawing them here keeps the build free of binary assets.
 */

function hatch(): { data: ImageData; ratio: number } {
  const ratio = 2, size = 8;
  const cv = document.createElement('canvas');
  cv.width = size * ratio;
  cv.height = size * ratio;
  const ctx = cv.getContext('2d')!;
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = 'rgba(24,18,14,0.55)';
  ctx.lineWidth = 1.6;
  // two diagonals, drawn twice so the pattern tiles seamlessly
  for (const off of [-size, 0]) {
    ctx.beginPath();
    ctx.moveTo(off, size);
    ctx.lineTo(off + size, 0);
    ctx.stroke();
  }
  return { data: ctx.getImageData(0, 0, size * ratio, size * ratio), ratio };
}

function victoryPoint(): { data: ImageData; ratio: number } {
  const ratio = 2, size = 18;
  const cv = document.createElement('canvas');
  cv.width = size * ratio;
  cv.height = size * ratio;
  const ctx = cv.getContext('2d')!;
  ctx.scale(ratio, ratio);
  const m = size / 2;

  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? m - 2 : (m - 2) * 0.44;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = m + Math.cos(a) * r, y = m + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(240,223,174,0.95)';
  ctx.strokeStyle = 'rgba(24,18,12,0.9)';
  ctx.lineWidth = 1.2;
  ctx.fill();
  ctx.stroke();
  return { data: ctx.getImageData(0, 0, size * ratio, size * ratio), ratio };
}

export function registerMapImages(map: MapLibreMap) {
  for (const [id, make] of [['hatch', hatch], ['vp', victoryPoint]] as const) {
    if (map.hasImage(id)) continue;
    const { data, ratio } = make();
    map.addImage(id, data, { pixelRatio: ratio });
  }
}
