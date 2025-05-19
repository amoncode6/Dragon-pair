const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

// Define version information
const version = [2, 3000, 1015901307];

router.get('/', async (req, res) => {
    let num = req.query.number;

    async function PairCode() {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(`./session`);

        try {
            let sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: ["Ubuntu", "Chrome", "20.0.04"],
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);

                if (!res.headersSent) {
                    await res.send({ code, version });
                }
            }

            sock.ev.on('creds.update', saveCreds);
            sock.ev.on("connection.update", async (s) => {
                const {
                    connection,
                    lastDisconnect
                } = s;

                if (connection == "open") {
                    await delay(10000);
                    const sessionsock = fs.readFileSync('./session/creds.json');

                    const sockses = await sock.sendMessage(sock.user.id, {
                        document: sessionsock,
                        mimetype: `application/json`,
                        fileName: `creds.json`
                    });

                    await sock.sendMessage(sock.user.id, {
                        text: `🎉 *CREDS.JSON SUCCESSFULLY CREATED*

━━━━━━━━━━━━━━━━━━━━━━━  
✅ *Stage Complete:* Device Linked  
🛰️ *Next Step:* Bot Deployment

📌 *Your Checklist:*  
• Push `creds.json` to your GitHub fork  
• Launch the bot instance to go live

🧠 *Developer Info:* 
• 👤 *Malvin King (XdKing2)*  
• 📞 [WhatsApp](https://wa.me/263714757857)  
• 🔗 GitHub Repos:  
↪ [MALVIN-XD]
(https://github.com/XdKing2/MALVIN-XD)  

↪ [Jinwoo-v4]
(https://github.com/XdKing2/Jinwoo-v4)  

↪ [MK-Bot]
(https://github.com/XdKing2/Mk-bot)

━━━━━━━━━━━━━━━━━━━━━━━  

🏁 *About MALVIN ORG:* 
• Tech Innovation Collective  
• Open-source Builders  
• Fields: AI, Bots, Automation  
• Motto: _“Empower through Code”_

🌐 *Community Access:*  
[Join WhatsApp Channel](https://whatsapp.com/channel/0029VbA6MSYJUM2TVOzCSb2A)

⚠️ *Reminders:*  
• Keep credentials private  
• Regularly sync your fork

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
*[System ID: MALVIN-XD-v${version.join('.')}]*`
                    }, { quoted: sockses });

                    await delay(100);
                    return await removeFile('./session');
                }

                if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10000);
                    PairCode();
                }
            });
        } catch (err) {
            console.log("service restarted");
            await removeFile('./session');
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable", version });
            }
        }
    }

    return await PairCode();
});

process.on('uncaughtException', function (err) {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    console.log('Caught exception: ', err);
});

module.exports = router;
