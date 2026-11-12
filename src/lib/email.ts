import { isLeadRole } from '@/lib/roles'
import fs from 'fs'
import path from 'path'
import { Resend } from 'resend'
import { buildInvitationUrl } from '@/lib/invitation-link'
import {
  EMAIL_NOT_CONFIGURED_MESSAGE,
  EMAIL_QUOTA_EXHAUSTED_MESSAGE,
  emailProviderLimit,
  shouldRefundSlot,
  type MailAttemptOutcome,
} from '@/lib/email-quota-core'
import { releaseEmailSlots, reserveEmailSlots } from '@/lib/email-quota'

const resendApiKey = process.env.RESEND_API_KEY
const emailFrom = process.env.EMAIL_FROM || 'onboarding@resend.dev'
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const resend = resendApiKey ? new Resend(resendApiKey) : null

let logoBase64Cache: string | null | undefined

/** Logo nhúng base64 để gửi inline qua CID (hiển thị được ở mọi mail client) */
function getLogoBase64(): string | null {
  if (logoBase64Cache !== undefined) return logoBase64Cache
  try {
    const logoPath = path.join(process.cwd(), 'public', 'images', 'logo-white.png')
    logoBase64Cache = fs.readFileSync(logoPath).toString('base64')
  } catch {
    logoBase64Cache = null
  }
  return logoBase64Cache
}

export interface SendInvitationEmailParams {
  to: string
  role: 'LEAD' | 'DNA_LEAD' | 'MEMBER'
  chapterName?: string
  token: string
  expiresAt: Date
  /** Ngày UTC của slot mà người gọi đã đặt chỗ sẵn (gửi hàng loạt). Bỏ trống thì hàm tự đặt chỗ 1 slot. */
  slotDay?: string
}

export interface SendPasswordResetEmailParams {
  to: string
  token: string
  expiresAt: Date
}

export interface SendEmailResult {
  success: boolean
  error?: string
  /** Hết hạn mức ngày: không gọi Resend. Người gọi nên chuyển sang link mời. */
  quotaExhausted?: boolean
}

interface ResendPayload {
  subject: string
  html: string
  logoBase64: string | null
}

/**
 * Cửa duy nhất gọi Resend: mọi email đều phải có slot hạn mức. Nếu người gọi chưa đặt chỗ (`slotDay`),
 * hàm tự đặt 1 slot (lời mời theo hạn mức lời mời; mail hệ thống được dùng tới trần của nhà cung cấp).
 * Slot được giữ khi mail có thể đã đi, hoàn lại khi chắc chắn chưa gửi (xem shouldRefundSlot).
 */
async function sendThroughResend(
  kind: 'invitation' | 'password_reset',
  to: string,
  payload: ResendPayload,
  slotDay: string | undefined,
  mockSuccess: boolean,
): Promise<SendEmailResult> {
  let day = slotDay
  if (!day) {
    const reservation = await reserveEmailSlots(1, kind === 'password_reset'
      ? { cap: emailProviderLimit(), onError: 'allow' }
      : { onError: 'deny' })
    if (reservation.granted < 1) {
      console.warn(`[EMAIL] ${kind}: daily quota exhausted, email skipped`)
      return { success: false, error: EMAIL_QUOTA_EXHAUSTED_MESSAGE, quotaExhausted: true }
    }
    day = reservation.day
  }

  let outcome: MailAttemptOutcome
  let result: SendEmailResult
  if (!resend) {
    console.log('[EMAIL] RESEND_API_KEY not configured. Running in Mock/Log mode.')
    outcome = { kind: 'no_client' }
    result = mockSuccess ? { success: true } : { success: false, error: EMAIL_NOT_CONFIGURED_MESSAGE }
  } else {
    try {
      const { data, error } = await resend.emails.send({
        from: emailFrom,
        to: [to],
        subject: payload.subject,
        html: payload.html,
        attachments: payload.logoBase64
          ? [{ filename: 'logo-white.png', content: payload.logoBase64, contentType: 'image/png', contentId: 'bbe-logo-white' }]
          : undefined,
      })
      if (error) {
        console.error('[RESEND ERROR]:', error.name, error.message)
        outcome = { kind: 'api_error', statusCode: (error as { statusCode?: number | null }).statusCode }
        result = { success: false, error: error.message }
      } else {
        console.log('[RESEND SUCCESS] Email sent id:', data?.id)
        outcome = { kind: 'sent' }
        result = { success: true }
      }
    } catch (err: any) {
      console.error('[RESEND EXCEPTION]:', err?.message)
      outcome = { kind: 'exception' }
      result = { success: false, error: err?.message || 'Lỗi gửi email' }
    }
  }

  if (shouldRefundSlot(outcome)) await releaseEmailSlots(day, 1)
  return result
}

/**
 * Send an invitation email to a new Chapter Leader or Member
 */
export async function sendInvitationEmail(params: SendInvitationEmailParams): Promise<SendEmailResult> {
  const { to, role, chapterName, token, expiresAt, slotDay } = params
  const inviteUrl = buildInvitationUrl(token)
  const roleName = isLeadRole(role) ? 'Lead Chapter' : role === 'DNA_LEAD' ? 'Lead DNA' : 'Thành viên học tập'

  const logoBase64 = getLogoBase64()
  const logoSrc = logoBase64 ? 'cid:bbe-logo-white' : `${appUrl}/images/logo-white.png`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lời mời tham gia BBE E-Learning</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8f9ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8f9ff; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 20px rgba(23, 37, 84, 0.08); border: 1px solid #eff4ff;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #172554 0%, #2563EB 100%); padding: 36px 32px; text-align: center;">
              <img src="${logoSrc}" width="48" height="48" alt="BBE E-Learning" style="width: 48px; height: 48px; border-radius: 12px; margin: 0 auto 12px auto; display: block; object-fit: contain;" />
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">BBE E-Learning Platform</h1>
              <p style="color: #cbdbf5; font-size: 14px; margin: 6px 0 0 0;">Nền tảng đào tạo & phát triển nội bộ BBE</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="color: #172554; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">Xin chào,</h2>
              <p style="color: #434655; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
                Bạn đã được mời tham gia hệ thống đào tạo <strong>BBE E-Learning</strong> với vai trò <strong>${roleName}</strong>${chapterName ? ` tại <strong>${chapterName}</strong>` : ''}.
              </p>
              <p style="color: #434655; font-size: 15px; line-height: 1.6; margin: 0 0 28px 0;">
                Vui lòng bấm vào nút bên dưới để tạo mật khẩu và kích hoạt tài khoản của bạn:
              </p>

              <!-- CTA Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}" style="display: inline-block; background-color: #F97316; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 12px; box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);">
                      Kích hoạt tài khoản ngay →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #737686; font-size: 13px; line-height: 1.5; margin: 28px 0 0 0; text-align: center;">
                Liên kết này sẽ hết hạn vào <strong>${expiresAt.toLocaleString('vi-VN')}</strong> (trong vòng 24 giờ).
              </p>

              <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #eff4ff; word-break: break-all;">
                <p style="color: #737686; font-size: 12px; margin: 0 0 6px 0;">Nếu nút trên không hoạt động, vui lòng copy đường link sau vào trình duyệt:</p>
                <a href="${inviteUrl}" style="color: #2563EB; font-size: 12px;">${inviteUrl}</a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9ff; padding: 20px 32px; text-align: center; border-top: 1px solid #eff4ff;">
              <p style="color: #737686; font-size: 12px; margin: 0;">
                © BBE E-Learning Platform • Nếu bạn không yêu cầu email này, vui lòng bỏ qua.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

  console.log(`[EMAIL DISPATCH] invitation role=${role}`)
  return sendThroughResend('invitation', to, { subject: `[BBE E-Learning] Lời mời tham gia với vai trò ${roleName}`, html, logoBase64 }, slotDay, false)
}

/**
 * Send a password reset email
 */
export async function sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<SendEmailResult> {
  const { to, token, expiresAt } = params
  const resetUrl = `${appUrl}/reset-password?token=${token}`

  const logoBase64 = getLogoBase64()
  const logoSrc = logoBase64 ? 'cid:bbe-logo-white' : `${appUrl}/images/logo-white.png`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Đặt lại mật khẩu BBE E-Learning</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8f9ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8f9ff; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 20px rgba(23, 37, 84, 0.08); border: 1px solid #eff4ff;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #172554 0%, #2563EB 100%); padding: 36px 32px; text-align: center;">
              <img src="${logoSrc}" width="48" height="48" alt="BBE E-Learning" style="width: 48px; height: 48px; border-radius: 12px; margin: 0 auto 12px auto; display: block; object-fit: contain;" />
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">Đặt lại mật khẩu</h1>
              <p style="color: #cbdbf5; font-size: 14px; margin: 6px 0 0 0;">BBE E-Learning Platform</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="color: #172554; font-size: 20px; font-weight: 700; margin: 0 0 16px 0;">Xin chào,</h2>
              <p style="color: #434655; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
                Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản <strong>${to}</strong>.
              </p>
              <p style="color: #434655; font-size: 15px; line-height: 1.6; margin: 0 0 28px 0;">
                Bấm vào nút bên dưới để tiến hành tạo mật khẩu mới:
              </p>

              <!-- CTA Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" style="display: inline-block; background-color: #2563EB; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 12px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                      Đặt lại mật khẩu →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #737686; font-size: 13px; line-height: 1.5; margin: 28px 0 0 0; text-align: center;">
                Liên kết này có hiệu lực trong vòng <strong>15 phút</strong> (hết hạn lúc ${expiresAt.toLocaleTimeString('vi-VN')}).
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9ff; padding: 20px 32px; text-align: center; border-top: 1px solid #eff4ff;">
              <p style="color: #737686; font-size: 12px; margin: 0;">
                Nếu bạn không gửi yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

  console.log('[PASSWORD RESET DISPATCH]')
  return sendThroughResend('password_reset', to, { subject: '[BBE E-Learning] Yêu cầu đặt lại mật khẩu', html, logoBase64 }, undefined, true)
}
