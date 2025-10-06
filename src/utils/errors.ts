export class HttpError extends Error {
  status: number;
  code: string;
  detail?: string;

  constructor(status: number, code: string, title: string, detail?: string) {
    super(title);
    this.status = status;
    this.code = code;
    this.detail = detail ?? title;
  }
}
