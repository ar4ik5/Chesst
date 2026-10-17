# Chess.tg — шахматы для Telegram Mini App

Статический проект без сборки и зависимостей.

## Структура
- `index.html` — разметка и подключение скриптов
- `css/style.css` — стили (светлая/тёмная тема)
- `js/engine.js` — правила шахмат, генерация ходов, запись партии
- `js/bot.js` — бот (оценка позиции + альфа-бета поиск, 3 уровня)
- `js/app.js` — интерфейс, состояние партии, сохранение, Telegram WebApp API

## Запуск локально
    python3 -m http.server 8080
затем откройте http://localhost:8080

## Подключение к Telegram
1. Выложите папку на HTTPS-хостинг (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
2. В @BotFather: `/newapp` (или `/setmenubutton`) и укажите URL.
3. Скрипт `telegram-web-app.js` уже подключён в `index.html`.
