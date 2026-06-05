import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

export interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  /** Inline-grid 2-col layout if true (label left, field right). */
  inline?: boolean;
  /**
   * Explicit id for the field. When omitted a stable one is generated via
   * useId(). The id is forwarded to the (single) child element as `id` and
   * linked from the <label> via htmlFor — zonder elke call-site te wijzigen.
   */
  htmlFor?: string;
}

/**
 * Probeert het control-element te vinden waaraan we de gegenereerde id moeten
 * koppelen. Voor een enkel React-element clonen we het met de id (tenzij het
 * kind al een eigen id heeft). Niet-elementen (strings, fragments, meerdere
 * children) laten we ongemoeid; de label krijgt dan geen htmlFor.
 */
function linkChild(children: ReactNode, id: string): { node: ReactNode; linked: boolean } {
  if (isValidElement(children)) {
    const el = children as ReactElement<{ id?: string }>;
    if (el.props.id) {
      // Kind heeft al een id — gebruik die voor de label, niet overschrijven.
      return { node: children, linked: true };
    }
    return { node: cloneElement(el, { id }), linked: true };
  }
  return { node: children, linked: false };
}

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  inline,
  htmlFor,
}: FormFieldProps) {
  const generatedId = useId();
  const explicitId = isValidElement(children)
    ? (children as ReactElement<{ id?: string }>).props.id
    : undefined;
  const fieldId = htmlFor ?? explicitId ?? generatedId;
  const { node, linked } = linkChild(children, fieldId);
  // Alleen htmlFor zetten wanneer we de id ook echt aan een control koppelen.
  const labelFor = linked ? fieldId : undefined;

  if (inline) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 12,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        {label && (
          <label htmlFor={labelFor} style={{ fontSize: 12.5, color: 'var(--theme-muted)' }}>
            {label}
            {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
          </label>
        )}
        <div>
          {node}
          {error && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          {hint && !error && (
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--theme-muted)' }}>{hint}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
      {label && (
        <label
          htmlFor={labelFor}
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--theme-muted)',
            letterSpacing: '0.02em',
          }}
        >
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {node}
      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      {hint && !error && (
        <div style={{ fontSize: 11.5, color: 'var(--theme-muted)' }}>{hint}</div>
      )}
    </div>
  );
}
