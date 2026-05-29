const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const crypto = require('crypto');

const app = express();

// Статика
app.use(express.static(path.join(__dirname, 'public')));

// Тестовый эндпоинт
app.get('/test', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Хранилище ключей
const clientKeys = new Map();

io.on('connection', (socket) => {
    console.log('✅ Connected:', socket.id);
    
    const keys = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    clientKeys.set(socket.id, {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey
    });
    
    socket.emit('your-keys', {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey
    });
    
    socket.on('get-public-key', (targetId, callback) => {
        const target = clientKeys.get(targetId);
        if (target) {
            callback({ publicKey: target.publicKey });
        }
    });
    
    socket.on('message', (data) => {
        io.emit('message', {
            from: socket.id,
            encryptedMessage: data.encryptedMessage,
            iv: data.iv
        });
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Disconnected:', socket.id);
        clientKeys.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
