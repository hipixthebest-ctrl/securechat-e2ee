const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Создаём папки
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

const app = express();

// ЛОГИРОВАНИЕ ВСЕХ ЗАПРОСОВ
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
});

// Статические файлы
app.use(express.static(publicDir));

const server = http.createServer(app);
const io = socketIO(server, {});

// Главная страница
app.get('/', (req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        console.log('✅ Sending index.html');
        res.sendFile(indexPath);
    } else {
        console.log('❌ index.html NOT FOUND at:', indexPath);
        res.send('<h1>Error: index.html not found</h1>');
    }
});

// Проверка
app.get('/test', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
});

// ОТЛАДОЧНАЯ СТРАНИЦА
app.get('/debug', (req, res) => {
    const files = fs.readdirSync(publicDir);
    res.json({ 
        publicDir: publicDir,
        files: files,
        indexExists: fs.existsSync(path.join(publicDir, 'index.html'))
    });
});

io.on('connection', (socket) => {
    console.log('✅ Socket connected:', socket.id);
    socket.emit('welcome', 'Hello from server!');
    
    socket.on('disconnect', () => {
        console.log('❌ Socket disconnected:', socket.id);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Public dir: ${publicDir}`);
    console.log(`📁 Index exists: ${fs.existsSync(path.join(publicDir, 'index.html'))}`);
});
