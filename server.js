const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

try {
    console.log('1. Starting server initialization...');
    
    const app = express();
    const server = http.createServer(app);
    
    // Создаём папку client если её нет
    const clientDir = path.join(__dirname, 'client');
    if (!fs.existsSync(clientDir)) {
        fs.mkdirSync(clientDir);
        console.log('📁 Created client/ folder');
    }
    
    // Создаём index.html если его нет
    const indexPath = path.join(clientDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SecureChat E2EE</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 0;
            padding: 20px;
        }
        .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 50px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
            max-width: 800px;
            width: 100%;
        }
        h1 {
            font-size: 3.5rem;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .subtitle {
            font-size: 1.3rem;
            margin-bottom: 30px;
            opacity: 0.9;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .feature {
            background: rgba(255, 255, 255, 0.15);
            padding: 25px;
            border-radius: 15px;
            transition: transform 0.3s;
        }
        .feature:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.25);
        }
        .feature-icon {
            font-size: 3rem;
            margin-bottom: 10px;
        }
        .feature-title {
            font-size: 1.2rem;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .feature-desc {
            font-size: 0.9rem;
            opacity: 0.85;
        }
        .status {
            margin-top: 30px;
            padding: 15px;
            background: rgba(76, 175, 80, 0.3);
            border-radius: 10px;
            display: inline-block;
        }
        .status-dot {
            display: inline-block;
            width: 10px;
            height: 10px;
            background-color: #4CAF50;
            border-radius: 50%;
            margin-right: 8px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 SecureChat</h1>
        <p class="subtitle">End-to-End Encrypted Messaging Platform</p>
        
        <div class="features">
            <div class="feature">
                <div class="feature-icon">🔐</div>
                <div class="feature-title">E2E Encrypted</div>
                <div class="feature-desc">Messages encrypted end-to-end</div>
            </div>
            <div class="feature">
                <div class="feature-icon">⚡</div>
                <div class="feature-title">Real-time</div>
                <div class="feature-desc">Instant message delivery</div>
            </div>
            <div class="feature">
                <div class="feature-icon">🛡️</div>
                <div class="feature-title">Secure</div>
                <div class="feature-desc">Military-grade encryption</div>
            </div>
        </div>
        
        <div class="status">
            <span class="status-dot"></span>
            <strong>Server Status: Online</strong> ✅
        </div>
        <p style="margin-top: 20px; opacity: 0.7; font-size: 0.9rem;">
            Your secure chat application is ready!
        </p>
    </div>
</body>
</html>`;
        
        fs.writeFileSync(indexPath, htmlContent, 'utf8');
        console.log('✅ Created client/index.html');
    }
    
    // Диагностика
    console.log('2. Client directory contents:', fs.readdirSync(clientDir));
    console.log('3. Index exists:', fs.existsSync(indexPath));
    console.log('4. Index size:', fs.statSync(indexPath).size, 'bytes');
    
    // Настройка статических файлов
    console.log('5. Setting up static files...');
    app.use(express.static(clientDir));
    
    // Основной маршрут
    console.log('6. Setting up routes...');
    app.get('/', (req, res) => {
        console.log('📄 GET / requested');
        res.sendFile(indexPath, (err) => {
            if (err) {
                console.error('❌ Error sending file:', err);
                res.status(500).send('<h1>Error loading page</h1>');
            } else {
                console.log('✅ index.html sent successfully');
            }
        });
    });
    
    // Тестовый маршрут
    app.get('/test', (req, res) => {
        console.log('🧪 GET /test requested');
        res.send('<h1 style="color:green; text-align:center; margin-top:100px;">✅ Server is working!</h1>');
    });
    
    // Запуск сервера
    console.log('7. Starting server...');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server is running on port ${PORT}`);
        console.log(`🌐 Visit: http://localhost:${PORT}`);
        console.log(`🧪 Test: http://localhost:${PORT}/test`);
    }).on('error', (err) => {
        console.error('❌ Server error:', err);
        process.exit(1);
    });
    
} catch (error) {
    console.error('❌ FATAL ERROR:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
}

// Обработка необработанных ошибок
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
