import { spawn, type ChildProcess } from 'node:child_process';
import { HttpError, checkAbort } from './errors.ts';

/** Every caller supplies a fixed executable or an administrator-owned environment override. No shell is used. */
export function stopProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 1500);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}

export async function captureCommand(
  executable: string,
  args: string[],
  { signal, timeout = 15_000, maxBytes = 512 * 1024 }: { signal?: AbortSignal; timeout?: number; maxBytes?: number } = {},
): Promise<string> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let bytes = 0;
    let failure: Error | undefined;
    const fail = (message: string) => {
      failure ??= new HttpError(503, message);
      stopProcess(child);
    };
    const abort = () => fail('Операция отменена.');
    const timer = setTimeout(() => fail('Локальная программа не ответила вовремя.'), timeout);
    timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail('Локальная программа вернула слишком большой ответ.');
      else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail('Локальная программа вернула слишком большой ответ.');
    });
    child.once('error', () => { cleanup(); reject(new HttpError(503, 'Не удалось запустить локальную программу.')); });
    child.once('close', code => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new HttpError(422, 'Локальная программа не смогла обработать файл.'));
      else resolve(stdout);
    });
  });
}

export async function commandAvailable(executable: string): Promise<boolean> {
  try { await captureCommand(executable, ['-version'], { timeout: 5000 }); return true; }
  catch { return false; }
}
