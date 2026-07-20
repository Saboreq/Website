import { ArrowRight } from 'lucide-react';

import { useModalFocus } from '../lib/useModalFocus';

interface WelcomeGateProps {
  leaving: boolean;
  onEnter: () => void;
}

export function WelcomeGate({ leaving, onEnter }: WelcomeGateProps) {
  const dialogRef = useModalFocus<HTMLDivElement>(true, onEnter);

  return (
    <div
      aria-describedby="welcome-description"
      aria-labelledby="welcome-title"
      aria-modal="true"
      className={`welcome-gate${leaving ? ' welcome-gate--leaving' : ''}`}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="welcome-gate__content">
        <span className="welcome-gate__mark" aria-hidden="true">F</span>
        <h1 id="welcome-title">Welcome to Filehaven</h1>
        <p id="welcome-description">Public downloads for everyone. Private storage for members.</p>
        <button className="welcome-gate__button" onClick={onEnter} type="button">
          <span>Browse files</span>
          <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
