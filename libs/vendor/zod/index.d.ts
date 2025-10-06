export type ZodIssue = { path: (string | number)[]; message: string };
export type SafeParseSuccess<T> = { success: true; data: T };
export type SafeParseError = { success: false; error: { issues: ZodIssue[] } };

export interface ZodSchema<T> {
  safeParse(value: unknown, path?: (string | number)[]): SafeParseSuccess<T> | SafeParseError;
  parse(value: unknown): T;
  refine(check: (value: T) => boolean, message?: string): ZodSchema<T>;
  optional(): ZodSchema<T | undefined>;
}

export interface ZodString extends ZodSchema<string> {
  min(length: number, message?: string): ZodString;
  regex(pattern: RegExp, message?: string): ZodString;
}

export interface ZodNumber extends ZodSchema<number> {
  int(message?: string): ZodNumber;
  nonnegative(message?: string): ZodNumber;
  positive(message?: string): ZodNumber;
}

export interface ZodArray<T> extends ZodSchema<T[]> {
  min(length: number, message?: string): ZodArray<T>;
}

export type infer<T extends ZodSchema<any>> = T extends ZodSchema<infer U> ? U : never;

export interface ZodObjectShape {
  [key: string]: ZodSchema<any>;
}

export interface ZodObject<T extends ZodObjectShape> extends ZodSchema<{ [K in keyof T]: infer<T[K]> }> {}

export interface ZodEnum<T extends readonly [string, ...string[]]> extends ZodSchema<T[number]> {}

export const z: {
  string(): ZodString;
  number(): ZodNumber;
  array<A>(inner: ZodSchema<A>): ZodArray<A>;
  object<T extends ZodObjectShape>(shape: T): ZodObject<T>;
  enum<T extends readonly [string, ...string[]]>(values: T): ZodEnum<T>;
};
