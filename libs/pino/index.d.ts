export interface PinoLogger {
  level: string;
  info(entry: unknown, message?: string): void;
  error(entry: unknown, message?: string): void;
}

export interface PinoOptions {
  level?: string;
}

declare function pino(options?: PinoOptions): PinoLogger;

export default pino;
export = pino;

