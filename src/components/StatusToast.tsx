import { AlertTriangle, RotateCcw, X } from 'lucide-react';

interface StatusToastProps {
  onDismiss: () => void;
  onRetry: () => void;
}

export function StatusToast({ onDismiss, onRetry }: StatusToastProps) {
  return (
    <section className="status-toast" role="alert">
      <span className="status-toast__icon" aria-hidden="true"><AlertTriangle size={16} /></span>
      <div className="status-toast__copy">
        <strong>Something went wrong</strong>
        <p>We couldn’t load this folder.</p>
      </div>
      <button className="status-toast__retry" onClick={onRetry} type="button">
        <RotateCcw aria-hidden="true" size={13} />
        Retry
      </button>
      <button aria-label="Dismiss notification" className="status-toast__close" onClick={onDismiss} type="button">
        <X aria-hidden="true" size={15} />
      </button>
    </section>
  );
}
