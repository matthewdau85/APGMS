import { createServer, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { getPayToImplementations } from "@core/ports/payto";
import type { PayToPort } from "@core/ports/types/payto";
import type { RuntimeMode } from "@core/runtime/mode";

const MODES: RuntimeMode[] = ["mock", "real"];
const ALLOWLIST = new Set(["BANK_TIMEOUT", "BANK_THROTTLED"]);

type Normalised = {
  ok: boolean;
  code?: string;
  status?: string;
  bankRef?: boolean;
};

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function createFakeBankServer() {
  const mandates = new Map<string, { id: string; abn: string; periodId: string; capCents: number; status: string; ledger: number }>();
  const server = createServer(async (req, res) => {
    if (!req.url || req.method !== "POST") {
      res.statusCode = 404;
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const body = await readBody(req);
    const segments = url.pathname.split("/").filter(Boolean);

    const respond = (payload: any) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    };

    if (segments.length === 2 && segments[0] === "payto" && segments[1] === "mandates") {
      const id = randomUUID();
      const mandate = { id, abn: body.abn, periodId: body.periodId, capCents: body.capCents, status: "PENDING", ledger: 0 };
      mandates.set(id, mandate);
      respond({ ok: true, mandate });
      return;
    }

    if (segments[0] === "payto" && segments[1] === "mandates" && segments.length >= 3) {
      const mandateId = segments[2];
      const mandate = mandates.get(mandateId);
      const action = segments[3];
      if (action === "verify") {
        if (!mandate) return respond({ ok: false, code: "NOT_FOUND" });
        if (mandate.status === "CANCELLED") return respond({ ok: false, code: "MANDATE_CANCELLED", mandate });
        mandate.status = "VERIFIED";
        return respond({ ok: true, mandate });
      }
      if (action === "cancel") {
        if (!mandate) return respond({ ok: false, code: "NOT_FOUND" });
        mandate.status = "CANCELLED";
        return respond({ ok: true, mandate });
      }
      if (action === "debit") {
        if (!mandate) return respond({ ok: false, code: "NOT_FOUND" });
        if (mandate.status === "CANCELLED") return respond({ ok: false, code: "MANDATE_CANCELLED" });
        const amount = Number(body.amountCents ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) return respond({ ok: false, code: "INVALID_AMOUNT" });
        if (amount > mandate.capCents) return respond({ ok: false, code: "CAP_EXCEEDED" });
        mandate.ledger += amount;
        return respond({ ok: true, bankRef: `bank-${mandate.id.slice(0, 6)}-${mandate.ledger}` });
      }
    }

    res.statusCode = 404;
    res.end();
  });

  return {
    async start() {
      server.listen(0);
      await once(server, "listening");
      const info = server.address() as AddressInfo;
      return `http://127.0.0.1:${info.port}`;
    },
    async stop() {
      server.close();
      await once(server, "close");
    },
  };
}

function normalise(result: any): Normalised {
  return {
    ok: !!result?.ok,
    code: result?.code,
    status: result?.mandate?.status,
    bankRef: !!result?.bankRef,
  };
}

async function runScenario(port: PayToPort) {
  const created = await port.createMandate({ abn: "12345678901", periodId: "2024Q1", capCents: 50_000 });
  const missingVerify = await port.verifyMandate("missing");
  const id = created.mandate?.id ?? "";
  const verified = await port.verifyMandate(id);
  const debit = await port.debitMandate(id, 10_000, { source: "contract" });
  const overCap = await port.debitMandate(id, 60_000);
  const cancelled = await port.cancelMandate(id);
  const afterCancel = await port.debitMandate(id, 5_000);

  return {
    created: normalise(created),
    missingVerify: normalise(missingVerify),
    verified: normalise(verified),
    debit: normalise(debit),
    overCap: normalise(overCap),
    cancelled: normalise(cancelled),
    afterCancel: normalise(afterCancel),
  } as const;
}

function allowlisted(code?: string) {
  return !!code && ALLOWLIST.has(code);
}

function compareScenario(reference: ReturnType<typeof runScenario> extends Promise<infer T> ? T : never, subject: ReturnType<typeof runScenario> extends Promise<infer T> ? T : never, mode: RuntimeMode) {
  for (const key of Object.keys(reference) as (keyof typeof reference)[]) {
    const ref = reference[key];
    const cur = subject[key];
    if (ref.ok !== cur.ok) {
      if (allowlisted(ref.code) || allowlisted(cur.code)) {
        continue;
      }
      console.error("[contracts/payto] ok divergence", { reference: ref, subject: cur, step: key, mode });
      throw new Error(`${mode} ${String(key)} ok diverged`);
    }
    if ((ref.code ?? null) !== (cur.code ?? null)) {
      if (!allowlisted(ref.code) && !allowlisted(cur.code)) {
        console.error("[contracts/payto] code divergence", { reference: ref, subject: cur, step: key, mode });
        throw new Error(`${mode} ${String(key)} code diverged`);
      }
    }
    if ((ref.status ?? null) !== (cur.status ?? null)) {
      console.error("[contracts/payto] status divergence", { reference: ref, subject: cur, step: key, mode });
      throw new Error(`${mode} ${String(key)} status diverged`);
    }
    if ((ref.bankRef ?? false) !== (cur.bankRef ?? false)) {
      console.error("[contracts/payto] bankRef divergence", { reference: ref, subject: cur, step: key, mode });
      throw new Error(`${mode} ${String(key)} bankRef presence diverged`);
    }
  }
}

export async function runContractTests() {
  const server = createFakeBankServer();
  const baseUrl = await server.start();
  process.env.BANK_API_BASE = baseUrl;

  try {
    const factories = getPayToImplementations();
    const reference = await runScenario(factories.mock());

    for (const mode of MODES.filter((m) => m !== "mock")) {
      const scenario = await runScenario(factories[mode]());
      compareScenario(reference, scenario, mode);
    }
  } finally {
    await server.stop();
  }
}
