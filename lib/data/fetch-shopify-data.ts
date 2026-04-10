/**
 * Server-side data fetching for Shopify store data.
 * Follows the same patterns as fetch-client-data.ts.
 */

import { createServiceClient } from "@/lib/supabase/server"
import type { ShopifyDailyOrdersRow, ShopifyAttributionRow } from "@/lib/utils/types"

/**
 * Paginated Supabase fetch — works around the PostgREST 1000-row default cap.
 */
async function fetchAllRows<T>(
  buildQuery: () => any,
  pageSize = 1000
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

/** Columns for shopify_daily_orders */
const SHOPIFY_ORDERS_COLUMNS =
  "date, orders, gross_revenue, discounts, refunds, net_revenue, cogs, shipping_costs"

/** Columns for shopify_daily_attribution */
const SHOPIFY_ATTRIBUTION_COLUMNS =
  "date, source, medium, orders, revenue"

export type ShopifyData = {
  orders: ShopifyDailyOrdersRow[]
  attribution: ShopifyAttributionRow[]
}

/**
 * Fetch Shopify daily orders and attribution data for a client within a date range.
 */
export async function fetchShopifyData(
  clientId: string,
  from: string,
  to: string
): Promise<ShopifyData> {
  try {
    const supabase = createServiceClient()

    const [orderRows, attributionRows] = await Promise.all([
      fetchAllRows<ShopifyDailyOrdersRow>(() =>
        supabase
          .from("shopify_daily_orders")
          .select(SHOPIFY_ORDERS_COLUMNS)
          .eq("client_id", clientId)
          .gte("date", from)
          .lte("date", to)
          .order("date")
      ),
      fetchAllRows<ShopifyAttributionRow>(() =>
        supabase
          .from("shopify_daily_attribution")
          .select(SHOPIFY_ATTRIBUTION_COLUMNS)
          .eq("client_id", clientId)
          .gte("date", from)
          .lte("date", to)
          .order("date")
      ),
    ])

    return {
      orders: orderRows,
      attribution: attributionRows,
    }
  } catch {
    return { orders: [], attribution: [] }
  }
}

/**
 * Fetch only Shopify daily orders for a client (lightweight, for blended metrics).
 */
export async function fetchShopifyOrders(
  clientId: string,
  from: string,
  to: string
): Promise<ShopifyDailyOrdersRow[]> {
  try {
    const supabase = createServiceClient()
    return await fetchAllRows<ShopifyDailyOrdersRow>(() =>
      supabase
        .from("shopify_daily_orders")
        .select(SHOPIFY_ORDERS_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
    )
  } catch {
    return []
  }
}
