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

export async function sendEmail(
  subject: string,
  html: string,
  text: string
): Promise<void> {
  if (!ENV.EMAIL_ENABLED) {
    console.log("  ⚠ Email disabled");
    return;
  }
  await getTransporter().sendMail({
    from: `PSX Agent <${ENV.EMAIL_USER}>`,
    to: ENV.EMAIL_TO,
    subject,
    html,
    text,
  });
  console.log(`  ✓ Email → ${ENV.EMAIL_TO}`);
}
