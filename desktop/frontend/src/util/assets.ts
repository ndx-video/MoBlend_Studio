import * as WailsApp from '../../wailsjs/go/main/App';
import { getManifest, patchParameters, Manifest } from '../broker/client';
import { FlowError, runStep } from './flow';

export const ASSET_EXTENSIONS = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
  font: ['.ttf', '.otf', '.woff', '.woff2'],
} as const;

export type AssetKind = keyof typeof ASSET_EXTENSIONS;
export type AssetParamType = AssetKind;

declare const window: Window & { go?: { main?: { App?: Record<string, unknown> } } };

function wailsOr<T extends (...args: never[]) => unknown>(fn: T, fallback: T): T {
  return (typeof fn === 'function' ? fn : fallback) as T;
}

const copyBinding = wailsOr(
  WailsApp.CopyToAssetSandbox,
  async (paths: string[]) => paths,
);

const listBinding = wailsOr(
  WailsApp.ListAssetSandbox,
  async () => [] as string[],
);

const pickBinding = wailsOr(
  WailsApp.PickAssetFile,
  async (_kind: string) => '',
);

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || normalized;
}

export function normalizePath(path: string): string {
  const trimmed = (path || '').trim();
  if (trimmed.toLowerCase().startsWith('file://')) {
    let p = trimmed.slice(7);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return decodeURIComponent(p);
  }
  return trimmed;
}

export function inferAssetKind(path: string): AssetKind | null {
  const lower = basename(path).toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = lower.slice(dot);
  for (const [kind, exts] of Object.entries(ASSET_EXTENSIONS) as [AssetKind, readonly string[]][]) {
    if (exts.includes(ext)) return kind;
  }
  return null;
}

export function isAssetParamType(type: string): type is AssetParamType {
  return type === 'image' || type === 'video' || type === 'font';
}

export function assetParamsFromManifest(manifest: Manifest | null | undefined) {
  return (manifest?.parameters || []).filter(p => isAssetParamType(p.type));
}

export async function copyToSandbox(paths: string[]): Promise<string[]> {
  const normalized = paths.map(normalizePath).filter(Boolean);
  if (!normalized.length) return [];
  const out = await copyBinding(normalized);
  return Array.isArray(out) ? out.map(normalizePath) : [];
}

export async function listSandboxAssets(): Promise<string[]> {
  const out = await listBinding();
  return Array.isArray(out) ? out.map(normalizePath) : [];
}

export async function pickAssetFile(kind: AssetKind): Promise<string> {
  const p = await pickBinding(kind);
  return normalizePath(p || '');
}

export async function ingestAssetParam(
  paramId: string,
  sandboxPath: string,
  setStatus: (msg: string, level?: 'info' | 'success' | 'warning' | 'error') => void,
  opts?: { refreshManifest?: boolean },
): Promise<{ value: string; manifest?: Manifest }> {
  const path = normalizePath(sandboxPath);
  if (!path) throw new FlowError('Empty sandbox path', '[asset] ingest');

  await runStep(
    `[asset] Ingest ${basename(path)} → param ${paramId}`,
    setStatus,
    () => patchParameters([{ id: paramId, value: path }]),
    { successMsg: `[asset] Ingested ${basename(path)} → param ${paramId}` },
  );

  if (opts?.refreshManifest === false) {
    return { value: path };
  }

  const manifest = await runStep(
    '[asset] Refresh manifest',
    setStatus,
    () => getManifest({ timeoutMs: 15_000 }),
    { successMsg: '[asset] Manifest refreshed.' },
  );
  const param = manifest.parameters.find(p => p.id === paramId);
  return { value: param?.default ?? path, manifest };
}

export async function copyAndIngestAsset(
  sourcePaths: string[],
  paramId: string,
  paramType: AssetParamType,
  setStatus: (msg: string, level?: 'info' | 'success' | 'warning' | 'error') => void,
): Promise<{ value: string; manifest?: Manifest }> {
  const sandboxPaths = await runStep(
    '[asset] Copy to sandbox',
    setStatus,
    () => copyToSandbox(sourcePaths),
    { successMsg: '[asset] Copied to sandbox.' },
  );
  if (!sandboxPaths.length) {
    throw new FlowError('No files copied to sandbox', '[asset] Copy to sandbox');
  }
  const path = sandboxPaths[0];
  const kind = inferAssetKind(path);
  if (kind !== paramType) {
    throw new FlowError(
      `File type mismatch: expected ${paramType}, got ${kind || 'unknown'} (${basename(path)})`,
      '[asset] type check',
    );
  }
  return ingestAssetParam(paramId, path, setStatus);
}