/**
 * SeoFieldset — herbruikbare SEO-velden (title/description/ogImage/noindex)
 * voor zowel de page- als de blog-editor. Controlled via value/onChange.
 */
import { FormField } from '@/components/ui/FormField';
import type { SeoFields } from './types';

interface Props {
  value: SeoFields;
  onChange: (next: SeoFields) => void;
  /** Fallback-placeholder voor de SEO-titel (meestal de page/post-titel). */
  titlePlaceholder?: string;
}

export function SeoFieldset({ value, onChange, titlePlaceholder }: Props) {
  const patch = (p: Partial<SeoFields>) => onChange({ ...value, ...p });
  const desc = typeof value.description === 'string' ? value.description : '';

  return (
    <div>
      <FormField label="SEO-titel" hint="Tab-titel + zoekresultaat-kop.">
        <input
          value={typeof value.title === 'string' ? value.title : ''}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={titlePlaceholder}
          maxLength={70}
        />
      </FormField>
      <FormField
        label="Meta-omschrijving"
        hint={`${desc.length}/160 tekens`}
      >
        <textarea
          rows={3}
          value={desc}
          onChange={(e) => patch({ description: e.target.value })}
          maxLength={320}
          style={{ resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }}
        />
      </FormField>
      <FormField label="OG-afbeelding (URL)" hint="Social-share preview.">
        <input
          value={typeof value.ogImage === 'string' ? value.ogImage : ''}
          onChange={(e) => patch({ ogImage: e.target.value })}
          placeholder="https://…"
        />
      </FormField>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12.5,
          color: 'var(--theme-text)',
          padding: '8px 10px',
          background: 'var(--surface-2)',
          borderRadius: 8,
        }}
      >
        <input
          type="checkbox"
          checked={value.noindex === true}
          onChange={(e) => patch({ noindex: e.target.checked })}
          style={{ width: 16, height: 16, padding: 0 }}
        />
        <span>Niet indexeren (noindex) — verberg voor zoekmachines</span>
      </label>
    </div>
  );
}
