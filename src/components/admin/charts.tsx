"use client";

import { useState } from "react";

/**
 * Graphiques à série unique, en HTML/CSS (aucune bibliothèque) :
 * une seule teinte (--chart, validée sur les deux surfaces), barres ≤ 24 px aux
 * extrémités arrondies côté valeur, quadrillage discret, infobulle au survol et au
 * focus clavier, valeur affichée au bout des barres, tableau des données disponible.
 * Une seule série : pas de légende, le titre dit ce qui est représenté.
 */

export function HBarChart({
  rows,
  valueSuffix = "",
}: {
  rows: Array<{ label: string; value: number; tooltip: string }>;
  valueSuffix?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-sm">
          <span className="text-muted truncate" title={r.label}>
            {r.label}
          </span>
          <span className="flex items-center gap-2" title={r.tooltip}>
            <span
              tabIndex={0}
              aria-label={r.tooltip}
              className="bg-chart block h-5 rounded-e"
              style={{ width: `${(r.value / max) * 85}%`, minWidth: r.value > 0 ? 4 : 0 }}
            />
            <span className="text-fg tabular-nums">
              {r.value}
              {valueSuffix}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ColumnChart({
  values,
  xLabel,
  tooltip,
  tickEvery = 3,
  ariaLabel,
}: {
  values: number[];
  xLabel: (i: number) => string;
  tooltip: (i: number, v: number) => string;
  tickEvery?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  const gridSteps = [0.5, 1];
  return (
    <figure aria-label={ariaLabel} className="relative">
      <div className="border-line relative h-44 border-b">
        {gridSteps.map((g) => (
          <div key={g} className="border-grid absolute inset-x-0 border-t" style={{ bottom: `${g * 100}%` }}>
            <span className="bg-surface text-muted absolute start-0 -top-2.5 pe-1 text-[11px] tabular-nums">
              {Math.round(max * g)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px] ps-6">
          {values.map((v, i) => (
            <div
              key={i}
              className="relative flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={tooltip(i, v)}
            >
              <div
                className="bg-chart w-full max-w-6 rounded-t"
                style={{ height: `${(v / max) * 100}%`, opacity: hover === null || hover === i ? 1 : 0.55 }}
              />
              {i === peak && v > 0 && (
                <span className="text-fg absolute -top-0 -translate-y-full text-[11px] font-semibold tabular-nums">
                  {v}
                </span>
              )}
            </div>
          ))}
        </div>
        {hover !== null && (
          <div
            role="status"
            className="bg-fg text-bg pointer-events-none absolute start-1/2 -top-8 -translate-x-1/2 rounded-md px-2 py-1 text-xs font-semibold whitespace-nowrap shadow"
          >
            {tooltip(hover, values[hover] ?? 0)}
          </div>
        )}
      </div>
      <div className="text-muted flex gap-[2px] ps-6 text-[11px]" aria-hidden>
        {values.map((_, i) => (
          <span key={i} className="flex-1 text-center tabular-nums">
            {i % tickEvery === 0 ? xLabel(i) : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}
