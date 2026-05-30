[...Оставьте всё как было выше до строки, где начинается app.get('/', ...)]

// ========== HTML ==========
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
    ...
</head>
<body>
    ...
    <script src="/socket.io/socket.io.js"></script>
    <script>
        // ВСЕ ПЕРЕМЕННЫЕ ...

        // ========== ЭКРАНЫ ==========
        function showScreen(screen) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            const screenMap = { 'login': 'login-screen', '2fa': '2fa-screen', 'chats': 'chats-screen', 'chat': 'chat-screen', 'settings': 'settings-screen' };
            const screenId = screenMap[screen] || screen;
            document.getElementById(screenId).classList.add('active');
            if (screen === 'settings') loadSettingsUI();
        }

        // Исправленная goBack согласно вашему запросу
        function goBack() {
            // 1. Скрываем экран чата
            document.getElementById('chat-screen').classList.remove('active');
            // 2. Показываем список чатов (у вас chats-screen)
            document.getElementById('chats-screen').classList.add('active');
            // 3. Форсируем обновление контактов
            loadContacts();
        }

        // === далее остальной фронтенд-скрипт ===
        // ...
    </script>
</body>
</html>`);
});

// ...
// Всё остальное без изменений
