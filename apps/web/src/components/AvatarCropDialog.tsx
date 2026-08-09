'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FaXmark } from 'react-icons/fa6';

/** Rendered size of the square crop viewport. */
const VIEW = 260;
/** Edge length of the exported image. Avatars are never shown larger than 72px. */
const OUTPUT = 512;

interface Props {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (cropped: Blob) => void;
}

/**
 * Crop-to-square before upload.
 *
 * Written against a canvas rather than pulling in a cropping library: the requirement is a
 * square, which needs only a scale and a translation, and the export is the same two numbers
 * applied to a larger drawing surface.
 *
 * The image is laid out "cover" — scaled so the shorter side fills the viewport — which makes
 * the initial framing already valid, so confirming without touching anything gives a sensible
 * centre crop rather than an image floating in empty space.
 */
export function AvatarCropDialog({ file, busy, onCancel, onConfirm }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Object URL rather than a data URL: no base64 inflation, and it is revoked on unmount.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Scale at which the shorter side exactly covers the viewport. */
  const baseScale = image ? Math.max(VIEW / image.width, VIEW / image.height) : 1;

  /**
   * Keeps the image covering the viewport, so panning can never expose a transparent edge.
   * Called on every pan and zoom, since raising the zoom widens the allowed range and lowering
   * it can leave a previously valid offset out of bounds.
   */
  const clamp = useCallback(
    (next: { x: number; y: number }, scale: number) => {
      if (!image) return { x: 0, y: 0 };
      const w = image.width * baseScale * scale;
      const h = image.height * baseScale * scale;
      const maxX = Math.max(0, (w - VIEW) / 2);
      const maxY = Math.max(0, (h - VIEW) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [image, baseScale],
  );

  useEffect(() => {
    setOffset((o) => clamp(o, zoom));
  }, [zoom, clamp]);

  // Preview. Drawn at device pixel ratio so the framing is not judged on a blurry canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = VIEW * dpr;
    canvas.height = VIEW * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEW, VIEW);
    const w = image.width * baseScale * zoom;
    const h = image.height * baseScale * zoom;
    ctx.drawImage(image, VIEW / 2 - w / 2 + offset.x, VIEW / 2 - h / 2 + offset.y, w, h);
  }, [image, zoom, offset, baseScale]);

  function handleConfirm() {
    if (!image) return;
    const out = document.createElement('canvas');
    out.width = OUTPUT;
    out.height = OUTPUT;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    // The export is the preview scaled up by one ratio, so what was framed is what is written.
    const k = OUTPUT / VIEW;
    const w = image.width * baseScale * zoom * k;
    const h = image.height * baseScale * zoom * k;
    ctx.drawImage(image, OUTPUT / 2 - w / 2 + offset.x * k, OUTPUT / 2 - h / 2 + offset.y * k, w, h);

    // PNG, so a transparent source stays transparent instead of picking up a black background.
    out.toBlob((blob) => { if (blob) onConfirm(blob); }, 'image/png');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Crop group picture"
    >
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <p className="font-semibold text-[15px]" style={{ color: 'var(--text)' }}>Crop picture</p>
          <button type="button" onClick={onCancel} disabled={busy} className="btn-icon disabled:opacity-40" style={{ width: 30, height: 30 }} aria-label="Cancel">
            <FaXmark size={14} />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          <div
            className="relative overflow-hidden touch-none"
            style={{ width: VIEW, height: VIEW, borderRadius: 16, background: 'var(--panel-alt)', cursor: dragRef.current ? 'grabbing' : 'grab' }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
            }}
            onPointerMove={(e) => {
              const start = dragRef.current;
              if (!start) return;
              setOffset(clamp({ x: e.clientX - start.x, y: e.clientY - start.y }, zoom));
            }}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerCancel={() => { dragRef.current = null; }}
          >
            <canvas ref={canvasRef} style={{ width: VIEW, height: VIEW, display: 'block' }} />
            {/* Guide showing the rounded shape the avatar is actually drawn in, so the corners
                that will be cut are visible while framing. */}
            <div
              className="absolute pointer-events-none"
              style={{ inset: 0, borderRadius: 16, border: '2px solid rgba(255,255,255,0.6)' }}
            />
          </div>

          <label className="w-full flex items-center gap-3">
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-dim)' }}>Zoom</span>
            <input
              type="range" min={1} max={3} step={0.01} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: 'var(--accent)' }}
              aria-label="Zoom"
            />
          </label>

          <p className="text-[11px] text-center" style={{ color: 'var(--text-dim)' }}>Drag to reposition</p>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost flex-1 justify-center disabled:opacity-40">Cancel</button>
          <button type="button" onClick={handleConfirm} disabled={busy || !image} className="btn-primary flex-1 justify-center disabled:opacity-40">
            {busy ? 'Uploading…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
