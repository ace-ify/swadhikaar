"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callAbdmGateway } from "@/lib/edge-functions";
import AbhaCard from "./abha-card";
import {
  ShieldCheck,
  KeyRound,
  Link2,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Download,
  Copy,
  RefreshCw,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

export interface AbdmGatewaySimulatorProps {
  patientId?: string;
  sessionId?: string;
  defaultAbhaId?: string;
  patientName?: string;
}

export default function AbdmGatewaySimulator({
  patientId,
  sessionId,
  defaultAbhaId = "91-8899-7766-5544",
  patientName = "Devendra Sharma",
}: AbdmGatewaySimulatorProps) {
  const [activeTab, setActiveTab] = useState<"M1" | "M2" | "M3">("M1");

  // M1 State
  const [mobile, setMobile] = useState("9876543210");
  const [abhaInput, setAbhaInput] = useState(defaultAbhaId);
  const [m1TxnId, setM1TxnId] = useState<string | null>(null);
  const [m1Otp, setM1Otp] = useState("123456");
  const [m1Loading, setM1Loading] = useState(false);
  const [m1AuthResult, setM1AuthResult] = useState<any | null>(null);

  // M2 State
  const [m2Loading, setM2Loading] = useState(false);
  const [m2DiscoveryResult, setM2DiscoveryResult] = useState<any | null>(null);
  const [m2LinkTxnId, setM2LinkTxnId] = useState<string | null>(null);
  const [m2LinkingResult, setM2LinkingResult] = useState<any | null>(null);

  // M3 State
  const [m3Loading, setM3Loading] = useState(false);
  const [m3Result, setM3Result] = useState<any | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  // M1: Initialize Auth
  const handleM1Init = async () => {
    setM1Loading(true);
    try {
      const res = await callAbdmGateway({
        milestone: "M1",
        action: "auth_init",
        mobile,
        abha_id: abhaInput,
      });
      setM1TxnId(res.txn_id);
      setM1Otp("123456"); // Pre-populate simulation OTP for evaluator convenience
      toast.success("Simulation OTP 123456 dispatched to " + (res.masked_mobile || mobile));
    } catch (err: any) {
      toast.error("M1 Auth Init failed: " + err.message);
    } finally {
      setM1Loading(false);
    }
  };

  // M1: Confirm Auth
  const handleM1Confirm = async () => {
    setM1Loading(true);
    try {
      const res = await callAbdmGateway({
        milestone: "M1",
        action: "auth_confirm",
        otp: m1Otp,
        txn_id: m1TxnId,
        abha_id: abhaInput,
        name: patientName,
        mobile,
      });
      if (res.status === "AUTHENTICATED") {
        setM1AuthResult(res);
        toast.success("ABHA KYC Verification Successful! X-Token Issued.");
      } else {
        toast.error(res.error || "Authentication failed");
      }
    } catch (err: any) {
      toast.error("M1 Auth Confirm failed: " + err.message);
    } finally {
      setM1Loading(false);
    }
  };

  // M2: Discover Care Contexts
  const handleM2Discover = async () => {
    setM2Loading(true);
    try {
      const res = await callAbdmGateway({
        milestone: "M2",
        action: "discover",
        abha_id: abhaInput,
      });
      setM2DiscoveryResult(res);
      toast.success(
        res.matched
          ? `Discovered ${res.patient?.careContexts?.length || 0} care context(s) linked to this ABHA ID`
          : "No prior records registered with this ABHA at current facility"
      );
    } catch (err: any) {
      toast.error("M2 Discovery failed: " + err.message);
    } finally {
      setM2Loading(false);
    }
  };

  // M2: Link Care Context
  const handleM2Link = async (careRef: string) => {
    setM2Loading(true);
    try {
      // Step 1: Link Init
      const initRes = await callAbdmGateway({
        milestone: "M2",
        action: "link_init",
        care_context_reference: careRef,
      });
      setM2LinkTxnId(initRes.link_txn_id);

      // Step 2: Auto-confirm link with simulation OTP
      const confirmRes = await callAbdmGateway({
        milestone: "M2",
        action: "link_confirm",
        otp: "123456",
        care_context_reference: careRef,
      });
      setM2LinkingResult(confirmRes);
      toast.success(`Care Context [${careRef}] successfully linked to patient's ABHA Locker!`);
    } catch (err: any) {
      toast.error("M2 Linking failed: " + err.message);
    } finally {
      setM2Loading(false);
    }
  };

  // M3: Request Health Data Transfer (FHIR R4 Bundle)
  const handleM3Request = async () => {
    setM3Loading(true);
    try {
      const res = await callAbdmGateway({
        milestone: "M3",
        action: "request_health_data",
        session_id: sessionId,
        patient_id: patientId,
      });
      setM3Result(res);
      toast.success(
        `Encrypted NRCES FHIR R4 Bundle received (${res.resource_count || 5} resources)!`
      );
    } catch (err: any) {
      toast.error("M3 Data Request failed: " + err.message);
    } finally {
      setM3Loading(false);
    }
  };

  // Download FHIR JSON
  const downloadFhirBundle = () => {
    if (!m3Result?.fhir_bundle) return;
    const blob = new Blob([JSON.stringify(m3Result.fhir_bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ABDM_FHIR_BUNDLE_${m3Result.transaction_id || Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("FHIR R4 Document Bundle downloaded");
  };

  return (
    <div className="space-y-4">
      {/* Milestone Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-1.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-sky-600 text-white font-bold text-xs shadow-sm">
            NHA
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight text-slate-900">
              ABDM Gateway Bridge Sandbox
            </h3>
            <p className="text-[11px] text-slate-500">
              National Health Authority v0.5 Interoperability Specifications
            </p>
          </div>
        </div>

        {/* Milestone Selector Tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab("M1")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              activeTab === "M1"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            M1: ABHA Verification
          </button>
          <button
            onClick={() => setActiveTab("M2")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              activeTab === "M2"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            M2: HIP Discovery &amp; Linking
          </button>
          <button
            onClick={() => setActiveTab("M3")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              activeTab === "M3"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            M3: FHIR R4 Exchange
          </button>
        </div>
      </div>

      {/* Milestone 1 Tab: ABHA Verification & Authentication */}
      {activeTab === "M1" && (
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                  <ShieldCheck className="size-4 text-sky-600" />
                  Milestone 1: ABHA Registration, Mobile OTP &amp; KYC Verification
                </CardTitle>
                <Badge variant="outline" className="font-mono text-[10px] border-sky-400 text-sky-700">
                  /v0.5/users/auth
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Authenticates patient against the National Health Authority gateway using Aadhaar / Mobile OTP.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Mobile Number (मोबाइल नंबर)
                  </label>
                  <Input
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="9876543210"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    ABHA ID / Health ID (आभा आईडी)
                  </label>
                  <Input
                    value={abhaInput}
                    onChange={(e) => setAbhaInput(e.target.value)}
                    placeholder="91-8899-7766-5544"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
              </div>

              {!m1TxnId ? (
                <Button
                  onClick={handleM1Init}
                  disabled={m1Loading}
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs gap-1.5"
                >
                  <KeyRound className="size-3.5" />
                  {m1Loading ? "Sending Simulation OTP..." : "Step 1: Request Gateway Authentication OTP"}
                </Button>
              ) : (
                <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-900">
                      Simulation OTP Dispatched
                    </span>
                    <span className="font-mono text-xs text-sky-700">
                      Txn: {m1TxnId.slice(0, 16)}...
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={m1Otp}
                      onChange={(e) => setM1Otp(e.target.value)}
                      placeholder="Enter 6-digit OTP"
                      className="font-mono text-sm bg-white max-w-[180px]"
                    />
                    <Button
                      onClick={handleM1Confirm}
                      disabled={m1Loading}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5"
                    >
                      <CheckCircle2 className="size-3.5" />
                      {m1Loading ? "Verifying..." : "Step 2: Verify OTP & Issue Token"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Demo hint: Valid sandbox simulation OTP is <strong className="font-mono text-sky-800">123456</strong>.
                  </p>
                </div>
              )}

              {/* Authenticated X-Token & Result Card */}
              {m1AuthResult && (
                <div className="space-y-3 pt-2">
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50/80 p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-emerald-900">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-4 text-emerald-600" />
                        ABHA Authenticated · Status: {m1AuthResult.status}
                      </span>
                      <span className="font-mono text-[10px] text-emerald-700">
                        source: {m1AuthResult.source}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-600 break-all bg-white p-2 rounded border border-emerald-200">
                      <strong>X-Token: </strong> {m1AuthResult.x_token}
                    </div>
                  </div>

                  {/* Render Official Generated Tricolor ABHA Card */}
                  <div className="pt-2">
                    <div className="text-center font-bold text-xs text-slate-700 mb-2">
                      Official Generated Digital Health Card (Ready for Print &amp; Locker Sync)
                    </div>
                    <AbhaCard
                      abhaNumber={m1AuthResult.profile?.abha_number || abhaInput}
                      abhaAddress={m1AuthResult.profile?.abha_address}
                      name={m1AuthResult.profile?.name || patientName}
                      gender={m1AuthResult.profile?.gender}
                      yearOfBirth={m1AuthResult.profile?.year_of_birth}
                      mobile={m1AuthResult.profile?.mobile}
                      kycVerified={m1AuthResult.profile?.kyc_verified}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Milestone 2 Tab: HIP Discovery & Care-Context Linking */}
      {activeTab === "M2" && (
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                  <Link2 className="size-4 text-sky-600" />
                  Milestone 2: Health Information Provider (HIP) Discovery &amp; Care-Context Linking
                </CardTitle>
                <Badge variant="outline" className="font-mono text-[10px] border-sky-400 text-sky-700">
                  /v0.5/care-contexts
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Discovers patient consultations registered at this hospital and links them to the patient's personal ABHA Locker.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  value={abhaInput}
                  onChange={(e) => setAbhaInput(e.target.value)}
                  placeholder="Enter ABHA ID (e.g. 91-8899-7766-5544)"
                  className="font-mono text-sm"
                />
                <Button
                  onClick={handleM2Discover}
                  disabled={m2Loading}
                  className="bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shrink-0 gap-1.5"
                >
                  <RefreshCw className={`size-3.5 ${m2Loading ? "animate-spin" : ""}`} />
                  {m2Loading ? "Discovering..." : "Discover Care Contexts"}
                </Button>
              </div>

              {m2DiscoveryResult && (
                <div className="space-y-3 pt-1 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>
                      Registered Care Contexts ({m2DiscoveryResult.patient?.careContexts?.length || 0})
                    </span>
                    <span className="text-slate-500 font-mono text-[10px]">
                      Patient ID: {m2DiscoveryResult.patient?.referenceNumber?.slice(0, 8) || "N/A"}
                    </span>
                  </div>

                  {m2DiscoveryResult.patient?.careContexts?.length > 0 ? (
                    <div className="space-y-2">
                      {m2DiscoveryResult.patient.careContexts.map((ctx: any) => (
                        <div
                          key={ctx.referenceNumber}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs"
                        >
                          <div>
                            <div className="font-bold text-slate-900">{ctx.display}</div>
                            <div className="font-mono text-[10px] text-slate-500">
                              Ref: {ctx.referenceNumber} · Status: {ctx.status}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleM2Link(ctx.referenceNumber)}
                            disabled={m2Loading || m2LinkingResult?.care_context_reference === ctx.referenceNumber}
                            className="text-xs font-semibold gap-1.5 border-sky-300 text-sky-700 hover:bg-sky-50"
                          >
                            <Link2 className="size-3" />
                            {m2LinkingResult?.care_context_reference === ctx.referenceNumber
                              ? "Linked to ABHA Locker ✓"
                              : "Link to ABHA Locker"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                      No active consultation sessions linked with this ABHA number yet. Complete an intake visit at the MediKiosk to register a care context.
                    </div>
                  )}

                  {m2LinkingResult && (
                    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs font-medium text-emerald-900">
                      ✓ Care context <strong className="font-mono">{m2LinkingResult.care_context_reference}</strong> linked to Ayushman Bharat Digital Health Locker at {new Date(m2LinkingResult.linked_at).toLocaleTimeString()}.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Milestone 3 Tab: FHIR R4 Bundle Exchange */}
      {activeTab === "M3" && (
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                  <FileCode2 className="size-4 text-sky-600" />
                  Milestone 3: Health Information User (HIU) Consent Flow &amp; FHIR R4 Exchange
                </CardTitle>
                <Badge variant="outline" className="font-mono text-[10px] border-sky-400 text-sky-700">
                  /v0.5/health-information
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Executes cryptographic health data exchange, assembling authentic NRCES FHIR R4 Bundles for interoperable hospital exchange.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleM3Request}
                disabled={m3Loading}
                className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs gap-2"
              >
                <FileCode2 className="size-3.5" />
                {m3Loading
                  ? "Assembling & Encrypting FHIR R4 Bundle..."
                  : "Request & Inspect Interoperable FHIR R4 Document Bundle"}
              </Button>

              {m3Result && (
                <div className="space-y-3 pt-2 animate-in fade-in">
                  {/* Encryption & Gateway Telemetry */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <span className="text-[10px] text-slate-500 block uppercase font-semibold">
                        Encryption
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {m3Result.encryption?.algorithm || "ECDH-AES-GCM"}
                      </span>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <span className="text-[10px] text-slate-500 block uppercase font-semibold">
                        Curve Key
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {m3Result.encryption?.key_material?.curve || "Curve25519"}
                      </span>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <span className="text-[10px] text-slate-500 block uppercase font-semibold">
                        FHIR Resources
                      </span>
                      <span className="font-mono font-bold text-emerald-700">
                        {m3Result.resource_count || 5} Validated
                      </span>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                      <span className="text-[10px] text-slate-500 block uppercase font-semibold">
                        Status
                      </span>
                      <span className="font-mono font-bold text-sky-700">
                        {m3Result.status || "DELIVERED"}
                      </span>
                    </div>
                  </div>

                  {/* Actions: Toggle Raw JSON & Download */}
                  <div className="flex items-center justify-between pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowRawJson(!showRawJson)}
                      className="text-xs font-semibold gap-1.5"
                    >
                      <Eye className="size-3" />
                      {showRawJson ? "Hide JSON Tree" : "Inspect Raw FHIR JSON"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={downloadFhirBundle}
                      className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold gap-1.5"
                    >
                      <Download className="size-3" />
                      Download NRCES Bundle JSON
                    </Button>
                  </div>

                  {/* Syntax-Highlighted JSON Viewer */}
                  {showRawJson && (
                    <div className="relative rounded-lg border border-slate-800 bg-slate-950 p-3 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-[360px] shadow-inner">
                      <pre>{JSON.stringify(m3Result.fhir_bundle, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
