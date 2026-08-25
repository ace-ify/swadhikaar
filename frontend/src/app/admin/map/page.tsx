"use client";

// Layer 4 operations map. Separate route rather than a panel on /admin/operations:
// a 70vh canvas plus 800 markers has no business mounting on a page someone opens
// to read a table.

import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePatients, useFacilities, useEscalations } from "@/hooks/use-supabase";

// Leaflet reads window at module scope, so this cannot be server-rendered.
const OperationsMap = dynamic(() => import("@/components/operations-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] w-full items-center justify-center rounded-xl border bg-muted/30">
      <span className="text-sm text-muted-foreground">Loading map…</span>
    </div>
  ),
});

export default function MapPage() {
  const { data: patients, loading: pLoading } = usePatients();
  const { data: facilities, loading: fLoading } = useFacilities();
  const { data: escalations } = useEscalations();

  const loading = pLoading || fLoading;
  const plotted = patients.filter((p) => p.lat != null).length;
  const sourced = facilities.filter((f) => f.coord_source === "osm").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-20">
      <div className="flex flex-col gap-1.5 px-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Operations Map
        </h1>
        <p className="text-sm font-medium text-muted-foreground">
          Enrolled patients, health facilities and open escalations across Bihar and
          Assam.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-sm font-medium">
              Patients plotted
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {loading ? "—" : plotted}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              Approximate location
            </Badge>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-sm font-medium">
              Facilities from OpenStreetMap
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {loading ? "—" : sourced}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-sm text-muted-foreground">
              Real names and coordinates
            </span>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-sm font-medium">
              Dispatch-eligible
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">
              {loading ? "—" : facilities.filter((f) => f.dispatch_eligible).length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-sm text-muted-foreground">
              Excludes labs, morgues, dental and AYUSH
            </span>
          </CardContent>
        </Card>
      </div>

      <OperationsMap
        patients={patients}
        facilities={facilities}
        escalations={escalations}
      />

      {/* Stated on the page, not only in the tooltips: a judge reading over someone's
          shoulder should not have to hover to learn which half is simulated. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base tracking-tight">
            What is real on this map
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Sourced:</span> facility
            names and coordinates are OpenStreetMap data for Guwahati and Patna.
            District centroids come from Nominatim.
          </p>
          <p>
            <span className="font-medium text-foreground">Approximate:</span> patient
            pins are locality centroids with a per-patient offset. The source records
            carried a health-camp name and vitals, never an address — so nobody&apos;s
            household is on this map, by construction and on purpose.
          </p>
          <p>
            <span className="font-medium text-foreground">Simulated:</span> bed and
            staffing counts. No public source publishes live Indian bed availability;
            it lives in each facility&apos;s own HMIS. Hidden by default and labelled
            wherever shown.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
