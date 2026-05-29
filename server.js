const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API
app.get('/api/info', (req, res) => {
  res.json({ 
    name: 'SecureChat E2EE',
    version: '1.0.0',
    node: process.version
  });
});

// In-memory rooms (без БД)
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-room', (roomId) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    socket.join(roomId);
    socket.emit('room-created', roomId);
  });

  socket.on('join-room', (roomId) => {
    if (rooms.has(roomId)) {
      rooms.get(roomId).add(socket.id);
      socket.join(roomId);
      socket.emit('room-joined', roomId);
      socket.to(roomId).emit('peer-joined', socket.id);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('signal', (data) => {
    socket.to(data.roomId).emit('signal', {
      senderId: socket.id,
      signal: data.signal
    });
  });

  socket.on('message', (data) => {
    socket.to(data.roomId).emit('message', {
      senderId: socket.id,
      message: data.message,
      timestamp: Date.now()
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    rooms.forEach((participants, roomId) => {
      if (participants.has(socket.id)) {
        participants.delete(socket.id);
        socket.to(roomId).emit('peer-left', socket.id);
        if (participants.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
