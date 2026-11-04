export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function publicError(error: unknown, fallback = 'Не удалось выполнить запрос.'): string {
  return error instanceof HttpError ? error.message : fallback;
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HttpError(409, 'Операция отменена.');
}
