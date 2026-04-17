import { Card } from "@/components/ui/card"
import { INSIGHTS, METHOD_NOTE, DATA_NOTES } from "@/lib/messaging/data"

export default function InsightsBlock() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h2 className="mb-4 text-base font-semibold text-white">Key Insights</h2>
        <ul className="space-y-3 text-sm text-neutral-300">
          {INSIGHTS.map((it, i) => (
            <li key={i} className="border-l-2 border-brand-lime/70 pl-3">
              <span className="font-medium text-white">{it.title}:</span>{" "}
              <span>{it.body}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-neutral-800 pt-3 text-xs italic text-neutral-500">
          Note: {METHOD_NOTE}
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-white">Data Notes</h2>
        <ul className="space-y-1.5 text-xs text-neutral-400">
          {DATA_NOTES.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
