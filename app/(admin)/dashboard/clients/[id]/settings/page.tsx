export const dynamic = "force-dynamic"

import ClientSettingsView from "@/components/dashboard/client-settings-view"

type Props = {
  params: { id: string }
}

export default function ClientSettingsPage({ params }: Props) {
  return <ClientSettingsView clientId={params.id} />
}
