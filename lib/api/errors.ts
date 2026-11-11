export class ApiAuthError extends Error {
  readonly status: 401 | 403;
  readonly code?: string;

  constructor(status: 401 | 403, message: string, code?: string) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
    this.code = code;
  }
}
