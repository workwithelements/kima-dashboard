"use client"

import { useCallback, useMemo, useState } from "react"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, MetricCard } from "@/components/ui/card"
import { fmtCurrency, fmtNumber } from "@/lib/utils/format"
import type { OrganicSocialData } from "@/lib/data/fetch-organic-social-data"

type Props = {
  clientId: string
  clientName: string
  currency: string
  range: { from: string; to: string }
  data: OrganicSocialData
}

const C = {
  grid: "#262626",
  axis: "#737373",
  tooltipBg: "#171717",
  tooltipBorder: "#262626",
}

const PALETTE = [
  "#CDFF00", // brand-lime
  "#FF69B4",
  "#60A5FA",
  "#FBBF24",
  "#A78BFA",
  "#34D399",
  "#F87171",
  "#FB923C",
  "#22D3EE",
  "#E879F9",
]

const tooltipStyle = {
  contentStyle: {
    backgroundColor: C.tooltipBg,
    border: `1px solid ${C.tooltipBorder}`,
    borderRadius: "8px",
    fontSize: "13px",
  },
  labelStyle: { color: "#a3a3a3" },
}

export default function OrganicSocialView({
  clientId,
  clientName,
  currency,
  range,
  data,
}: Props) {
  const [lagWeeks, setLagWeeks] = useState(0)
  const [bookingsUploading, setBookingsUploading] = useState(false)
  const [bookingsMsg, setBookingsMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [hdyhauUploading, setHdyhauUploading] = useState(false)
  const [hdyhauMsg, setHdyhauMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  /* ─── weekly overlay (posts bars + bookings/meta lines) ──────────── */
  const overlayData = useMemo(() => {
    const weeks = new Set<string>()
    data.weeklyPosts.forEach((r) => weeks.add(r.week_start_date))
    data.weeklyBookings.forEach((r) => weeks.add(r.week_start_date))
    data.weeklyMeta.forEach((r) => weeks.add(r.week_start_date))

    const postByWeek = new Map(data.weeklyPosts.map((r) => [r.week_start_date, r]))
    const bookByWeek = new Map(data.weeklyBookings.map((r) => [r.week_start_date, r]))
    const metaByWeek = new Map(data.weeklyMeta.map((r) => [r.week_start_date, r]))

    return Array.from(weeks)
      .sort()
      .map((week) => {
        const p = postByWeek.get(week)
        const b = bookByWeek.get(week)
        const m = metaByWeek.get(week)
        return {
          week,
          posts: p?.posts ?? 0,
          engagement: p?.engagement ?? 0,
          bookings: b?.bookings ?? null,
          metaPurchases: m?.purchases ?? 0,
          metaSpend: m?.spend ?? 0,
        }
      })
  }, [data.weeklyPosts, data.weeklyBookings, data.weeklyMeta])

  /* ─── HDYHAU stacked area ───────────────────────────────────────── */
  const { hdyhauChartData, hdyhauChannels } = useMemo(() => {
    const channels = Array.from(new Set(data.weeklyHdyhau.map((r) => r.channel)))
    // Sort channels by total dollars, descending — "socialMedia" floats to the top of the legend if dominant.
    const channelTotals: Record<string, number> = {}
    for (const r of data.weeklyHdyhau) {
      channelTotals[r.channel] = (channelTotals[r.channel] || 0) + r.dollars
    }
    channels.sort((a, b) => (channelTotals[b] || 0) - (channelTotals[a] || 0))

    const byWeek = new Map<string, Record<string, number>>()
    for (const r of data.weeklyHdyhau) {
      const cur = byWeek.get(r.week_start_date) || {}
      cur[r.channel] = (cur[r.channel] || 0) + r.dollars
      byWeek.set(r.week_start_date, cur)
    }
    const rows = Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, vals]) => {
        const row: Record<string, number | string> = { week }
        for (const ch of channels) row[ch] = vals[ch] || 0
        return row
      })
    return { hdyhauChartData: rows, hdyhauChannels: channels }
  }, [data.weeklyHdyhau])

  /* ─── lag scatter (weekly posts → weekly bookings, shifted) ─────── */
  const scatterData = useMemo(() => {
    if (data.weeklyBookings.length === 0) return []
    const postByWeek = new Map(data.weeklyPosts.map((r) => [r.week_start_date, r.posts]))

    const shift = (dateStr: string, weeks: number): string => {
      const d = new Date(dateStr + "T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - weeks * 7)
      return d.toISOString().slice(0, 10)
    }

    return data.weeklyBookings
      .map((b) => {
        const sourceWeek = shift(b.week_start_date, lagWeeks)
        const posts = postByWeek.get(sourceWeek) ?? 0
        return { posts, bookings: b.bookings, week: b.week_start_date }
      })
      .filter((d) => d.posts > 0 || d.bookings > 0)
  }, [data.weeklyPosts, data.weeklyBookings, lagWeeks])

  const correlation = useMemo(() => pearson(scatterData.map((d) => d.posts), scatterData.map((d) => d.bookings)), [scatterData])

  /* ─── summary totals for cards ──────────────────────────────────── */
  const totals = useMemo(() => {
    const totalPosts = data.weeklyPosts.reduce((s, r) => s + r.posts, 0)
    const totalEngagement = data.weeklyPosts.reduce((s, r) => s + r.engagement, 0)
    const uniqueCreators = data.creators.length
    const totalBookings = data.weeklyBookings.reduce((s, r) => s + r.bookings, 0)
    const totalMetaSpend = data.weeklyMeta.reduce((s, r) => s + r.spend, 0)
    const totalMetaPurchases = data.weeklyMeta.reduce((s, r) => s + r.purchases, 0)
    const nonMetaBookings = totalBookings - totalMetaPurchases
    return {
      totalPosts,
      totalEngagement,
      uniqueCreators,
      totalBookings,
      totalMetaSpend,
      totalMetaPurchases,
      nonMetaBookings,
    }
  }, [data])

  /* ─── uploads ───────────────────────────────────────────────────── */
  const handleBookingsUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setBookingsUploading(true)
      setBookingsMsg(null)
      const form = new FormData()
      form.append("file", file)
      try {
        const res = await fetch(`/api/clients/${clientId}/weekly-bookings`, {
          method: "POST",
          body: form,
        })
        const body = await res.json()
        if (res.ok) {
          setBookingsMsg({ type: "success", text: `Uploaded ${body.inserted} rows. Refresh to see changes.` })
        } else {
          setBookingsMsg({ type: "error", text: body.error || "Upload failed" })
        }
      } catch {
        setBookingsMsg({ type: "error", text: "Network error" })
      } finally {
        setBookingsUploading(false)
        e.target.value = ""
      }
    },
    [clientId],
  )

  const handleHdyhauUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setHdyhauUploading(true)
      setHdyhauMsg(null)
      const form = new FormData()
      form.append("file", file)
      try {
        const res = await fetch(`/api/clients/${clientId}/hdyhau`, {
          method: "POST",
          body: form,
        })
        const body = await res.json()
        if (res.ok) {
          setHdyhauMsg({ type: "success", text: `Uploaded ${body.inserted} rows. Refresh to see changes.` })
        } else {
          setHdyhauMsg({ type: "error", text: body.error || "Upload failed" })
        }
      } catch {
        setHdyhauMsg({ type: "error", text: "Network error" })
      } finally {
        setHdyhauUploading(false)
        e.target.value = ""
      }
    },
    [clientId],
  )

  /* ─── top posts ─────────────────────────────────────────────────── */
  const topPosts = useMemo(() => {
    return [...data.posts]
      .sort((a, b) => (b.like_count + b.comment_count) - (a.like_count + a.comment_count))
      .slice(0, 25)
  }, [data.posts])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Organic Social</h2>
          <p className="text-sm text-neutral-400">
            Instagram tagged posts alongside weekly bookings and Meta performance · {range.from} → {range.to}
          </p>
        </div>
      </div>

      {/* Caveat banner */}
      {!bannerDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
          <span className="mt-0.5 text-neutral-500">i</span>
          <p className="flex-1">
            Organic reach is a signal, not ground truth. Engagement counts are scraped snapshots; HDYHAU shares are self-reported; bookings arrive later than the posts that drove them — use the lag scatter below rather than comparing same-week numbers naively.
          </p>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-neutral-500 hover:text-white"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Tagged Posts" value={fmtNumber(totals.totalPosts)} />
        <MetricCard label="Engagement" value={fmtNumber(totals.totalEngagement)} subValue="likes + comments" />
        <MetricCard label="Unique Creators" value={fmtNumber(totals.uniqueCreators)} />
        <MetricCard label="Bookings (CSV)" value={totals.totalBookings > 0 ? fmtNumber(totals.totalBookings) : "—"} />
        <MetricCard label="Meta Spend" value={fmtCurrency(totals.totalMetaSpend, currency)} />
        <MetricCard label="Meta Bookings" value={fmtNumber(totals.totalMetaPurchases)} subValue="event_eb" />
        <MetricCard
          label="Non-Meta Bookings"
          value={totals.totalBookings > 0 ? fmtNumber(totals.nonMetaBookings) : "—"}
          subValue="bookings − Meta (rough)"
        />
      </div>

      {/* Weekly overlay */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-300">Weekly: Posts vs Bookings vs Meta</h3>
          <span className="text-xs text-neutral-500">posts (bars, left) · other (lines, right)</span>
        </div>
        {overlayData.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={overlayData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
              <XAxis dataKey="week" tick={{ fill: C.axis, fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: C.axis, fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: C.axis, fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="posts" name="Posts" fill="#CDFF00" fillOpacity={0.6} />
              <Line yAxisId="right" type="monotone" dataKey="bookings" name="Bookings" stroke="#FF69B4" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="metaPurchases" name="Meta event_eb" stroke="#60A5FA" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="metaSpend" name="Meta spend" stroke="#A78BFA" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* HDYHAU stacked area */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-300">HDYHAU weekly allocation</h3>
          <span className="text-xs text-neutral-500">self-reported · $ per channel</span>
        </div>
        {hdyhauChartData.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            No HDYHAU data yet. Upload a CSV below to populate this chart.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hdyhauChartData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
              <XAxis dataKey="week" tick={{ fill: C.axis, fontSize: 11 }} />
              <YAxis tick={{ fill: C.axis, fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {hdyhauChannels.map((ch, i) => (
                <Area
                  key={ch}
                  type="monotone"
                  dataKey={ch}
                  name={ch}
                  stackId="1"
                  stroke={ch === "socialMedia" ? "#CDFF00" : PALETTE[i % PALETTE.length]}
                  fill={ch === "socialMedia" ? "#CDFF00" : PALETTE[i % PALETTE.length]}
                  fillOpacity={ch === "socialMedia" ? 0.6 : 0.35}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Lag scatter */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-neutral-300">Posts → Bookings correlation</h3>
            <p className="text-xs text-neutral-500">
              Each point is one week. Lag shifts bookings later than posts by N weeks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Lag:</span>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  onClick={() => setLagWeeks(w)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    lagWeeks === w
                      ? "bg-brand-lime text-neutral-900"
                      : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  }`}
                >
                  {w}w
                </button>
              ))}
            </div>
            <span className="ml-2 text-xs text-neutral-400">
              Pearson r = <span className="font-mono">{isFinite(correlation) ? correlation.toFixed(2) : "—"}</span>
            </span>
          </div>
        </div>
        {scatterData.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            Upload weekly bookings to enable correlation analysis.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
              <XAxis
                type="number"
                dataKey="posts"
                name="Posts"
                tick={{ fill: C.axis, fontSize: 11 }}
                label={{ value: "Weekly tagged posts", position: "insideBottom", offset: -4, fill: C.axis, fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="bookings"
                name="Bookings"
                tick={{ fill: C.axis, fontSize: 11 }}
              />
              <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={scatterData} fill="#CDFF00" />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Post leaderboard */}
      <Card>
        <h3 className="mb-3 text-sm font-medium text-neutral-300">Top tagged posts</h3>
        {topPosts.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            No tagged posts synced yet. Run the Apify sync script to populate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-xs text-neutral-500">
                  <th className="px-2 py-2 text-left">Creator</th>
                  <th className="px-2 py-2 text-left">Posted</th>
                  <th className="px-2 py-2 text-right">Likes</th>
                  <th className="px-2 py-2 text-right">Comments</th>
                  <th className="px-2 py-2 text-right">Views</th>
                  <th className="px-2 py-2 text-right">Engagement</th>
                  <th className="px-2 py-2 text-left">Caption</th>
                </tr>
              </thead>
              <tbody>
                {topPosts.map((p) => {
                  const engagement = (p.like_count || 0) + (p.comment_count || 0)
                  return (
                    <tr key={p.post_url} className="border-b border-neutral-900 text-neutral-300 hover:bg-neutral-900">
                      <td className="px-2 py-2">
                        <a
                          href={p.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-brand-lime"
                        >
                          @{p.author_username}
                          {p.author_is_verified ? <span className="ml-1 text-xs text-blue-400" title="Verified">✓</span> : null}
                        </a>
                      </td>
                      <td className="px-2 py-2 text-neutral-500 tabular-nums">{p.taken_at.slice(0, 10)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtNumber(p.like_count || 0)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtNumber(p.comment_count || 0)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {p.video_view_count ? fmtNumber(p.video_view_count) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums">{fmtNumber(engagement)}</td>
                      <td className="px-2 py-2 max-w-xs truncate text-xs text-neutral-500">
                        {p.caption || "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Creator leaderboard */}
      <Card>
        <h3 className="mb-3 text-sm font-medium text-neutral-300">Top creators</h3>
        {data.creators.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">No creator data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-xs text-neutral-500">
                  <th className="px-2 py-2 text-left">Creator</th>
                  <th className="px-2 py-2 text-right">Posts</th>
                  <th className="px-2 py-2 text-right">Engagement</th>
                  <th className="px-2 py-2 text-right">Followers</th>
                </tr>
              </thead>
              <tbody>
                {data.creators.slice(0, 25).map((c) => (
                  <tr key={c.author_username} className="border-b border-neutral-900 text-neutral-300 hover:bg-neutral-900">
                    <td className="px-2 py-2">
                      <a
                        href={`https://www.instagram.com/${c.author_username}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-brand-lime"
                      >
                        @{c.author_username}
                        {c.author_is_verified ? <span className="ml-1 text-xs text-blue-400" title="Verified">✓</span> : null}
                      </a>
                      {c.author_full_name ? (
                        <span className="ml-2 text-xs text-neutral-500">{c.author_full_name}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNumber(c.posts)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNumber(c.engagement)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
                      {c.author_followers ? fmtNumber(c.author_followers) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Data management */}
      <Card>
        <h3 className="mb-3 text-sm font-medium text-neutral-300">Data imports</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Bookings */}
          <div className="rounded-lg border border-neutral-800 p-4">
            <p className="text-sm font-medium text-neutral-200">Weekly bookings</p>
            <p className="mt-1 text-xs text-neutral-500">
              CSV columns: <code className="text-neutral-400">week_start_date, bookings, revenue?, notes?</code>. Dates snap to ISO Monday. <code className="text-neutral-400">YYYY W##</code> also accepted.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Currently imported: <span className="text-neutral-300">{data.weeklyBookings.length} weeks</span>
            </p>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {bookingsUploading ? "Uploading..." : "Upload bookings CSV"}
              <input type="file" accept=".csv" onChange={handleBookingsUpload} disabled={bookingsUploading} className="hidden" />
            </label>
            {bookingsMsg && (
              <p className={`mt-2 text-xs ${bookingsMsg.type === "success" ? "text-green-400" : "text-red-400"}`}>
                {bookingsMsg.text}
              </p>
            )}
          </div>

          {/* HDYHAU */}
          <div className="rounded-lg border border-neutral-800 p-4">
            <p className="text-sm font-medium text-neutral-200">HDYHAU weekly allocation</p>
            <p className="mt-1 text-xs text-neutral-500">
              Accepts wide format (like the pivot export: <code className="text-neutral-400">WEEK_NAME, socialMedia, searchEngine, ...</code>) or long (<code className="text-neutral-400">week_start_date, channel, dollars</code>).
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Currently imported: <span className="text-neutral-300">{data.weeklyHdyhau.length} rows · {new Set(data.weeklyHdyhau.map((r) => r.week_start_date)).size} weeks</span>
            </p>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {hdyhauUploading ? "Uploading..." : "Upload HDYHAU CSV"}
              <input type="file" accept=".csv" onChange={handleHdyhauUpload} disabled={hdyhauUploading} className="hidden" />
            </label>
            {hdyhauMsg && (
              <p className={`mt-2 text-xs ${hdyhauMsg.type === "success" ? "text-green-400" : "text-red-400"}`}>
                {hdyhauMsg.text}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Instagram tagged posts sync via <code className="text-neutral-400">scripts/sync-instagram-tagged.ts</code> (daily cron). Ensure <code className="text-neutral-400">clients.instagram_tagged_url</code> is set for {clientName} and <code className="text-neutral-400">APIFY_TOKEN</code> is configured.
        </p>
      </Card>
    </div>
  )
}

/** Pearson correlation coefficient. Returns NaN when input is degenerate. */
function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return NaN
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const y = ys[i]
    sx += x
    sy += y
    sxx += x * x
    syy += y * y
    sxy += x * y
  }
  const num = n * sxy - sx * sy
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
  return den === 0 ? NaN : num / den
}
