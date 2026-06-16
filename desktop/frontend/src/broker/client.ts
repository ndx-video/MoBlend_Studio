// Minimal typed REST client for the Mo.Blend broker (127.0.0.1:8000).
// The frontend calls the broker directly (never through Go bindings for data).

import { getBrokerBase } from './config';
import { FlowError } from '../util/flow';

export const BROKER = getBrokerBase();

const DEFAULT_TIMEOUT_MS = 90_000;

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, any> };
}

export type ApiOptions = RequestInit & { timeoutMs?: number };

export async function api<T>(path: string, init?: ApiOptions): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { timeoutMs: _t, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${getBrokerBase()}${path}`, {
      ...fetchInit,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(fetchInit.headers || {}) },
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'AbortError') {
      throw new FlowError(
        `Broker request timed out (${timeoutMs}ms): ${path}`,
        `HTTP ${path}`,
        e,
      );
    }
    throw new FlowError(
      `Broker unreachable at ${getBrokerBase()} (${err?.message || e})`,
      `HTTP ${path}`,
      e,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as ErrorEnvelope;
      msg = j?.error?.message || msg;
    } catch { /* ignore */ }
    throw new FlowError(msg, `HTTP ${path}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export interface Health {
  status?: string;
  loaded: boolean;
  template_id?: string | null;
  dirty: boolean;
  blender_version?: string | null;
}

export interface Manifest {
  version: string;
  template_id: string;
  metadata?: Record<string, any>;
  parameters: Array<{
    id: string;
    type: string;
    label?: string;
    ui_group?: string;
    default?: any;
    min?: number;
    max?: number;
    options?: string[];
    node_target: string;
    socket_identifier: string;
  }>;
  slots?: Array<{ index: number; label?: string; start_time: number; end_time: number; preset_id?: string }>;
  slot_presets?: Array<{ id: string; label?: string }>;
}

export interface ParamUpdate { id: string; value: any }

export async function getHealth(opts?: { timeoutMs?: number }): Promise<Health> {
  return api<Health>('/api/v1/health', { timeoutMs: opts?.timeoutMs ?? 8_000 });
}
export async function getManifest(opts?: { timeoutMs?: number }): Promise<Manifest> {
  return api<Manifest>('/api/v1/manifest', { timeoutMs: opts?.timeoutMs ?? 15_000 });
}
export async function loadProject(template_path: string, opts?: { timeoutMs?: number }) {
  return api('/api/v1/project/load', {
    method: 'POST',
    body: JSON.stringify({ template_path }),
    timeoutMs: opts?.timeoutMs ?? 120_000,
  });
}
export async function patchParameters(updates: ParamUpdate[]) {
  return api('/api/v1/parameters', { method: 'PATCH', body: JSON.stringify({ updates }) });
}
export async function patchSlots(slots: any[]) {
  return api('/api/v1/slots', { method: 'PATCH', body: JSON.stringify({ slots }) });
}
export async function startExport(spec: Record<string, any> = {}) {
  return api<{ job_id: string; status: string }>('/api/v1/render/export', {
    method: 'POST',
    body: JSON.stringify(spec),
  });
}
export async function getExportStatus(jobId: string) {
  return api(`/api/v1/render/status/${encodeURIComponent(jobId)}`);
}

export interface CatalogEntry {
  template_id: string;
  name: string;
  category?: string;
  description?: string;
  version: string;
  preview_url?: string;
  manifest_url?: string;
  download_url: string;
}

export async function getTemplates(opts?: { timeoutMs?: number }): Promise<CatalogEntry[]> {
  return api<CatalogEntry[]>('/api/v1/templates', { timeoutMs: opts?.timeoutMs ?? 15_000 });
}

export async function refreshTemplates(opts?: { timeoutMs?: number }): Promise<CatalogEntry[]> {
  return api<CatalogEntry[]>('/api/v1/templates/refresh', {
    method: 'POST',
    timeoutMs: opts?.timeoutMs ?? 30_000,
  });
}