const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();

// Отдаём HTML прямо из строки
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Chat</title>
            <style>
                body {
                    background: black;
                    color: lime;
                    text-align: center;
                    padding-top: 100px;
                    font-family: Arial;
                    font-size: 40px;
                }
            </style>
        </head>
        <body>
            NO PUBLIC FOLDER - INLINE HTML
            <script src="/socket.io/socket.io.js"></script>
        </body>
        </html>
    `);
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

io.on('connection', (socket) => {
    console.log('User:', socket.id);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port', PORT);
});
