import { redirect } from "next/navigation"

type Props = {
  params: { id: string }
  searchParams: Record<string, string | string[] | undefined>
}

export default function CreativeAnalysisPage({ params, searchParams }: Props) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v))
    else if (value !== undefined) qs.set(key, value)
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  redirect(`/dashboard/clients/${params.id}${suffix}`)
}
