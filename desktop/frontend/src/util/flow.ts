/** Async flow helpers — timeouts and numbered checkpoints (no silent hangs). */

export class FlowError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FlowError';
  }
}

export function logCheckpoint(step: string, detail?: string) {
  const msg = detail ? `[moblend] ${step} — ${detail}` : `[moblend] ${step}`;
  console.info(msg);
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new FlowError(`${label} timed out after ${timeoutMs}ms`, label));
    }, timeoutMs);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function runStep<T>(
  step: string,
  onStatus: (msg: string, level?: 'info' | 'success' | 'warning' | 'error') => void,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; successMsg?: string },
): Promise<T> {
  logCheckpoint(step, 'start');
  onStatus(step, 'info');
  try {
    const work = fn();
    const result = opts?.timeoutMs
      ? await withTimeout(work, opts.timeoutMs, step)
      : await work;
    if (opts?.successMsg) onStatus(opts.successMsg, 'success');
    logCheckpoint(step, 'ok');
    return result;
  } catch (e: unknown) {
    const err = e instanceof FlowError ? e : new FlowError(
      e instanceof Error ? e.message : String(e),
      step,
      e,
    );
    logCheckpoint(step, `FAIL: ${err.message}`);
    onStatus(`${step} — FAILED: ${err.message}`, 'error');
    throw err;
  }
}