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

  // Try with slug first, fall back without it if the column doesn't exist yet
  let client: { id: string; name: string; slug?: string } | null = null
  const { data: full, error } = await supabase
    .from("clients")
    .select("id, name, slug")
    .eq("id", params.id)
    .single()

  if (error && !full) {
    const { data: fallback } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", params.id)
      .single()
    client = fallback ? { ...fallback, slug: undefined } : null
  } else {
    client = full
  }

  if (!client) notFound()

  return (
    <div className="space-y-6">
      <ClientHeader clientId={client.id} clientName={client.name} slug={client.slug} />
      {children}
    </div>
  )
}
