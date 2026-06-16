import React, { useMemo, useState } from 'react';
import { basename, ingestAssetParam, inferAssetKind } from '../util/assets';
import { Manifest } from '../broker/client';
import { FlowError } from '../util/flow';

export function AssetAssignModal({
  paths,
  manifest,
  onClose,
  onIngested,
  setStatus,
}: {
  paths: string[];
  manifest: Manifest;
  onClose: () => void;
  onIngested: (paramId: string, value: string) => void;
  setStatus: (msg: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const assetParams = useMemo(
    () => (manifest.parameters || []).filter(p => p.type === 'image' || p.type === 'video' || p.type === 'font'),
    [manifest],
  );
  const [selected, setSelected] = useState<Record<number, string>>({});

  async function assign(path: string, index: number) {
    const paramId = selected[index];
    if (!paramId) {
      setStatus('[asset] Select a parameter to assign.', 'warning');
      return;
    }
    const param = assetParams.find(p => p.id === paramId);
    if (!param) return;
    const kind = inferAssetKind(path);
    if (kind !== param.type) {
      setStatus(`[asset] Wrong file type for ${param.label || param.id}: expected ${param.type}`, 'error');
      return;
    }
    try {
      const result = await ingestAssetParam(paramId, path, setStatus);
      onIngested(paramId, String(result.value));
      onClose();
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus(`[asset] Assign failed: ${(e as Error)?.message || e}`, 'error');
      }
    }
  }

  if (!paths.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      data-testid="asset-assign-modal"
    >
      <div
        style={{
          background: 'var(--surface-container, #1e1f24)',
          border: '1px solid var(--outline-variant, #444)',
          borderRadius: 8,
          padding: 16,
          minWidth: 360,
          maxWidth: 480,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Assign dropped file(s)</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
          Multiple asset parameters — choose where each file should be ingested.
        </div>
        {paths.map((path, index) => (
          <div key={`${path}-${index}`} style={{ marginBottom: 10 }} data-testid={`asset-assign-row-${index}`}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>{basename(path)}</div>
            <select
              value={selected[index] || ''}
              onChange={e => setSelected(s => ({ ...s, [index]: e.target.value }))}
              style={{ width: '100%', marginBottom: 6 }}
              data-testid="asset-assign-select"
            >
              <option value="">Select parameter…</option>
              {assetParams.map(p => (
                <option key={p.id} value={p.id}>{p.label || p.id} ({p.type})</option>
              ))}
            </select>
            <button type="button" onClick={() => assign(path, index)} data-testid="asset-assign-confirm">
              Ingest
            </button>
          </div>
        ))}
        <button type="button" onClick={onClose} style={{ marginTop: 8 }} data-testid="asset-assign-cancel">
          Cancel
        </button>
      </div>
    </div>
  );
}