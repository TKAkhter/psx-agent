"use strict";
const twilio = require("twilio");
const { ENV } = require("../config");

let client = null;

function getClient() {
    if (!client) client = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN);
    return client;
}

async function sendWhatsApp(body) {
    if (!ENV.TWILIO_ENABLED) {
        console.log("  ⚠ WhatsApp disabled (TWILIO_ENABLED=false)");
        return;
    }
    const msg = await getClient().messages.create({
        body: body.slice(0, 1600),
        from: ENV.TWILIO_FROM,
        to: ENV.TWILIO_TO,
    });
    console.log("  ✓ WhatsApp sent →", ENV.TWILIO_TO, `(SID: ${msg.sid})`);
}

module.exports = { sendWhatsApp };