const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Настройки Telegram бота
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'ТВОЙ_ТОКЕН_БОТА';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'ТВОЙ_CHAT_ID';

// Хранилища
const users = new Map();
const messages = [];
const groups = new Map(); // groupId -> { id, name, avatar, members: Set, createdBy, created }
const groupMessages = []; // [{ id, groupId, from, text, time, type, readBy: Set }]
const sessions = new Map();
const online = new Map();
const callRequests = new Map();

function sendToTelegram(code, email) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || 
        TELEGRAM_BOT_TOKEN === 'ТВОЙ_ТОКЕН_БОТА' || 
        TELEGRAM_CHAT_ID === 'ТВОЙ_CHAT_ID') {
        console.log(`\n⚠️  Telegram бот не настроен. Код для ${email}: ${code}\n`);
        return;
    }
    
    const text = `🔐 *Messages 2FA*\n\n📧 Email: \`${email}\`\n🔑 Код: \`${code}\`\n⏰ ${new Date().toLocaleString('ru-RU')}`;
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
    });
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };
    
    const req = https.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(body);
                if (result.ok) {
                    console.log(`✅ Код для ${email} отправлен в Telegram`);
                } else {
                    console.log(`❌ Ошибка Telegram: ${result.description}`);
                    console.log(`📧 Код для ${email}: ${code}`);
                }
            } catch(e) {
                console.log(`📧 Код для ${email}: ${code}`);
            }
        });
    });
    
    req.on('error', (err) => {
        console.log(`❌ Ошибка Telegram API: ${err.message}`);
        console.log(`📧 Код для ${email}: ${code}`);
    });
    
    req.write(data);
    req.end();
}

// ========== API ==========
// ...
// --- остальной код до строки 1129 не изменяется ---
