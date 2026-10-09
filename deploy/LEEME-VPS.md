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
git clone https://github.com/Martinvb07/arbicrypto.git .
mkdir -p logs
```

**Nunca** subas `backend/.env` ni `backend/data/` a git (el repositorio es público). Si vas a traer tus datos actuales, cópialos aparte (paso 6).

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
REMOTE_ADMIN=1       # cada usuario conecta SU cuenta de Binance desde su navegador (por HTTPS)
# APP_SECRET=...     # lo crea el panel solo la primera vez: cifra las llaves de Binance de todos
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
- **Traer lo que ya tienes:** copia tu carpeta `backend/data/` del PC al VPS (misma ruta) y la línea `APP_SECRET` de tu `.env`. La primera vez que el panel arranca con MySQL vacío, copia solo todo (usuarios, llaves cifradas, monedas, bitácora, historial, avisos y órdenes). No borra nada de `data/`.

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

Cada persona crea en Binance → Gestión de API una llave de **solo lectura**, la restringe a la **IP del VPS** y la conecta desde **Mi Binance** con su propio usuario (por HTTPS). Cada quien solo ve su cuenta.

---

## Actualizar: automático con cada push (CI/CD)

Igual que en ReservaTuCancha: cada `git push` a `main` dispara **GitHub Actions** (`.github/workflows/deploy.yml`):

1. **CI**: instala todo, revisa errores del backend, comprueba que la app carga, revisa los tipos y compila la interfaz. Si algo falla, **no se despliega**.
2. **Deploy**: entra al VPS por SSH, deja el código en esa versión, instala dependencias, compila la interfaz y recarga PM2.
3. **Verificación**: espera a que `http://127.0.0.1:8787/login` responda. Si no responde, **vuelve sola a la versión anterior**.

`backend/.env`, `backend/data`, `.venv`, `node_modules` y `logs` nunca se tocan.

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

## Copias de seguridad

```bash
mysqldump -u arbicrypto -p arbicrypto > respaldo-$(date +%F).sql
```

Guarda también `backend/.env` en un lugar seguro: tiene `APP_SECRET` (descifra las llaves de Binance de todos) y el token de Telegram. El respaldo de MySQL trae las llaves **cifradas**: sin `APP_SECRET` no sirven.

## En tu PC con Windows

Se prende con PM2 igual que aquí (ver LEEME.md). Para que use MySQL, crea la base y el usuario (paso 2) y agrega a `backend\.env`:

```ini
DATABASE_URL=mysql://arbicrypto:CLAVE-SEGURA@127.0.0.1:3306/arbicrypto
```

Reinicia el panel (`pm2 restart arbicrypto`): la primera vez copia solo tus datos de `backend\data` a MySQL.
Sin `DATABASE_URL` sigue usando SQLite y los archivos de `backend\data`.
