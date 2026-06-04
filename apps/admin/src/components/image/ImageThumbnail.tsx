/**
 * ImageThumbnail — preview-tile met alt-text-input, delete-knop, drag-handle.
 *
 * Wordt gebruikt door ImageUploader. Geen state hier; pure controlled-component.
 */
import { useState } from 'react';
import { Trash2, GripVertical } from 'lucide-react';
import type { ProductImage } from '../ImageUploader';

interface Props {
  image: ProductImage;
  index: number;
  onDelete: () => void;
  onAltChange: (alt: string) => void;
  onDragStart: () => void;
  onDropTarget: () => void;
}

export function ImageThumbnail({
  image,
  index,
  onDelete,
  onAltChange,
  onDragStart,
  onDropTarget,
}: Props) {
  const [altDraft, setAltDraft] = useState(image.alt ?? '');
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers require text-data to enable drag.
        e.dataTransfer.setData('text/plain', image.id);
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropTarget();
      }}
      style={{
        position: 'relative',
        background: 'var(--theme-card)',
        border: '1px solid var(--theme-border)',
        borderRadius: 10,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Position-badge + drag-handle */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          background: 'rgba(0,0,0,0.5)',
          color: 'white',
          fontSize: 11,
          borderRadius: 999,
          cursor: 'grab',
        }}
        title="Sleep om te herschikken"
      >
        <GripVertical size={11} />
        {index + 1}
      </div>

      {/* Delete-knop */}
      <button
        type="button"
        aria-label="Verwijder foto"
        onClick={(e) => {
          e.stopPropagation();
          if (confirming) {
            onDelete();
          } else {
            setConfirming(true);
            setTimeout(() => setConfirming(false), 2500);
          }
        }}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          padding: '4px 6px',
          background: confirming ? 'var(--theme-danger)' : 'rgba(0,0,0,0.5)',
          border: 'none',
          borderRadius: 6,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
        }}
      >
        <Trash2 size={12} /> {confirming ? 'Bevestig' : ''}
      </button>

      {/* Image */}
      <div
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--theme-card2)',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={image.url}
          alt={image.alt ?? ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = '0.3';
          }}
        />
      </div>

      {/* Alt-input */}
      <input
        type="text"
        placeholder="Alt-tekst (SEO + toegankelijkheid)"
        value={altDraft}
        onChange={(e) => setAltDraft(e.target.value)}
        onBlur={() => {
          if (altDraft !== (image.alt ?? '')) onAltChange(altDraft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{
          fontSize: 12,
          border: 'none',
          borderTop: '1px solid var(--theme-border)',
          borderRadius: 0,
          padding: '6px 8px',
          background: 'var(--theme-card)',
        }}
      />
    </div>
  );
}
