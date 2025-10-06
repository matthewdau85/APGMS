export interface JsonPatchOp {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

function isObject(value: any): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function computeJsonPatch(before: any, after: any, path = ""): JsonPatchOp[] {
  if (before === after) return [];

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length || before.some((v, i) => JSON.stringify(v) !== JSON.stringify(after[i]))) {
      return [{ op: "replace", path: path || "/", value: after }];
    }
    return [];
  }

  if (isObject(before) && isObject(after)) {
    const ops: JsonPatchOp[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const nextPath = `${path}/${key}`.replace(/^\/+/, "/");
      if (!(key in after)) {
        ops.push({ op: "remove", path: nextPath });
      } else if (!(key in before)) {
        ops.push({ op: "add", path: nextPath, value: after[key] });
      } else {
        ops.push(...computeJsonPatch(before[key], after[key], nextPath));
      }
    }
    return ops;
  }

  return [{ op: "replace", path: path || "/", value: after }];
}
