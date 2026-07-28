import { Block, EmptyState } from "./ui.js";
import { Tip } from "./Tooltip.js";
import { moneyFull, count as fmtCount } from "../../lib/format.js";
import type { DetailRow } from "../types.js";

const BUCKET_LABEL: Record<string, string> = {
  current: "Current",
  "1_30": "1–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  "91_plus": "91+ days",
  total: "Total",
};

/**
 * Ageing buckets past 30 days are the ones an advisor acts on. Red is reserved for
 * genuinely overdue money rather than applied to every row.
 */
function bucketTone(bucket: string | null): string {
  if (bucket === "61_90" || bucket === "91_plus") return "text-flag";
  if (bucket === "31_60") return "text-warn";
  return "text-ink-muted";
}

function emptyFor(what: string, report: string) {
  return (
    <EmptyState
      title={`No ${what} yet`}
      body={`Upload a ${report} export for this period to populate this section.`}
    />
  );
}

/** Top expenses, from the P&L's own detail lines. */
export function TopExpensesBlock({ rows }: { rows: DetailRow[] }) {
  // Rules carried over from the v9 review: drop depreciation & amortisation, drop
  // zero-value lines, sort by size, show the top five.
  const filtered = rows
    .filter((row) => !/depreciat|amorti[sz]/i.test(row.label))
    .filter((row) => Math.abs(row.value) > 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 5);

  const total = filtered.reduce((sum, row) => sum + Math.abs(row.value), 0);

  return (
    <Block title="Top expenses this month" subtitle="Largest five, excluding depreciation">
      {filtered.length === 0 ? (
        emptyFor("expense lines", "Profit & Loss")
      ) : (
        <div className="divide-y divide-line-soft">
          {filtered.map((row) => {
            const share = total === 0 ? 0 : (Math.abs(row.value) / total) * 100;
            return (
              <div key={row.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {row.label.trim()}
                </span>
                <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-line-soft">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${share}%` }}
                  />
                </span>
                <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                  {moneyFull(row.value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Block>
  );
}

/** Who owes you / What you owe. */
export function AgingBlock({
  title,
  subtitle,
  rows,
  reportName,
  entityNoun,
}: {
  title: string;
  subtitle: string;
  rows: DetailRow[];
  reportName: string;
  entityNoun: string;
}) {
  const top = rows.slice(0, 8);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <Block
      title={title}
      subtitle={subtitle}
      actions={
        rows.length > 0 ? (
          <span className="num text-[12.5px] font-semibold text-ink">
            {moneyFull(total)}
          </span>
        ) : null
      }
    >
      {top.length === 0 ? (
        emptyFor(entityNoun, reportName)
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-line-soft/60">
                <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  {entityNoun}
                </th>
                <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  Ageing
                </th>
                <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((row) => (
                <tr key={row.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-2 text-ink">{row.label}</td>
                  <td className="px-5 py-2">
                    {/*
                      The bucket the report itself placed them in — not a day count,
                      which the source data does not actually support.
                    */}
                    <Tip content="The ageing bucket holding the largest part of this balance, as reported by QuickBooks">
                      <span className={`font-medium ${bucketTone(row.bucket)}`}>
                        {BUCKET_LABEL[row.bucket ?? "total"] ?? row.bucket}
                      </span>
                    </Tip>
                  </td>
                  <td className="num px-5 py-2 text-right font-medium text-ink">
                    {moneyFull(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}

/** Where your money came from — top customers by revenue. */
export function TopCustomersBlock({ rows }: { rows: DetailRow[] }) {
  const top = rows.slice(0, 8);
  return (
    <Block
      title="Where your money came from"
      subtitle="Top customers by revenue"
    >
      {top.length === 0 ? (
        emptyFor("customer revenue", "Sales by Customer")
      ) : (
        <div className="divide-y divide-line-soft">
          {top.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                {row.label}
              </span>
              {row.count !== null ? (
                <span className="num shrink-0 text-[11.5px] text-ink-faint">
                  {fmtCount(row.count)} jobs
                </span>
              ) : null}
              <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                {moneyFull(row.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

/** Top referral partners, last 90 days. */
export function ReferralBlock({ rows }: { rows: DetailRow[] }) {
  const top = rows.slice(0, 8);
  return (
    <Block title="Top referral partners" subtitle="Last 90 days">
      {top.length === 0 ? (
        emptyFor("referral data", "Referral")
      ) : (
        <div className="divide-y divide-line-soft">
          {top.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                {row.label}
              </span>
              <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                {moneyFull(row.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}
