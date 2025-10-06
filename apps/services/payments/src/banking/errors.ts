export class BankingValidationError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "BankingValidationError";
    this.code = code;
  }
}
