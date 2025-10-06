export type Issue = { path: (string | number)[]; message: string };

export class ZodError extends Error {
  constructor(public issues: Issue[]) {
    super("Zod validation error");
  }
}

abstract class BaseSchema<T> {
  protected optionalFlag = false;
  protected defaultValue: T | (() => T) | undefined;

  optional(): this {
    this.optionalFlag = true;
    return this;
  }

  default(value: T | (() => T)): this {
    this.defaultValue = value;
    this.optional();
    return this;
  }

  protected resolveDefault(input: unknown): T | undefined {
    if (input === undefined && this.defaultValue !== undefined) {
      return typeof this.defaultValue === "function"
        ? (this.defaultValue as () => T)()
        : this.defaultValue;
    }
    return undefined;
  }

  abstract safeParse(data: unknown, path?: (string | number)[]):
    | { success: true; data: T }
    | { success: false; error: { issues: Issue[] } };

  parse(data: unknown): T {
    const result = this.safeParse(data);
    if (!result.success) {
      throw new ZodError(result.error.issues);
    }
    return result.data;
  }
}

class StringSchema extends BaseSchema<string> {
  private minLength?: { value: number; message: string };

  min(value: number, message?: string): this {
    this.minLength = { value, message: message ?? `Expected string length >= ${value}` };
    return this;
  }

  safeParse(data: unknown, path: (string | number)[] = []) {
    if (data === undefined) {
      if (this.optionalFlag) {
        const fallback = this.resolveDefault(data);
        return { success: true, data: (fallback ?? data) as string };
      }
      return { success: false, error: { issues: [{ path, message: "Required" }] } };
    }
    if (typeof data !== "string") {
      return { success: false, error: { issues: [{ path, message: "Expected string" }] } };
    }
    if (this.minLength && data.length < this.minLength.value) {
      return { success: false, error: { issues: [{ path, message: this.minLength.message }] } };
    }
    return { success: true, data };
  }
}

class NumberSchema extends BaseSchema<number> {
  private nonNegativeMessage?: string;

  nonnegative(message?: string): this {
    this.nonNegativeMessage = message ?? "Expected non-negative number";
    return this;
  }

  safeParse(data: unknown, path: (string | number)[] = []) {
    if (data === undefined) {
      if (this.optionalFlag) {
        const fallback = this.resolveDefault(data);
        return { success: true, data: (fallback ?? data) as number };
      }
      return { success: false, error: { issues: [{ path, message: "Required" }] } };
    }
    if (typeof data !== "number" || Number.isNaN(data)) {
      return { success: false, error: { issues: [{ path, message: "Expected number" }] } };
    }
    if (this.nonNegativeMessage && data < 0) {
      return { success: false, error: { issues: [{ path, message: this.nonNegativeMessage }] } };
    }
    return { success: true, data };
  }
}

class ArraySchema<T> extends BaseSchema<T[]> {
  constructor(private inner: BaseSchema<T>) {
    super();
  }

  safeParse(data: unknown, path: (string | number)[] = []) {
    if (data === undefined) {
      if (this.optionalFlag) {
        const fallback = this.resolveDefault(data);
        return { success: true, data: (fallback ?? data) as T[] };
      }
      return { success: false, error: { issues: [{ path, message: "Required" }] } };
    }
    if (!Array.isArray(data)) {
      return { success: false, error: { issues: [{ path, message: "Expected array" }] } };
    }
    const results: T[] = [];
    const issues: Issue[] = [];
    data.forEach((value, index) => {
      const parsed = this.inner.safeParse(value, [...path, index]);
      if (parsed.success) {
        results.push(parsed.data);
      } else {
        issues.push(...parsed.error.issues);
      }
    });
    if (issues.length) {
      return { success: false, error: { issues } };
    }
    return { success: true, data: results };
  }
}

class ObjectSchema<Shape extends Record<string, BaseSchema<any>>> extends BaseSchema<{ [K in keyof Shape]: Shape[K] extends BaseSchema<infer U> ? U : never }> {
  constructor(private shape: Shape) {
    super();
  }

  extend<Extension extends Record<string, BaseSchema<any>>>(extension: Extension) {
    return new ObjectSchema({ ...this.shape, ...extension });
  }

  safeParse(data: unknown, path: (string | number)[] = []) {
    if (data === undefined) {
      if (this.optionalFlag) {
        const fallback = this.resolveDefault(data);
        return { success: true, data: (fallback ?? data) as any };
      }
      return { success: false, error: { issues: [{ path, message: "Required" }] } };
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { issues: [{ path, message: "Expected object" }] } };
    }
    const result: any = {};
    const issues: Issue[] = [];
    for (const key of Object.keys(this.shape)) {
      const schema = this.shape[key];
      const parsed = schema.safeParse((data as any)[key], [...path, key]);
      if (parsed.success) {
        result[key] = parsed.data === undefined ? schema.resolveDefault(undefined) : parsed.data;
        if (result[key] === undefined && schema.resolveDefault(undefined) === undefined) {
          result[key] = (data as any)[key];
        }
        if (schema instanceof BaseSchema && (data as any)[key] === undefined) {
          const fallback = schema.resolveDefault(undefined);
          if (fallback !== undefined) {
            result[key] = fallback;
          }
        }
      } else {
        issues.push(...parsed.error.issues);
      }
    }
    if (issues.length) {
      return { success: false, error: { issues } };
    }
    return { success: true, data: result };
  }
}

class LiteralSchema<T> extends BaseSchema<T> {
  constructor(private literal: T) {
    super();
  }

  safeParse(data: unknown, path: (string | number)[] = []) {
    if (data === undefined) {
      if (this.optionalFlag) {
        const fallback = this.resolveDefault(data);
        return { success: true, data: (fallback ?? data) as T };
      }
      return { success: false, error: { issues: [{ path, message: "Required" }] } };
    }
    if (data !== this.literal) {
      return { success: false, error: { issues: [{ path, message: `Expected literal ${this.literal}` }] } };
    }
    return { success: true, data: data as T };
  }
}

class EnumSchema<T extends readonly [string, ...string[]]> extends BaseSchema<T[number]> {
  constructor(private values: T) {
    super();
  }

  safeParse(data: unknown, path: (string | number)[] = []) {
    if (data === undefined) {
      if (this.optionalFlag) {
        const fallback = this.resolveDefault(data);
        return { success: true, data: (fallback ?? data) as T[number] };
      }
      return { success: false, error: { issues: [{ path, message: "Required" }] } };
    }
    if (!this.values.includes(data as string)) {
      return {
        success: false,
        error: { issues: [{ path, message: `Expected one of ${this.values.join(", ")}` }] },
      };
    }
    return { success: true, data: data as T[number] };
  }
}

export const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  array: <T>(schema: BaseSchema<T>) => new ArraySchema(schema),
  object: <Shape extends Record<string, BaseSchema<any>>>(shape: Shape) => new ObjectSchema(shape),
  literal: <T>(value: T) => new LiteralSchema(value),
  enum: <T extends readonly [string, ...string[]]>(values: T) => new EnumSchema(values),
};

export type infer<T> = T extends BaseSchema<infer U> ? U : never;
