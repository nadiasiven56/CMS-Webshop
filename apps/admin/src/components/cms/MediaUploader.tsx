/**
 * MediaUploader — drag-drop / klik-uploader voor de CMS-media-library.
 *
 * Spiegelt het patroon van `components/ImageUploader.tsx`, maar post multipart
 * naar `/api/cms/media` (file[, shop, folder, alt]). Bij succes → onUploaded zodat
 * de parent de lijst kan invalideren. Shop wordt als veld meegestuurd zodat de
 * media shop-scoped wordt opgeslagen (niet globaal).
 */
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { api, asApiError } from '@/lib/api';

const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'application/pdf',
]);
const MAX_BYTES = 20 * 1024 * 1024;

interface Props {
  shopId: string | null;
  folder?: string;
  onUploaded: () => void;
}

export function MediaUploader({ shopId, folder = 'uploads', onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function validate(file: File): string | null {
    if (!ALLOWED.has(file.type)) return `${file.name}: type niet toegestaan.`;
    if (file.size > MAX_BYTES) return `${file.name}: groter dan 20 MB.`;
    if (file.size === 0) return `${file.name}: leeg bestand.`;
    return null;
  }

  async function uploadOne(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    if (shopId) fd.append('shop', shopId);
    fd.append('folder', folder);
    await api.post('/cms/media', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  }

  async function handleFiles(list: FileList | File[]) {
    setError(null);
    const files = Array.from(list);
    const bad = files.map(validate).filter(Boolean) as string[];
    if (bad.length) setError(bad.join(' '));
    const ok = files.filter((f) => !validate(f));
    if (ok.length === 0) return;
    setBusy(true);
    try {
      for (const f of ok) {
        setProgress(0);
        await uploadOne(f);
      }
      onUploaded();
    } catch (err) {
      setError(asApiError(err).message || 'Upload mislukt');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
        }}
        style={{
          border: `2px dashed ${dragOver ? 'var(--theme-accent)' : 'var(--theme-border, var(--border-default))'}`,
          borderRadius: 12,
          padding: 22,
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--theme-accent-subtle)' : 'var(--surface-2)',
          color: 'var(--theme-muted)',
          transition: 'all 120ms ease',
        }}
      >
        <Upload size={20} style={{ marginBottom: 6 }} />
        <div style={{ fontWeight: 500, color: 'var(--theme-text)' }}>
          {busy ? `Uploaden… ${progress}%` : 'Sleep bestanden hierheen of klik om te kiezen'}
        </div>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          JPG, PNG, WebP, GIF, SVG, AVIF of PDF. Max 20 MB.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            if (e.target.files) await handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'var(--danger-soft, rgba(255,107,87,0.1))',
            border: '1px solid var(--theme-danger, var(--danger))',
            borderRadius: 8,
            color: 'var(--theme-danger, var(--danger))',
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
