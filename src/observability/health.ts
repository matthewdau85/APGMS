import { Pool } from "pg";

export type DependencyStatus = {
  name: string;
  ok: boolean;
  error?: string;
};

const pool = new Pool();

async function checkDb(): Promise<DependencyStatus> {
  try {
    const client = await pool.connect();
    try {
      await client.query("select 1");
      return { name: "db", ok: true };
    } finally {
      client.release();
    }
  } catch (error: any) {
    return { name: "db", ok: false, error: error?.message ?? "unknown" };
  }
}

async function checkHttpDependency(name: string, url: string): Promise<DependencyStatus> {
  try {
    const response = await fetch(url, { method: "GET" });
    const ok = response.ok;
    return {
      name,
      ok,
      error: ok ? undefined : `${response.status} ${response.statusText}`,
    };
  } catch (error: any) {
    return { name, ok: false, error: error?.message ?? "unknown" };
  }
}

export async function gatherHealth(): Promise<{ ok: boolean; deps: DependencyStatus[] }> {
  const checks: Promise<DependencyStatus>[] = [checkDb()];

  const natsUrl = process.env.NATS_HEALTH_URL;
  if (natsUrl) {
    checks.push(checkHttpDependency("nats", natsUrl));
  }

  const taxEngineUrl = process.env.TAX_ENGINE_HEALTH_URL;
  if (taxEngineUrl) {
    checks.push(checkHttpDependency("tax_engine", taxEngineUrl));
  }

  const deps = await Promise.all(checks);
  const ok = deps.every((dep) => dep.ok);
  return { ok, deps };
}
