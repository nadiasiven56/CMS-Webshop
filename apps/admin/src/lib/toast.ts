/**
 * Globale toast-helper. Bovenop de event-bus uit `components/ui/Toast.tsx`.
 *
 * Usage:
 *   import { toast } from '@/lib/toast';
 *   toast.success('Order verzonden');
 *   toast.error('Adjust niet mogelijk: voorraad ontoereikend');
 *   toast.info('Komt in Fase 2');
 */
import { toastBus } from '@/components/ui/Toast';

export const toast = {
  success(text: string) {
    toastBus.push('success', text);
  },
  error(text: string) {
    toastBus.push('error', text);
  },
  info(text: string) {
    toastBus.push('info', text);
  },
};
