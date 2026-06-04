/**
 * ImageUploader — drag-drop product-images uploader.
 *
 * Gebruik:
 *   <ImageUploader productId={prod.id} initial={prod.images} onChange={setImages} />
 *
 * Features V1:
 *   - Drag-drop OF "Kies bestanden"-knop (HTML5 native, geen react-dropzone)
 *   - Validatie client-side (mime-allowlist + 10 MB cap, gespiegeld aan backend)
 *   - Preview-thumbnails met alt-text-input + delete-knop per image
 *   - Reorder via drag-handle (HTML5-DnD tussen thumbnails)
 *   - Upload-progress per file via XHR (axios geeft progress alleen op upload)
 *   - Per upload: POST /api/images met multipart-body (file + product_id + alt)
 *   - Persisteert direct naar backend; UI-state spiegelt server-state
 *
 * Props:
 *   productId   — als gezet, uploads krijgen DB-row + audit
 *   initial     — startset images voor existing product
 *   onChange    — callback bij elke succesvolle mutatie
 *
 * Out-of-scope V1:
 *   - Image-resize / thumbnails (V2 via BullMQ-job)
 *   - Bulk-paste-from-clipboard
 *   - Crop UI
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, ImageOff } from 'lucide-react';
import { api, asApiError } from '@/lib/api';
import { ImageThumbnail } from './image/ImageThumbnail';
import { UploadProgressBar } from './image/UploadProgressBar';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 10 * 1024 * 1024;

export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  alt: string | null;
  position: number;
  createdAt?: string;
}

interface InFlight {
  /** local-only id for the in-flight upload (not the DB id). */
  tempId: string;
  filename: string;
  size: number;
  progress: number; // 0-100
  error?: string;
}

interface Props {
  productId?: string;
  initial?: ProductImage[];
  onChange?: (images: ProductImage[]) => void;
}

export function ImageUploader({ productId, initial, onChange }: Props) {
  const [images, setImages] = useState<ProductImage[]>(() =>
    [...(initial ?? [])].sort((a, b) => a.position - b.position),
  );
  const [inFlight, setInFlight] = useState<InFlight[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragSourceIdx = useRef<number | null>(null);

  // initial-prop-changed reset (e.g. after parent fetch)
  useEffect(() => {
    if (initial) setImages([...initial].sort((a, b) => a.position - b.position));
  }, [initial]);

  const notify = useCallback(
    (next: ProductImage[]) => {
      setImages(next);
      onChange?.(next);
    },
    [onChange],
  );

  // ─── client-side validation ──────────────────────────────
  function validate(file: File): string | null {
    if (!(ALLOWED_MIMES as readonly string[]).includes(file.type)) {
      return `${file.name}: bestandsformaat niet toegestaan (JPG/PNG/WebP).`;
    }
    if (file.size > MAX_BYTES) {
      return `${file.name}: groter dan 10 MB.`;
    }
    if (file.size === 0) {
      return `${file.name}: leeg bestand.`;
    }
    return null;
  }

  // ─── upload-flow ─────────────────────────────────────────
  async function uploadOne(file: File) {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setInFlight((cur) => [
      ...cur,
      { tempId, filename: file.name, size: file.size, progress: 0 },
    ]);

    const formData = new FormData();
    formData.append('file', file);
    if (productId) formData.append('product_id', productId);

    try {
      const res = await api.post<{ images: ProductImage[] }>('/images', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (!e.total) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          setInFlight((cur) =>
            cur.map((f) => (f.tempId === tempId ? { ...f, progress: pct } : f)),
          );
        },
      });

      const newRows = res.data.images;
      // Bij productId is response een gevulde DB-row (incl. id, position).
      // Bij losse upload is id=null — die voegen we niet toe aan images-list.
      setInFlight((cur) => cur.filter((f) => f.tempId !== tempId));
      const meaningful = newRows.filter((r) => r.id);
      if (meaningful.length > 0) {
        notify([...images, ...(meaningful as ProductImage[])].sort((a, b) => a.position - b.position));
      }
    } catch (err) {
      const apiErr = asApiError(err);
      setInFlight((cur) =>
        cur.map((f) =>
          f.tempId === tempId ? { ...f, error: apiErr.message || 'upload mislukt' } : f,
        ),
      );
    }
  }

  async function handleFiles(filesIn: FileList | File[]) {
    setGlobalError(null);
    const files = Array.from(filesIn);
    const errors: string[] = [];
    const accepted: File[] = [];
    for (const f of files) {
      const e = validate(f);
      if (e) errors.push(e);
      else accepted.push(f);
    }
    if (errors.length > 0) {
      setGlobalError(errors.join(' '));
    }
    // Upload sequentially to keep UI predictable; parallel werkt ook maar
    // 10MB×N gigt qua RAM bij grote batches in dev.
    for (const f of accepted) await uploadOne(f);
  }

  // ─── drop-zone handlers ─────────────────────────────────
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer?.files) return;
    await handleFiles(e.dataTransfer.files);
  }

  // ─── delete ──────────────────────────────────────────────
  async function handleDelete(id: string) {
    const before = images;
    notify(images.filter((i) => i.id !== id)); // optimistic
    try {
      await api.delete(`/images/${id}`);
    } catch (err) {
      // rollback
      notify(before);
      setGlobalError(asApiError(err).message);
    }
  }

  // ─── alt-text update ─────────────────────────────────────
  async function handleAltChange(id: string, alt: string) {
    // Optimistic
    notify(images.map((i) => (i.id === id ? { ...i, alt } : i)));
    try {
      await api.patch(`/images/${id}`, { alt });
    } catch (err) {
      setGlobalError(asApiError(err).message);
    }
  }

  // ─── reorder via HTML5 DnD ──────────────────────────────
  function onThumbDragStart(idx: number) {
    dragSourceIdx.current = idx;
  }
  async function onThumbDrop(targetIdx: number) {
    const sourceIdx = dragSourceIdx.current;
    dragSourceIdx.current = null;
    if (sourceIdx === null || sourceIdx === targetIdx) return;

    const next = [...images];
    const [moved] = next.splice(sourceIdx, 1);
    if (!moved) return;
    next.splice(targetIdx, 0, moved);
    // Renumber positions 0..n-1
    const reordered = next.map((img, i) => ({ ...img, position: i }));
    notify(reordered);

    if (productId) {
      try {
        await api.post(`/images/reorder/${productId}`, {
          items: reordered.map((r) => ({ id: r.id, position: r.position })),
        });
      } catch (err) {
        setGlobalError(asApiError(err).message);
      }
    }
  }

  // ─── render ──────────────────────────────────────────────
  return (
    <div className="image-uploader">
      {/* Drop-zone */}
      <div
        className={`image-uploader-dropzone${dragOver ? ' is-dragover' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
        }}
        style={{
          border: dragOver
            ? '2px dashed var(--theme-accent)'
            : '2px dashed var(--theme-border)',
          borderRadius: 12,
          padding: 24,
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--theme-accent-subtle)' : 'var(--theme-card2)',
          color: 'var(--theme-muted)',
          transition: 'all 120ms ease',
        }}
      >
        <Upload size={20} style={{ marginBottom: 8 }} />
        <div style={{ fontWeight: 500, color: 'var(--theme-text)' }}>
          Sleep foto&apos;s hierheen of klik om te kiezen
        </div>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          JPG, PNG of WebP. Max 10 MB per bestand.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            if (e.target.files) await handleFiles(e.target.files);
            // clear so picking the same file twice fires onChange:
            e.target.value = '';
          }}
        />
      </div>

      {/* Errors */}
      {globalError && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: 'rgba(255, 107, 87, 0.1)',
            border: '1px solid var(--theme-danger)',
            borderRadius: 8,
            color: 'var(--theme-danger)',
            fontSize: 13,
          }}
        >
          {globalError}
        </div>
      )}

      {/* In-flight uploads */}
      {inFlight.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {inFlight.map((f) => (
            <UploadProgressBar key={f.tempId} {...f} />
          ))}
        </div>
      )}

      {/* Thumbnails grid */}
      {images.length > 0 ? (
        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {images.map((img, i) => (
            <ImageThumbnail
              key={img.id}
              image={img}
              index={i}
              onDelete={() => handleDelete(img.id)}
              onAltChange={(alt) => handleAltChange(img.id, alt)}
              onDragStart={() => onThumbDragStart(i)}
              onDropTarget={() => onThumbDrop(i)}
            />
          ))}
        </div>
      ) : (
        inFlight.length === 0 && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              textAlign: 'center',
              color: 'var(--theme-muted)',
              fontSize: 13,
              border: '1px dashed var(--theme-border-subtle)',
              borderRadius: 8,
            }}
          >
            <ImageOff size={16} style={{ marginBottom: 4 }} /> Nog geen foto&apos;s.
          </div>
        )
      )}
    </div>
  );
}

export default ImageUploader;
