const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

// Global flag to prevent multiple pairing attempts
let pairingInProgress = false;
let activeSocket = null;

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (error) {
        console.error('Error removing file:', error);
        return false;
    }
}

function safeReadFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
        return null;
    } catch (error) {
        console.error('Error reading file:', error);
        return null;
    }
}

// Define version information
const version = [2, 3000, 1015901307];

router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num || !/^\d{8,15}$/.test(num)) {
        return res.status(400).send({ error: '❌ Invalid or missing number parameter' });
    }

    // Prevent multiple simultaneous pairing attempts
    if (pairingInProgress) {
        return res.status(503).send({ 
            error: '⏳ Pairing service is currently busy. Please try again in 30 seconds.',
            version 
        });
    }

    // Set response timeout (5 minutes)
    res.setTimeout(300000, () => {
        if (!res.headersSent) {
            res.status(504).send({ error: 'Request timeout', version });
        }
        cleanup();
    });

    const cleanup = () => {
        pairingInProgress = false;
        if (activeSocket) {
            try {
                activeSocket.end();
                activeSocket = null;
            } catch (error) {
                console.error('Error cleaning up socket:', error);
            }
        }
        removeFile('./session');
    };

    async function PairCode() {
        pairingInProgress = true;

        try {
            const {
                state,
                saveCreds
            } = await useMultiFileAuthState(`./session`);

            let sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: ["Ubuntu", "Chrome", "20.0.04"],
            });

            activeSocket = sock;

            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);

                if (!res.headersSent) {
                    res.send({ code, version });
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(10000);

                        const credsText = safeReadFile('./session/creds.json');
                        
                        if (credsText && sock.user?.id) {
                            await sock.sendMessage(sock.user.id, {
                                text: credsText
                            });

                            await sock.sendMessage(sock.user.id, {
                                text: `🎉 *CREDS.JSON SUCCESSFULLY CREATED*

━━━━━━━━━━━━━━━━━━━━━━━  
✅ *Stage Complete:* Device Linked  
🛰️ *Next Step:* Bot Deployment

📌 *Your Checklist:*  
• Copy the creds.json text above  
• Paste into your GitHub repo in the session folder  
• Launch the bot instance to go live

🧠 *Developer Info:* 
• 👤 *Malvin King (XdKing2)*  
• 📞 [WhatsApp](https://wa.me/263714757857)  
• 🔗 GitHub Repos:
↪ [MALVIN-XD](https://github.com/XdKing2/MALVIN-XD)  
↪ [Jinwoo-v4](https://github.com/XdKing2/Jinwoo-v4)  
↪ [MK-Bot](https://github.com/XdKing2/Mk-bot)  
↪ [Zenthra-Bot](https://github.com/XdKing2/Zenthra-bot)

━━━━━━━━━━━━━━━━━━━━━━━  

🏁 *About MALVIN King:*  
• Tech Innovation Collective  
• Open-source Builders  
• Fields: AI, Bots, Automation  
• Motto: _“Empower through Code”_

🌐 *Community Access:*  
[Join WhatsApp Channel](https://whatsapp.com/channel/0029VbB3YxTDJ6H15SKoBv3S)

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  
*[System ID: MALVIN-XD-v${version.join('.')}]*`
                            });
                        }

                        await delay(100);
                    } catch (messageError) {
                        console.error('Error sending messages:', messageError);
                    } finally {
                        removeFile('./session');
                        cleanup();
                    }
                }

                if (connection === "close") {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log('Connection closed, cleaning up...');
                    }
                    cleanup();
                }
            });

            // Handle socket errors
            sock.ev.on("connection.update", (update) => {
                if (update.qr) {
                    console.log('QR code generated');
                }
                if (update.connection === "close") {
                    cleanup();
                }
            });

        } catch (err) {
            console.error("Pairing error:", err);
            cleanup();
            
            if (!res.headersSent) {
                const errorMessage = err.message?.includes('timeout') ? 
                    'Pairing request timeout' : 
                    'Service temporarily unavailable';
                
                res.status(500).send({ 
                    error: errorMessage,
                    version 
                });
            }
        }
    }

    try {
        await PairCode();
    } catch (error) {
        console.error('Unexpected error:', error);
        cleanup();
        if (!res.headersSent) {
            res.status(500).send({ error: 'Internal server error', version });
        }
    }
});

// Improved error handling
process.on('uncaughtException', function (err) {
    let e = String(err);
    if (
        e.includes("conflict") ||
        e.includes("Socket connection timeout") ||
        e.includes("not-authorized") ||
        e.includes("rate-overlimit") ||
        e.includes("Connection Closed") ||
        e.includes("Timed Out") ||
        e.includes("Value not found") ||
        e.includes("ECONNREFUSED") ||
        e.includes("ENOENT")
    ) {
        console.log('Expected error caught:', err.message);
        return;
    }
    console.log('Caught unexpected exception: ', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = router;