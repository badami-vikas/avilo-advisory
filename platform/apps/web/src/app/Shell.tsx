import { Link, Outlet, useLocation } from "react-router";

/**
 * Application shell.
 *
 * The landing screen is deliberately spare: the wordmark at top-left of the header, and
 * below it one section only — the client table. No sidebar yet; the left nav arrives
 * with the platform shell on integration.
 */
export function Shell() {
  const location = useLocation();
  const isDetail = location.pathname.startsWith("/client/");

  return (
    <div className="min-h-full">
      <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-[13px] font-semibold text-white">
              A
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">
              Avilo Advisory
            </span>
          </Link>
          {isDetail ? (
            <>
              <span className="text-ink-faint">/</span>
              <Link
                to="/"
                className="text-[13px] text-ink-muted hover:text-ink"
              >
                Clients
              </Link>
            </>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
