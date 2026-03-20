# AGENTS.md

## Обязательные проверки перед коммитом
- Перед каждым коммитом запускать `npm run build` в корне репозитория.
- Коммитить только если `npm run build` завершился без ошибок.

## Деплой и дебаг на сервере

- Бот работает в Docker-контейнере `pesiki-bot` на сервере x260 (SSH хост `192.168.0.118`, юзер `gleb`)
- Деплой автоматический: push в `main` → GitHub Actions → `docker compose up` на x260
- Секреты (токены, ключи, прокси) хранятся в GitHub Repository Secrets и пробрасываются через workflow
- Для дебага: подключиться по SSH и смотреть логи/env контейнера (`docker logs pesiki-bot`, `docker exec pesiki-bot printenv`)
- Если env не обновился после деплоя — контейнер нужно пересоздать с `--force-recreate`
