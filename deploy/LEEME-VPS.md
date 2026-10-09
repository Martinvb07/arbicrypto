# ArbiCrypto en un VPS (Ubuntu + nginx + PM2 + MySQL)

Cómo queda montado:

```
Internet ──HTTPS──► nginx (443) ──► ArbiCrypto en 127.0.0.1:8787 (FastAPI + uvicorn, lo mantiene PM2)
                                        ├─ MySQL   (usuarios, monedas, bitácora, historial…)
                                        └─ Redis   (opcional: eventos en vivo y límite de intentos de login)
```

> **Importante:** Binance bloquea las IPs de **Estados Unidos**. Usa un VPS en otra región (por ejemplo Brasil, Europa o Colombia).

---

## 1. Instalar lo necesario (una sola vez)

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx certbot python3-certbot-nginx mysql-server git
# Node.js 20 (para compilar la interfaz y para PM2)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Redis es **opcional**. Si lo quieres, se instala con una sola línea:

```bash
sudo apt install -y redis-server
```

## 2. Crear la base de datos y su usuario en MySQL

Esto sirve igual en el VPS y en tu PC con Windows (ahí abre *MySQL 8.0 Command Line Client* o Workbench).
Entra a MySQL como administrador:

```bash
sudo mysql
```

Y pega esto, cambiando `CLAVE-SEGURA` por una contraseña larga:

```sql
CREATE DATABASE arbicrypto CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'arbicrypto'@'localhost' IDENTIFIED BY 'CLAVE-SEGURA';
GRANT ALL PRIVILEGES ON arbicrypto.* TO 'arbicrypto'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

El usuario `arbicrypto` solo puede tocar su propia base, nada más del servidor.
Si la clave tiene caracteres como `@`, `:` o `/`, escríbelos en la URL como `%40`, `%3A` y `%2F`.

## 3. Subir el proyecto

```bash
sudo mkdir -p /opt/arbicrypto && sudo chown $USER /opt/arbicrypto
cd /opt/arbicrypto
git clone <tu-repositorio> .          # o súbelo con scp/WinSCP (sin node_modules)
mkdir -p logs
```

**Nunca** subas `backend/.env` ni `backend/data/` a git. Si vas a traer tus datos actuales, cópialos aparte (paso 6).

## 4. Backend (Python)

```bash
cd /opt/arbicrypto/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Crea `backend/.env` con:

```ini
DATABASE_URL=mysql://arbicrypto:CLAVE-SEGURA@127.0.0.1:3306/arbicrypto
# REDIS_URL=redis://127.0.0.1:6379/0      ← solo si instalaste Redis
COOKIE_SECURE=1      # la sesión solo viaja por HTTPS
REMOTE_ADMIN=1       # permite conectar la cuenta de Binance desde el navegador (en el VPS no hay "PC local")
```

Protégelo: `chmod 600 .env`

## 5. Interfaz (Next.js)

```bash
cd /opt/arbicrypto/web
npm ci
npm run build          # genera web/out, que sirve el backend
```

## 6. Tus datos

- **Empezar de cero:** crea el administrador con `cd /opt/arbicrypto/backend && .venv/bin/python auth.py` (opción 1).
- **Traer lo que ya tienes:** copia tu carpeta `backend/data/` del PC al VPS (misma ruta) y ejecuta:

  ```bash
  cd /opt/arbicrypto/backend && .venv/bin/python migrate.py
  ```

  Pasa usuarios, monedas, bitácora, historial, avisos y órdenes a MySQL. No borra nada de `data/`.

## 7. Encenderlo con PM2

```bash
cd /opt/arbicrypto
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup           # copia y ejecuta el comando que te muestra: así arranca solo al reiniciar el VPS
```

Útiles:

| Para | Comando |
|---|---|
| Ver si está corriendo | `pm2 status` |
| Ver los registros | `pm2 logs arbicrypto` |
| Reiniciar | `pm2 restart arbicrypto` |

Debe correr **una sola copia** (ya viene así en `ecosystem.config.js`): los escáneres viven en memoria.

## 8. nginx + HTTPS

Necesitas un dominio apuntando a la IP del VPS (registro A).

```bash
sudo cp /opt/arbicrypto/deploy/nginx-arbicrypto.conf /etc/nginx/sites-available/arbicrypto
sudo sed -i 's/TU-DOMINIO.com/tudominio.com/g' /etc/nginx/sites-available/arbicrypto
sudo ln -s /etc/nginx/sites-available/arbicrypto /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tudominio.com     # certificado gratis y renovación automática
```

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

El puerto **8787 nunca se abre** a internet: solo nginx habla con el panel.

## 10. Binance

En Binance → Gestión de API, restringe la llave de **solo lectura** a la **IP del VPS**. Luego conéctala desde **Mi Binance** en el panel (con HTTPS).

---

## Actualizar a una versión nueva

```bash
cd /opt/arbicrypto
git pull
backend/.venv/bin/pip install -r backend/requirements.txt
cd web && npm ci && npm run build && cd ..
pm2 restart arbicrypto
```

## Copias de seguridad

```bash
mysqldump -u arbicrypto -p arbicrypto > respaldo-$(date +%F).sql
```

Guarda también `backend/.env` en un lugar seguro: tiene la llave de Binance y el token de Telegram.

## En tu PC con Windows

Funciona igual que siempre con `iniciar.bat`. Para que use MySQL, crea la base y el usuario (paso 2) y agrega a `backend\.env`:

```ini
DATABASE_URL=mysql://arbicrypto:CLAVE-SEGURA@127.0.0.1:3306/arbicrypto
```

Luego, con el panel apagado: `python migrate.py` (dentro de `backend`) para pasar tus datos, y vuelve a abrir el panel.
Sin `DATABASE_URL` sigue usando SQLite y los archivos de `backend\data`.
