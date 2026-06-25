import nodemailer from "nodemailer";
import { ENV } from "../config";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: ENV.EMAIL_USER, pass: ENV.EMAIL_PASS },
    });
  }
  return transporter;
}

/**
 * Sends the PSX report as an email with the PDF attached.
 * `bodyText` is a brief plain-text summary shown in the email body
 * (the full report lives in the attached PDF, generated in-memory
 * by pdf-generator.ts and never written to disk by this function).
 */
export async function sendEmail(
  subject: string,
  bodyText: string,
  pdfBuffer: Buffer,
  pdfFileName: string
): Promise<void> {
  if (!ENV.EMAIL_ENABLED) {
    console.log("  ⚠ Email disabled");
    return;
  }
  await getTransporter().sendMail({
    from: `PSX Agent <${ENV.EMAIL_USER}>`,
    to: ENV.EMAIL_TO,
    subject,
    text: bodyText,
    html: `<pre style="font-family:inherit;white-space:pre-wrap;">${bodyText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre><p>Full report attached as PDF.</p>`,
    attachments: [
      {
        filename: pdfFileName,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
  console.log(`  ✓ Email → ${ENV.EMAIL_TO} (PDF attached: ${pdfFileName})`);
}
