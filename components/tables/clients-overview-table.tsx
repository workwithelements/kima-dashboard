"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { fmtCurrency, fmtNumber, fmtRoas } from "@/lib/utils/format"

type ClientRow = {
  id: string
  name: string
  spend: number
  impressions: number
  purchases: number
  revenue: number
  roas: number
}

type SortKey = "name" | "spend" | "impressions" | "purchases" | "revenue" | "roas"
type SortDir = "asc" | "desc"

const COLUMNS: { key: SortKey; label: string; align?: "left" }[] = [
  { key: "name", label: "Client", align: "left" },
  { key: "spend", label: "Spend" },
  { key: "impressions", label: "Impressions" },
  { key: "purchases", label: "Purchases" },
  { key: "revenue", label: "Revenue" },
  { key: "roas", label: "ROAS" },
]

export default function ClientsOverviewTable({ clients }: { clients: ClientRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("spend")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const sorted = useMemo(() => {
    const copy = [...clients]
    copy.sort((a, b) => {
      const va = sortKey === "name" ? a.name.toLowerCase() : a[sortKey]
      const vb = sortKey === "name" ? b.name.toLowerCase() : b[sortKey]
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va)
      }
      return sortDir === "asc"
        ? (va as number) - (vb as number)
        : (vb as number) - (va as number)
    })
    return copy
  }, [clients, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function formatCell(client: ClientRow, key: SortKey): string {
    switch (key) {
      case "name":
        return client.name
      case "spend":
        return fmtCurrency(client.spend)
      case "impressions":
        return fmtNumber(client.impressions)
      case "purchases":
        return fmtNumber(client.purchases)
      case "revenue":
        return fmtCurrency(client.revenue)
      case "roas":
        return client.roas > 0 ? fmtRoas(client.roas) : "—"
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-neutral-800">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`cursor-pointer whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500 transition hover:text-neutral-300 ${
                  col.align === "left" ? "text-left" : "text-right"
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    <svg
                      className={`h-3 w-3 transition ${sortDir === "asc" ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((client) => (
            <tr
              key={client.id}
              className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
            >
              {COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2.5 text-xs tabular-nums ${
                    col.align === "left" ? "text-left" : "text-right"
                  } ${col.key === "name" ? "font-medium text-white" : "text-neutral-300"}`}
                >
                  {col.key === "name" ? (
                    <Link
                      href={`/dashboard/clients/${client.id}`}
                      className="transition hover:text-brand-lime"
                    >
                      {client.name}
                    </Link>
                  ) : (
                    formatCell(client, col.key)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-xs text-neutral-500">
                No active clients
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
