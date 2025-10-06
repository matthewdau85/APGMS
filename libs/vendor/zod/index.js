"use strict";
function makeError(message, path) {
  return { success: false, error: { issues: [{ message, path: path || [] }] } };
}
function makeSuccess(data) {
  return { success: true, data };
}
function cloneChecks(checks) {
  return checks.slice();
}
function buildString(checks) {
  const schema = {
    _checks: cloneChecks(checks),
    safeParse(value, path) {
      const p = path || [];
      if (typeof value !== "string") {
        return makeError("Expected string", p);
      }
      for (const check of this._checks) {
        if (!check.fn(value)) {
          return makeError(check.message, p);
        }
      }
      return makeSuccess(value);
    },
    parse(value) {
      const res = this.safeParse(value);
      if (!res.success) {
        const err = new Error("Invalid input");
        err.issues = res.error.issues;
        throw err;
      }
      return res.data;
    },
    refine(fn, message) {
      const msg = message || "Invalid value";
      return buildString([...this._checks, { fn, message: msg }]);
    },
    optional() {
      return buildOptional(this);
    },
    min(len, message) {
      const msg = message || `Must be at least ${len} characters`;
      return this.refine((val) => val.length >= len, msg);
    },
    regex(re, message) {
      const msg = message || "Invalid format";
      return this.refine((val) => re.test(val), msg);
    }
  };
  return schema;
}
function buildNumber(checks) {
  const schema = {
    _checks: cloneChecks(checks),
    safeParse(value, path) {
      const p = path || [];
      if (typeof value !== "number" || Number.isNaN(value)) {
        return makeError("Expected number", p);
      }
      for (const check of this._checks) {
        if (!check.fn(value)) {
          return makeError(check.message, p);
        }
      }
      return makeSuccess(value);
    },
    parse(value) {
      const res = this.safeParse(value);
      if (!res.success) {
        const err = new Error("Invalid input");
        err.issues = res.error.issues;
        throw err;
      }
      return res.data;
    },
    refine(fn, message) {
      const msg = message || "Invalid value";
      return buildNumber([...this._checks, { fn, message: msg }]);
    },
    optional() {
      return buildOptional(this);
    },
    int(message) {
      const msg = message || "Expected integer";
      return this.refine((val) => Number.isInteger(val), msg);
    },
    nonnegative(message) {
      const msg = message || "Must be non-negative";
      return this.refine((val) => val >= 0, msg);
    },
    positive(message) {
      const msg = message || "Must be positive";
      return this.refine((val) => val > 0, msg);
    }
  };
  return schema;
}
function buildArray(inner, checks) {
  const schema = {
    _checks: cloneChecks(checks),
    safeParse(value, path) {
      const p = path || [];
      if (!Array.isArray(value)) {
        return makeError("Expected array", p);
      }
      let issues = [];
      const data = [];
      value.forEach((item, idx) => {
        const res = inner.safeParse(item, [...p, idx]);
        if (!res.success) {
          issues = issues.concat(res.error.issues);
        } else {
          data.push(res.data);
        }
      });
      if (issues.length) {
        return { success: false, error: { issues } };
      }
      for (const check of this._checks) {
        if (!check.fn(data)) {
          return makeError(check.message, p);
        }
      }
      return makeSuccess(data);
    },
    parse(value) {
      const res = this.safeParse(value);
      if (!res.success) {
        const err = new Error("Invalid input");
        err.issues = res.error.issues;
        throw err;
      }
      return res.data;
    },
    refine(fn, message) {
      const msg = message || "Invalid value";
      return buildArray(inner, [...this._checks, { fn, message: msg }]);
    },
    optional() {
      return buildOptional(this);
    },
    min(len, message) {
      const msg = message || `Must contain at least ${len} items`;
      return this.refine((arr) => arr.length >= len, msg);
    }
  };
  return schema;
}
function buildObject(shape, checks) {
  const schema = {
    _checks: cloneChecks(checks),
    safeParse(value, path) {
      const p = path || [];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return makeError("Expected object", p);
      }
      const data = {};
      let issues = [];
      for (const key of Object.keys(shape)) {
        const parser = shape[key];
        const res = parser.safeParse(value[key], [...p, key]);
        if (!res.success) {
          issues = issues.concat(res.error.issues);
        } else {
          data[key] = res.data;
        }
      }
      if (issues.length) {
        return { success: false, error: { issues } };
      }
      for (const check of this._checks) {
        if (!check.fn(data)) {
          return makeError(check.message, p);
        }
      }
      return makeSuccess(data);
    },
    parse(value) {
      const res = this.safeParse(value);
      if (!res.success) {
        const err = new Error("Invalid input");
        err.issues = res.error.issues;
        throw err;
      }
      return res.data;
    },
    refine(fn, message) {
      const msg = message || "Invalid value";
      return buildObject(shape, [...this._checks, { fn, message: msg }]);
    },
    optional() {
      return buildOptional(this);
    }
  };
  return schema;
}
function buildEnum(values) {
  const allowed = new Set(values);
  return buildString([{ fn: (v) => allowed.has(v), message: `Expected one of ${values.join(", ")}` }]);
}
function buildOptional(inner) {
  return {
    safeParse(value, path) {
      if (value === undefined || value === null) {
        return makeSuccess(undefined);
      }
      return inner.safeParse(value, path);
    },
    parse(value) {
      const res = this.safeParse(value);
      if (!res.success) {
        const err = new Error("Invalid input");
        err.issues = res.error.issues;
        throw err;
      }
      return res.data;
    },
    refine(fn, message) {
      const msg = message || "Invalid value";
      return buildOptional(inner.refine((val) => val === undefined || fn(val), msg));
    },
    optional() {
      return this;
    }
  };
}
const z = {
  string() {
    return buildString([]);
  },
  number() {
    return buildNumber([]);
  },
  array(inner) {
    return buildArray(inner, []);
  },
  object(shape) {
    return buildObject(shape, []);
  },
  enum(values) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("z.enum requires a non-empty array");
    }
    return buildEnum(values);
  }
};
module.exports = { z };
