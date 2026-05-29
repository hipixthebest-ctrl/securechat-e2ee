const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'frontend')));

// socketId → { username, publicKey }
const users = new Map();

function findSocket(username) {
  for (const [id, u] of users)
    if (u.username === username) return id;
  return null;
}

function broadcast() {
  // Рассылаем публичные ключи всем — это безопасно
  const list = [...users.values()].map(u => ({
    username: u.username,
    publicKey: u.publicKey   // base64(spki)
  }));
  io.emit('users', list);
}

io.on('connection', (socket) => {

  // Теперь регистрация принимает и publicKey
  socket.on('register', ({ username, publicKey }) => {
    if (!username || username.length < 2 || username.length > 24) {
      socket.emit('err', 'Юзернейм: 2–24 символа');
      return;
    }
    if ([...users.values()].some(u => u.username === username)) {
      socket.emit('err', 'Юзернейм занят');
      return;
    }
    users.set(socket.id, { username, publicKey });
    socket.username = username;
    socket.emit('registered', username);
    broadcast();
    console.log(`[+] ${username}`);
  });

  // Сообщение — сервер по-прежнему видит только зашифрованный байткод
  socket.on('msg', ({ to, payload }) => {
    if (!socket.username) return;
    const sid = findSocket(to);
    if (sid) {
      io.to(sid).emit('msg', {
        from: socket.username,
        payload,
        ts: Date.now()
      });
    }
  });

  // WebRTC сигнализация
  socket.on('rtc:offer', ({ to, offer }) => {
    const sid = findSocket(to);
    if (sid) io.to(sid).emit('rtc:offer', { from: socket.username, offer });
  });

  socket.on('rtc:answer', ({ to, answer }) => {
    const sid = findSocket(to);
    if (sid) io.to(sid).emit('rtc:answer', { from: socket.username, answer });
  });

  socket.on('rtc:ice', ({ to, candidate }) => {
    const sid = findSocket(to);
    if (sid) io.to(sid).emit('rtc:ice', { from: socket.username, candidate });
  });

  socket.on('rtc:end', ({ to }) => {
    const sid = findSocket(to);
    if (sid) io.to(sid).emit('rtc:end', { from: socket.username });
  });

  socket.on('disconnect', () => {
    const u = users.get(socket.id);
    users.delete(socket.id);
    if (u) {
      broadcast();
      console.log(`[-] ${u.username}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`SecureChat → http://localhost:${PORT}`)
);
