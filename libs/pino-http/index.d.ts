import type { Request, Response, NextFunction } from "express";
import type { PinoLogger } from "../pino";

export interface PinoHttpOptions {
  logger?: PinoLogger;
}

declare function pinoHttp(options?: PinoHttpOptions): (req: Request, res: Response, next: NextFunction) => void;

export default pinoHttp;
export = pinoHttp;

