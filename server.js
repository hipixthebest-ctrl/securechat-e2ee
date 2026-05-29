const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

try {
    console.log('1. Starting server initialization...');
    
    const app = express();
    const server = http.createServer(app);
    
    // Создаём папку и HTML
    const clientDir = path.join(__dirname, 'client');
    if (!fs.existsSync(clientDir)) {
        fs.mkdirSync(clientDir);
        console.log('📁 Created client/ folder');
    }
    
    const indexPath = path.join(clientDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
        fs.writeFileSync(indexPath, `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>SecureChat</title>
</head>
<body>
    <h1>SecureChat E2EE</h1>
    <p>Server is running!</p>
</body>
</html>`);
        console.log('✅ Created client/index.html');
    }
    
    console.log('2. Setting up static files...');
    app.use(express.static(clientDir));
    
    console.log('3. Setting up routes...');
    app.get('/', (req, res) => {
        res.sendFile(path.join(clientDir, 'index.html'));
    });
    
    console.log('4. Starting server...');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server is running on port ${PORT}`);
    }).on('error', (err) => {
        console.error('❌ Server error:', err);
        process.exit(1);
    });
    
} catch (error) {
    console.error('❌ FATAL ERROR:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
}

// На случай необработанных ошибок
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
