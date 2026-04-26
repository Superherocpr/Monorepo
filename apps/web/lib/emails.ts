/**
 * lib/emails.ts
 * Central repository for all transactional email content used by SuperHeroCPR.
 *
 * Every email sent by the system is defined here as a named function that
 * accepts the data it needs and returns { subject, html }. Route files are
 * responsible for fetching data, checking RESEND_API_KEY, and calling Resend.
 * This file has no knowledge of Resend, HTTP, or Supabase.
 *
 * To edit email copy: find the function by name, change the template string.
 * To add a new email: add a new exported function following the same pattern.
 *
 * All functions call wrapEmail() internally so output is always branded.
 * escapeHtml() is a private helper used only within this file to sanitize
 * user-supplied values before inserting them into HTML.
 */

import { wrapEmail } from "@/lib/email";

// ── Private helpers ────────────────────────────────────────────────────────────

/** Escapes HTML special characters to prevent injection in email bodies. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ── Return type shared by all email builders ───────────────────────────────────

export interface EmailContent {
  subject: string;
  html: string;
}

// ── 1. Welcome email (new account via public booking flow) ─────────────────────

/**
 * Sent to a newly created customer after they create an account in the booking flow.
 * Triggered by: POST /api/emails/welcome
 * @param firstName - The customer's first name.
 */
export function welcomeEmail({ firstName }: { firstName: string }): EmailContent {
  return {
    subject: "Welcome to SuperHeroCPR!",
    html: wrapEmail(`
      <h1>Welcome, ${firstName}!</h1>
      <p>Your SuperHeroCPR account has been created successfully.</p>
      <p>You can now book classes, view your certifications, and manage your account at
        <a href="https://superherocpr.com/dashboard">superherocpr.com</a>.
      </p>
      <p>See you in class!</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 2. Rollcall welcome email (new student checked in at class) ────────────────

/**
 * Sent to a new student after they create an account on the rollcall check-in page.
 * Triggered by: POST /api/rollcall/register
 * @param firstName - The student's first name.
 */
export function rollcallWelcomeEmail({ firstName }: { firstName: string }): EmailContent {
  const safeFirstName = escapeHtml(firstName.trim());

  const content = `
    <style type="text/css">
#outlook a { padding:0; }
.ExternalClass { width:100%; }
.ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height:100%; }
.es-button { mso-style-priority:100!important; text-decoration:none!important; }
a[x-apple-data-detectors] { color:inherit!important; text-decoration:none!important; font-size:inherit!important; font-family:inherit!important; font-weight:inherit!important; line-height:inherit!important; }
.es-desk-hidden { display:none; float:left; overflow:hidden; width:0; max-height:0; line-height:0; mso-hide:all; }
[data-ogsb] .es-button { border-width:0!important; padding:5px 30px 5px 30px!important; }
@media only screen and (max-width:600px) {
  p, ul li, ol li, a { line-height:150%!important }
  h1 { font-size:30px!important; text-align:center; line-height:120%!important }
  h2 { font-size:26px!important; text-align:center; line-height:120%!important }
  h3 { font-size:20px!important; text-align:center; line-height:120%!important }
  .es-menu td a { font-size:13px!important }
  .es-header-body p, .es-header-body ul li, .es-header-body ol li, .es-header-body a { font-size:16px!important }
  .es-content-body p, .es-content-body ul li, .es-content-body ol li, .es-content-body a { font-size:16px!important }
  .es-footer-body p, .es-footer-body ul li, .es-footer-body ol li, .es-footer-body a { font-size:16px!important }
  .es-infoblock p, .es-infoblock ul li, .es-infoblock ol li, .es-infoblock a { font-size:12px!important }
  *[class="gmail-fix"] { display:none!important }
  .es-m-txt-c, .es-m-txt-c h1, .es-m-txt-c h2, .es-m-txt-c h3 { text-align:center!important }
  .es-m-txt-r, .es-m-txt-r h1, .es-m-txt-r h2, .es-m-txt-r h3 { text-align:right!important }
  .es-m-txt-l, .es-m-txt-l h1, .es-m-txt-l h2, .es-m-txt-l h3 { text-align:left!important }
  .es-m-txt-r img, .es-m-txt-c img, .es-m-txt-l img { display:inline!important }
  .es-button-border { display:block!important }
  .es-btn-fw { border-width:10px 0px!important; text-align:center!important }
  .es-adaptive table, .es-btn-fw, .es-btn-fw-brdr, .es-left, .es-right { width:100%!important }
  .es-content table, .es-header table, .es-footer table, .es-content, .es-footer, .es-header { width:100%!important; max-width:600px!important }
  .es-adapt-td { display:block!important; width:100%!important }
  .adapt-img { width:100%!important; height:auto!important }
  .es-m-p0 { padding:0px!important }
  .es-m-p0r { padding-right:0px!important }
  .es-m-p0l { padding-left:0px!important }
  .es-m-p0t { padding-top:0px!important }
  .es-m-p0b { padding-bottom:0!important }
  .es-m-p20b { padding-bottom:20px!important }
  .es-mobile-hidden, .es-hidden { display:none!important }
  tr.es-desk-hidden, td.es-desk-hidden, table.es-desk-hidden { width:auto!important; overflow:visible!important; float:none!important; max-height:inherit!important; line-height:inherit!important }
  tr.es-desk-hidden { display:table-row!important }
  table.es-desk-hidden { display:table!important }
  td.es-desk-menu-hidden { display:table-cell!important }
  .es-menu td { width:1%!important }
  table.es-table-not-adapt, .esd-block-html table { width:auto!important }
  table.es-social { display:inline-block!important }
  table.es-social td { display:inline-block!important }
  a.es-button, button.es-button { font-size:16px!important; display:block!important; border-width:10px 0px 10px 0px!important }
}
    </style>

    <div class="es-wrapper-color" style="background-color:#FFFFFF">
      <table class="es-wrapper" width="100%" cellspacing="0" cellpadding="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;padding:0;Margin:0;width:100%;height:100%;background-repeat:repeat;background-position:center top;background-color:#FFFFFF">
        <tr style="border-collapse:collapse">
          <td valign="top" style="padding:0;Margin:0">
            <!-- Header content removed: copyright, view-in-browser link, logo image and menu removed to rely on global wrapper banner -->

            <!-- Main content from Welcome Hero (brand normalized) -->
            <table class="es-content" cellspacing="0" cellpadding="0" align="center" style="table-layout:fixed !important;width:100%">
              <tr>
                <td align="center" style="padding:0;Margin:0">
                  <table class="es-content-body" cellspacing="0" cellpadding="0" bgcolor="#ffffff" align="center" style="background-color:#FFFFFF;width:600px">
                    <tr>
                      <td align="left" bgcolor="#ffffff" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px;background-color:#ffffff">
                        <table width="100%" cellspacing="0" cellpadding="0">
                          <tr>
                            <td valign="top" align="center" style="padding:0;Margin:0;width:560px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><p style="Margin:0;line-height:21px;color:#333333;font-size:14px"><strong>SuperHeroCPR</strong></p></td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><h2 style="Margin:0;line-height:29px;font-size:24px;color:#e1261d">Welcomes You New Hero!</h2></td>
                                </tr>
                                <tr>
                                  <td class="es-m-txt-c" align="left" style="padding:0;Margin:0;padding-top:10px"><h1 style="font-size:22px;margin:8px 0">Welcome, ${safeFirstName}!</h1><p style="Margin:0;line-height:21px;color:#000000;font-size:14px">Today you have taken an important step. Getting educated on proper CPR practices is the first step to saving the life of someone choking, having a heart attack or any other cardio or pulmonary problems.</p></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Image / CTA -->
            <table cellpadding="0" cellspacing="0" class="es-content" align="center" style="width:100%">
              <tr>
                <td align="center" style="padding:0;Margin:0">
                  <table bgcolor="#ffffff" class="es-content-body" align="center" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;width:600px">
                    <tr>
                      <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                              <table cellpadding="0" cellspacing="0" width="100%" role="presentation">
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><a target="_blank" href="https://youtu.be/JeIjJqi6WuM" style="text-decoration:underline;color:#333333;font-size:14px"><img class="adapt-img" src="https://obwshc.stripocdn.email/content/guids/videoImgGuid/images/93271603261079653.png" alt="Welcome New Heroes!" width="560" title="Welcome New Heroes!" height="315" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Two column feature area -->
            <table class="es-content" cellspacing="0" cellpadding="0" align="center">
              <tr>
                <td align="center" style="padding:0;Margin:0">
                  <table class="es-content-body" cellspacing="0" cellpadding="0" bgcolor="#ffffff" align="center" style="background-color:#FFFFFF;width:600px">
                    <tr>
                      <td align="left" style="padding:20px;Margin:0">
                        <table class="es-left" cellspacing="0" cellpadding="0" align="left" style="float:left">
                          <tr>
                            <td class="es-m-p20b" align="left" style="padding:0;Margin:0;width:270px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr>
                                  <td align="center" style="padding:0;Margin:0;font-size:0px"><img class="adapt-img" src="https://superherocpr.com/wp-content/uploads/2015/10/chest-and-hands.jpg" alt style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic" width="270" height="280"></td>
                                </tr>
                                <tr>
                                  <td align="left" style="padding:0;Margin:0;padding-bottom:10px;padding-top:15px"><h3 style="Margin:0;line-height:24px;font-size:20px;color:#e1261d"><strong style="color:#e1261d">Our Instructors</strong></h3></td>
                                </tr>
                                <tr>
                                  <td class="es-m-txt-c" align="left" style="padding:0;Margin:0;padding-bottom:20px"><p style="Margin:0;line-height:21px;color:#333333;font-size:14px">There's a saying, "<strong><em><span>Those who can't do, teach</span></em></strong>". Well, here at <strong><span>SuperHeroCPR</span></strong> our instructors not only teach, but they <strong><span>do</span></strong>! in fact, they "do" regularly.</p><p style="Margin:0;line-height:21px;color:#333333;font-size:14px">You can trust that the information is not only <strong><span>up-to-date</span></strong> in theory but also in practice. And we get A LOT of practice. With <strong><em><span>THOUSANDS</span></em></strong> <em><span>of documented CPR performances</span></em> on real patients, we do, did, and done!!</p><p style="Margin:0;line-height:21px;color:#333333;font-size:14px">Now it's <strong><span>YOUR</span></strong> time to <a target="_blank" href="https://superherocpr.com/" style="text-decoration:underline;color:#333333;font-size:14px">JOIN US!</a> We need your help to keep your family safe.</p></td>
                                </tr>
                                <tr>
                                  <td align="left" style="padding:0;Margin:0"><span class="es-button-border" style="border-style:solid;border-color:#808080;background:#FFFFFF;border-width:2px;display:inline-block;border-radius:0px;width:auto"><a href="https://superherocpr.com" class="es-button" target="_blank" style="color:#cc0000;font-size:16px;border-style:solid;border-color:#FFFFFF;border-width:5px 30px 5px 30px;display:inline-block;background:#FFFFFF;border-radius:0px;font-weight:bold;line-height:19px;width:auto;text-align:center">Join Us</a></span></td>
                                </tr>
                              </table>
                            </td>
                            <table class="es-right" cellspacing="0" cellpadding="0" align="right" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;float:right">
                              <tr>
                                <td class="es-m-p20b" align="left" style="padding:0;Margin:0;width:270px">
                                  <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                    <tr>
                                      <td align="center" style="padding:0;Margin:0;font-size:0px"><img class="adapt-img" src="https://obwshc.stripocdn.email/content/guids/CABINET_c143c7474ec05d89e957df59017bdab5/images/29811603252019707.jpg" alt style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic" width="270" height="188"></td>
                                    </tr>
                                    <tr>
                                      <td align="left" style="padding:0;Margin:0;padding-bottom:10px;padding-top:15px"><h3 style="Margin:0;line-height:24px;font-size:20px;color:#e1261d"><strong style="color:#e1261d">The JUST - US League</strong></h3></td>
                                    </tr>
                                    <tr>
                                      <td class="es-m-txt-c" align="left" style="padding:0;Margin:0;padding-bottom:20px"><p style="Margin:0;line-height:21px;color:#333333;font-size:14px">The <strong><span>JUST - US League</span></strong> is an <em><span>elite group</span></em> of super-secret, highly intelligent, extremely special individuals, not like you or me.</p><p style="Margin:0;line-height:21px;color:#333333;font-size:14px">So I guess <strong><em><span>&nbsp;it's not-so-super-secret&nbsp;</span></em></strong>and <strong><span>they are exactly like you and me</span></strong>. But they <em><span>are </span></em><strong><em><span>SPECIAL</span></em></strong>. Why?...</p><p style="Margin:0;line-height:21px;color:#333333;font-size:14px">Because <strong><span>they made the choice to become a hero</span></strong>. Always <strong><span>&nbsp;ready to save a life</span></strong> if there is a cardiac emergency. <strong><em><span>Will you stand with them?</span></em></strong></p></td>
                                    </tr>
                                    <tr>
                                      <td align="left" style="padding:0;Margin:0"><span class="es-button-border" style="border-style:solid;border-color:#808080;background:#f0f0f0;border-width:2px;display:inline-block;border-radius:0px;width:auto"><a href="https://superherocpr.com" class="es-button" target="_blank" style="color:#E1261D;font-size:16px;border-style:solid;border-color:#FFFFFF;border-width:5px 30px 5px 30px;display:inline-block;background:#FFFFFF;border-radius:0px;font-weight:bold;line-height:19px;width:auto;text-align:center">JUST-US</a></span></td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Small image grid + Young Heroes (restored from template) -->
            <table cellpadding="0" cellspacing="0" class="es-content" align="center" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;table-layout:fixed !important;width:100%">
              <tr style="border-collapse:collapse">
                <td align="center" style="padding:0;Margin:0">
                  <table class="es-content-body" cellspacing="0" cellpadding="0" bgcolor="#ffffff" align="center" style="background-color:#FFFFFF;width:600px">
                    <tr style="border-collapse:collapse">
                      <td align="left" style="padding:20px;Margin:0">
                        <!--[if mso]><table style="width:560px" cellpadding="0" cellspacing="0"><tr><td style="width:145px" valign="top"><![endif]-->
                        <table class="es-left" cellspacing="0" cellpadding="0" align="left" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;float:left">
                          <tr style="border-collapse:collapse">
                            <td align="left" style="padding:0;Margin:0;width:125px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr style="border-collapse:collapse">
                                  <td align="center" style="padding:0;Margin:0;padding-bottom:20px;font-size:0px"><img src="https://obwshc.stripocdn.email/content/guids/CABINET_c143c7474ec05d89e957df59017bdab5/images/11491603258010118.jpg" alt class="adapt-img" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic" width="125" height="88"></td>
                                </tr>
                              </table>
                            </td>
                            <td style="padding:0;Margin:0;width:20px"></td>
                            <td align="left" style="padding:0;Margin:0;width:125px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr style="border-collapse:collapse">
                                  <td align="center" style="padding:0;Margin:0;padding-bottom:20px;font-size:0px"><img src="https://obwshc.stripocdn.email/content/guids/CABINET_c143c7474ec05d89e957df59017bdab5/images/22921603258025841.jpg" alt class="adapt-img" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic" width="125" height="88"></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          <tr style="border-collapse:collapse">
                            <td align="left" style="padding:0;Margin:0;width:125px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr style="border-collapse:collapse">
                                  <td align="center" style="padding:0;Margin:0;padding-bottom:20px;font-size:0px"><img src="https://obwshc.stripocdn.email/content/guids/CABINET_c143c7474ec05d89e957df59017bdab5/images/1251603258042066.jpg" alt class="adapt-img" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic" width="125" height="88"></td>
                                </tr>
                              </table>
                            </td>
                            <td style="padding:0;Margin:0;width:20px"></td>
                            <td align="left" style="padding:0;Margin:0;width:125px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr style="border-collapse:collapse">
                                  <td align="center" style="padding:0;Margin:0;padding-bottom:20px;font-size:0px"><img src="https://obwshc.stripocdn.email/content/guids/CABINET_c143c7474ec05d89e957df59017bdab5/images/18391603258153322.jpg" alt class="adapt-img" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic" width="125" height="88"></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!--[if mso]></td><td style="width:125px"></td><td style="width:125px" valign="top"><![endif]-->
                        <table class="es-right" cellspacing="0" cellpadding="0" align="right" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;float:right">
                          <tr style="border-collapse:collapse">
                            <td class="es-m-p20b" align="left" style="padding:0;Margin:0;width:270px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr style="border-collapse:collapse">
                                  <td align="left" style="padding:0;Margin:0;padding-top:5px"><h2 style="Margin:0;line-height:26px;font-size:22px;color:#e1261d"><strong style="color:#e1261d">Young Heroes<span style="font-size:24px"></span>!</strong></h2></td>
                                </tr>
                                <tr style="border-collapse:collapse">
                                  <td class="es-m-txt-c" align="left" style="padding:0;Margin:0;padding-top:10px;padding-bottom:10px"><p style="Margin:0;line-height:21px;color:#000000;font-size:14px">There's one thing the <strong>JUST - US League</strong> doesn't have... and thats <em><strong>SIDE-KICKS!</strong></em><br><br>These <strong>HEROES</strong> might be young, but they <strong>DON'T</strong> play second fiddle. They are equipped with the skills <em><strong>to save a life!</strong></em></p></td>
                                </tr>
                                <tr style="border-collapse:collapse">
                                  <td class="es-m-txt-c" align="left" style="padding:0;Margin:0"><p style="Margin:0;line-height:21px;color:#333333;font-size:14px"><u>Learn</u><a href="https://superherocpr.com" target="_blank" style="text-decoration:underline;color:#333333;font-size:14px">&nbsp;More +</a></p></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!--[if mso]></td></tr></table><![endif]--></td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Footer -->
            <table cellpadding="0" cellspacing="0" class="es-footer" align="center" style="width:100%;background-color:transparent;background-repeat:repeat;background-position:center top">
              <tr>
                <td align="center" style="padding:0;Margin:0">
                  <table class="es-footer-body" style="background-color:#333333;width:600px" cellspacing="0" cellpadding="0" bgcolor="#333333" align="center">
                    <tr>
                      <td align="left" style="padding:20px;Margin:0">
                        <table width="100%" cellspacing="0" cellpadding="0">
                          <tr>
                            <td valign="top" align="center" style="padding:0;Margin:0;width:560px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><h3 style="Margin:0;line-height:30px;font-size:20px;color:#ffffff">Let's get social!</h3></td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:10px;font-size:0px">
                                    <table class="es-table-not-adapt es-social" cellspacing="0" cellpadding="0" role="presentation">
                                      <tr>
                                        <td valign="top" align="center" style="padding:0;Margin:0;padding-right:20px"><a href="https://www.facebook.com/1HeroWay/" style="text-decoration:underline;color:#FFFFFF;font-size:14px"><img title="Facebook" src="https://obwshc.stripocdn.email/content/assets/img/social-icons/logo-gray/facebook-logo-gray.png" alt="Fb" width="32" height="32" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a></td>
                                        <td valign="top" align="center" style="padding:0;Margin:0"><a href="https://www.youtube.com/channel/UCuRG_ZiO1WoOXZxyRzgTDxA" style="text-decoration:underline;color:#FFFFFF;font-size:14px"><img title="Youtube" src="https://obwshc.stripocdn.email/content/assets/img/social-icons/logo-gray/youtube-logo-gray.png" alt="Yt" width="32" height="32" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a></td>
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:10px"><p style="Margin:0;color:#FFFFFF;font-size:14px">© ${new Date().getFullYear()}&nbsp;SuperHeroCPR</p></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>
    </div>
  `;

  return {
    subject: "Welcome to SuperHeroCPR!",
    html: wrapEmail(content),
  };
}

// ── 3. Contact form — business notification ────────────────────────────────────

/**
 * Sent to info@superherocpr.com when a visitor submits the public contact form.
 * All user-supplied values are escaped before insertion.
 * Triggered by: POST /api/contact
 * @param name        - Submitter's full name.
 * @param email       - Submitter's email address.
 * @param phone       - Submitter's phone number (null if not provided).
 * @param inquiryType - Selected inquiry category.
 * @param message     - The message body.
 */
export function contactNotificationEmail({
  name,
  email,
  phone,
  inquiryType,
  message,
}: {
  name: string;
  email: string;
  phone: string | null;
  inquiryType: string;
  message: string;
}): EmailContent {
  const safeName        = escapeHtml(name.trim());
  const safeEmail       = escapeHtml(email.trim());
  const safePhone       = escapeHtml(phone ?? "Not provided");
  const safeInquiryType = escapeHtml(inquiryType.trim());
  // Preserve newlines as <br> tags for readability in the email client
  const safeMessage     = escapeHtml(message.trim()).replace(/\n/g, "<br>");

  return {
    subject: `New Contact Form Submission — ${inquiryType.trim()}`,
    html: wrapEmail(`
      <h2>New contact form submission</h2>
      <table>
        <tr><td><strong>Name:</strong></td><td>${safeName}</td></tr>
        <tr><td><strong>Email:</strong></td><td>${safeEmail}</td></tr>
        <tr><td><strong>Phone:</strong></td><td>${safePhone}</td></tr>
        <tr><td><strong>Inquiry type:</strong></td><td>${safeInquiryType}</td></tr>
      </table>
      <h3>Message:</h3>
      <p>${safeMessage}</p>
    `),
  };
}

// ── 4. Contact form — auto-reply to submitter ──────────────────────────────────

/**
 * Sent to the person who submitted the contact form to confirm receipt.
 * Triggered by: POST /api/contact
 * @param firstName - Submitter's first name (extracted from their full name).
 */
export function contactAutoReplyEmail({ firstName }: { firstName: string }): EmailContent {
  const safeFirstName = escapeHtml(firstName);

  return {
    subject: "We received your message — SuperHeroCPR",
    html: wrapEmail(`
      <h1>Thanks for reaching out, ${safeFirstName}!</h1>
      <p>We received your message and will get back to you within 1 business day.</p>
      <p>If your matter is urgent, you can also reach us at:</p>
      <ul>
        <li>Phone: <a href="tel:+18139663969">(813) 966-3969</a></li>
        <li>Email: <a href="mailto:info@superherocpr.com">info@superherocpr.com</a></li>
      </ul>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 5. Account deleted confirmation ───────────────────────────────────────────

/**
 * Sent to a customer after their account has been archived (deleted).
 * Triggered by: POST /api/account/archive
 * @param firstName - The customer's first name (from their profile).
 */
export function accountDeletedEmail({ firstName }: { firstName: string }): EmailContent {
  return {
    subject: "Your SuperHeroCPR account has been deleted",
    html: wrapEmail(`
      <h1>Account Deleted</h1>
      <p>Hi ${firstName},</p>
      <p>Your SuperHeroCPR account has been successfully deleted. You will no longer be able to log in.</p>
      <p>Your certification history has been preserved for our records.</p>
      <p>If you believe this was a mistake or wish to restore your account, please contact us at
        <a href="mailto:info@superherocpr.com">info@superherocpr.com</a> or call (813) 966-3969.
      </p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 6. Order shipped ───────────────────────────────────────────────────────────

/** A single line item in a shipped order email. */
export interface OrderEmailItem {
  productName: string;
  size: string;
  quantity: number;
  priceAtPurchase: number;
}

/**
 * Sent to a customer when an admin marks their merch order as shipped.
 * Builds the order summary table internally from the items array.
 * Triggered by: POST /api/orders/mark-shipped
 * @param firstName     - Customer's first name.
 * @param trackingNumber - Shipping tracking number.
 * @param carrier       - Carrier name (optional).
 * @param items         - Array of line items in the order.
 * @param totalAmount   - Order total in dollars.
 * @param shippingName  - Recipient name on the shipping address.
 * @param shippingCity  - Shipping city.
 * @param shippingState - Shipping state.
 */
export function orderShippedEmail({
  firstName,
  trackingNumber,
  carrier,
  items,
  totalAmount,
  shippingName,
  shippingCity,
  shippingState,
}: {
  firstName: string;
  trackingNumber: string;
  carrier: string | null;
  items: OrderEmailItem[];
  totalAmount: number;
  shippingName: string;
  shippingCity: string;
  shippingState: string;
}): EmailContent {
  const carrierLine = carrier
    ? `<p><strong>Carrier:</strong> ${carrier}</p>`
    : "";

  const itemsHtml = items
    .map(
      (item) => `<tr>
        <td style="padding:4px 8px">${item.productName}</td>
        <td style="padding:4px 8px">${item.size}</td>
        <td style="padding:4px 8px;text-align:center">${item.quantity}</td>
        <td style="padding:4px 8px;text-align:right">$${item.priceAtPurchase.toFixed(2)}</td>
      </tr>`
    )
    .join("");

  return {
    subject: "Your SuperHeroCPR order has shipped!",
    html: wrapEmail(`
      <h1>Your order is on the way, ${firstName}!</h1>
      <p>Your SuperHeroCPR order has shipped.</p>
      <p><strong>Tracking number:</strong> ${trackingNumber}</p>
      ${carrierLine}
      <h3>Your order:</h3>
      <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:4px 8px;text-align:left">Product</th>
            <th style="padding:4px 8px;text-align:left">Size</th>
            <th style="padding:4px 8px;text-align:center">Qty</th>
            <th style="padding:4px 8px;text-align:right">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin-top:12px"><strong>Order Total: $${totalAmount.toFixed(2)}</strong></p>
      <p>Shipping to: ${shippingName}, ${shippingCity}, ${shippingState}</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 7. Staff invite ────────────────────────────────────────────────────────────

/**
 * Sent to a newly invited staff member with their account setup link.
 * User-supplied values (firstName, personalMessage, roleLabel) are escaped.
 * Triggered by: POST /api/staff/invite
 * @param firstName       - Staff member's first name.
 * @param personalMessage - Optional personal message from the inviting admin.
 * @param roleLabel       - Human-readable role string (e.g. "Instructor").
 * @param actionLink      - Supabase-generated password setup link.
 * @param isInstructor    - Whether to show the payment account setup reminder.
 */
export function staffInviteEmail({
  firstName,
  personalMessage,
  roleLabel,
  actionLink,
  isInstructor,
}: {
  firstName: string;
  personalMessage: string | null;
  roleLabel: string;
  actionLink: string;
  isInstructor: boolean;
}): EmailContent {
  const safePersonalMessage = personalMessage?.trim()
    ? `<p>${escapeHtml(personalMessage.trim())}</p>`
    : "";

  const instructorNote = isInstructor
    ? `<p><strong>Important:</strong> Once you log in, you'll need to connect a payment account
       before you can send invoices. Visit Admin → Settings → Payment to get set up.</p>`
    : "";

  return {
    subject: "You've been invited to join SuperHeroCPR",
    html: wrapEmail(`
      <h1>Welcome to the SuperHeroCPR team, ${escapeHtml(firstName.trim())}!</h1>
      ${safePersonalMessage}
      <p>Your account has been created with the role of <strong>${escapeHtml(roleLabel)}</strong>.</p>
      <p>Click the link below to set your password and activate your account.</p>
      <p><a href="${actionLink}">Set My Password →</a></p>
      <p>This link expires in 24 hours.</p>
      ${instructorNote}
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 8. Customer setup email (created by admin) ─────────────────────────────────

/**
 * Sent to a new customer when an admin creates their account manually.
 * Triggered by: POST /api/customers/create
 * @param firstName - Customer's first name.
 * @param setupLink - Supabase-generated password setup link.
 */
export function customerSetupEmail({
  firstName,
  setupLink,
}: {
  firstName: string;
  setupLink: string;
}): EmailContent {
  return {
    subject: "Set up your SuperHeroCPR account",
    html: wrapEmail(`
      <h1>Welcome to SuperHeroCPR, ${firstName}!</h1>
      <p>An account has been created for you. Click the link below to set your password and activate your account.</p>
      <p><a href="${setupLink}">Set My Password →</a></p>
      <p>This link expires in 24 hours.</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 9. Password reset (sent by admin on behalf of customer) ───────────────────

/**
 * Sent to a customer when a staff member triggers a password reset for them.
 * Triggered by: POST /api/customers/[id]/send-password-reset
 * @param firstName  - Customer's first name.
 * @param actionLink - Supabase-generated password reset link.
 */
export function passwordResetEmail({
  firstName,
  actionLink,
}: {
  firstName: string;
  actionLink: string;
}): EmailContent {
  return {
    subject: "Reset your SuperHeroCPR password",
    html: wrapEmail(`
      <h1>Password Reset</h1>
      <p>Hi ${firstName},</p>
      <p>A staff member has sent you a password reset link. Click below to set a new password for your SuperHeroCPR account.</p>
      <p><a href="${actionLink}">Reset My Password →</a></p>
      <p>This link expires in 24 hours. If you did not expect this email, you can safely ignore it.</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 10. Certification expiry reminder ─────────────────────────────────────────

/**
 * Sent to a customer whose CPR certification is expiring within 90 days.
 * Triggered by: POST /api/certifications/send-reminders (batch)
 * @param firstName     - Customer's first name.
 * @param certName      - The name of the certification type (e.g. "BLS for Healthcare Providers").
 * @param daysRemaining - Number of days until the certification expires.
 */
export function certReminderEmail({
  firstName,
  certName,
  daysRemaining,
}: {
  firstName: string;
  certName: string;
  daysRemaining: number;
}): EmailContent {
  const safeFirstName = escapeHtml(firstName.trim());
  const safeCertName = escapeHtml(certName.trim());
  const dayText = `${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`;

  const content = `
    <style type="text/css">
#outlook a { padding:0; }
.ExternalClass { width:100%; }
.ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height:100%; }
.es-button { mso-style-priority:100!important; text-decoration:none!important; }
a[x-apple-data-detectors] { color:inherit!important; text-decoration:none!important; font-size:inherit!important; font-family:inherit!important; font-weight:inherit!important; line-height:inherit!important; }
.es-desk-hidden { display:none; float:left; overflow:hidden; width:0; max-height:0; line-height:0; mso-hide:all; }
[data-ogsb] .es-button { border-width:0!important; padding:5px 30px 5px 30px!important; }
@media only screen and (max-width:600px) {
  p, ul li, ol li, a { line-height:150%!important }
  h1 { font-size:30px!important; text-align:center; line-height:120%!important }
  h2 { font-size:26px!important; text-align:center; line-height:120%!important }
  h3 { font-size:20px!important; text-align:center; line-height:120%!important }
  .es-menu td a { font-size:13px!important }
  .es-header-body p, .es-header-body ul li, .es-header-body ol li, .es-header-body a { font-size:16px!important }
  .es-content-body p, .es-content-body ul li, .es-content-body ol li, .es-content-body a { font-size:16px!important }
  .es-footer-body p, .es-footer-body ul li, .es-footer-body ol li, .es-footer-body a { font-size:16px!important }
  .es-infoblock p, .es-infoblock ul li, .es-infoblock ol li, .es-infoblock a { font-size:12px!important }
  *[class="gmail-fix"] { display:none!important }
  .es-m-txt-c, .es-m-txt-c h1, .es-m-txt-c h2, .es-m-txt-c h3 { text-align:center!important }
  .es-m-txt-r, .es-m-txt-r h1, .es-m-txt-r h2, .es-m-txt-r h3 { text-align:right!important }
  .es-m-txt-l, .es-m-txt-l h1, .es-m-txt-l h2, .es-m-txt-l h3 { text-align:left!important }
  .es-m-txt-r img, .es-m-txt-c img, .es-m-txt-l img { display:inline!important }
  .es-button-border { display:block!important }
  .es-btn-fw { border-width:10px 0px!important; text-align:center!important }
  .es-adaptive table, .es-btn-fw, .es-btn-fw-brdr, .es-left, .es-right { width:100%!important }
  .es-content table, .es-header table, .es-footer table, .es-content, .es-footer, .es-header { width:100%!important; max-width:600px!important }
  .es-adapt-td { display:block!important; width:100%!important }
  .adapt-img { width:100%!important; height:auto!important }
  .es-m-p0 { padding:0px!important }
  .es-m-p0r { padding-right:0px!important }
  .es-m-p0l { padding-left:0px!important }
  .es-m-p0t { padding-top:0px!important }
  .es-m-p0b { padding-bottom:0!important }
  .es-m-p20b { padding-bottom:20px!important }
  .es-mobile-hidden, .es-hidden { display:none!important }
  tr.es-desk-hidden, td.es-desk-hidden, table.es-desk-hidden { width:auto!important; overflow:visible!important; float:none!important; max-height:inherit!important; line-height:inherit!important }
  tr.es-desk-hidden { display:table-row!important }
  table.es-desk-hidden { display:table!important }
  td.es-desk-menu-hidden { display:table-cell!important }
  .es-menu td { width:1%!important }
  table.es-table-not-adapt, .esd-block-html table { width:auto!important }
  table.es-social { display:inline-block!important }
  table.es-social td { display:inline-block!important }
  a.es-button, button.es-button { font-size:16px!important; display:block!important; border-width:10px 0px 10px 0px!important }
}
    </style>

    <div class="es-wrapper-color" style="background-color:#FFFFFF">
      <table class="es-wrapper" width="100%" cellspacing="0" cellpadding="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;border-spacing:0px;padding:0;Margin:0;width:100%;height:100%;background-repeat:repeat;background-position:center top;background-color:#FFFFFF">
        <tr style="border-collapse:collapse">
          <td valign="top" style="padding:0;Margin:0">

            <!-- Main hero (top infoblock and header removed to rely on global wrapper banner) -->
            <table class="es-content" cellspacing="0" cellpadding="0" align="center" style="table-layout:fixed !important;width:100%">
              <tr>
                <td align="center" style="padding:0;Margin:0">
                  <table class="es-content-body" cellspacing="0" cellpadding="0" bgcolor="#ffffff" align="center" style="background-color:#FFFFFF;width:600px">
                    <tr>
                      <td align="left" bgcolor="#ffffff" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px;background-color:#ffffff">
                        <table width="100%" cellspacing="0" cellpadding="0">
                          <tr>
                            <td valign="top" align="center" style="padding:0;Margin:0;width:560px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><p style="Margin:0;line-height:21px;color:#333333;font-size:14px"><strong>SuperHeroCPR</strong></p></td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><h2 style="Margin:0;line-height:29px;font-size:24px;color:#e1261d">Hi ${safeFirstName}, Your Certification Expires Soon!</h2></td>
                                </tr>
                                <tr>
                                  <td class="es-m-txt-c" align="left" style="padding:0;Margin:0;padding-top:10px"><p style="Margin:0;line-height:21px;color:#000000;font-size:14px;margin-top:8px">But we've got you covered, Hero! We are ready with up-to-date guidelines and best practices from the American Heart Association, delivered with the easy-to-learn approach of SuperHeroCPR.</p></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Image / CTA -->
            <table cellpadding="0" cellspacing="0" class="es-content" align="center" style="width:100%">
              <tr>
                <td align="center" style="padding:0;Margin:0">
                  <table bgcolor="#ffffff" class="es-content-body" align="center" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;width:600px">
                    <tr>
                      <td align="left" style="padding:0;Margin:0;padding-top:20px;padding-left:20px;padding-right:20px">
                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td align="center" valign="top" style="padding:0;Margin:0;width:560px">
                              <table cellpadding="0" cellspacing="0" width="100%" role="presentation">
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><a target="_blank" href="https://apps.apple.com/us/app/cpr-super-hero/id1527298859" style="text-decoration:underline;color:#333333;font-size:14px"><img class="adapt-img" src="https://obwshc.stripocdn.email/content/guids/CABINET_7baf845b7c19c5a1d2035b63f9dc2b5a/images/76741620341738726.jpg" alt="Renew" width="560" title="Renew" height="280" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a></td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0;padding-bottom:18px"><h2 style="Margin:0;line-height:29px;font-size:20px;color:#e1261d">Book Your Class Before Your Certification Expires!</h2></td>
                                </tr>
                                <tr>
                                  <td class="es-m-txt-c" align="center" style="padding:0;Margin:0;padding-bottom:18px;padding-left:36px;padding-right:36px">
                                    <p style="Margin:0 0 10px 0;line-height:22px;color:#333333;font-size:15px">You are part of the <strong><u>JUST - US League</u></strong>.</p>
                                    <p style="Margin:0;line-height:22px;color:#333333;font-size:15px">Your ${safeCertName} certification expires in <strong>${dayText}</strong>. Book a renewal class today to stay certified.</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0;padding-top:18px;padding-bottom:24px">
                                    <span class="es-button-border" style="border-style:solid;border-color:#808080;background:#FFFFFF;border-width:2px;display:inline-block;border-radius:4px;width:auto">
                                      <a href="https://superherocpr.com/#book" class="es-button es-button-1" target="_blank" style="color:#E1261D;font-size:16px;border-style:solid;border-color:#FFFFFF;border-width:12px 20px;display:inline-block;background:#FFFFFF;border-radius:4px;font-weight:bold;line-height:19px;text-align:center">BOOK NOW</a>
                                    </span>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Footer -->
            <table cellpadding="0" cellspacing="0" class="es-footer" align="center" style="width:100%;background-color:transparent;background-repeat:repeat;background-position:center top">
              <tr>
                <td align="center" style="padding:0;Margin:0">
                  <table class="es-footer-body" style="background-color:#333333;width:600px" cellspacing="0" cellpadding="0" bgcolor="#333333" align="center">
                    <tr>
                      <td align="left" style="padding:20px;Margin:0">
                        <table width="100%" cellspacing="0" cellpadding="0">
                          <tr>
                            <td valign="top" align="center" style="padding:0;Margin:0;width:560px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation">
                                <tr>
                                  <td align="center" style="padding:0;Margin:0"><h3 style="Margin:0;line-height:30px;font-size:20px;color:#ffffff">Let's get social!</h3></td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:10px;font-size:0px">
                                    <table class="es-table-not-adapt es-social" cellspacing="0" cellpadding="0" role="presentation">
                                      <tr>
                                        <td valign="top" align="center" style="padding:0;Margin:0;padding-right:20px"><a href="https://www.facebook.com/1HeroWay/" style="text-decoration:underline;color:#FFFFFF;font-size:14px"><img title="Facebook" src="https://obwshc.stripocdn.email/content/assets/img/social-icons/logo-gray/facebook-logo-gray.png" alt="Fb" width="32" height="32" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a></td>
                                        <td valign="top" align="center" style="padding:0;Margin:0"><a href="https://www.youtube.com/channel/UCuRG_ZiO1WoOXZxyRzgTDxA" style="text-decoration:underline;color:#FFFFFF;font-size:14px"><img title="Youtube" src="https://obwshc.stripocdn.email/content/assets/img/social-icons/logo-gray/youtube-logo-gray.png" alt="Yt" width="32" height="32" style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic"></a></td>
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                                <tr>
                                  <td align="center" style="padding:0;Margin:0;padding-top:10px;padding-bottom:10px"><p style="Margin:0;color:#FFFFFF;font-size:14px">© ${new Date().getFullYear()}&nbsp;SuperHeroCPR</p></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>
    </div>
  `;

  return {
    subject: "Your CPR Certification Expires Soon",
    html: wrapEmail(content),
  };
}

// ── 11. Invoice paid — notification to instructor ─────────────────────────────

/**
 * Sent to the instructor when one of their invoices is marked as paid.
 * Triggered by: POST /api/invoices/mark-paid
 * @param firstName      - Instructor's first name.
 * @param invoiceNumber  - Invoice number (e.g. "INV-0042").
 * @param recipientName  - Name of the company or individual who was invoiced.
 * @param studentCount   - Number of student spots reserved.
 */
export function invoicePaidEmail({
  firstName,
  invoiceNumber,
  recipientName,
  studentCount,
}: {
  firstName: string;
  invoiceNumber: string;
  recipientName: string;
  studentCount: number;
}): EmailContent {
  return {
    subject: `Invoice ${invoiceNumber} marked as paid`,
    html: wrapEmail(`
      <p>Hi ${firstName},</p>
      <p>Invoice <strong>${invoiceNumber}</strong> for ${recipientName} has been marked as paid.</p>
      <p>${studentCount} student spot${studentCount !== 1 ? "s" : ""} have been reserved for the class.</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 12. Invoice resend ─────────────────────────────────────────────────────────

/**
 * Sent when an instructor or admin resends an existing invoice.
 * Formats the date and amount internally from raw values.
 * Triggered by: POST /api/invoices/resend
 * @param invoiceNumber   - Invoice number.
 * @param recipientName   - Name of the recipient.
 * @param className       - Name of the CPR class.
 * @param sessionDate     - ISO date string of the class session (null if unknown).
 * @param locationName    - Venue name.
 * @param locationCity    - Venue city.
 * @param locationState   - Venue state.
 * @param instructorName  - Instructor's full name.
 * @param studentCount    - Number of students on the invoice.
 * @param totalAmount     - Invoice total in dollars (null if unavailable).
 * @param notes           - Optional notes on the invoice.
 * @param paymentPlatform - Payment platform name (e.g. "PayPal").
 */
export function invoiceResendEmail({
  invoiceNumber,
  recipientName,
  className,
  sessionDate,
  locationName,
  locationCity,
  locationState,
  instructorName,
  studentCount,
  totalAmount,
  notes,
  paymentPlatform,
}: {
  invoiceNumber: string;
  recipientName: string;
  className: string;
  sessionDate: string | null;
  locationName: string;
  locationCity: string;
  locationState: string;
  instructorName?: string | null;
  studentCount: number;
  totalAmount: number | null;
  notes: string | null;
  paymentPlatform: string | null;
}): EmailContent {
  const formattedDate = sessionDate
    ? new Date(sessionDate).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "See your instructor for details";

  const formattedAmount =
    typeof totalAmount === "number"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalAmount)
      : "$0.00";

  const safeInstructorName = instructorName ? escapeHtml(instructorName.trim()) : null;
  const instructorRow = safeInstructorName
    ? `<tr><td style="padding:8px;color:#555">Instructor</td><td style="padding:8px;font-weight:bold">${safeInstructorName}</td></tr>`
    : "";

  return {
    subject: `Invoice ${invoiceNumber} from SuperHeroCPR`,
    html: wrapEmail(`
      <h1>Invoice ${invoiceNumber}</h1>
      <p>Hello ${recipientName},</p>
      <p>Please find your invoice for the upcoming CPR class below.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px">
        <tr><td style="padding:8px;color:#555">Class</td><td style="padding:8px;font-weight:bold">${className}</td></tr>
        <tr><td style="padding:8px;color:#555">Date</td><td style="padding:8px">${formattedDate}</td></tr>
        <tr><td style="padding:8px;color:#555">Location</td><td style="padding:8px">${locationName}, ${locationCity}, ${locationState}</td></tr>
        ${instructorRow}
        <tr><td style="padding:8px;color:#555">Students</td><td style="padding:8px">${studentCount}</td></tr>
        <tr><td style="padding:8px;color:#555;font-weight:bold">Total Due</td><td style="padding:8px;font-weight:bold;font-size:18px">${formattedAmount}</td></tr>
      </table>
      ${notes ? `<p style="margin-top:16px;color:#555">Note: ${notes}</p>` : ""}
      <p style="margin-top:24px">Payment platform: ${paymentPlatform ?? "See your instructor"}</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 13. Booking confirmation + payment receipt ────────────────────────────────

/**
 * Sent to a customer immediately after their online booking payment is captured.
 * Includes class details, location, amount paid, and transaction ID.
 * Triggered by: POST /api/bookings/confirm
 * @param firstName         - Customer's first name (falls back to "there" if null).
 * @param instructorName    - Instructor's full name.
 * @param className         - Name of the booked class.
 * @param startsAt          - ISO date-time string for the class start.
 * @param locationName      - Venue name.
 * @param locationAddress   - Street address.
 * @param locationCity      - City.
 * @param locationState     - State.
 * @param locationZip       - ZIP code.
 * @param amount            - Amount paid in dollars.
 * @param paymentProcessor  - Human-readable payment processor label (e.g. "SuperHeroCPR via PayPal").
 * @param transactionId     - PayPal capture transaction ID (null if unavailable).
 */
export function bookingConfirmationEmail({
  firstName,
  className,
  startsAt,
  locationName,
  locationAddress,
  locationCity,
  locationState,
  locationZip,
  amount,
  paymentProcessor,
  transactionId,
  instructorName,
}: {
  firstName: string | null;
  className: string;
  startsAt: string;
  locationName: string;
  locationAddress: string;
  locationCity: string;
  locationState: string;
  locationZip: string;
  amount: number;
  paymentProcessor: string;
  transactionId: string | null;
  instructorName?: string | null;
}): EmailContent {
  const formattedDate = new Date(startsAt).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = new Date(startsAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const safeInstructorName = instructorName ? escapeHtml(instructorName.trim()) : null;
  const instructorRow = safeInstructorName
    ? `<tr><td><strong>Instructor:</strong></td><td>${safeInstructorName}</td></tr>`
    : "";

  return {
    subject: `Booking Confirmed — ${className} on ${formattedDate}`,
    html: wrapEmail(`
      <h1>You're booked!</h1>
      <p>Hi ${firstName ?? "there"},</p>
      <p>Your booking for <strong>${className}</strong> has been confirmed. Here are your details:</p>
      <table cellpadding="6">
        <tr><td><strong>Class:</strong></td><td>${className}</td></tr>
        <tr><td><strong>Date:</strong></td><td>${formattedDate}</td></tr>
        <tr><td><strong>Time:</strong></td><td>${formattedTime}</td></tr>
        <tr>
          <td style="vertical-align:top"><strong>Location:</strong></td>
          <td>${locationName}<br>${locationAddress}<br>${locationCity}, ${locationState} ${locationZip}</td>
        </tr>
        ${instructorRow}
        <tr><td><strong>Amount paid:</strong></td><td>$${amount.toFixed(2)}</td></tr>
        <tr><td><strong>Payment processed by:</strong></td><td>${paymentProcessor}</td></tr>
        <tr><td><strong>Transaction ID:</strong></td><td>${transactionId ?? "N/A"}</td></tr>
      </table>
      <p>Please arrive a few minutes early. Wear comfortable clothing.</p>
      <p>Questions? Reply to this email or call us at (813) 966-3969.</p>
      <p>See you in class!</p>
      <p>— The SuperHeroCPR Team</p>
    `),
  };
}

// ── 14. Invoice email (new invoice sent to recipient) ─────────────────────────

/**
 * Sent to the invoice recipient when a new invoice is created.
 * For group invoices, includes a "Submit Your Roster" button.
 * Builds the full email body internally including conditional rows.
 * Triggered by: POST /api/invoices/create (via sendInvoiceEmail helper)
 * @param invoiceNumber  - Invoice number.
 * @param recipientName  - Recipient's name.
 * @param invoiceType    - "individual" or "group".
 * @param companyName    - Company name (group invoices only, else null).
 * @param studentCount   - Number of students on the invoice.
 * @param totalAmount    - Invoice total in dollars.
 * @param className      - Name of the CPR class.
 * @param classDate      - ISO date string for the class.
 * @param locationName   - Venue name.
 * @param locationCity   - Venue city.
 * @param locationState  - Venue state.
 * @param notes          - Optional instructor notes.
 * @param paymentLink    - Direct payment URL (null if not provided).
 * @param instructorName - Instructor's name.
 */
export function invoiceEmail({
  invoiceNumber,
  recipientName,
  invoiceType,
  companyName,
  studentCount,
  totalAmount,
  className,
  classDate,
  locationName,
  locationCity,
  locationState,
  instructorName,
  notes,
  paymentLink,
}: {
  invoiceNumber: string;
  recipientName: string;
  invoiceType: "individual" | "group";
  companyName: string | null;
  studentCount: number;
  totalAmount: number;
  className: string;
  classDate: string;
  locationName: string;
  locationCity: string;
  locationState: string;
  instructorName?: string | null;
  notes: string | null;
  paymentLink: string | null;
}): EmailContent {
  const formattedDate = new Date(classDate).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(totalAmount);

  const instructorRow = instructorName
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;">Instructor:</td>
        <td style="padding:6px 0;font-size:14px;">${escapeHtml(instructorName.trim())}</td>
       </tr>`
    : "";

  const companyRow = companyName
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;">Company:</td>
        <td style="padding:6px 0;font-size:14px;">${companyName}</td>
       </tr>`
    : "";

  const notesRow = notes
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;vertical-align:top;">Note:</td>
        <td style="padding:6px 0;font-size:14px;">${notes}</td>
       </tr>`
    : "";

  const paymentRow = paymentLink
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;">Pay here:</td>
        <td style="padding:6px 0;font-size:14px;"><a href="${paymentLink}" style="color:#dc2626;">${paymentLink}</a></td>
       </tr>`
    : "";

  // Group invoices include a roster submission prompt so the company can
  // pre-register attendees and save time on class day.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://superherocpr.com";
  const rosterSection =
    invoiceType === "group"
      ? `<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
         <p style="font-size:14px;color:#374151;font-weight:600;">Submitting your student roster</p>
         <p style="font-size:14px;color:#6b7280;">
           If you have a list of staff attending this class, you can submit it in advance to save time on class day.
           This is only needed if you have multiple attendees and want to pre-register them.
         </p>
         <p style="font-size:14px;color:#6b7280;">Your invoice number: <strong>${invoiceNumber}</strong></p>
         <p>
           <a href="${baseUrl}/submit-roster?invoice=${invoiceNumber}"
              style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
             Submit Your Roster →
           </a>
         </p>
         <p style="font-size:12px;color:#9ca3af;">Note: Individual students do not need to submit a roster.</p>`
      : "";

  return {
    subject: `Invoice ${invoiceNumber} — ${className} on ${formattedDate}`,
    html: wrapEmail(`
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin-bottom:4px;">Invoice from SuperHeroCPR</h1>
      <p style="font-size:14px;color:#6b7280;margin-bottom:24px;">Invoice number: <strong>${invoiceNumber}</strong></p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">To:</td>
          <td style="padding:6px 0;font-size:14px;font-weight:600;">${recipientName}</td>
        </tr>
        ${companyRow}
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Class:</td>
          <td style="padding:6px 0;font-size:14px;">${className}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Date:</td>
          <td style="padding:6px 0;font-size:14px;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Location:</td>
          <td style="padding:6px 0;font-size:14px;">${locationName}, ${locationCity}, ${locationState}</td>
        </tr>
        ${instructorRow}
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Students:</td>
          <td style="padding:6px 0;font-size:14px;">${studentCount}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Amount:</td>
          <td style="padding:6px 0;font-size:16px;font-weight:700;color:#111827;">${formattedAmount}</td>
        </tr>
        ${notesRow}
        ${paymentRow}
      </table>

      ${rosterSection}

      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="font-size:12px;color:#9ca3af;">
        This invoice was sent by a SuperHeroCPR instructor. For questions, reply to this email.
      </p>
    `),
  };
}
