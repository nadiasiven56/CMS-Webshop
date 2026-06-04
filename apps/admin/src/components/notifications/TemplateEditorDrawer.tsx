/**
 * TemplateEditorDrawer — bewerk één e-mailtemplate op de ECHTE API
 * (`PATCH /api/notifications/templates/:key`): subject + bodyHtml + bodyText +
 * enabled-toggle. Plus een "Test-mail sturen"-actie (`POST /test-send`) die de
 * status toont — inclusief de `skipped_no_provider`-hint dat er eerst een
 * provider verbonden + geactiveerd moet zijn.
 *
 * De template-DTO levert de huidige waarden; we laden ze in lokale state en
 * sturen alleen gewijzigde velden mee in de PATCH.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Info, Send, XCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { FormField } from '@/components/ui/FormField';
import { toast } from '@/lib/toast';
import { asApiError } from '@/lib/api';
import {
  usePatchTemplate,
  useTestSend,
  templateMeta,
  type TemplateDto,
  type TestSendResponse,
} from './api';

export function TemplateEditorDrawer({
  template,
  hasActiveProvider,
  onClose,
}: {
  template: TemplateDto | null;
  /** Of er een actieve, verbonden provider is — stuurt de test-mail-hint. */
  hasActiveProvider: boolean;
  onClose: () => void;
}) {
  const open = template != null;
  const patch = usePatchTemplate();
  const testSend = useTestSend();

  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [testTo, setTestTo] = useState('');
  const [sendResult, setSendResult] = useState<TestSendResponse | null>(null);

  useEffect(() => {
    if (!open || !template) return;
    setSubject(template.subject);
    setBodyHtml(template.bodyHtml);
    setBodyText(template.bodyText ?? '');
    setEnabled(template.enabled);
    setTestTo('');
    setSendResult(null);
  }, [open, template]);

  if (!template) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const meta = templateMeta(template.key);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!template) return;
    try {
      await patch.mutateAsync({
        key: template.key,
        patch: {
          subject: subject.trim(),
          bodyHtml,
          bodyText: bodyText.trim() ? bodyText : null,
          enabled,
        },
      });
      toast.success(`Template "${meta.label}" opgeslagen`);
      onClose();
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Opslaan mislukt: ${e2.message}`);
    }
  }

  async function onTestSend() {
    if (!template) return;
    const to = testTo.trim();
    if (!to) {
      toast.error('Vul een e-mailadres in om een test-mail te sturen.');
      return;
    }
    setSendResult(null);
    try {
      const res = await testSend.mutateAsync({ to, templateKey: template.key });
      setSendResult(res);
      if (res.status === 'sent') toast.success(res.message);
      else if (res.status === 'skipped_no_provider') toast.info(res.message);
      else toast.error(res.message);
    } catch (err) {
      const e2 = asApiError(err);
      toast.error(`Test-mail mislukt: ${e2.message}`);
    }
  }

  const sendOk = sendResult?.status === 'sent';
  const sendSkipped = sendResult?.status === 'skipped_no_provider';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={meta.label}
      subtitle={`Template • ${template.key}`}
      width={620}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleer
          </button>
          <button
            type="submit"
            form="template-editor"
            className="btn btn-primary"
            disabled={patch.isPending}
          >
            {patch.isPending ? 'Opslaan…' : 'Opslaan'}
          </button>
        </>
      }
    >
      <form id="template-editor" onSubmit={onSubmit}>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--text-soft)',
            lineHeight: 1.5,
            padding: '10px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {meta.description} Gebruik <code>{'{{customerName}}'}</code>,{' '}
          <code>{'{{orderNumber}}'}</code>, <code>{'{{total}}'}</code> en{' '}
          <code>{'{{trackingUrl}}'}</code> als placeholders.
        </div>

        {/* Enabled-toggle */}
        <FormField label="Status" hint="Uitgeschakelde templates worden niet verstuurd.">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 'auto' }}
            />
            {enabled ? 'Ingeschakeld' : 'Uitgeschakeld'}
          </label>
        </FormField>

        <FormField label="Onderwerp" required>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            placeholder="Bedankt voor je bestelling {{orderNumber}}"
          />
        </FormField>

        <FormField label="HTML-body" required hint="De volledige HTML van de mail.">
          <textarea
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            required
            rows={10}
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, resize: 'vertical' }}
          />
        </FormField>

        <FormField
          label="Platte-tekst-body"
          hint="Optioneel — fallback voor clients zonder HTML. Leeg = geen tekst-variant."
        >
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={5}
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, resize: 'vertical' }}
          />
        </FormField>

        {/* Test-mail sturen */}
        <div
          style={{
            marginTop: 8,
            padding: '12px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            background: 'var(--surface-2)',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
            Test-mail sturen
          </div>
          {!hasActiveProvider && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 6,
                marginBottom: 10,
                fontSize: 12,
                background: 'var(--warning-soft, var(--theme-accent-subtle))',
                border: '1px solid var(--warning-border, var(--theme-accent-border))',
                color: 'var(--text-soft)',
                lineHeight: 1.5,
              }}
            >
              <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Er is nog geen actieve, verbonden provider — een test-mail wordt overgeslagen
                (<code>skipped_no_provider</code>). Koppel en activeer eerst een provider.
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="jij@voorbeeld.nl"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onTestSend()}
              disabled={testSend.isPending}
            >
              <Send size={13} />
              {testSend.isPending ? 'Sturen…' : 'Verstuur'}
            </button>
          </div>

          {sendResult && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 6,
                marginTop: 10,
                fontSize: 12,
                lineHeight: 1.5,
                background: sendOk
                  ? 'var(--success-soft)'
                  : sendSkipped
                    ? 'var(--warning-soft, var(--theme-accent-subtle))'
                    : 'var(--danger-soft)',
                border: `1px solid ${
                  sendOk
                    ? 'var(--success-border)'
                    : sendSkipped
                      ? 'var(--warning-border, var(--theme-accent-border))'
                      : 'var(--danger-border)'
                }`,
                color: sendOk
                  ? 'var(--success)'
                  : sendSkipped
                    ? 'var(--text-soft)'
                    : 'var(--danger)',
              }}
            >
              {sendOk ? (
                <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              ) : sendSkipped ? (
                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              ) : (
                <XCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              )}
              <span>
                <strong>{sendResult.status}</strong> — {sendResult.message}
              </span>
            </div>
          )}
        </div>
      </form>
    </Drawer>
  );
}
