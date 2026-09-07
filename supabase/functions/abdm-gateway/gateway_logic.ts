// Pure business logic for ABDM Gateway Mock Sandbox
// Separated from Deno globals and network calls so it runs under node --test.

export interface M1AuthInitResult {
  source: "mock-abdm-gateway";
  milestone: "M1";
  action: "auth_init";
  status: "OTP_SENT";
  txn_id: string;
  auth_mode: "MOBILE_OTP";
  masked_mobile: string;
  message: string;
}

export interface M1AuthConfirmResult {
  source: "mock-abdm-gateway";
  milestone: "M1";
  action: "auth_confirm";
  status: "AUTHENTICATED" | "FAILED";
  x_token?: string;
  error?: string;
  profile?: {
    abha_number: string;
    abha_address: string;
    name: string;
    gender: string;
    year_of_birth: number;
    mobile: string;
    kyc_verified: boolean;
  };
}

export function handleAbdmM1Auth(
  action: string,
  payload: Record<string, any>
): M1AuthInitResult | M1AuthConfirmResult {
  if (action === "auth_init") {
    const txnId = `txn-m1-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const mobile = String(payload.mobile || "9876543210");
    return {
      source: "mock-abdm-gateway",
      milestone: "M1",
      action: "auth_init",
      status: "OTP_SENT",
      txn_id: txnId,
      auth_mode: "MOBILE_OTP",
      masked_mobile: "XXXXXX" + mobile.slice(-4),
      message: "Simulation OTP is 123456 (Valid for 10 minutes)",
    };
  }

  if (action === "auth_confirm") {
    const otp = String(payload.otp || "").trim();
    if (otp !== "123456" && otp !== "000000") {
      return {
        source: "mock-abdm-gateway",
        milestone: "M1",
        action: "auth_confirm",
        status: "FAILED",
        error: "Invalid OTP. For sandbox simulation, enter 123456.",
      };
    }

    const abhaId = payload.abha_id || "91-8899-7766-5544";
    const xToken = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abdm_mock_${Date.now()}`;

    return {
      source: "mock-abdm-gateway",
      milestone: "M1",
      action: "auth_confirm",
      status: "AUTHENTICATED",
      x_token: xToken,
      profile: {
        abha_number: abhaId,
        abha_address: `${abhaId.replace(/-/g, "")}@abdm`,
        name: payload.name || "Devendra Sharma",
        gender: "M",
        year_of_birth: 1982,
        mobile: payload.mobile || "9876543210",
        kyc_verified: true,
      },
    };
  }

  throw new Error(`Unsupported M1 action: ${action}`);
}
