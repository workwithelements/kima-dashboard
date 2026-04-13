export const dynamic = "force-dynamic"

import MetaImpactView from "@/components/dashboard/meta-impact-view"

type Props = {
  params: { id: string }
}

export default function MetaImpactPage({ params }: Props) {
  return <MetaImpactView clientId={params.id} />
}
