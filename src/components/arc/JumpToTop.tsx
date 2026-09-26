export const JUMP_TARGET_ID = "analysis-top";

/**
 * Bottom-of-workpaper navigation back to the analysis summary and workpaper
 * navigation. Pure chrome: it only scrolls and moves focus — no navigation,
 * no URL change, no draft access.
 */
export function JumpToTop() {
  const handleClick = () => {
    const target = document.getElementById(JUMP_TARGET_ID);
    if (!target) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
  };

  return (
    <div className="flex justify-end">
      <button
        type="button"
        data-arc-chrome
        onClick={handleClick}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span aria-hidden="true">↑</span> Jump to top of page
      </button>
    </div>
  );
}
