/**
 * Renders a `SummaryDoc` — the executive summary's colour and in-app links.
 *
 * The important thing about this file is what it does NOT do. It never parses a string as
 * HTML, never calls `dangerouslySetInnerHTML`, and never builds an `href` from model
 * output. A coloured run becomes a `<span>` whose `style.color` React assigns through the
 * CSSOM; a link becomes a `<button>` that calls a navigation handler with an id the server
 * already checked against the live registry. There is no path from the model's words to an
 * element or a request the application did not already have — which is why arbitrary colour
 * is safe to allow, and why an external URL is not merely disallowed but inexpressible.
 *
 * Colour is the model's to choose. A wrong one looks wrong and the advisor says so; that is
 * a taste problem, and taste problems do not need a validator.
 */
import type { SummaryDoc, SummarySpan } from "@avilo/core";
import { parseLinkTarget } from "@avilo/core";

export interface SummaryNavigate {
  /** Scroll to a section of the report. */
  report: (sectionId: string) => void;
  /** Scroll to a panel of this dashboard. */
  dashboard: (panelId: string) => void;
  /** Switch the view picker to a custom view. */
  view: (viewId: string) => void;
  /** Switch to the raw imported data. */
  raw: () => void;
}

function Span({ span, go }: { span: SummarySpan; go: SummaryNavigate }) {
  if ("link" in span) {
    const target = parseLinkTarget(span.link);
    // Already validated server-side; if a stored doc outlives the build that wrote it, the
    // words still read correctly as plain text rather than becoming a dead control.
    if (!target) return <>{span.text}</>;
    return (
      <button
        type="button"
        onClick={() => {
          if (target.kind === "raw") return go.raw();
          if (target.kind === "report") return go.report(target.id);
          if (target.kind === "dashboard") return go.dashboard(target.id);
          return go.view(target.id);
        }}
        className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {span.text}
      </button>
    );
  }

  if ("color" in span) return <span style={{ color: span.color }}>{span.text}</span>;
  return <>{span.text}</>;
}

export function SummaryRichText({ doc, go }: { doc: SummaryDoc; go: SummaryNavigate }) {
  const blocks = doc.blocks.map((block, i) => (
    <span key={i}>
      {block.map((span, j) => (
        <Span key={j} span={span} go={go} />
      ))}
    </span>
  ));

  if (doc.mode === "bullets") {
    return (
      <ul className="space-y-1.5 text-[12.5px] leading-[1.65] text-ink">
        {blocks.map((block, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-ink-faint">·</span>
            <span>{block}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {blocks.map((block, i) => (
        <p key={i} className="text-[12.5px] leading-[1.65] text-ink">
          {block}
        </p>
      ))}
    </>
  );
}
