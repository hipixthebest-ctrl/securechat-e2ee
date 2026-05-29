const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const server = http.createServer(app);
const io = new Server(server);

// == ДАННЫЕ ==
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const d = { users: {}, chats: [] };
        fs.writeFileSync(DATA_FILE, JSON.stringify(d));
        return d;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(d) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(d));
}

// == СОКЕТЫ ==
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let userId = null;

    socket.on('register', (data) => {
        const db = loadData();
        const exists = Object.values(db.users).find(u => u.username === data.username);
        if (exists) {
            return socket.emit('regError', 'User exists');
        }
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        db.users[id] = {
            userId: id,
            username: data.username,
            email: data.email,
            password: data.password,
            avatar: null
        };
        saveData(db);
        socket.emit('regSuccess');
    });

    socket.on('login', (data) => {
        const db = loadData();
        const user = Object.values(db.users).find(u =>
            u.username === data.username && u.password === data.password
        );
        if (!user) {
            return socket.emit('authError', 'Wrong credentials');
        }
        userId = user.userId;
        socket.userId = userId;

        const chats = db.chats
            .filter(c => c.participants.includes(userId))
            .map(c => {
                const otherId = c.participants.find(p => p !== userId);
                const other = db.users[otherId] || {};
                return {
                    id: c.id,
                    with: other.username || 'Unknown',
                    withId: otherId,
                    avatar: other.avatar,
                    lastMessage: c.messages[c.messages.length - 1]?.text || '',
                    lastTime: c.lastTime || Date.now()
                };
            });

        socket.emit('authSuccess', {
            userId: user.userId,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            chats
        });
    });

    socket.on('searchUsers', (query) => {
        const db = loadData();
        const q = query.toLowerCase();
        const results = Object.values(db.users)
            .filter(u => u.userId !== userId && u.username.toLowerCase().includes(q))
            .slice(0, 10)
            .map(u => ({ userId: u.userId, username: u.username, avatar: u.avatar }));
        socket.emit('searchResults', results);
    });

    socket.on('startChat', (data) => {
        if (!userId) return;
        const db = loadData();
        const chatId = [userId, data.userId].sort().join('_');
        let chat = db.chats.find(c => c.id === chatId);
        if (!chat) {
            chat = {
                id: chatId,
                participants: [userId, data.userId],
                messages: [],
                createdAt: Date.now(),
                lastTime: Date.now()
            };
            db.chats.push(chat);
            saveData(db);
        }
        socket.emit('chatCreated', {
            id: chatId,
            with: data.username,
            withId: data.userId,
            avatar: data.avatar,
            lastMessage: '',
            lastTime: Date.now()
        });
        socket.emit('chatMessages', { chatId, messages: chat.messages });
    });

    socket.on('openChat', (peerId) => {
        if (!userId) return;
        const chatId = [userId, peerId].sort().join('_');
        const db = loadData();
        const chat = db.chats.find(c => c.id === chatId);
        if (chat) {
            socket.emit('chatMessages', { chatId, messages: chat.messages });
        }
    });

    socket.on('sendMessage', (data) => {
        if (!userId) return;
        const db = loadData();
        const chat = db.chats.find(c => c.id === data.chatId);
        if (!chat) return;
        const msg = {
            from: userId,
            fromName: db.users[userId]?.username || 'User',
            text: data.text,
            time: Date.now()
        };
        chat.messages.push(msg);
        chat.lastTime = msg.time;
        saveData(db);
        io.emit('newMessage', { chatId: data.chatId, message: msg });
    });

    socket.on('sendImage', (data) => {
        if (!userId) return;
        const db = loadData();
        const chat = db.chats.find(c => c.id === data.chatId);
        if (!chat) return;
        const base64 = data.image.replace(/^data:image\/\w+;base64,/, '');
        const filename = Date.now() + '.jpg';
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), base64, 'base64');
        const msg = {
            from: userId,
            fromName: db.users[userId]?.username || 'User',
            image: '/uploads/' + filename,
            text: 'Photo',
            time: Date.now()
        };
        chat.messages.push(msg);
        chat.lastTime = msg.time;
        saveData(db);
        io.emit('newMessage', { chatId: data.chatId, message: msg });
    });

    socket.on('logout', () => {
        userId = null;
        socket.userId = null;
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log('Server running on port', PORT);
});
