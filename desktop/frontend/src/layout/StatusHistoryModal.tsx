import React, { useEffect } from 'react';
import { StatusEntry, formatStatusEntry } from './StatusContext';

const levelClass: Record<StatusEntry['level'], string> = {
  info: 'text-on-surface-variant',
  success: 'text-[#8fd89a]',
  warning: 'text-[#ffe9a6]',
  error: 'text-[#ffb4ab]',
};

export default function StatusHistoryModal({
  history,
  onClose,
}: {
  history: StatusEntry[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lines = history.length > 0 ? history : [{ message: '(no messages yet)', level: 'info' as const, at: Date.now() }];

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center pb-8 px-4 bg-black/50"
      data-testid="status-history-overlay"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[min(420px,60vh)] flex flex-col rounded-lg border border-outline-variant bg-surface-container shadow-lg"
        data-testid="status-history-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant">
          <span className="text-sm font-semibold text-on-surface">Notification history</span>
          <button
            type="button"
            className="text-xs text-on-surface-variant hover:text-on-surface px-2 py-1"
            onClick={onClose}
            data-testid="status-history-close"
          >
            Close (Esc)
          </button>
        </div>
        <div
          className="overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-1"
          data-testid="status-history-list"
        >
          {lines.map((entry, i) => (
            <div key={`${entry.at}-${i}`} className={levelClass[entry.level]} data-testid={`status-history-line-${i}`}>
              {formatStatusEntry(entry)}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-outline-variant text-[10px] text-on-surface-variant">
          Click · copy latest · Double-click · copy log · Shift-click · this overlay
        </div>
      </div>
    </div>
  );
}