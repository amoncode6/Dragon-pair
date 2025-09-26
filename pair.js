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

// Define version information
const version = [2, 3000, 1015901307];

function removeFile(FilePath) {
    try {
        if (fs.existsSync(FilePath)) {
            fs.rmSync(FilePath, { recursive: true, force: true });
            return true;
        }
    } catch (error) {
        console.error('Error removing file:', error);
    }
    return false;
}

router.get('/', async (req, res) => {
    const num = req.query.number;

    // Validate number
    if (!num || !/^\d{8,15}$/.test(num)) {
        return res.status(400).send({ 
            error: '❌ Invalid number. Use 8-15 digits without + or spaces.',
            example: '/pair?number=263714757857'
        });
    }

    console.log(`🔧 Pairing request for: ${num}`);

    // Clean any existing session first
    removeFile('./session');

    try {
        // Create auth state
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        
        console.log('✅ Auth state created');

        // Create simple socket connection
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: true,
            logger: pino({ level: "silent" }),
            browser: ["Chrome", "Windows", "10.0.0"],
        });

        console.log('✅ Socket created');

        // Wait a moment for connection
        await delay(2000);

        // Request pairing code
        console.log(`📱 Requesting pairing code for: ${num}`);
        
        const formattedNum = num.startsWith('+') ? num : `+${num}`;
        const code = await sock.requestPairingCode(formattedNum);
        
        console.log(`✅ Pairing code generated: ${code}`);

        // Send success response
        res.send({
            success: true,
            code: code,
            number: formattedNum,
            version: version,
            message: '✅ Check your WhatsApp for the device linking popup!'
        });

        // Simple connection handler for completion
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on("connection.update", (update) => {
            const { connection } = update;
            console.log(`🔗 Connection status: ${connection}`);
            
            if (connection === "open") {
                console.log('🎉 Device paired successfully!');
                // Optional: Send success message or cleanup
                setTimeout(() => {
                    removeFile('./session');
                }, 5000);
            }
            
            if (connection === "close") {
                console.log('❌ Connection closed');
                removeFile('./session');
            }
        });

        // Keep process alive for 2 minutes
        setTimeout(() => {
            try {
                sock.ws.close();
                removeFile('./session');
                console.log('🔄 Cleanup completed');
            } catch (e) {
                console.log('Cleanup error:', e.message);
            }
        }, 120000);

    } catch (error) {
        console.error('❌ Pairing failed:', error);
        
        // Cleanup on error
        removeFile('./session');
        
        let errorMessage = 'Failed to generate pairing code';
        
        if (error.message.includes('rate')) {
            errorMessage = '⚠️ Rate limit exceeded. Wait 10 minutes and try again.';
        } else if (error.message.includes('invalid')) {
            errorMessage = '❌ Invalid phone number format.';
        } else if (error.message.includes('timeout')) {
            errorMessage = '⏰ Connection timeout. Check your internet.';
        } else if (error.message.includes('not registered')) {
            errorMessage = '❌ Phone number not registered on WhatsApp.';
        }
        
        res.status(500).send({
            error: errorMessage,
            details: error.message,
            version: version
        });
    }
});

// Simple error handling
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
});

module.exports = router;