class BaseSchema {
  constructor(parseFn) {
    this._parse = parseFn;
  }
  parse(data) {
    return this._parse(data);
  }
}

function stringSchema() {
  let checks = [];
  const schema = new BaseSchema((data) => {
    if (typeof data !== "string") {
      throw new Error("Expected string");
    }
    for (const fn of checks) {
      fn(data);
    }
    return data;
  });
  schema.min = (len) => {
    checks.push((value) => {
      if (value.length < len) throw new Error(`Expected string length >= ${len}`);
    });
    return schema;
  };
  schema.datetime = () => {
    checks.push((value) => {
      if (Number.isNaN(Date.parse(value))) throw new Error("Invalid datetime");
    });
    return schema;
  };
  return schema;
}

function numberSchema() {
  let checks = [];
  const schema = new BaseSchema((data) => {
    if (typeof data !== "number" || Number.isNaN(data)) {
      throw new Error("Expected number");
    }
    for (const fn of checks) {
      fn(data);
    }
    return data;
  });
  schema.int = () => {
    checks.push((value) => {
      if (!Number.isInteger(value)) throw new Error("Expected integer");
    });
    return schema;
  };
  schema.nonnegative = () => {
    checks.push((value) => {
      if (value < 0) throw new Error("Expected nonnegative number");
    });
    return schema;
  };
  return schema;
}

function objectSchema(shape) {
  return new BaseSchema((data) => {
    if (data === null || typeof data !== "object") {
      throw new Error("Expected object");
    }
    const result = {};
    for (const key of Object.keys(shape)) {
      try {
        result[key] = shape[key].parse(data[key]);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        error.message = `${key}: ${error.message}`;
        throw error;
      }
    }
    return result;
  });
}

const z = {
  object: objectSchema,
  string: stringSchema,
  number: numberSchema
};

module.exports = { z, BaseSchema };
