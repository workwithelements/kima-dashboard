import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import ClientHeader from "@/components/ui/client-header"

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const supabase = createServiceClient()

  // Try with slug + marketing_impact_enabled first, fall back if columns don't exist yet
  let client: { id: string; name: string; slug?: string; marketing_impact_enabled?: boolean } | null = null
  const { data: full, error } = await supabase
    .from("clients")
    .select("id, name, slug, marketing_impact_enabled")
    .eq("id", params.id)
    .single()

  if (error && !full) {
    const { data: fallback } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", params.id)
      .single()
    client = fallback ? { ...fallback, slug: undefined, marketing_impact_enabled: undefined } : null
  } else {
    client = full
  }

  if (!client) notFound()

  // Check if creative tests are enabled for this client
  const { data: testConfig } = await supabase
    .from("creative_test_config")
    .select("enabled")
    .eq("client_id", params.id)
    .maybeSingle()

  const creativeTestsEnabled = testConfig?.enabled ?? false

  return (
    <div className="space-y-6">
      <ClientHeader clientId={client.id} clientName={client.name} slug={client.slug} creativeTestsEnabled={creativeTestsEnabled} marketingImpactEnabled={client.marketing_impact_enabled ?? false} />
      {children}
    </div>
  )
}
