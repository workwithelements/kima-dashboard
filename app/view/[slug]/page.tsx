import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/server"
import ClientDashboard from "./client-dashboard"
import PasswordGate from "./password-gate"

type Props = {
  params: { slug: string }
}

export default async function ClientViewPage({ params }: Props) {
  const { slug } = params
  const supabase = createServiceClient()

  // Look up client by slug
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, view_password_hash, slug")
    .eq("slug", slug)
    .single()

  if (!client) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-neutral-400">Report not found.</p>
      </div>
    )
  }

  // Check if user has already authenticated via cookie
  const cookieStore = cookies()
  const authCookie = cookieStore.get(`kima_view_${slug}`)
  const isAuthenticated = authCookie?.value === client.view_password_hash

  if (!isAuthenticated) {
    return <PasswordGate slug={slug} clientName={client.name} />
  }

  // Fetch last 30 days of Meta data for this client
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const fromDate = thirtyDaysAgo.toISOString().split("T")[0]

  const { data: metaRows } = await supabase
    .from("meta_daily_performance")
    .select("date, spend, impressions, unique_link_clicks, purchases, purchase_value")
    .eq("client_id", client.id)
    .gte("date", fromDate)
    .order("date")

  return <ClientDashboard clientName={client.name} data={metaRows || []} />
}
