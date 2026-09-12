export class AppError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class RbacError extends AppError {
  constructor(message = 'Unzureichende Berechtigung') {
    super('RBAC_DENIED', message, 403);
  }
}

export class NetworkError extends AppError {
  constructor(message = 'Netzwerkfehler') {
    super('NETWORK_ERROR', message, 502);
  }
}

export class DeviceError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 400);
  }
}

export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler';
}
