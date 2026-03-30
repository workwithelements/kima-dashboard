export const dynamic = "force-dynamic"

import { fetchCreativeTests } from "@/lib/data/fetch-creative-tests"
import CreativeTestsView from "@/components/dashboard/creative-tests-view"
import { notFound } from "next/navigation"

type Props = {
  params: { id: string }
}

export default async function CreativeTestsPage({ params }: Props) {
  const data = await fetchCreativeTests(params.id)
  if (!data) notFound()

  return (
    <CreativeTestsView
      tests={data.tests}
      results={data.results}
      config={data.config}
      thumbnails={data.thumbnails}
      currency={data.currency}
      keyAction={data.keyAction}
      clientId={params.id}
    />
  )
}
