import LoadingLogo from "@/components/ui/loading-logo"

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoadingLogo size="large" className="text-neutral-400" />
    </div>
  )
}
