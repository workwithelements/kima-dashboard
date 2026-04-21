/**
 * Server-side data fetching for the Organic Social tab.
 * Aggregates Instagram posts, weekly bookings, HDYHAU allocations, and
 * Meta daily performance onto a common ISO-week axis.
 */

import { unstable_cache } from "next/cache"
import { createServiceClient } from "@/lib/supabase/server"
import type {
  InstagramTaggedPostRow,
  WeeklyBookingRow,
  WeeklyHdyhauRow,
} from "@/lib/utils/types"

const CACHE_TTL_SECONDS = 300

/** One row per ISO-week Monday. Zeros where no data exists. */
export type WeeklyPostAgg = {
  week_start_date: string
  posts: number
  engagement: number // likes + comments
  unique_creators: number
}

export type WeeklyMetaAgg = {
  week_start_date: string
  spend: number
  purchases: number // for Ezra this is event_eb
  purchase_value: number
}

export type CreatorAgg = {
  author_username: string
  author_full_name: string | null
  author_is_verified: boolean | null
  author_followers: number | null
  posts: number
  engagement: number
}

export type OrganicSocialData = {
  posts: InstagramTaggedPostRow[]
  weeklyPosts: WeeklyPostAgg[]
  weeklyBookings: WeeklyBookingRow[]
  weeklyMeta: WeeklyMetaAgg[]
  weeklyHdyhau: WeeklyHdyhauRow[]
  creators: CreatorAgg[]
}

/** Monday of the ISO week containing date `d` (UTC), as YYYY-MM-DD. */
function isoWeekMonday(isoDate: string): string {
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return isoDate.slice(0, 10)
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay() || 7
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1))
  return x.toISOString().slice(0, 10)
}

async function fetchAllRows<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1)
    if (error || !data) break
    all.push(...(data as T[]))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function fetchOrganicSocialDataUncached(
  clientId: string,
  from: string, // YYYY-MM-DD
  to: string,
): Promise<OrganicSocialData> {
  const db = createServiceClient()

  const [posts, bookings, metaRows, hdyhau] = await Promise.all([
    fetchAllRows<InstagramTaggedPostRow>(() =>
      db
        .from("instagram_tagged_posts")
        .select(
          "post_url, shortcode, post_type, taken_at, week_start_date, author_username, author_full_name, author_followers, author_is_verified, caption, thumbnail_url, like_count, comment_count, video_view_count, play_count, hashtags, mentions",
        )
        .eq("client_id", clientId)
        .gte("week_start_date", from)
        .lte("week_start_date", to)
        .order("taken_at", { ascending: false }),
    ),
    fetchAllRows<WeeklyBookingRow>(() =>
      db
        .from("weekly_bookings")
        .select("week_start_date, bookings, revenue, notes")
        .eq("client_id", clientId)
        .gte("week_start_date", from)
        .lte("week_start_date", to)
        .order("week_start_date", { ascending: true }),
    ),
    fetchAllRows<{ date: string; spend: number; purchases: number; purchase_value: number }>(
      () =>
        db
          .from("meta_daily_performance")
          .select("date, spend, purchases, purchase_value")
          .eq("client_id", clientId)
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: true }),
    ),
    fetchAllRows<WeeklyHdyhauRow>(() =>
      db
        .from("weekly_hdyhau")
        .select("week_start_date, channel, dollars")
        .eq("client_id", clientId)
        .gte("week_start_date", from)
        .lte("week_start_date", to)
        .order("week_start_date", { ascending: true }),
    ),
  ])

  // ─── Weekly post aggregates ─────────────────────────────────────────
  const postsByWeek = new Map<string, { posts: number; engagement: number; creators: Set<string> }>()
  for (const p of posts) {
    const week = p.week_start_date
    const cur = postsByWeek.get(week) || { posts: 0, engagement: 0, creators: new Set<string>() }
    cur.posts += 1
    cur.engagement += (p.like_count || 0) + (p.comment_count || 0)
    if (p.author_username) cur.creators.add(p.author_username)
    postsByWeek.set(week, cur)
  }
  const weeklyPosts: WeeklyPostAgg[] = Array.from(postsByWeek.entries())
    .map(([week_start_date, v]) => ({
      week_start_date,
      posts: v.posts,
      engagement: v.engagement,
      unique_creators: v.creators.size,
    }))
    .sort((a, b) => a.week_start_date.localeCompare(b.week_start_date))

  // ─── Weekly Meta aggregates ─────────────────────────────────────────
  const metaByWeek = new Map<string, WeeklyMetaAgg>()
  for (const r of metaRows) {
    const week = isoWeekMonday(r.date)
    const cur = metaByWeek.get(week) || {
      week_start_date: week,
      spend: 0,
      purchases: 0,
      purchase_value: 0,
    }
    cur.spend += r.spend || 0
    cur.purchases += r.purchases || 0
    cur.purchase_value += r.purchase_value || 0
    metaByWeek.set(week, cur)
  }
  const weeklyMeta = Array.from(metaByWeek.values()).sort((a, b) =>
    a.week_start_date.localeCompare(b.week_start_date),
  )

  // ─── Creators ───────────────────────────────────────────────────────
  const creatorsMap = new Map<string, CreatorAgg>()
  for (const p of posts) {
    if (!p.author_username) continue
    const cur = creatorsMap.get(p.author_username) || {
      author_username: p.author_username,
      author_full_name: p.author_full_name,
      author_is_verified: p.author_is_verified,
      author_followers: p.author_followers,
      posts: 0,
      engagement: 0,
    }
    cur.posts += 1
    cur.engagement += (p.like_count || 0) + (p.comment_count || 0)
    // Keep the max followers count seen (rough signal)
    if ((p.author_followers ?? 0) > (cur.author_followers ?? 0)) {
      cur.author_followers = p.author_followers
    }
    creatorsMap.set(p.author_username, cur)
  }
  const creators = Array.from(creatorsMap.values()).sort(
    (a, b) => b.engagement - a.engagement,
  )

  return {
    posts,
    weeklyPosts,
    weeklyBookings: bookings,
    weeklyMeta,
    weeklyHdyhau: hdyhau,
    creators,
  }
}

/** Cached wrapper — 5 min TTL, keyed on clientId + date range. */
export const fetchOrganicSocialData = (clientId: string, from: string, to: string) =>
  unstable_cache(
    () => fetchOrganicSocialDataUncached(clientId, from, to),
    ["organic-social", clientId, from, to],
    { revalidate: CACHE_TTL_SECONDS, tags: [`organic-social:${clientId}`] },
  )()
