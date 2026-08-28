"use client";

// The emergency card — what a crew is shown about you before you can speak.
//
// EOS stores this on the user document and copies it into the incident. Same idea here,
// with one difference that matters: this screen shows the patient the ACTUAL text a
// paramedic will read, rather than a form that disappears into a database. If the row
// says nothing, the screen says "not recorded" in the same words the crew will see, so
// the cost of leaving it blank is visible to the person who can fix it.
//
// Nothing here is pre-filled with a guess. A wrong blood group is more dangerous than a
// missing one.

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useMyProfile, saveMyProfile, type EmergencyProfile } from "@/hooks/use-acute";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

// Comma-separated in, array out. A tag widget would be nicer and is not worth a
// dependency for three fields someone edits once.
const toList = (v: string) =>
  v.split(",").map((x) => x.trim()).filter(Boolean);
const fromList = (v: string[] | null) => (v ?? []).join(", ");

function Line({ label, hi, value }: { label: string; hi: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0">
      <span className="text-sm">
        <span lang="hi" className="font-medium">
          {hi}
        </span>
        <span className="text-muted-foreground block text-xs">{label}</span>
      </span>
      <span
        className={`shrink-0 text-right text-sm ${
          value ? "font-semibold" : "text-muted-foreground italic"
        }`}
      >
        {value ?? "not recorded"}
      </span>
    </div>
  );
}

export default function EmergencyProfilePage() {
  const [pulse, setPulse] = useState(0);
  const { data: profile, loading } = useMyProfile(pulse);
  const [busy, setBusy] = useState(false);
  // The edit buffer IS the editing state: null means "not editing". Seeded from the row
  // when Edit is pressed, so nothing has to sync server state into local state in an
  // effect, and a background refetch cannot overwrite what someone is typing.
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const editing = form !== null;

  const openEditor = (p: EmergencyProfile) =>
    setForm({
      blood_group: p.blood_group ?? "",
      allergies: fromList(p.allergies),
      chronic_conditions: fromList(p.chronic_conditions),
      current_medications: fromList(p.current_medications),
      emergency_contact_name: p.emergency_contact_name ?? "",
      emergency_contact_phone: p.emergency_contact_phone ?? "",
    });

  async function save(p: EmergencyProfile) {
    if (!form) return;
    setBusy(true);
    const res = await saveMyProfile(p.id, {
      blood_group: form.blood_group || null,
      allergies: toList(form.allergies ?? ""),
      chronic_conditions: toList(form.chronic_conditions ?? ""),
      current_medications: toList(form.current_medications ?? ""),
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Saved — a crew will see this");
      setForm(null);
      setPulse((n) => n + 1);
    } else {
      toast.error(res.error ?? "Could not save");
    }
  }

  if (loading) {
    return <p className="text-muted-foreground p-4 text-sm">Loading…</p>;
  }

  // A login with no clinical record. Says which is missing rather than rendering an
  // empty form that saves nowhere.
  if (!profile) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-2 py-8 text-center text-sm">
          <p className="font-medium">No health record is linked to this account yet.</p>
          <p className="text-muted-foreground">
            A record is created when a health worker screens you, or when an emergency is
            closed at a hospital. Ask your ASHA to link it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-20">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-bold tracking-tight" lang="hi">
          मेरा इमरजेंसी कार्ड
        </h1>
        <p className="text-muted-foreground text-sm">
          What an ambulance crew is shown about you.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base tracking-tight">{profile.name}</CardTitle>
              <CardDescription>
                {profile.abha_id ? `ABHA ${profile.abha_id}` : "No ABHA linked"}
                {profile.language ? ` · speaks ${profile.language}` : ""}
              </CardDescription>
            </div>
            {profile.blood_group ? (
              <Badge variant="outline" className="border-red-500 text-base font-bold text-red-700">
                {profile.blood_group}
              </Badge>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {editing && form ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-sm font-medium" lang="hi">
                  ब्लड ग्रुप
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {BLOOD_GROUPS.map((g) => (
                    <Button
                      key={g}
                      type="button"
                      size="sm"
                      variant={form.blood_group === g ? "default" : "outline"}
                      onClick={() =>
                        setForm((f) => ({
                          ...(f ?? {}),
                          blood_group: (f?.blood_group ?? "") === g ? "" : g,
                        }))
                      }
                    >
                      {g}
                    </Button>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs" lang="hi">
                  पक्का न हो तो खाली छोड़ें — गलत ग्रुप खतरनाक है।
                </p>
              </div>

              {[
                { key: "allergies", hi: "किस दवा से एलर्जी है?", en: "Allergies" },
                { key: "chronic_conditions", hi: "पुरानी बीमारी", en: "Long-term conditions" },
                { key: "current_medications", hi: "चल रही दवाइयां", en: "Current medicines" },
                { key: "emergency_contact_name", hi: "घर में किसे बताएं?", en: "Emergency contact" },
                { key: "emergency_contact_phone", hi: "उनका नंबर", en: "Their phone" },
              ].map((f) => (
                <div key={f.key} className="space-y-1">
                  <label htmlFor={f.key} className="text-sm font-medium" lang="hi">
                    {f.hi}
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      {f.en}
                    </span>
                  </label>
                  <Input
                    id={f.key}
                    value={form[f.key] ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({ ...(prev ?? {}), [f.key]: e.target.value }))
                    }
                    placeholder={
                      f.key.includes("contact") ? "" : "comma separated, e.g. Penicillin, Sulfa"
                    }
                  />
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <Button className="flex-1" disabled={busy} onClick={() => void save(profile)}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-0">
              <Line label="Allergies" hi="एलर्जी" value={fromList(profile.allergies) || null} />
              <Line
                label="Long-term conditions"
                hi="पुरानी बीमारी"
                value={fromList(profile.chronic_conditions) || null}
              />
              <Line
                label="Current medicines"
                hi="चल रही दवाइयां"
                value={fromList(profile.current_medications) || null}
              />
              <Line
                label="Emergency contact"
                hi="घर का नंबर"
                value={
                  profile.emergency_contact_name
                    ? `${profile.emergency_contact_name}${
                        profile.emergency_contact_phone
                          ? ` · ${profile.emergency_contact_phone}`
                          : ""
                      }`
                    : null
                }
              />
              <Button className="mt-4 w-full" variant="outline" onClick={() => openEditor(profile)}>
                <span lang="hi">बदलें</span>
                <span className="text-muted-foreground ml-2 text-xs">Edit</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground px-1 text-xs">
        {profile.emergency_profile_updated_at
          ? `Last updated ${new Date(profile.emergency_profile_updated_at).toLocaleDateString("en-IN")}`
          : ""}
      </p>
    </div>
  );
}
