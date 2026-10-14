# ArbiCrypto en un VPS (Ubuntu + nginx + PM2 + MySQL)

Cómo queda montado:

```
Internet ──HTTPS──► nginx (443) ─┬─ arbicrypto.org        ──► Portada y login (los sirve el panel, 127.0.0.1:8787)
                                 ├─ panel.arbicrypto.org  ──► Panel en 127.0.0.1:8787  (FastAPI + uvicorn, PM2: arbicrypto)
                                 │                                ├─ MySQL  base arbicrypto
                                 │                                └─ Redis  (opcional: eventos en vivo y límite de intentos de login)
                                 └─ wallet.arbicrypto.org ──► Wallet en 127.0.0.1:8788  (FastAPI + uvicorn, PM2: arbicrypto-wallet)
                                                                  └─ MySQL  base arbicrypto_wallet
```

Las dos apps viven en el mismo repositorio y comparten el entorno de Python (`backend/.venv`). La wallet se configura en el paso 11.

Cómo se entra: **arbicrypto.org** es la portada (sale en Google). *Iniciar sesión* lleva a **arbicrypto.org/login**, donde cada
persona elige *Panel* o *Wallet*; después de entrar sigue a **panel.arbicrypto.org** o a **su** wallet en **wallet.arbicrypto.org**.
Es una sola sesión para los tres dominios (cookie de `.arbicrypto.org`).

> **Importante:** Binance bloquea las IPs de **Estados Unidos**. Usa un VPS en otra región (por ejemplo Brasil, Europa o Colombia).
>
> Lo que cuenta es el país que Binance le asigna a la IP, no dónde dice el proveedor que está el servidor: hay VPS "en Brasil"
> con IP registrada en Estados Unidos. Antes de instalar nada, pruébalo en el VPS (debe dar `200`, no `451`):
>
> ```bash
> curl -4 -s ipinfo.io | grep -E '"(ip|city|country)"'
> curl -4 -s -o /dev/null -w "%{http_code}\n" https://api.binance.com/api/v3/ping
> ```

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
git clone https://github.com/Martinvb07/arbicrypto.git .
mkdir -p logs
```

**Nunca** subas `backend/.env` ni `backend/data/` a git (el repositorio es público). Si vas a traer tus datos actuales, cópialos aparte (paso 6).

## 4. Backend (Python)

```bash
cd /opt/arbicrypto/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r ../wallet/backend/requirements.txt   # panel y wallet
```

Crea `backend/.env` con:

```ini
DATABASE_URL=mysql://arbicrypto:CLAVE-SEGURA@127.0.0.1:3306/arbicrypto
# REDIS_URL=redis://127.0.0.1:6379/0      ← solo si instalaste Redis
COOKIE_SECURE=1      # la sesión solo viaja por HTTPS
REMOTE_ADMIN=1       # cada usuario conecta SU cuenta de Binance desde su navegador (por HTTPS)
SITE_DOMAIN=arbicrypto.org   # portada y login en arbicrypto.org, panel en panel., wallet en wallet. (una sola sesión)
# APP_SECRET=...     # lo crea el panel solo la primera vez: cifra las llaves de Binance de todos
# SSO_SECRET=...     # lo crea el panel solo la primera vez: firma la entrada a la wallet
```

Protégelo: `chmod 600 .env`

Si traes tus datos del PC, copia también la línea `APP_SECRET` de tu `.env`: sin ella no se pueden descifrar las llaves de Binance ya guardadas (cada quien tendría que conectar su cuenta otra vez).

## 5. Interfaz (Next.js)

```bash
cd /opt/arbicrypto/web
npm ci
npm run build          # genera web/out, que sirve el backend
```

## 6. Tus datos

- **Empezar de cero:** crea el administrador con `cd /opt/arbicrypto/backend && .venv/bin/python auth.py` (opción 1).
- **Traer lo que ya tienes:** copia tu carpeta `backend/data/` del PC al VPS (misma ruta) y la línea `APP_SECRET` de tu `.env`. La primera vez que el panel arranca con MySQL vacío, copia solo todo (usuarios, llaves cifradas, monedas, historial, avisos y órdenes). No borra nada de `data/`.

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

En tu proveedor del dominio crea cuatro registros **A** con la IP del VPS: `arbicrypto.org` (@), `www`, `panel` y `wallet`.

Panel (panel.arbicrypto.org):

```bash
sudo cp /opt/arbicrypto/deploy/nginx-arbicrypto.conf /etc/nginx/sites-available/arbicrypto
sudo sed -i 's/TU-DOMINIO.com/panel.arbicrypto.org/g' /etc/nginx/sites-available/arbicrypto
sudo ln -s /etc/nginx/sites-available/arbicrypto /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d panel.arbicrypto.org     # certificado gratis y renovación automática
```

Portada y login (arbicrypto.org y www, los sirve el mismo panel):

```bash
sudo cp /opt/arbicrypto/deploy/nginx-sitio.conf /etc/nginx/sites-available/arbicrypto-sitio
sudo ln -s /etc/nginx/sites-available/arbicrypto-sitio /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d arbicrypto.org -d www.arbicrypto.org
```

La wallet (wallet.arbicrypto.org) va en el paso 11.

### Imágenes del chat (si ya tenías nginx instalado)

nginx deja pasar como máximo 64 KB por petición, y una imagen del chat pesa más (sale *Error 413*). El archivo `deploy/nginx-arbicrypto.conf` ya trae la excepción; si instalaste nginx antes, agrégala una vez:

```bash
sudo sed -i '/location = \/api\/events {/i\    location = /api/chat/send {\n        client_max_body_size 5m;\n        proxy_pass http://arbicrypto;\n        proxy_read_timeout 60s;\n    }\n' /etc/nginx/sites-available/arbicrypto
sudo nginx -t && sudo systemctl reload nginx
```

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

El puerto **8787 nunca se abre** a internet: solo nginx habla con el panel.

## 10. Binance

Cada persona crea en Binance → Gestión de API una llave de **solo lectura**, la restringe a la **IP del VPS** y la conecta desde **Mi Binance** con su propio usuario (por HTTPS). Cada quien solo ve su cuenta.

---

## Actualizar: automático con cada push (CI/CD)

Igual que en ReservaTuCancha: cada `git push` a `main` dispara **GitHub Actions** (`.github/workflows/deploy.yml`):

1. **CI**: instala todo, revisa errores del backend, comprueba que la app carga, revisa los tipos y compila la interfaz. Si algo falla, **no se despliega**.
2. **Deploy**: entra al VPS por SSH, deja el código en esa versión, instala dependencias, compila la interfaz y recarga PM2.
3. **Verificación**: espera a que `http://127.0.0.1:8787/login` (panel) y `http://127.0.0.1:8788/` (wallet) respondan. Si alguna no responde, **vuelve sola a la versión anterior**.

`backend/.env`, `wallet/backend/.env`, `backend/data`, `wallet/backend/data`, `.venv`, `node_modules` y `logs` nunca se tocan.

### Configurarlo (una sola vez)

En el VPS, con el usuario que corre PM2, crea una llave SSH solo para el deploy:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "deploy-arbicrypto"
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy          # esta es la PRIVADA: va a GitHub y luego puedes borrarla del VPS
```

En GitHub → repositorio **arbicrypto** → *Settings → Secrets and variables → Actions*, crea estos secretos (o en *Environments → produccion*):

| Secreto | Valor |
|---|---|
| `VPS_SSH_KEY` | la llave **privada** que mostró el último comando (todo, con las líneas BEGIN/END) |
| `VPS_HOST` | la IP o dominio del VPS |
| `VPS_USER` | el usuario del VPS (el mismo que corre PM2) |
| `VPS_PATH` | `/opt/arbicrypto` |

Listo: el próximo push a `main` se despliega solo. También puedes lanzarlo a mano en *Actions → CI y Deploy a VPS → Run workflow*. El primer arranque (pasos 1 a 9) sí se hace a mano.

## 11. La wallet (wallet.arbicrypto.org)

Necesitas un registro A de `wallet.arbicrypto.org` apuntando a la IP del VPS (igual que el panel).

**Base de datos** (en `sudo mysql`; el mismo usuario `arbicrypto`, otra base):

```sql
CREATE DATABASE arbicrypto_wallet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON arbicrypto_wallet.* TO 'arbicrypto'@'localhost';
FLUSH PRIVILEGES;
```

Necesita MySQL 8.0.13 o más nuevo (el de Ubuntu 22.04 y 24.04 sirve).

**`wallet/backend/.env`** (`chmod 600`):

```ini
DATABASE_URL=mysql://arbicrypto:CLAVE-SEGURA@127.0.0.1:3306/arbicrypto_wallet
COOKIE_SECURE=1                      # la sesión solo viaja por HTTPS
ALLOWED_HOSTS=wallet.arbicrypto.org  # el dominio con el que se abre (protección contra DNS rebinding)
# APP_SECRET=...                     # lo crea la wallet sola la primera vez: cifra las llaves de Binance
```

**Interfaz y datos:**

```bash
cd /opt/arbicrypto/wallet/web && npm ci && npm run build
```

- **Usuarios:** son los del panel. Cada uno entra a SU wallet desde el menú de su usuario → **Wallet** (sin otro login).
  `SSO_SECRET` lo crea el panel en `backend/.env` y la wallet lo lee de ahí: no hay que configurar nada.
- **Traer lo de tu PC:** copia `wallet/backend/data/` del PC al VPS (misma ruta) y la línea `APP_SECRET` de tu `wallet/backend/.env`.
  La primera vez que la wallet arranca con MySQL vacío copia sola todo `wallet.db` (usuarios, movimientos, cierres, extractos, llaves cifradas).

**PM2 y nginx** (el `ecosystem.config.js` ya trae las dos apps):

```bash
cd /opt/arbicrypto && pm2 start deploy/ecosystem.config.js && pm2 save
sudo cp /opt/arbicrypto/deploy/nginx-wallet.conf /etc/nginx/sites-available/arbicrypto-wallet
sudo ln -s /etc/nginx/sites-available/arbicrypto-wallet /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d wallet.arbicrypto.org
```

El puerto **8788 nunca se abre** a internet: solo nginx habla con la wallet.

## Copias de seguridad

```bash
mysqldump -u arbicrypto -p arbicrypto > respaldo-panel-$(date +%F).sql
mysqldump -u arbicrypto -p arbicrypto_wallet > respaldo-wallet-$(date +%F).sql
```

Guarda también `backend/.env` y `wallet/backend/.env` en un lugar seguro: tienen `APP_SECRET` (descifra las llaves de Binance de todos) y el token de Telegram. El respaldo de MySQL trae las llaves **cifradas**: sin `APP_SECRET` no sirven. Los extractos bancarios originales están en `wallet/backend/data/extractos`: cópialos también.

## En tu PC con Windows

Se prende con PM2 igual que aquí (ver LEEME.md). Para que use MySQL, crea la base y el usuario (paso 2) y agrega a `backend\.env`:

```ini
DATABASE_URL=mysql://arbicrypto:CLAVE-SEGURA@127.0.0.1:3306/arbicrypto
```

Reinicia el panel (`pm2 restart arbicrypto`): la primera vez copia solo tus datos de `backend\data` a MySQL.
Sin `DATABASE_URL` sigue usando SQLite y los archivos de `backend\data`.
