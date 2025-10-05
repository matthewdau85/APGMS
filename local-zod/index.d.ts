export interface ZodSchema<T> {
  parse(input: unknown): T;
}

export interface ZodString extends ZodSchema<string> {
  min(length: number): ZodString;
  datetime(): ZodString;
}

export interface ZodNumber extends ZodSchema<number> {
  int(): ZodNumber;
  nonnegative(): ZodNumber;
}

export type Shape = Record<string, ZodSchema<any>>;

export interface ZodObject<T extends Shape> extends ZodSchema<{ [K in keyof T]: Infer<T[K]> }> {}

export type Infer<T extends ZodSchema<any>> = T extends ZodSchema<infer O> ? O : never;

export const z: {
  object<T extends Shape>(shape: T): ZodObject<T>;
  string(): ZodString;
  number(): ZodNumber;
};

export namespace z {
  export type infer<T extends ZodSchema<any>> = Infer<T>;
}
