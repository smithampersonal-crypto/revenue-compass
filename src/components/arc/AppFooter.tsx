import { Link } from "@tanstack/react-router";

const LINK =
  "rounded-sm hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export function AppFooter() {
  return (
    <footer className="border-t border-border bg-card/40">
      <div className="mx-auto max-w-7xl space-y-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <nav aria-label="Footer">
            <ul className="flex items-center gap-4">
              <li>
                <Link to="/privacy" className={LINK}>
                  Privacy
                </Link>
              </li>
              <li>
                <Link to="/sitemap" className={LINK}>
                  Sitemap
                </Link>
              </li>
            </ul>
          </nav>
          <span>© 2026 Ayden&apos;s Revenue Compass (ARC)</span>
        </div>
        <p>
          Icons by Fajriah Robiatul Adawiah, Afqoh, rendicon, and Nur Khasan from{" "}
          <a href="https://thenounproject.com" target="_blank" rel="noreferrer" className={LINK}>
            Noun Project
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
