import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describeProviderRegistry,
  getFeatureFlags,
  getProviderRegistry,
  resetProviderRegistryCache,
} from "@core/providers/registry";

const ORIGINAL_PROVIDERS = process.env.PROVIDERS;
const ORIGINAL_KILL = process.env.PROTO_KILL_SWITCH;
const ORIGINAL_SHADOW = process.env.SHADOW_MODE;

describe("provider registry", () => {
  beforeEach(() => {
    resetProviderRegistryCache();
  });

  afterEach(() => {
    process.env.PROVIDERS = ORIGINAL_PROVIDERS;
    process.env.PROTO_KILL_SWITCH = ORIGINAL_KILL;
    process.env.SHADOW_MODE = ORIGINAL_SHADOW;
    resetProviderRegistryCache();
  });

  it("defaults to mock providers", () => {
    delete process.env.PROVIDERS;
    const registry = getProviderRegistry();
    assert.equal(registry.bank.providerName, "bank:mock");
    assert.equal(registry.kms.providerName, "kms:mock");
  });

  it("switches providers when env overrides", () => {
    process.env.PROVIDERS = "bank=live;kms=live;rates=live;statements=live;anomaly=live";
    const registry = getProviderRegistry();
    assert.equal(registry.bank.providerName, "bank:live");
    assert.equal(registry.kms.providerName, "kms:live");
    const description = describeProviderRegistry();
    assert.equal(description.bindings.bank, "live");
    assert.equal(description.active.bank, "bank:live");
  });

  it("reads feature flags", () => {
    process.env.PROTO_KILL_SWITCH = "1";
    process.env.SHADOW_MODE = "true";
    const flags = getFeatureFlags();
    assert.equal(flags.protoKillSwitch, true);
    assert.equal(flags.shadowMode, true);
  });
});
