import React, { useRef, useState } from 'react';
import { useStatus, formatStatusEntry } from './StatusContext';
import StatusHistoryModal from './StatusHistoryModal';

const CLICK_DELAY_MS = 250;

export default function StatusBar() {
  const { message, level, brokerState, history } = useStatus();
  const [copied, setCopied] = useState<'single' | 'all' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const display = message || 'Ready';

  function flash(kind: 'single' | 'all') {
    setCopied(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setCopied(null), 1200);
  }

  async function copyText(text: string, kind: 'single' | 'all') {
    try {
      await navigator.clipboard.writeText(text);
      flash(kind);
    } catch {
      /* clipboard may be blocked outside secure context */
    }
  }

  function handleClick(e: React.MouseEvent) {
    if (e.shiftKey) {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      setShowHistory(true);
      return;
    }
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      void copyText(display, 'single');
    }, CLICK_DELAY_MS);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (e.shiftKey) return;
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    const lines = history.length > 0
      ? history.map(formatStatusEntry)
      : [formatStatusEntry({ message: display, level, at: Date.now() })];
    void copyText(lines.join('\n'), 'all');
  }

  const copiedLabel = copied === 'all'
    ? 'Copied full log'
    : copied === 'single'
      ? 'Copied'
      : null;

  return (
    <>
      <footer
        className="h-6 flex-shrink-0 flex items-center gap-2 px-3 border-t border-outline-variant bg-surface-container-low text-[11px] font-mono cursor-pointer hover:bg-surface-container-high transition-colors"
        data-testid="status-bar"
        role="status"
        aria-live="polite"
        title="Click · copy message · Double-click · copy log · Shift-click · history overlay"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            brokerState === 'ready' ? 'bg-[#8fd89a]'
            : brokerState === 'starting' ? 'bg-[#ffe9a6] animate-pulse'
            : brokerState === 'unreachable' ? 'bg-[#ffb4ab]'
            : 'bg-on-surface-variant'
          }`}
          data-testid="status-broker-dot"
        />
        <span className={`truncate flex-1 ${
          level === 'error' ? 'text-[#ffb4ab]'
          : level === 'warning' ? 'text-[#ffe9a6]'
          : level === 'success' ? 'text-[#8fd89a]'
          : 'text-on-surface-variant'
        }`} data-testid="status-bar-message">
          {copiedLabel ?? display}
        </span>
        <span className="text-on-surface-variant/60 flex-shrink-0 hidden sm:inline" data-testid="status-broker-label">
          {history.length > 0 ? `${history.length} msgs · ` : ''}
          {brokerState === 'ready' ? 'broker:8000' : brokerState}
        </span>
        {copiedLabel && (
          <span className="sr-only" data-testid="status-bar-copied">{copiedLabel}</span>
        )}
      </footer>
      {showHistory && (
        <StatusHistoryModal history={history} onClose={() => setShowHistory(false)} />
      )}
    </>
  );
}