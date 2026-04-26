/**
 * lib/email.ts
 * Shared HTML email template wrapper for all SuperHeroCPR transactional emails.
 *
 * Usage:
 *   import { wrapEmail } from "@/lib/email";
 *   html: wrapEmail(`<h1>Hello!</h1><p>Your content here.</p>`)
 *
 * The wrapper provides:
 *   - A branded header with the SuperHeroCPR logo text
 *   - A centered white card body (600px max-width)
 *   - A footer with contact info and copyright
 *   - Base typography styles via a <style> block in the body (supported by Gmail
 *     since 2016 and all other major email clients)
 *
 * Email client compatibility: Gmail, Apple Mail, Outlook 2016+, Yahoo Mail.
 * Table-based outer layout is used for maximum Outlook compatibility.
 */

/**
 * Wraps email body HTML in the SuperHeroCPR branded email shell.
 * @param content - Inner HTML content for the email body (h1, p, a, table, etc.)
 * @returns A complete HTML email document ready to pass to Resend's `html` field.
 */
export function wrapEmail(content: string): string {
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!-- Base typography — placed in body for Gmail compatibility -->
  <style>
    h1 { font-size:22px; font-weight:700; color:#111827; margin:0 0 16px 0; }
    h2 { font-size:18px; font-weight:700; color:#111827; margin:0 0 12px 0; }
    h3 { font-size:15px; font-weight:600; color:#374151; margin:16px 0 8px 0; }
    p  { margin:0 0 12px 0; color:#374151; font-size:15px; line-height:1.6; }
    a  { color:#dc2626; }
    ul, ol { margin:0 0 12px 0; padding-left:20px; }
    li { margin-bottom:4px; color:#374151; font-size:15px; }
    strong { color:#111827; }
  </style>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Branded header -->
          <tr>
            <td style="background-color:#111827;padding:20px 32px;border-radius:8px 8px 0 0;">
              <span style="font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
                SuperHero<span style="color:#dc2626;">CPR</span>
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px;font-size:15px;line-height:1.6;color:#374151;font-family:Arial,Helvetica,sans-serif;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;border-radius:0 0 8px 8px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">Questions? We&rsquo;re here to help.</p>
              <p style="margin:0 0 4px 0;font-size:13px;color:#374151;">
                <a href="mailto:info@superherocpr.com" style="color:#dc2626;text-decoration:none;">info@superherocpr.com</a>
                &nbsp;&middot;&nbsp;
                <a href="tel:+18139663969" style="color:#dc2626;text-decoration:none;">(813) 966-3969</a>
              </p>
              <p style="margin:8px 0 0 0;font-size:12px;color:#9ca3af;">&copy; ${year} SuperHeroCPR. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`.trim();
}
