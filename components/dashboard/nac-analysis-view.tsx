"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

/* ─── colour tokens ─── */
const COLORS = [
  "#CDFF00", // brand-lime
  "#FF69B4", // pink
  "#60A5FA", // blue
  "#FBBF24", // amber
  "#A78BFA", // violet
  "#34D399", // emerald
  "#F87171", // red
  "#FB923C", // orange
]

const C = {
  grid: "#262626",
  axis: "#737373",
  tooltipBg: "#171717",
  tooltipBorder: "#262626",
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: C.tooltipBg,
    border: `1px solid ${C.tooltipBorder}`,
    borderRadius: "8px",
    fontSize: "13px",
  },
  labelStyle: { color: "#a3a3a3" },
}

type NacRow = {
  date: string
  region: string
  channel: string
  campaign: string
  first_product: string
  nacs: number
}

type BreakdownKey = "region" | "channel" | "first_product"

export default function NacAnalysisView() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<NacRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [productFilter, setProductFilter] = useState<string>("all")
  const [breakdownBy, setBreakdownBy] = useState<BreakdownKey>("region")

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/nac-data`)
      if (res.ok) {
        setData(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { fetchData() }, [fetchData])

  /* ─── derived data ─── */

  const productTypes = useMemo(() => {
    const set = new Set(data.map((r) => r.first_product))
    return Array.from(set).sort()
  }, [data])

  const filtered = useMemo(() => {
    if (productFilter === "all") return data
    return data.filter((r) => r.first_product === productFilter)
  }, [data, productFilter])

  const totalNacs = useMemo(() => filtered.reduce((s, r) => s + r.nacs, 0), [filtered])

  const pieData = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of filtered) {
      const key = r[breakdownBy]
      map[key] = (map[key] || 0) + r.nacs
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [filtered, breakdownBy])

  // Daily trend by breakdown
  const trendData = useMemo(() => {
    const dateMap: Record<string, Record<string, number>> = {}
    const categories = new Set<string>()

    for (const r of filtered) {
      if (!dateMap[r.date]) dateMap[r.date] = {}
      const key = r[breakdownBy]
      categories.add(key)
      dateMap[r.date][key] = (dateMap[r.date][key] || 0) + r.nacs
    }

    return {
      series: Object.entries(dateMap)
        .map(([date, vals]) => ({ date, ...vals }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      categories: Array.from(categories).sort(),
    }
  }, [filtered, breakdownBy])

  // Bar chart: volume by breakdown dimension
  const barData = useMemo(() => {
    return pieData.map((d) => ({ ...d }))
  }, [pieData])

  // Product mix breakdown (always by product, ignoring productFilter)
  const productMixData = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of data) {
      map[r.first_product] = (map[r.first_product] || 0) + r.nacs
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [data])

  /* ─── CSV upload ─── */

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadMsg(null)

    const form = new FormData()
    form.append("file", file)

    try {
      const res = await fetch(`/api/clients/${clientId}/nac-data`, {
        method: "POST",
        body: form,
      })
      const body = await res.json()
      if (res.ok) {
        setUploadMsg({ type: "success", text: `Uploaded ${body.inserted} rows` })
        fetchData()
      } else {
        setUploadMsg({ type: "error", text: body.error || "Upload failed" })
      }
    } catch {
      setUploadMsg({ type: "error", text: "Network error" })
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  /* ─── render helpers ─── */

  const pctLabel = ({ name, percent }: { name: string; percent: number }) =>
    `${name} ${(percent * 100).toFixed(1)}%`

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-brand-lime" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">NAC Analysis</h2>
          <p className="text-sm text-neutral-400">
            Newly Acquired Customers by region, channel &amp; product
          </p>
        </div>

        {/* CSV Upload */}
        <div className="flex items-center gap-3">
          {uploadMsg && (
            <span className={`text-xs ${uploadMsg.type === "success" ? "text-green-400" : "text-red-400"}`}>
              {uploadMsg.text}
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {uploading ? "Uploading..." : "Upload CSV"}
            <input
              type="file"
              accept=".csv"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {data.length === 0 ? (
        <Card className="col-span-full">
          <p className="text-center text-sm text-neutral-500">
            No NAC data yet. Upload a CSV to get started.
          </p>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            {/* Product type toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">Product:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setProductFilter("all")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    productFilter === "all"
                      ? "bg-brand-lime text-neutral-900"
                      : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  }`}
                >
                  All
                </button>
                {productTypes.map((p) => (
                  <button
                    key={p}
                    onClick={() => setProductFilter(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      productFilter === p
                        ? "bg-brand-lime text-neutral-900"
                        : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Breakdown selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">Breakdown:</span>
              <div className="flex gap-1">
                {([
                  { key: "region", label: "Region" },
                  { key: "channel", label: "Channel" },
                  { key: "first_product", label: "Product" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setBreakdownBy(opt.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      breakdownBy === opt.key
                        ? "bg-brand-lime text-neutral-900"
                        : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs text-neutral-400">Total NACs</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{totalNacs.toLocaleString()}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {productFilter === "all" ? "All products" : productFilter}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-neutral-400">Top {breakdownBy === "first_product" ? "Product" : breakdownBy === "region" ? "Region" : "Channel"}</p>
              <p className="mt-1 text-2xl font-semibold">{pieData[0]?.name || "—"}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {pieData[0] ? `${((pieData[0].value / totalNacs) * 100).toFixed(1)}% of total` : ""}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-neutral-400">Date Range</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {filtered.length > 0
                  ? `${filtered[0].date} — ${filtered[filtered.length - 1].date}`
                  : "—"}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-neutral-400">Unique Days</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {new Set(filtered.map((r) => r.date)).size}
              </p>
            </Card>
          </div>

          {/* Charts Row 1: Pie + Bar */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Pie chart: % split */}
            <Card>
              <h3 className="mb-4 text-sm font-medium text-neutral-300">
                NAC % by {breakdownBy === "first_product" ? "Product" : breakdownBy === "region" ? "Region" : "Channel"}
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={pctLabel}
                    fontSize={12}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            {/* Bar chart: volume */}
            <Card>
              <h3 className="mb-4 text-sm font-medium text-neutral-300">
                NAC Volume by {breakdownBy === "first_product" ? "Product" : breakdownBy === "region" ? "Region" : "Channel"}
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fill: C.axis, fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: C.axis, fontSize: 12 }}
                    width={120}
                  />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="value" name="NACs" radius={[0, 4, 4, 0]}>
                    {barData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Chart Row 2: Daily trend */}
          <Card>
            <h3 className="mb-4 text-sm font-medium text-neutral-300">
              Daily NAC Trend by {breakdownBy === "first_product" ? "Product" : breakdownBy === "region" ? "Region" : "Channel"}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData.series} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: C.axis, fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis tick={{ fill: C.axis, fontSize: 12 }} />
                <Tooltip {...tooltipStyle} />
                <Legend
                  wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                />
                {trendData.categories.map((cat, i) => (
                  <Line
                    key={cat}
                    type="monotone"
                    dataKey={cat}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Chart Row 3: Product mix (always shown, ignores product filter) */}
          <Card>
            <h3 className="mb-4 text-sm font-medium text-neutral-300">
              Product Mix (All Products)
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={productMixData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={pctLabel}
                  fontSize={12}
                >
                  {productMixData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </div>
  )
}
