/* Minimal Zod-like implementation supporting the subset used in simulators. */

type Issue = { path: (string | number)[]; message: string };

type ParseSuccess<T> = { success: true; data: T };

type ParseFailure = {
  success: false;
  error: {
    errors: Issue[];
    flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
  };
};

type ParseResult<T> = ParseSuccess<T> | ParseFailure;

abstract class Schema<T> {
  protected refinements: ((value: T) => string | null)[] = [];
  optional() {
    return new OptionalSchema(this);
  }
  refine(check: (value: T) => boolean, message: string) {
    this.refinements.push((value) => (check(value) ? null : message));
    return this;
  }
  protected applyRefinements(value: T, path: (string | number)[]) {
    const issues: Issue[] = [];
    for (const fn of this.refinements) {
      const result = fn(value);
      if (result) {
        issues.push({ path, message: result });
      }
    }
    return issues;
  }
  abstract _parse(value: unknown, path: (string | number)[]): { issues: Issue[]; data?: T };
  safeParse(value: unknown): ParseResult<T> {
    const { issues, data } = this._parse(value, []);
    if (issues.length) {
      return {
        success: false,
        error: {
          errors: issues,
          flatten: () => {
            const fieldErrors: Record<string, string[]> = {};
            for (const issue of issues) {
              const key = issue.path.length ? issue.path.join(".") : "";
              if (!fieldErrors[key]) fieldErrors[key] = [];
              fieldErrors[key].push(issue.message);
            }
            return { fieldErrors, formErrors: issues.map((i) => i.message) };
          },
        },
      };
    }
    return { success: true, data: data as T };
  }
}

class StringSchema extends Schema<string> {
  _parse(value: unknown, path: (string | number)[]) {
    const issues: Issue[] = [];
    if (typeof value !== "string") {
      issues.push({ path, message: "Expected string" });
      return { issues };
    }
    issues.push(...this.applyRefinements(value, path));
    return { issues, data: value };
  }
}

class NumberSchema extends Schema<number> {
  _parse(value: unknown, path: (string | number)[]) {
    const issues: Issue[] = [];
    if (typeof value !== "number" || Number.isNaN(value)) {
      issues.push({ path, message: "Expected number" });
      return { issues };
    }
    issues.push(...this.applyRefinements(value, path));
    return { issues, data: value };
  }
}

class AnySchema extends Schema<any> {
  _parse(value: unknown, path: (string | number)[]) {
    return { issues: this.applyRefinements(value, path), data: value };
  }
}

class EnumSchema<T extends string> extends Schema<T> {
  constructor(private values: readonly T[]) {
    super();
  }
  _parse(value: unknown, path: (string | number)[]) {
    const issues: Issue[] = [];
    if (typeof value !== "string" || !this.values.includes(value as T)) {
      issues.push({ path, message: `Expected one of ${this.values.join(", ")}` });
      return { issues };
    }
    issues.push(...this.applyRefinements(value as T, path));
    return { issues, data: value as T };
  }
}

class ArraySchema<T> extends Schema<T[]> {
  private minLength?: { value: number; message: string };
  constructor(private itemSchema: Schema<T>) {
    super();
  }
  min(count: number, message = `Expected at least ${count} items`) {
    this.minLength = { value: count, message };
    return this;
  }
  _parse(value: unknown, path: (string | number)[]) {
    const issues: Issue[] = [];
    if (!Array.isArray(value)) {
      issues.push({ path, message: "Expected array" });
      return { issues };
    }
    if (this.minLength && value.length < this.minLength.value) {
      issues.push({ path, message: this.minLength.message });
    }
    const result: T[] = [];
    value.forEach((item, index) => {
      const { issues: subIssues, data } = this.itemSchema._parse(item, [...path, index]);
      issues.push(...subIssues);
      if (subIssues.length === 0) {
        result.push(data as T);
      }
    });
    issues.push(...this.applyRefinements(result as unknown as T[], path));
    return { issues, data: result };
  }
}

class ObjectSchema<T extends Record<string, any>> extends Schema<T> {
  constructor(private shape: { [K in keyof T]: Schema<T[K]> }) {
    super();
  }
  _parse(value: unknown, path: (string | number)[]) {
    const issues: Issue[] = [];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({ path, message: "Expected object" });
      return { issues };
    }
    const result: Record<string, any> = {};
    for (const key of Object.keys(this.shape)) {
      const schema = this.shape[key as keyof T];
      const { issues: subIssues, data } = schema._parse((value as any)[key], [...path, key]);
      issues.push(...subIssues);
      if (subIssues.length === 0) {
        result[key] = data;
      }
    }
    issues.push(...this.applyRefinements(result as T, path));
    return { issues, data: result as T };
  }
}

class OptionalSchema<T> extends Schema<T | undefined> {
  constructor(private inner: Schema<T>) {
    super();
  }
  _parse(value: unknown, path: (string | number)[]) {
    if (value === undefined || value === null) {
      return { issues: [], data: undefined };
    }
    return this.inner._parse(value, path);
  }
}

class RecordSchema<T> extends Schema<Record<string, T>> {
  constructor(private valueSchema: Schema<T>) {
    super();
  }
  _parse(value: unknown, path: (string | number)[]) {
    const issues: Issue[] = [];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({ path, message: "Expected record" });
      return { issues };
    }
    const result: Record<string, T> = {} as any;
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const { issues: subIssues, data } = this.valueSchema._parse(val, [...path, key]);
      issues.push(...subIssues);
      if (subIssues.length === 0) {
        result[key] = data as T;
      }
    }
    issues.push(...this.applyRefinements(result, path));
    return { issues, data: result };
  }
}

export const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  any: () => new AnySchema(),
  enum: <T extends string>(values: readonly T[]) => new EnumSchema(values),
  array: <T>(schema: Schema<T>) => new ArraySchema(schema),
  object: <T extends Record<string, any>>(shape: { [K in keyof T]: Schema<T[K]> }) => new ObjectSchema(shape),
  record: <T>(schema: Schema<T>) => new RecordSchema(schema),
};

export type infer<T> = T extends Schema<infer O> ? O : never;
