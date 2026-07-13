/**
 * The single admin account — gates team management and LTV-assumption edits.
 * Kept free of server-only imports so client components can use it too.
 */
export const ADMIN_EMAIL = "tom@workwithelements.com"

export function isAdminEmail(email: string | null | undefined): boolean {
  return email === ADMIN_EMAIL
}
