/**
 * Slack notification utility.
 * Uses an incoming webhook URL to post messages.
 *
 * Set SLACK_WEBHOOK_URL in your environment variables.
 */

export async function sendSlackMessage(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) {
    console.warn("[Slack] SLACK_WEBHOOK_URL not configured — skipping notification")
    return false
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })

    if (!res.ok) {
      console.error("[Slack] webhook failed:", res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error("[Slack] webhook error:", err)
    return false
  }
}
