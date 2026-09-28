import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { createTemporaryAnalysis } from "@/lib/arc/persistence/guest.functions";

/**
 * Package 3D-T — the only way a temporary analysis is created: an explicit
 * button that runs one POST mutation. Never a link, loader, prefetch or render.
 * A second activation while the first is still pending is ignored, so each
 * click creates exactly one analysis.
 */
export function StartAnalysisButton({
  origin,
  destination = "inputs",
  customer,
  variant = "default",
  className,
  children,
}: {
  origin: "blank" | "upload" | `sample:${string}`;
  /** Where the new analysis opens: the inputs, or Source Documents with the upload dialog. */
  destination?: "inputs" | "upload";
  /** Save-panel preselection hint only; never authorization. */
  customer?: string | undefined;
  variant?: "default" | "outline";
  className?: string;
  children: ReactNode;
}) {
  const create = useServerFn(createTemporaryAnalysis);
  const navigate = useNavigate();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const { analysisId } = await create({ data: { origin } });
      if (destination === "upload") {
        await navigate({
          to: "/analysis/documents",
          search: { a: analysisId, upload: "1", ...(customer ? { customer } : {}) } as never,
        });
      } else {
        await navigate({ to: "/analysis", search: { a: analysisId } as never });
      }
    } catch {
      setError("A new analysis couldn't be started. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={pending}
        aria-busy={pending}
        onClick={() => void start()}
      >
        {pending ? "Starting…" : children}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
