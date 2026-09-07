import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAbdmM1Auth } from "./gateway_logic.ts";

test("ABDM M1: auth_init returns valid simulation OTP transaction", () => {
  const res = handleAbdmM1Auth("auth_init", {
    abha_id: "91-1234-5678-9012",
    mobile: "9876543210",
  });

  assert.equal(res.source, "mock-abdm-gateway");
  assert.equal(res.milestone, "M1");
  assert.equal(res.status, "OTP_SENT");
  assert.ok(res.txn_id.startsWith("txn-m1-"));
  assert.ok(res.message.includes("123456"));
});

test("ABDM M1: auth_confirm verifies simulation OTP and returns ABHA profile with X-Token", () => {
  const res = handleAbdmM1Auth("auth_confirm", {
    abha_id: "91-1234-5678-9012",
    otp: "123456",
    name: "Aarav Sharma",
  });

  assert.equal(res.status, "AUTHENTICATED");
  assert.ok(res.x_token.startsWith("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9"));
  assert.equal(res.profile.name, "Aarav Sharma");
  assert.equal(res.profile.kyc_verified, true);
  assert.ok(res.profile.abha_address.includes("@abdm"));
});

test("ABDM M1: auth_confirm rejects incorrect OTP", () => {
  const res = handleAbdmM1Auth("auth_confirm", {
    abha_id: "91-1234-5678-9012",
    otp: "999999",
  });

  assert.equal(res.status, "FAILED");
  assert.ok(res.error.includes("Invalid OTP"));
});
