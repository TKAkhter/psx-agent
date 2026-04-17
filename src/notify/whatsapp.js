"use strict";
const twilio = require("twilio");
const { ENV } = require("../config");

let twilioClient = null;

function getClient() {
    if (!twilioClient) twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN);
    return twilioClient;
}

async function sendWhatsApp(body) {
    if (!ENV.TWILIO_ENABLED) { console.log("  ⚠ WhatsApp disabled"); return; }
    const msg = await getClient().messages.create({
        body: body.slice(0, 1600),
        from: ENV.TWILIO_FROM,
        to: ENV.TWILIO_TO,
    });
    console.log(`  ✓ WhatsApp → ${ENV.TWILIO_TO} (${msg.sid})`);
}

module.exports = { sendWhatsApp };