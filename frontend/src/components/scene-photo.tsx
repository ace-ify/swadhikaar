"use client";

// The scene photo, wherever a case is being read. One component so the facility inbox
// and the ops console cannot drift into showing it differently -- or, worse, one of them
// not showing it at all, which is the failure mode that makes an upload pointless.
//
// The bucket is private, so this mints a signed link per viewer on mount and storage RLS
// decides whether they get one. A viewer who is not entitled to the case sees the same
// thing as a viewer whose link failed: nothing, stated.

import { useEffect, useState } from "react";
import { scenePhotoUrl } from "@/hooks/use-acute";

export function ScenePhoto({
  path,
  className = "",
}: {
  path: string | null | undefined;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void scenePhotoUrl(path).then(({ url: signed, error }) => {
      if (cancelled) return;
      if (error || !signed) setFailed(true);
      else setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // No photo is the common case and is not a problem worth a row of chrome. Most
  // emergencies are reported by the person in them, and they are not holding a camera.
  if (!path) return null;

  if (failed) {
    return (
      <p className={`text-muted-foreground text-xs ${className}`}>
        A scene photo was attached but cannot be loaded here.
      </p>
    );
  }

  return (
    <figure className={`space-y-1 ${className}`}>
      {/* Plain <img>: next/image wants a configured remote host, and a signed URL's
          host and token change per request, so there is nothing stable to configure. */}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Photograph of the scene, taken by the person who reported it"
          className="max-h-64 w-full rounded-md border object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="bg-muted h-32 w-full animate-pulse rounded-md" aria-hidden />
      )}
      <figcaption className="text-muted-foreground text-xs">
        Taken at the scene by the person who reported it. Not clinically assessed — no
        model has looked at this, and it has not changed the triage.
      </figcaption>
    </figure>
  );
}
