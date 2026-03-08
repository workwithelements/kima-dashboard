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

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", params.id)
    .single()

  if (!client) notFound()

  return (
    <div className="space-y-6">
      <ClientHeader clientId={client.id} clientName={client.name} />
      {children}
    </div>
  )
}
