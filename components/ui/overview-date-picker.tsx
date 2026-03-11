"use client"

import { useRouter } from "next/navigation"
import type { DatePreset } from "@/lib/utils/dates"

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "this_month", label: "Month to date" },
  { value: "last_month", label: "Last month" },
]

type Props = {
  preset: string
}

export default function OverviewDatePicker({ preset }: Props) {
  const router = useRouter()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    router.push(`/dashboard?preset=${value}`)
  }

  return (
    <select
      value={preset}
      onChange={handleChange}
      className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-600"
    >
      {PRESETS.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  )
}
