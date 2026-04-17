"use client"

import { useState, useMemo } from "react"
import { fmtCurrencyFull, fmtRoas } from "@/lib/utils/format"

export type AdRow = {
  name: string
  job: string
  market: "UK" | "US" | "AU"
  spend: number
  roas: number
}

type SortKey = "name" | "job" | "market" | "spend" | "roas"
type SortDir = "asc" | "desc"

export default function JobAdsTable({ rows }: { rows: AdRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("roas")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av
      }
      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
      if (as < bs) return sortDir === "asc" ? -1 : 1
      if (as > bs) return sortDir === "asc" ? 1 : -1
      return 0
    })
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "name" || key === "job" || key === "market" ? "asc" : "desc")
    }
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs text-neutral-400">
            <Th onClick={() => toggleSort("name")}>Ad Name{arrow("name")}</Th>
            <Th onClick={() => toggleSort("job")}>JOB{arrow("job")}</Th>
            <Th onClick={() => toggleSort("market")}>Market{arrow("market")}</Th>
            <Th onClick={() => toggleSort("spend")} align="right">
              Spend{arrow("spend")}
            </Th>
            <Th onClick={() => toggleSort("roas")} align="right">
              ROAS{arrow("roas")}
            </Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={`${r.name}-${r.market}-${i}`}
              className="border-b border-neutral-900 text-neutral-200 hover:bg-neutral-800/40"
            >
              <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
              <td className="px-3 py-2">
                <JobBadge job={r.job} />
              </td>
              <td className="px-3 py-2">{r.market}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtCurrencyFull(r.spend)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums font-medium ${
                  r.roas >= 4
                    ? "text-emerald-400"
                    : r.roas >= 2
                      ? "text-neutral-200"
                      : r.roas >= 1
                        ? "text-amber-400"
                        : "text-red-400"
                }`}
              >
                {fmtRoas(r.roas)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({
  children,
  onClick,
  align = "left",
}: {
  children: React.ReactNode
  onClick?: () => void
  align?: "left" | "right"
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-3 py-2 font-medium uppercase tracking-wide transition hover:text-white ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  )
}

function JobBadge({ job }: { job: string }) {
  const colors: Record<string, string> = {
    "Bold Trendsetter": "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
    "Considered Shopper": "bg-sky-500/10 text-sky-300 border-sky-500/30",
    "Conscious Consumer": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    Untagged: "bg-neutral-700/30 text-neutral-400 border-neutral-700",
  }
  const cls = colors[job] || "bg-neutral-700/30 text-neutral-400 border-neutral-700"
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${cls}`}>
      {job}
    </span>
  )
}
