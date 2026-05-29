const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();

// Вот это важно - укажи ПРЯМОЙ путь
app.use(express.static(path.join(__dirname, 'public')));

// Отдаём index.html руками
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    socket.on('disconnect', () => console.log('Disconnected:', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Server on port', PORT);
    console.log('Dir:', __dirname);
    console.log('Public path:', path.join(__dirname, 'public'));
});
