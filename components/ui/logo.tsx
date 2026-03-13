/**
 * Elements logo — the stylised X mark followed by "elements" wordmark.
 * The X is a quatrefoil rotated 45° with concave indentations.
 * Renders as inline SVG so it inherits colour via `currentColor`.
 */

/** Shared X-mark path used by both Logo and LoadingLogo */
export const LOGO_X_PATH =
  "M82,18 C84,32 72,38 65,50 C72,62 84,68 82,82 C68,84 62,72 50,65 C38,72 32,84 18,82 C16,68 28,62 35,50 C28,38 16,32 18,18 C32,16 38,28 50,35 C62,28 68,16 82,18Z"

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
      {/* X mark — four rounded petals with concave indents */}
      <path d={LOGO_X_PATH} fill="currentColor" />
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
