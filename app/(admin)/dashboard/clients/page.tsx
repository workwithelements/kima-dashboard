import Link from "next/link"
import { fetchClientsList } from "@/lib/data/fetch-client-data"
import { Card } from "@/components/ui/card"
import { daysAgo, today } from "@/lib/utils/dates"
import { fmtCurrency, fmtNumber, fmtRoas } from "@/lib/utils/format"

export default async function ClientsPage() {
  const clients = await fetchClientsList(daysAgo(29), today())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Clients</h1>
        <p className="text-sm text-neutral-400">
          {clients.length} active client{clients.length !== 1 ? "s" : ""} &middot; Last 30 days
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => (
          <Link key={client.id} href={`/dashboard/clients/${client.id}`}>
            <Card className="transition hover:border-neutral-700 hover:bg-neutral-800/50">
              <h3 className="font-medium text-white">{client.name}</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Spend</p>
                  <p className="text-sm font-medium tabular-nums text-neutral-200">
                    {fmtCurrency(client.spend)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">ROAS</p>
                  <p className="text-sm font-medium tabular-nums text-neutral-200">
                    {client.roas > 0 ? fmtRoas(client.roas) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Impressions</p>
                  <p className="text-sm font-medium tabular-nums text-neutral-200">
                    {fmtNumber(client.impressions)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Purchases</p>
                  <p className="text-sm font-medium tabular-nums text-neutral-200">
                    {fmtNumber(client.purchases)}
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        ))}

        {clients.length === 0 && (
          <Card className="col-span-full">
            <p className="text-center text-sm text-neutral-500">
              No active clients found. Add clients to your Supabase database to get started.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
