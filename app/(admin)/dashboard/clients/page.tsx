import { fetchClientsList } from "@/lib/data/fetch-client-data"
import { daysAgo, today } from "@/lib/utils/dates"
import ClientsPageContent from "@/components/dashboard/clients-page-content"

export default async function ClientsPage() {
  const clients = await fetchClientsList(daysAgo(29), today())

  return <ClientsPageContent clients={clients} />
}
