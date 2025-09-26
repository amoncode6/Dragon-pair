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
        // Cleanup session after a delay
        setTimeout(() => {
            removeFile('./session');
        }, 3000);
    };

    // Set response timeout (3 minutes)
    res.setTimeout(180000, () => {
        if (!res.headersSent) {
            res.status(504).send({ error: 'Request timeout', version });
        }
        cleanup();
    });

    async function PairCode() {
        pairingInProgress = true;
        
        // Clean any existing session first
        removeFile('./session');

        try {
            console.log('🔄 Starting pairing process for:', num);
            
            const {
                state,
                saveCreds
            } = await useMultiFileAuthState(`./session`);

            console.log('✅ Auth state loaded');

            let sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: true, // Enable to see connection status
                logger: pino({ level: "error" }).child({ level: "error" }), // Change to error for debugging
                browser: ["Chrome", "Windows", "10.0.0"],
                version: version,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 10000,
                maxRetries: 3,
            });

            activeSocket = sock;
            console.log('✅ WebSocket created');

            // Wait for connection to stabilize
            await delay(3000);

            // Check connection state before requesting code
            if (sock.user && sock.user.id) {
                console.log('❌ Already authenticated with:', sock.user.id);
                if (!res.headersSent) {
                    res.send({ 
                        error: 'Session already authenticated', 
                        version 
                    });
                }
                cleanup();
                return;
            }

            if (!sock.authState.creds.registered) {
                console.log('📱 Requesting pairing code for:', num);
                
                // Format number properly
                num = num.replace(/[^0-9]/g, '');
                if (!num.startsWith('+')) {
                    num = '+' + num;
                }

                try {
                    const code = await sock.requestPairingCode(num);
                    console.log('✅ Pairing code generated:', code);

                    if (!res.headersSent) {
                        res.send({ 
                            code, 
                            version,
                            message: '✅ Check your WhatsApp for device linking popup'
                        });
                    }

                    // Set up connection listeners AFTER sending the response
                    sock.ev.on('creds.update', saveCreds);

                    sock.ev.on("connection.update", async (update) => {
                        const { connection, lastDisconnect, qr } = update;
                        console.log('🔗 Connection update:', connection);

                        if (connection === "open") {
                            console.log('✅ Device successfully paired!');
                            
                            try {
                                await delay(3000); // Wait for stabilization
                                
                                // Read and send creds.json
                                if (fs.existsSync('./session/creds.json')) {
                                    const credsText = fs.readFileSync('./session/creds.json', 'utf8');
                                    
                                    if (sock.user?.id) {
                                        await sock.sendMessage(sock.user.id, {
                                            text: credsText
                                        });

                                        await sock.sendMessage(sock.user.id, {
                                            text: `🎉 *DEVICE PAIRING SUCCESSFUL*

✅ *Creds.json generated successfully*
📱 *Number:* ${num}
🆔 *User ID:* ${sock.user.id}

━━━━━━━━━━━━━━━━━━━━━━━  
*Next Steps:*
1. Copy the creds.json above
2. Use it in your bot deployment
3. Bot is now ready to use

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  
*System ID: MALVIN-XD-v${version.join('.')}*`
                                        });

                                        console.log('✅ Success messages sent');
                                    }
                                }
                            } catch (messageError) {
                                console.error('Error sending messages:', messageError);
                            } finally {
                                // Wait a bit before cleanup
                                await delay(2000);
                                cleanup();
                            }
                        }

                        if (connection === "close") {
                            console.log('❌ Connection closed:', lastDisconnect?.error?.message);
                            if (lastDisconnect?.error?.output?.statusCode === 401) {
                                console.log('🔄 Authentication failed, cleaning up...');
                            }
                            cleanup();
                        }
                    });

                    // Keep the process alive to wait for pairing
                    console.log('⏳ Waiting for user to complete pairing...');
                    await delay(300000); // Wait 5 minutes for pairing

                } catch (pairingError) {
                    console.error('❌ Pairing code generation failed:', pairingError);
                    
                    if (!res.headersSent) {
                        let errorMessage = 'Failed to generate pairing code';
                        
                        if (pairingError.message.includes('rate')) {
                            errorMessage = 'Rate limit exceeded. Try again later.';
                        } else if (pairingError.message.includes('timeout')) {
                            errorMessage = 'Connection timeout. Check your internet.';
                        } else if (pairingError.message.includes('invalid')) {
                            errorMessage = 'Invalid phone number format.';
                        }
                        
                        res.status(500).send({ 
                            error: errorMessage,
                            version,
                            details: pairingError.message
                        });
                    }
                    cleanup();
                }
            }

        } catch (err) {
            console.error('❌ Pairing process error:', err);
            
            if (!res.headersSent) {
                res.status(500).send({ 
                    error: 'Service error during pairing',
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
        console.error('💥 Unexpected error:', error);
        cleanup();
        if (!res.headersSent) {
            res.status(500).send({ 
                error: 'Internal server error', 
                version 
            });
        }
    }
});

// Error handling
process.on('uncaughtException', function (err) {
    console.error('⚠️ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = router;