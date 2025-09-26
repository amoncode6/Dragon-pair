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

    // Set response timeout (10 minutes for pairing process)
    res.setTimeout(600000, () => {
        if (!res.headersSent) {
            res.status(504).send({ error: 'Pairing process timeout', version });
        }
        cleanup();
    });

    const cleanup = () => {
        pairingInProgress = false;
        if (activeSocket) {
            try {
                activeSocket.ws?.close();
                activeSocket = null;
            } catch (error) {
                console.error('Error cleaning up socket:', error);
            }
        }
        // Don't remove session immediately, wait for pairing to complete
        setTimeout(() => {
            removeFile('./session');
        }, 5000);
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
                // Keep the connection alive
                keepAliveIntervalMs: 30000,
                connectTimeoutMs: 60000,
                maxRetries: 10,
            });

            activeSocket = sock;

            // Send pairing code immediately
            if (!sock.authState.creds.registered) {
                await delay(2000); // Short delay for connection stabilization
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                console.log(`Pairing code generated for ${num}: ${code}`);

                if (!res.headersSent) {
                    res.send({ 
                        code, 
                        version,
                        message: '📱 Check your WhatsApp for device linking popup...'
                    });
                }
            }

            sock.ev.on('creds.update', saveCreds);

            // Listen for connection events
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                console.log('Connection update:', connection);

                if (connection === "open") {
                    console.log('✅ Device successfully paired!');
                    
                    try {
                        await delay(5000); // Wait a bit for everything to stabilize

                        const credsText = safeReadFile('./session/creds.json');
                        
                        if (credsText && sock.user?.id) {
                            // Send creds.json content
                            await sock.sendMessage(sock.user.id, {
                                text: credsText
                            });

                            // Send success message
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
• Motto: _"Empower through Code"_

🌐 *Community Access:*  
[Join WhatsApp Channel](https://whatsapp.com/channel/0029VbB3YxTDJ6H15SKoBv3S)

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  
*[System ID: MALVIN-XD-v${version.join('.')}]*`
                            });

                            console.log('Success messages sent to user');
                        }

                        // Keep the connection alive for a while longer
                        await delay(10000);
                        
                    } catch (messageError) {
                        console.error('Error sending success messages:', messageError);
                    } finally {
                        console.log('Cleaning up session...');
                        cleanup();
                    }
                }

                if (connection === "close") {
                    console.log('Connection closed, status:', lastDisconnect?.error?.output?.statusCode);
                    
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        // Non-auth error, might want to retry or notify
                        console.log('Unexpected disconnect, cleaning up...');
                    }
                    cleanup();
                }

                // Handle connecting state - important for pairing
                if (connection === "connecting") {
                    console.log('🔄 Connecting to WhatsApp...');
                }
            });

            // Handle specific pairing events
            sock.ev.on("pairing", (data) => {
                console.log('Pairing event:', data);
            });

            // Keep the process alive for pairing
            console.log('🕒 Waiting for user to complete pairing on WhatsApp...');
            
            // Don't exit immediately - wait for pairing to complete
            await delay(300000); // Wait up to 5 minutes for pairing

        } catch (err) {
            console.error("Pairing error:", err);
            
            if (!res.headersSent) {
                const errorMessage = err.message?.includes('timeout') ? 
                    'Pairing process took too long' : 
                    'Failed to generate pairing code';
                
                res.status(500).send({ 
                    error: errorMessage,
                    version,
                    details: err.message
                });
            }
            cleanup();
        }
    }

    try {
        await PairCode();
    } catch (error) {
        console.error('Unexpected error:', error);
        cleanup();
        if (!res.headersSent) {
            res.status(500).send({ 
                error: 'Internal server error', 
                version,
                details: error.message 
            });
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
        e.includes("ENOENT") ||
        e.includes("pairing")
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