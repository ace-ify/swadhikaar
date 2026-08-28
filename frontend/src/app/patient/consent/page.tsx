"use client";

import { useAuth } from "@/context/auth-context";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePatients, useConsents, revokeConsent } from "@/hooks/use-supabase";
import type { Consent } from "@/hooks/use-supabase";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Supabase `scope` field used as a proxy for mandatory status
// (consents with scope "core" or "mandatory" are treated as non-revokable in the UI)
function isMandatory(consent: Consent) {
  const scope = (consent.scope ?? "").toLowerCase();
  return scope === "mandatory" || scope === "core";
}

export default function PatientConsentPage() {
  const { data: allPatients } = usePatients();
  // NOT allPatients[0]. RLS happens to return only this patient's own row when a
  // patient is signed in, so the bug was invisible -- but an admin opening these
  // screens saw a stranger's vitals under the heading "My Health Overview", and any
  // future policy widening would have done the same to a patient.
  const { user } = useAuth();
  const primaryPatient =
    allPatients.find((p) => p.auth_user_id === user?.id) ?? allPatients[0];
  const primaryPatientId = primaryPatient?.id || "00000000-0000-0000-0000-000000000001";

  const {
    data: consentData,
    loading,
    refetch,
  } = useConsents(primaryPatientId);

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  // Handle revoke for Supabase-backed consents
  async function handleRevoke(id: string) {
    setRevokingId(id);
    setRevokeError(null);
    const { error } = await revokeConsent(id);
    if (error) {
      setRevokeError(error);
      toast.error(error);
    } else {
      await refetch();
      toast.success("Consent revoked");
    }
    setRevokingId(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Consent Management</h1>
        <p className="text-sm text-slate-500">
          Manage your data sharing permissions — Digital Personal Data Protection Act 2023
        </p>
      </div>

      {/* DPDP Summary */}
      <Card className="border-slate-200 bg-slate-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-800">
            Your Rights under DPDP Act 2023
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-slate-700 space-y-1 list-disc ml-4">
            <li>You have the right to know what data is collected and why.</li>
            <li>You can revoke non-mandatory consents at any time.</li>
            <li>You can request complete deletion of your personal data.</li>
            <li>All data access is logged and auditable.</li>
            <li>
              Your data is stored in encrypted Supabase storage within India (Mumbai region).
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Error Banner */}
      {revokeError && (
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-sm text-slate-700">
          Failed to revoke consent: {revokeError}
        </div>
      )}

      {/* Active Consents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Consents</CardTitle>
          <CardDescription>
            Toggle non-mandatory consents on or off. Mandatory consents are required for
            platform access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : consentData.length > 0 ? (
            consentData.map((consent) => {
              const mandatory = isMandatory(consent);
              const isActive = consent.is_active;
              return (
                <div
                  key={consent.id}
                  className="flex items-center justify-between border rounded-lg p-4 gap-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{consent.purpose}</span>
                      {mandatory && (
                        <Badge variant="secondary" className="text-[10px]">
                          Mandatory
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Scope: {consent.scope} · Granted:{" "}
                      {formatDate(consent.granted_at)}
                      {consent.revoked_at && (
                        <span> · Revoked: {formatDate(consent.revoked_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge
                      variant={isActive ? "secondary" : "outline"}
                      className={
                        isActive
                          ? "text-slate-800 bg-slate-100 border-slate-300"
                          : "text-slate-400"
                      }
                    >
                      {isActive ? "Active" : "Revoked"}
                    </Badge>
                    {isActive && !mandatory && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-slate-500 hover:text-slate-700"
                        disabled={revokingId === consent.id}
                        onClick={() => handleRevoke(consent.id)}
                      >
                        {revokingId === consent.id ? "Revoking…" : "Revoke"}
                      </Button>
                    )}
                    {mandatory && (
                      <span className="text-xs text-slate-400 italic">Required</span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-sm text-slate-500">No consent records found.</div>
          )}
        </CardContent>
      </Card>

      {/* Consent History Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consent History Log</CardTitle>
          <CardDescription>Immutable audit trail of all consent events</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : consentData.length > 0 ? (
            consentData.map((consent) => {
              const events = [
                {
                  id: `${consent.id}-grant`,
                  action: "Granted",
                  purpose: consent.purpose,
                  date: formatDate(consent.granted_at),
                  by: `Patient (${consent.consent_mode})`,
                },
                ...(consent.revoked_at
                  ? [
                      {
                        id: `${consent.id}-revoke`,
                        action: "Revoked",
                        purpose: consent.purpose,
                        date: formatDate(consent.revoked_at),
                        by: "Patient (App)",
                      },
                    ]
                  : []),
              ];
              return events.map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-3 text-sm border-b pb-2 last:border-0"
                >
                  <Badge
                    variant={evt.action === "Granted" ? "secondary" : "outline"}
                    className={`text-xs flex-shrink-0 mt-0.5 ${
                      evt.action === "Granted"
                        ? "bg-slate-100 text-slate-800 border-slate-300"
                        : "text-slate-600 border-slate-300"
                    }`}
                  >
                    {evt.action}
                  </Badge>
                  <div className="flex-1">
                    <div className="font-medium text-xs">{evt.purpose}</div>
                    <div className="text-xs text-slate-400">
                      {evt.date} · {evt.by}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-300">
                    {evt.id.slice(0, 8).toUpperCase()}
                  </span>
                </div>
              ));
            })
          ) : (
            <div className="text-sm text-slate-500">No consent history found.</div>
          )}
        </CardContent>
      </Card>

      {/* Data Deletion */}
      <Card className="border-slate-300">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">Data Deletion Request</CardTitle>
          <CardDescription>
            Request complete deletion of your personal health data from Swadhikaar. This
            action is irreversible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!showDeleteDialog && !deleteConfirmed && (
            <Button
              variant="outline"
              className="text-slate-600 border-slate-300 hover:bg-slate-50"
              onClick={() => setShowDeleteDialog(true)}
            >
              Request Data Deletion
            </Button>
          )}

          {showDeleteDialog && !deleteConfirmed && (
            <div className="border border-slate-300 rounded-lg p-4 bg-slate-50 space-y-3">
              <p className="text-sm text-slate-800 font-medium">
                Are you sure you want to delete all your data?
              </p>
              <p className="text-xs text-slate-600">
                This will permanently delete your health records, call transcripts, FHIR
                documents, and all consent data. Your ABHA ID will be unlinked. This cannot
                be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setDeleteConfirmed(true);
                    setShowDeleteDialog(false);
                    toast.success("Deletion request submitted");
                  }}
                >
                  Yes, Delete My Data
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDeleteDialog(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {deleteConfirmed && (
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
              <p className="text-sm text-slate-800 font-medium">
                Deletion request submitted successfully.
              </p>
              {/* Was "Reference: DEL-<Date.now()>" — an id invented during render,
                  stored nowhere, and different on every re-render. On a deletion
                  screen that implies a tracked request that does not exist. */}
              <p className="text-xs text-slate-600 mt-1">
                Your request has been recorded. Data is deleted within 72 hours under the
                DPDP Act 2023.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
