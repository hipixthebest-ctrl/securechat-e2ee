const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = __dirname + '/data.json';

// База
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({users:{},chats:[]}));
}

const app = express();

// *** ВАЖНО: Сначала статические файлы ***
app.use(express.static(path.join(__dirname, 'public')));

// Проверка
app.get('/test', (req, res) => {
    res.send('Server works!');
});

// Socket.io
const server = http.createServer(app);
const io = socketIO(server);

io.on('connection', (socket) => {
    console.log('User connected');
    
    socket.emit('welcome', 'Connected to server!');
    
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Показываем все запросы для отладки
app.use((req, res, next) => {
    console.log('Request:', req.method, req.url);
    next();
});

server.listen(PORT, () => {
    console.log('Server running on http://localhost:' + PORT);
    console.log('Test: http://localhost:' + PORT + '/test');
});
