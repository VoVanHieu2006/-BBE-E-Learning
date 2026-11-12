/** Link kích hoạt tài khoản của một lời mời. Chứa token thật: không được in ra màn hình hay log. */
export function buildInvitationUrl(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${appUrl}/accept-invitation?token=${token}`
}
