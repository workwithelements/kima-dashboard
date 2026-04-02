"use client"

import { useState } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { fmtCurrency, fmtNumber, fmtRoas } from "@/lib/utils/format"
import AddClientModal from "./add-client-modal"

type ClientSummary = {
  id: string
  name: string
  spend: number
  roas: number
  impressions: number
  purchases: number
}

export default function ClientsPageContent({ clients }: { clients: ClientSummary[] }) {
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-neutral-400">
            {clients.length} active client{clients.length !== 1 ? "s" : ""} &middot; Last 30 days
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-lime px-3 py-2 text-sm font-medium text-neutral-900 transition hover:bg-brand-lime/90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Client
        </button>
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
              No active clients found. Click &quot;Add Client&quot; to get started.
            </p>
          </Card>
        )}
      </div>

      {showModal && <AddClientModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
