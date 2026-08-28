"use client";

// What a crew and a receiving hospital are shown about the patient before anyone can ask
// them. Copied into the incident at create time, so it reflects what was true when the
// emergency opened rather than what the record says now.
//
// Blood group first and largest, because it is the one field that changes what happens in
// the next five minutes. Allergies second, for the same reason in reverse — it changes
// what must NOT happen.
//
// Absent fields are stated as absent. "not recorded" is information; a blank space reads
// as "nothing to worry about", which is the opposite of what it means.

import { Badge } from "@/components/ui/badge";

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : [];

export function MedicalSnapshot({
  snapshot,
  compact = false,
}: {
  snapshot: Record<string, unknown> | null | undefined;
  compact?: boolean;
}) {
  const s = snapshot ?? {};
  const blood = typeof s.blood_group === "string" ? s.blood_group : null;
  const allergies = asList(s.allergies);
  const conditions = asList(s.chronic_conditions);
  const meds = asList(s.current_medications);
  const contactName =
    typeof s.emergency_contact_name === "string" ? s.emergency_contact_name : null;
  const contactPhone =
    typeof s.emergency_contact_phone === "string" ? s.emergency_contact_phone : null;
  const abha = typeof s.abha_id === "string" ? s.abha_id : null;
  const language = typeof s.language === "string" ? s.language : null;

  // An incident opened for someone the system does not know — a bystander call for a
  // stranger — carries nothing, and saying so is the useful answer.
  const empty =
    !blood && allergies.length === 0 && conditions.length === 0 && meds.length === 0 &&
    !contactName && !abha;

  if (empty) {
    return (
      <p className="text-muted-foreground text-xs">No medical history on file.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {blood ? (
          <Badge
            variant="outline"
            className="border-red-500 bg-red-50 text-base font-bold text-red-700"
          >
            {blood}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-dashed text-muted-foreground">
            blood group not recorded
          </Badge>
        )}
        {allergies.length > 0 ? (
          <Badge variant="outline" className="border-amber-500 bg-amber-50 text-amber-800">
            allergic to {allergies.join(", ")}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-dashed text-muted-foreground">
            no known allergies recorded
          </Badge>
        )}
      </div>

      {!compact ? (
        <div className="text-muted-foreground space-y-0.5 text-xs">
          {conditions.length > 0 ? <p>Conditions: {conditions.join(", ")}</p> : null}
          {meds.length > 0 ? <p>On: {meds.join(", ")}</p> : null}
          {language ? <p>Speaks {language}</p> : null}
          {abha ? <p>ABHA {abha}</p> : null}
          {contactName ? (
            <p>
              Next of kin: {contactName}
              {contactPhone ? ` · ${contactPhone}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
