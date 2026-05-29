const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// Логи
app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
});

// Статика
app.use(express.static(path.join(__dirname, 'public')));

// Тест
app.get('/test', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
});

// Socket.io - МАКСИМАЛЬНО ПРОСТО
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    socket.emit('welcome', 'Connected!');
    
    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('Server on port', PORT);
});
