type Issue = { path: (string | number)[]; message: string; code: string };

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = { success: false; error: { issues: Issue[] } };
type SafeParseReturn<T> = SafeParseSuccess<T> | SafeParseError;

class ZString {
  private minLength?: number;
  private maxLength?: number;

  min(length: number) {
    this.minLength = length;
    return this;
  }

  max(length: number) {
    this.maxLength = length;
    return this;
  }

  safeParse(data: unknown): SafeParseReturn<string> {
    if (typeof data !== "string") {
      return { success: false, error: { issues: [{ path: [], message: "Expected string", code: "invalid_type" }] } };
    }
    if (this.minLength !== undefined && data.length < this.minLength) {
      return { success: false, error: { issues: [{ path: [], message: `Must be at least ${this.minLength} characters`, code: "too_small" }] } };
    }
    if (this.maxLength !== undefined && data.length > this.maxLength) {
      return { success: false, error: { issues: [{ path: [], message: `Must be at most ${this.maxLength} characters`, code: "too_big" }] } };
    }
    return { success: true, data };
  }
}

class ZNumber {
  private requireInt = false;
  private requirePositive = false;

  int() {
    this.requireInt = true;
    return this;
  }

  positive() {
    this.requirePositive = true;
    return this;
  }

  safeParse(data: unknown): SafeParseReturn<number> {
    if (typeof data !== "number" || Number.isNaN(data)) {
      return { success: false, error: { issues: [{ path: [], message: "Expected number", code: "invalid_type" }] } };
    }
    if (this.requireInt && !Number.isInteger(data)) {
      return { success: false, error: { issues: [{ path: [], message: "Expected integer", code: "invalid_type" }] } };
    }
    if (this.requirePositive && data <= 0) {
      return { success: false, error: { issues: [{ path: [], message: "Must be positive", code: "too_small" }] } };
    }
    return { success: true, data };
  }
}

class ZCoerceNumber extends ZNumber {
  safeParse(data: unknown): SafeParseReturn<number> {
    const coerced = Number(data);
    if (!Number.isFinite(coerced)) {
      return { success: false, error: { issues: [{ path: [], message: "Unable to coerce to number", code: "invalid_type" }] } };
    }
    return super.safeParse(coerced);
  }
}

class ZEnum<T extends string[]> {
  constructor(private readonly values: T) {}

  safeParse(data: unknown): SafeParseReturn<T[number]> {
    if (typeof data !== "string" || !this.values.includes(data as T[number])) {
      return { success: false, error: { issues: [{ path: [], message: "Invalid enum value", code: "invalid_enum_value" }] } };
    }
    return { success: true, data: data as T[number] };
  }
}

class ZRecord<T> {
  constructor(private readonly valueSchema: { safeParse(value: unknown): SafeParseReturn<T> }) {}

  safeParse(data: unknown): SafeParseReturn<Record<string, T>> {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { issues: [{ path: [], message: "Expected object", code: "invalid_type" }] } };
    }
    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const parsed = this.valueSchema.safeParse(value);
      if (!parsed.success) {
        return { success: false, error: { issues: parsed.error.issues.map((issue) => ({ ...issue, path: [key, ...issue.path] })) } };
      }
      result[key] = parsed.data;
    }
    return { success: true, data: result };
  }
}

class ZObject<T extends Record<string, any>> {
  constructor(private readonly shape: { [K in keyof T]: { safeParse(value: unknown): SafeParseReturn<T[K]> } }) {}

  safeParse(data: unknown): SafeParseReturn<T> {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { issues: [{ path: [], message: "Expected object", code: "invalid_type" }] } };
    }
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const issues: Issue[] = [];
    for (const key of Object.keys(this.shape)) {
      const schema = this.shape[key];
      const parsed = schema.safeParse(obj[key]);
      if (!parsed.success) {
        parsed.error.issues.forEach((issue) => {
          issues.push({ ...issue, path: [key, ...issue.path] });
        });
      } else {
        result[key] = parsed.data;
      }
    }
    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }
    return { success: true, data: result as T };
  }
}

function optionalWrapper<T>(schema: { safeParse(value: unknown): SafeParseReturn<T> }) {
  return {
    safeParse(value: unknown): SafeParseReturn<T | undefined> {
      if (value === undefined || value === null) {
        return { success: true, data: undefined };
      }
      return schema.safeParse(value);
    },
  };
}

export const z = {
  string: () => new ZString(),
  number: () => new ZNumber(),
  enum: <T extends string[]>(values: T) => new ZEnum(values),
  record: <T>(schema: { safeParse(value: unknown): SafeParseReturn<T> }) => new ZRecord(schema),
  object: <T extends Record<string, any>>(shape: { [K in keyof T]: { safeParse(value: unknown): SafeParseReturn<T[K]> } }) =>
    new ZObject(shape),
  coerce: {
    number: () => new ZCoerceNumber(),
  },
  optional: optionalWrapper,
};

export type { Issue as ZodIssue };
