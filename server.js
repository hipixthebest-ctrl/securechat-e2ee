const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

// Database setup
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    displayName TEXT,
    avatar TEXT DEFAULT '',
    status TEXT DEFAULT 'online',
    publicKey TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    content TEXT NOT NULL,
    messageType TEXT DEFAULT 'text',
    replyTo TEXT,
    edited INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    type TEXT DEFAULT 'direct',
    name TEXT,
    createdBy TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chatId TEXT,
    userId TEXT,
    role TEXT DEFAULT 'member',
    unreadCount INTEGER DEFAULT 0,
    PRIMARY KEY (chatId, userId)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    messageId TEXT,
    userId TEXT,
    emoji TEXT,
    UNIQUE(messageId, userId, emoji)
  );

  CREATE TABLE IF NOT EXISTS blocked_users (
    userId TEXT,
    blockedId TEXT,
    PRIMARY KEY (userId, blockedId)
  );
`);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'client')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many attempts, please try again later'
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'whisper-secret-' + uuidv4();
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-' + uuidv4();

// Generate tokens
function generateTokens(userId, username) {
  const accessToken = jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const refreshToken = jwt.sign(
    { userId, username },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

// Auth middleware for Socket.io
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  });
});

// API Routes

// Register
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 12);
    
    db.prepare(
      'INSERT INTO users (id, username, password, displayName) VALUES (?, ?, ?, ?)'
    ).run(id, username, hashedPassword, displayName || username);

    const tokens = generateTokens(id, username);

    res.json({
      user: { id, username, displayName: displayName || username },
      ...tokens
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', user.id);

    const tokens = generateTokens(user.id, user.username);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: 'online'
      },
      ...tokens
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  
  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const tokens = generateTokens(decoded.userId, decoded.username);
    res.json(tokens);
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Get user profile
app.get('/api/users/me', authenticateToken, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, displayName, avatar, status, publicKey FROM users WHERE id = ?'
  ).get(req.user.userId);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Search users
app.get('/api/users/search', authenticateToken, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  const users = db.prepare(
    `SELECT id, username, displayName, avatar, status 
     FROM users 
     WHERE username LIKE ? AND id != ? 
     LIMIT 20`
  ).all(`%${q}%`, req.user.userId);
  
  res.json(users);
});

// Get user by username
app.get('/api/users/by-username/:username', authenticateToken, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, displayName, avatar, status FROM users WHERE username = ?'
  ).get(req.params.username);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Get user chats
app.get('/api/chats', authenticateToken, (req, res) => {
  const chats = db.prepare(`
    SELECT c.*, cm.role, cm.unreadCount,
      (SELECT json_group_array(
        json_object(
          'id', u.id,
          'username', u.username,
          'displayName', u.displayName,
          'avatar', u.avatar,
          'status', u.status
        )
      )
      FROM chat_members cm2 
      JOIN users u ON cm2.userId = u.id 
      WHERE cm2.chatId = c.id AND cm2.userId != ?
      ) as members
    FROM chats c
    JOIN chat_members cm ON c.id = cm.chatId
    WHERE cm.userId = ?
    ORDER BY c.id DESC
  `).all(req.user.userId, req.user.userId);
  
  res.json(chats.map(chat => ({
    ...chat,
    members: JSON.parse(chat.members)
  })));
});

// Create chat
app.post('/api/chats', authenticateToken, (req, res) => {
  const { participantId } = req.body;
  
  if (!participantId) {
    return res.status(400).json({ error: 'Participant ID required' });
  }

  // Check if chat already exists
  const existing = db.prepare(`
    SELECT c.id FROM chats c
    JOIN chat_members cm1 ON c.id = cm1.chatId AND cm1.userId = ?
    JOIN chat_members cm2 ON c.id = cm2.chatId AND cm2.userId = ?
    WHERE c.type = 'direct'
  `).get(req.user.userId, participantId);

  if (existing) {
    return res.json({ chatId: existing.id });
  }

  const chatId = uuidv4();
  
  const insertChat = db.prepare(
    'INSERT INTO chats (id, type, createdBy) VALUES (?, ?, ?)'
  );
  const insertMember = db.prepare(
    'INSERT INTO chat_members (chatId, userId, role) VALUES (?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    insertChat.run(chatId, 'direct', req.user.userId);
    insertMember.run(chatId, req.user.userId, 'member');
    insertMember.run(chatId, participantId, 'member');
  });

  transaction();
  res.json({ chatId });
});

// Get messages
app.get('/api/messages/:chatId', authenticateToken, (req, res) => {
  const { chatId } = req.params;
  const { before, limit = 50 } = req.query;

  // Check user is member
  const member = db.prepare(
    'SELECT * FROM chat_members WHERE chatId = ? AND userId = ?'
  ).get(chatId, req.user.userId);

  if (!member) {
    return res.status(403).json({ error: 'Not a member of this chat' });
  }

  let query = 'SELECT * FROM messages WHERE chatId = ? AND deleted = 0';
  const params = [chatId];

  if (before) {
    query += ' AND createdAt < ?';
    params.push(before);
  }

  query += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(limit);

  const messages = db.prepare(query).all(...params);

  // Get reactions for these messages
  const messageIds = messages.map(m => m.id);
  const reactions = messageIds.length > 0 ? db.prepare(`
    SELECT r.*, u.username as userUsername 
    FROM reactions r 
    JOIN users u ON r.userId = u.id 
    WHERE r.messageId IN (${messageIds.map(() => '?').join(',')})
  `).all(...messageIds) : [];

  // Update unread count
  db.prepare(
    'UPDATE chat_members SET unreadCount = 0 WHERE chatId = ? AND userId = ?'
  ).run(chatId, req.user.userId);

  res.json(messages.reverse().map(msg => ({
    ...msg,
    reactions: reactions.filter(r => r.messageId === msg.id)
  })));
});

// Block user
app.post('/api/users/block/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  
  db.prepare(
    'INSERT OR IGNORE INTO blocked_users (userId, blockedId) VALUES (?, ?)'
  ).run(req.user.userId, userId);
  
  res.json({ success: true });
});

// Unblock user
app.delete('/api/users/block/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  
  db.prepare(
    'DELETE FROM blocked_users WHERE userId = ? AND blockedId = ?'
  ).run(req.user.userId, userId);
  
  res.json({ success: true });
});

// Update profile
app.put('/api/users/profile', authenticateToken, (req, res) => {
  const { displayName, avatar, publicKey } = req.body;
  
  const updates = [];
  const params = [];
  
  if (displayName) {
    updates.push('displayName = ?');
    params.push(displayName);
  }
  if (avatar !== undefined) {
    updates.push('avatar = ?');
    params.push(avatar);
  }
  if (publicKey) {
    updates.push('publicKey = ?');
    params.push(publicKey);
  }
  
  if (updates.length > 0) {
    params.push(req.user.userId);
    db.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);
  }
  
  res.json({ success: true });
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
}

// Socket.io handling
const onlineUsers = new Map();

io.on('connection', (socket) => {
  const userId = socket.userId;
  
  // Add to online users
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);
  
  // Broadcast online status
  io.emit('user:status', { userId, status: 'online' });
  
  console.log(`User connected: ${socket.username} (${userId})`);

  // Join user to their chat rooms
  const userChats = db.prepare(
    'SELECT chatId FROM chat_members WHERE userId = ?'
  ).all(userId);
  
  userChats.forEach(chat => {
    socket.join(chat.chatId);
  });

  // Send message
  socket.on('message:send', (data) => {
    const { chatId, content, messageType = 'text', replyTo } = data;
    
    // Check user is member
    const member = db.prepare(
      'SELECT * FROM chat_members WHERE chatId = ? AND userId = ?'
    ).get(chatId, userId);
    
    if (!member) return;

    // Check if blocked
    const chatMembers = db.prepare(
      'SELECT userId FROM chat_members WHERE chatId = ? AND userId != ?'
    ).all(chatId, userId);
    
    let blocked = false;
    for (const member of chatMembers) {
      const isBlocked = db.prepare(
        'SELECT * FROM blocked_users WHERE (userId = ? AND blockedId = ?) OR (userId = ? AND blockedId = ?)'
      ).get(member.userId, userId, userId, member.userId);
      
      if (isBlocked) {
        blocked = true;
        break;
      }
    }
    
    if (blocked) return;

    const messageId = uuidv4();
    
    db.prepare(`
      INSERT INTO messages (id, chatId, senderId, content, messageType, replyTo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, chatId, userId, content, messageType, replyTo || null);

    // Update unread count for other members
    db.prepare(`
      UPDATE chat_members 
      SET unreadCount = unreadCount + 1 
      WHERE chatId = ? AND userId != ?
    `).run(chatId, userId);

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    
    io.to(chatId).emit('message:new', {
      ...message,
      senderUsername: socket.username
    });
  });

  // Edit message
  socket.on('message:edit', (data) => {
    const { messageId, content } = data;
    
    const message = db.prepare(
      'SELECT * FROM messages WHERE id = ? AND senderId = ?'
    ).get(messageId, userId);
    
    if (!message) return;

    db.prepare(
      'UPDATE messages SET content = ?, edited = 1 WHERE id = ?'
    ).run(content, messageId);

    io.to(message.chatId).emit('message:updated', {
      messageId,
      content,
      edited: true
    });
  });

  // Delete message
  socket.on('message:delete', (data) => {
    const { messageId } = data;
    
    const message = db.prepare(
      'SELECT * FROM messages WHERE id = ? AND senderId = ?'
    ).get(messageId, userId);
    
    if (!message) return;

    db.prepare(
      'UPDATE messages SET deleted = 1 WHERE id = ?'
    ).run(messageId);

    io.to(message.chatId).emit('message:deleted', { messageId });
  });

  // Add reaction
  socket.on('message:react', (data) => {
    const { messageId, emoji } = data;
    
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!message) return;

    const reactionId = uuidv4();
    
    try {
      db.prepare(
        'INSERT INTO reactions (id, messageId, userId, emoji) VALUES (?, ?, ?, ?)'
      ).run(reactionId, messageId, userId, emoji);
      
      io.to(message.chatId).emit('message:reaction', {
        messageId,
        reaction: {
          id: reactionId,
          messageId,
          userId,
          emoji,
          userUsername: socket.username
        }
      });
    } catch (e) {
      // Reaction already exists, remove it
      db.prepare(
        'DELETE FROM reactions WHERE messageId = ? AND userId = ? AND emoji = ?'
      ).run(messageId, userId, emoji);
      
      io.to(message.chatId).emit('message:reaction-removed', {
        messageId,
        userId,
        emoji
      });
    }
  });

  // Typing indicator
  socket.on('chat:typing', (data) => {
    const { chatId, isTyping } = data;
    socket.to(chatId).emit('chat:typing', {
      chatId,
      userId,
      username: socket.username,
      isTyping
    });
  });

  // Read messages
  socket.on('message:read', (data) => {
    const { chatId } = data;
    db.prepare(
      'UPDATE chat_members SET unreadCount = 0 WHERE chatId = ? AND userId = ?'
    ).run(chatId, userId);
    
    socket.to(chatId).emit('message:read', {
      chatId,
      userId
    });
  });

  // WebRTC signaling
  socket.on('call:offer', (data) => {
    socket.to(data.to).emit('call:offer', {
      offer: data.offer,
      from: userId,
      fromUsername: socket.username
    });
  });

  socket.on('call:answer', (data) => {
    socket.to(data.to).emit('call:answer', {
      answer: data.answer,
      from: userId
    });
  });

  socket.on('call:ice-candidate', (data) => {
    socket.to(data.to).emit('call:ice-candidate', {
      candidate: data.candidate,
      from: userId
    });
  });

  socket.on('call:end', (data) => {
    socket.to(data.to).emit('call:end', {
      from: userId
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const userSockets = onlineUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run('offline', userId);
        io.emit('user:status', { userId, status: 'offline' });
      }
    }
    console.log(`User disconnected: ${socket.username}`);
  });
});

// Serve client for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Whisper server running on port ${PORT}`);
});
