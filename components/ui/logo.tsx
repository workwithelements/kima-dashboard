/**
 * Elements logo — the stylised X mark followed by "elements" wordmark.
 * Extracted from the brand asset. Renders as inline SVG so it can
 * inherit colour via `currentColor` or be overridden with `className`.
 */
export default function Logo({
  className = "",
  size = "default",
}: {
  className?: string
  size?: "small" | "default" | "large"
}) {
  const heights: Record<string, string> = {
    small: "h-5",
    default: "h-7",
    large: "h-10",
  }

  return (
    <svg
      viewBox="0 0 534 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${heights[size]} w-auto ${className}`}
    >
      {/* X mark — four rounded petals */}
      <path
        d="M50 0C50 0 58 20 70 30C80 20 100 20 100 20C100 20 80 28 70 40C80 52 100 80 100 80C100 80 80 60 70 50C58 60 50 80 50 80C50 80 42 60 30 50C20 60 0 80 0 80C0 80 20 52 30 40C20 28 0 20 0 20C0 20 20 20 30 30C42 20 50 0 50 0Z"
        fill="currentColor"
      />
      {/* "elements" wordmark */}
      <text
        x="120"
        y="64"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="500"
        fontSize="58"
        fill="currentColor"
        letterSpacing="-1"
      >
        elements
      </text>
    </svg>
  )
}
