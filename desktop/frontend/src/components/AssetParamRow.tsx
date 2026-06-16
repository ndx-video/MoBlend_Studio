import React, { useRef } from 'react';
import {
  AssetParamType,
  basename,
  copyAndIngestAsset,
  inferAssetKind,
  normalizePath,
} from '../util/assets';
import { FlowError } from '../util/flow';

type Param = {
  id: string;
  type: string;
  label?: string;
  default?: unknown;
};

export function AssetParamRow({
  param,
  value,
  onIngested,
  setStatus,
}: {
  param: Param;
  value: string;
  onIngested: (id: string, value: string) => void;
  setStatus: (msg: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const assetType = param.type as AssetParamType;
  const display = value ? basename(value) : 'No file';

  async function ingestFromPaths(paths: string[]) {
    try {
      const result = await copyAndIngestAsset(paths, param.id, assetType, setStatus);
      onIngested(param.id, String(result.value));
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus(`[asset] Ingest failed: ${(e as Error)?.message || e}`, 'error');
      }
    }
  }

  async function onChooseFile() {
    try {
      const { pickAssetFile } = await import('../util/assets');
      const picked = await pickAssetFile(assetType);
      if (!picked) {
        setStatus('[asset] File pick cancelled.', 'info');
        return;
      }
      await ingestFromPaths([picked]);
    } catch (e: unknown) {
      if (!(e instanceof FlowError)) {
        setStatus(`[asset] Pick failed: ${(e as Error)?.message || e}`, 'error');
      }
    }
  }

  async function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const kind = inferAssetKind(file.name);
    if (kind !== assetType) {
      setStatus(`[asset] Wrong file type: expected ${assetType}, got ${kind || 'unknown'}`, 'error');
      return;
    }
    const path = normalizePath((file as File & { path?: string }).path || file.name);
    await ingestFromPaths([path]);
  }

  return (
    <div data-testid={`param-row-${param.id}`}>
      <div style={{ fontSize: 12, marginBottom: 2 }}>
        {param.label || param.id} <span style={{ opacity: .5 }}>({param.type})</span>
      </div>
      <div
        style={{
          border: '1px dashed var(--outline-variant, #444)',
          borderRadius: 6,
          padding: 8,
          background: 'var(--surface-container-low, #1e1f24)',
        }}
        data-testid={`param-asset-drop-${param.id}`}
      >
        <div style={{ fontSize: 12, marginBottom: 6 }} data-testid={`param-asset-value-${param.id}`}>
          {display}
        </div>
        <button
          type="button"
          onClick={onChooseFile}
          data-testid={`param-choose-file-${param.id}`}
        >
          Choose file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={assetType === 'image' ? 'image/*' : assetType === 'video' ? 'video/*' : '.ttf,.otf,.woff,.woff2'}
          style={{ display: 'none' }}
          onChange={onFileInputChange}
          data-testid={`param-file-input-${param.id}`}
        />
        <button
          type="button"
          style={{ marginLeft: 6 }}
          onClick={() => fileRef.current?.click()}
          data-testid={`param-choose-fallback-${param.id}`}
        >
          Browse (dev)
        </button>
      </div>
    </div>
  );
}