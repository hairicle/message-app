'use client';

import { useEffect, useState } from 'react';

/**
 * Drop a company logo at `apps/web/public/logo.png` and it is picked up automatically — anything
 * under public/ is served from the site root. Until that file exists, or if it fails to load, the
 * built-in messenger glyph is shown instead, so the header is never empty.
 */
const LOGO_SRC = '/logo.png';

/** Bounding box of the non-transparent pixels, as a fraction of the image, plus its aspect. */
interface InkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Logo files are usually exported onto a square canvas with generous transparent padding, which
 * would otherwise render the artwork at a fraction of its slot. Measure the actual ink once per
 * source and lay out against that instead. Resolved lazily and shared by every instance.
 */
let inkBoxPromise: Promise<InkBox | null> | null = null;

function measureInkBox(src: string): Promise<InkBox | null> {
  if (inkBoxPromise) return inkBoxPromise;

  inkBoxPromise = new Promise<InkBox | null>((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);

        let minX = w;
        let minY = h;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 10) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        // A fully opaque export has no padding to trim — fall back to the whole image.
        if (maxX < 0) return resolve({ x: 0, y: 0, w, h });
        resolve({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
      } catch {
        resolve(null); // tainted canvas or no 2d context — render untrimmed
      }
    };
    img.src = src;
  });

  return inkBoxPromise;
}

interface BrandLogoProps {
  /** Height of the logo box in px. The artwork is fitted inside it. */
  height?: number;
  /** Widest the box may get. The logo is centred, so extra width is harmless. */
  maxWidth?: number;
  className?: string;
  title?: string;
}

/**
 * The company mark. Shared by the login page and the desktop nav rail so the brand stays
 * identical in both places.
 */
export function BrandLogo({
  height = 36,
  maxWidth = 36,
  className = '',
  title = 'Internal Messenger',
}: BrandLogoProps) {
  const [ink, setInk] = useState<InkBox | null>(null);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    measureInkBox(LOGO_SRC).then((box) => {
      if (cancelled) return;
      if (!box) return setFailed(true);
      setInk(box);
    });
    const probe = new Image();
    probe.onload = () => !cancelled && setNatural({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => !cancelled && setFailed(true);
    probe.src = LOGO_SRC;
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = !failed && ink !== null && natural !== null;

  // Contain the ink box within the slot, then offset the full image so that box lands centred.
  let imgStyle: React.CSSProperties = { display: 'none' };
  if (ready && ink && natural) {
    const scale = Math.min(maxWidth / ink.w, height / ink.h);
    imgStyle = {
      position: 'absolute',
      width: natural.w * scale,
      height: natural.h * scale,
      left: maxWidth / 2 - (ink.x + ink.w / 2) * scale,
      top: height / 2 - (ink.y + ink.h / 2) * scale,
      maxWidth: 'none',
    };
  }

  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className={`relative inline-block flex-shrink-0 overflow-hidden ${className}`}
      style={{ width: maxWidth, height }}
    >
      <img src={LOGO_SRC} alt="" style={imgStyle} />

      {!ready && (
        // No logo file (or it could not be measured): the built-in accent tile, kept square.
        <span
          className="absolute inset-0 m-auto inline-flex items-center justify-center"
          style={{ width: height, height, borderRadius: height * 0.28, background: 'var(--accent)' }}
        >
          <svg
            style={{ width: height / 2, height: height / 2, color: '#fff' }}
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
            <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
          </svg>
        </span>
      )}
    </span>
  );
}
