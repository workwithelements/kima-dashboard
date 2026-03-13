"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import Sparkline from "@/components/charts/sparkline"

type ClientRow = {
  id: string
  name: string
  spend: number
  dailySpend: number[]
  keyActionLabel: string | null
  keyActionCount: number
  costPerKeyAction: number
  compKeyActionCount: number
}

type SortKey = "name" | "spend" | "keyActionCount" | "costPerKeyAction"
type SortDir = "asc" | "desc"

export default function ClientsOverviewTable({
  clients,
}: {
  clients: ClientRow[]
}) {
  const [sortKey, setSortKey] = useState<SortKey>("spend")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const sorted = useMemo(() => {
    const copy = [...clients]
    copy.sort((a, b) => {
      if (sortKey === "name") {
        return sortDir === "asc"
          ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
          : b.name.toLowerCase().localeCompare(a.name.toLowerCase())
      }
      const va = a[sortKey] as number
      const vb = b[sortKey] as number
      return sortDir === "asc" ? va - vb : vb - va
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-neutral-800">
            <SortableHeader
              label="Client"
              sortKey="name"
              currentSort={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              align="left"
            />
            <SortableHeader
              label="Spend (MTD)"
              sortKey="spend"
              currentSort={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <th className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Trend
            </th>
            <SortableHeader
              label="Key Action"
              sortKey="keyActionCount"
              currentSort={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <SortableHeader
              label="Cost / Action"
              sortKey="costPerKeyAction"
              currentSort={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((client) => (
            <tr
              key={client.id}
              className="border-b border-neutral-800/50 transition hover:bg-neutral-800/30"
            >
              {/* Client name */}
              <td className="whitespace-nowrap px-3 py-2.5 text-xs font-medium text-white">
                <Link
                  href={`/dashboard/clients/${client.id}`}
                  className="transition hover:text-brand-lime"
                >
                  {client.name}
                </Link>
              </td>

              {/* Spend (MTD) */}
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-neutral-300">
                {fmtCurrency(client.spend)}
              </td>

              {/* Sparkline trend */}
              <td className="whitespace-nowrap px-3 py-2.5 text-right">
                {client.dailySpend.length > 1 ? (
                  <div className="flex justify-end">
                    <Sparkline data={client.dailySpend} />
                  </div>
                ) : (
                  <span className="text-xs text-neutral-600">—</span>
                )}
              </td>

              {/* Key action */}
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-neutral-300">
                {client.keyActionLabel ? (
                  <span>
                    <span className="text-neutral-500">
                      {client.keyActionLabel}:
                    </span>{" "}
                    {fmtNumber(client.keyActionCount)}
                    {client.compKeyActionCount > 0 && (
                      <span className={`ml-1.5 text-[10px] ${
                        client.keyActionCount >= client.compKeyActionCount
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}>
                        {client.keyActionCount >= client.compKeyActionCount ? "+" : ""}
                        {(((client.keyActionCount - client.compKeyActionCount) / client.compKeyActionCount) * 100).toFixed(0)}%
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-neutral-600 text-[10px] italic">None set</span>
                )}
              </td>

              {/* Cost per action */}
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-neutral-300">
                {client.costPerKeyAction > 0
                  ? fmtCurrency(client.costPerKeyAction)
                  : "—"}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-8 text-center text-xs text-neutral-500"
              >
                No active clients
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Reusable sortable column header */
function SortableHeader({
  label,
  sortKey,
  currentSort,
  sortDir,
  onSort,
  align = "right",
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  align?: "left" | "right"
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-neutral-500 transition hover:text-neutral-300 ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {currentSort === sortKey && (
          <svg
            className={`h-3 w-3 transition ${sortDir === "asc" ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        )}
      </span>
    </th>
  )
}
