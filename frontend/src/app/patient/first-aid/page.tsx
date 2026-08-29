"use client";

// What to do while help is coming, readable before anything has happened.
//
// The same guidance the SOS screen shows during a live case, browsable. That is the
// point: the person who reads this on a calm Tuesday is the bystander who stops at a
// roadside accident on Friday, and they will not be reading anything then.
//
// No search box. EOS has one; six topics do not need it, and a text field is one more
// thing to fail at with shaking hands. Every step is written about somebody else --
// "do not move them" -- because that is who is usually being helped.

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, Siren } from "lucide-react";
import { firstAidFor, FIRST_AID_TOPICS } from "@/components/patient/first-aid";

export default function FirstAidPage() {
  const [open, setOpen] = useState<string>(FIRST_AID_TOPICS[0].type);
  const steps = firstAidFor(open);

  return (
    <div className="mx-auto max-w-xl space-y-5 pb-20">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-bold tracking-tight" lang="hi">
          तब तक क्या करें
        </h1>
        <p className="text-muted-foreground text-sm">
          What to do while help is on the way.
        </p>
      </div>

      {/* Both escape hatches first. Somebody who opened this page during a real
          emergency should not have to scroll past reading material. */}
      <div className="grid grid-cols-2 gap-2">
        <a href="tel:112">
          <Button variant="outline" size="lg" className="h-14 w-full text-base">
            <Phone className="mr-2 size-5" />
            <span lang="hi">112</span>
          </Button>
        </a>
        <Link href="/patient/sos">
          <Button variant="destructive" size="lg" className="h-14 w-full text-base">
            <Siren className="mr-2 size-5" />
            <span lang="hi">मदद बुलाएं</span>
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FIRST_AID_TOPICS.map((t) => (
          <Button
            key={t.type}
            size="sm"
            variant={open === t.type ? "secondary" : "outline"}
            onClick={() => setOpen(t.type)}
          >
            <span lang="hi">{t.hi}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 py-5">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {FIRST_AID_TOPICS.find((t) => t.type === open)?.en}
          </p>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.en} className="flex gap-3">
                <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {i + 1}
                </span>
                <span>
                  <span lang="hi" className="font-medium">
                    {s.hi}
                  </span>
                  <span className="text-muted-foreground block text-sm">{s.en}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground border-t pt-3 text-xs">
            <span lang="hi">
              ये डॉक्टर की सलाह नहीं है। सांस चलती रहे, यही सबसे ज़रूरी है।
            </span>
            <span className="block">
              This is not medical advice. Keeping them breathing matters more than
              anything else here.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
