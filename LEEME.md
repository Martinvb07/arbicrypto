# ArbiCrypto

Panel en vivo de **arbitraje en Binance** para ti y tu equipo: comprar barato y vender más caro al mismo tiempo, en P2P (pesos) y dentro de Binance Spot, solo con criptos principales. Todo se mide en **pesos por dólar (USDT)** y ya descuenta comisiones de Binance, el redondeo de cantidades, un colchón por movimiento de precio y el 4x1000 **solo sobre la ganancia** (lo que llega de más a Nequi; el capital va y vuelve sin cobro por los topes exentos).

## Cómo abrirlo (PM2)

El panel se maneja con **PM2**, igual en tu PC y en el VPS. La primera vez, en la carpeta del proyecto:

```bash
npm install -g pm2
pip install -r backend/requirements.txt
cd web && npm install && npm run build && cd ..
```

| Quiero… | Comando (en la carpeta del proyecto) |
|---|---|
| Usarlo en este PC | `pm2 start deploy/ecosystem.config.js` |
| Que mi equipo entre desde sus celulares o PCs (misma red Wi-Fi de confianza) | `pm2 start deploy/ecosystem.config.js --env equipo` |
| Ver si está prendido | `pm2 status` |
| Ver qué está pasando | `pm2 logs arbicrypto` |
| Reiniciarlo | `pm2 restart arbicrypto` |
| Apagarlo | `pm2 stop arbicrypto` |

Luego abre `http://127.0.0.1:8787`. Para cambiar entre "solo este PC" y "equipo": `pm2 delete arbicrypto` y vuelve a arrancarlo con el comando que quieras.

## En un servidor (VPS)

Para tenerlo en un VPS con dominio y HTTPS (Ubuntu + nginx + PM2 + MySQL) sigue **deploy/LEEME-VPS.md**. El backend corre en FastAPI + uvicorn; sin `DATABASE_URL` usa SQLite y los archivos de `backend/data`, con `DATABASE_URL=mysql://...` usa MySQL.

Cada `git push` a `main` se **despliega solo en el VPS** (GitHub Actions: revisa el código, actualiza, recarga PM2 y, si algo falla, vuelve a la versión anterior). Cómo configurarlo: *deploy/LEEME-VPS.md → Actualizar*.

## Usuarios

- Administrador: **jesuscrypto**. Cambia la contraseña en el menú de tu usuario (arriba a la derecha) → *Cambiar contraseña*.
- Invitar a alguien: pestaña **Equipo → Generar código** (sirve una sola vez y vence en 7 días). La persona toca *“Tengo un código de invitación”* y crea su usuario.
- **Cada usuario pone su propio capital** (Arbitraje → Capital) y ve las rutas y avisos para su monto.
- **Cada usuario conecta SU cuenta de Binance** en *Mi Binance* (llave de solo lectura). Solo esa persona ve sus saldos y órdenes; ni los administradores las ven, y nadie puede desconectar la cuenta de otro. Si un administrador borra un usuario, su llave se borra con él.
- Los administradores cambian 4x1000 y avisos, invitan gente y **cambian la contraseña de cualquier usuario** (Equipo → Contraseña).
- ¿Olvidaste la contraseña? Apaga el panel (`pm2 stop arbicrypto`) y en la carpeta `backend` ejecuta `python auth.py` → opción 2.

## Cómo se usa

- **Arbitraje**: indicadores arriba (estado, mejor ruta, dólar compra y venta) y la tabla de rutas de mejor a peor. En la barra de la tabla: filtro *Todas / P2P / Spot*, **Capital** (escríbelo y presiona Enter) y el interruptor **4x1000**. Toca *Pasos* para ver a quién comprarle y a quién venderle: cada paso trae un botón que abre al anunciante (o el par de Spot) en Binance y otro que copia el monto para pegarlo allá. Debajo, **También gana con otro monto** muestra lo que gana con anunciantes recomendables (50+ órdenes, 97 %+ completadas) que no aceptan tu capital, con el monto más cercano que sí aceptan. Los precios de Spot llegan en **tiempo real** y las rutas cercanas a cero se calculan con el **precio real para tu monto** (profundidad del libro y comisión real de cada par).
- **¿Dónde vendo? (Mis monedas)**: agrega cada moneda que tienes (cuánto tienes y cuánto te costó). La lista muestra en vivo cuánto ganas o pierdes si vendes ya, a quién venderle, cuánto falta para tu meta y el paso a paso con botones a Binance. Cada moneda tiene un switch **Avisarme cuando gane** (sonido, Windows y Telegram), y se puede editar o quitar.
- **Precios P2P**: lo que de verdad te cuesta comprar y recibes al vender con tu capital (comisión P2P y 4x1000 incluidos), gráfico del día y anuncios de cada cripto en verde (buen precio y anunciante confiable) o rojo. Si comprar y vender una cripto gana, con tu capital o con otro monto, aparece el **paso a paso** con los botones a Binance y las otras criptos que también ganan. Cada anuncio tiene su botón para comprarle o venderle (amarillo si es recomendable).
- **Simular anuncios**: calcula cuánto ganas si publicas tus propios anuncios de compra y venta en P2P. Pones el precio de cada anuncio (o tomas uno que ya existe), el monto, cuántas vueltas haces al día y tu comisión de Binance por anuncio (si conectaste tu cuenta, sale de tus órdenes como anunciante; si no, la más alta sin ser comerciante verificado: 0,35 %). Descuenta esa comisión, el 4x1000 de lo que pagas y el **impuesto de renta** sobre la ganancia (19 % por defecto; cámbialo según tu tramo, 0 % a 39 %). Muestra lo que te queda por vuelta, por dólar, al día y al mes, en qué puesto saldría tu anuncio frente a los de ahora y a cuánto debes vender (o hasta cuánto comprar) para no perder.
- **Historial**: cuántas oportunidades hubo, cuánto duraron y a qué hora del día el mercado se acerca más a dar ganancia. Se llena solo mientras el panel está prendido.
- **Mi Binance** (cada usuario, la suya): saldos y todas tus órdenes P2P guardadas (Binance solo entrega las últimas; el panel las va acumulando), con exportación a Excel.
- **Equipo** (administrador): códigos de invitación y usuarios.
- **Chat**: canal **General** para todo el equipo y **mensajes privados** entre dos personas (solo ellas los ven, ni siquiera el administrador). Muestra quién está conectado, cuenta los no leídos en la pestaña y avisa con sonido y notificación cuando llega un mensaje. Cada quien puede borrar sus mensajes; el administrador también puede borrar del General.
- Verde = ganancia, rojo = pérdida, gris = cero. Debajo de cada tabla dice qué costos incluye.

Fijo para que sea simple: todos los métodos de pago, criptos principales y anunciantes con 20+ órdenes.

**Cálculos conservadores:** cada cambio en Spot descuenta comisión, el redondeo de cantidades de Binance y un colchón de 0,1 % por movimiento de precio. Toda ruta con ganancia real que llegue a tu mínimo de aviso suena; si deja menos de **0,6 %** (P2P) o **0,1 %** (Spot) sale como *Justa · actúa rápido*: gana poco y si un precio cambia mientras operas puede volverse pérdida. En Spot usa siempre **orden de Mercado, nunca Convertir**, y si en un paso te llega menos del mínimo que indica el panel, no sigas.

## Funcionamiento 24/7

- **Arrancar solo con Windows**: una vez, `npm install -g pm2-windows-startup`, luego `pm2-startup install` y `pm2 save` con el panel prendido.
- **Se reinicia solo** si el panel se cae (PM2).
- **Vigilante**: si el escáner de Spot o P2P deja de responder, te llega un aviso (también por Telegram) y otro cuando vuelve.
- Para que no se detenga, configura Windows para que el PC **no entre en suspensión** (Configuración → Sistema → Inicio/apagado y suspensión → Nunca).
- Para entrar desde fuera de tu Wi-Fi de forma segura, la opción más simple es instalar **Tailscale** (gratis) en este PC y en los celulares del equipo y usar el modo equipo (`--env equipo`).

## Avisos (botón **Avisos** en la barra de arriba)

- **Avisar desde**: cuántos pesos por dólar debe dejar una ruta para avisarte (por defecto $3).
- **Sonido**: el navegador solo deja sonar después de tocar la página una vez.
- **Notificaciones de Windows**: llegan aunque estés en otra pestaña, con el panel abierto.
- **Celular (Telegram)**: *Configurar* → crea un bot con @BotFather, pega el token, escríbele `/start` y toca *Buscar mi chat*. Para el equipo, agrega el bot a un grupo y escribe `/start` ahí.
- Cada aviso trae los enlaces directos a Binance (anunciante para comprar y vender, par de Spot, billetera), en el panel y en Telegram. Tocar la notificación de Windows abre la pestaña con el paso a paso.
- Solo suena cuando aparece una ruta **nueva** con ganancia. Se ignora lo que promete más del 3 % (casi siempre son precios viejos) y las rutas de Spot deben confirmarse en 2 revisiones seguidas.

## Seguridad

- Las llaves de Binance deben ser **solo lectura**: el panel rechaza llaves con trading, retiros o transferencias. Se ingresan desde el PC donde corre el panel (en el VPS, por HTTPS).
- Las llaves de todos se guardan **cifradas** (`binance_keys` en `backend/data` o en MySQL). La clave para descifrarlas es `APP_SECRET`, en `backend/.env`: **guárdala en un lugar seguro**. Si se pierde, cada persona tendrá que conectar su cuenta otra vez.
- Contraseñas cifradas con PBKDF2-SHA256 (600.000 iteraciones). Sesiones con cookie HttpOnly y SameSite=Strict, bloqueo tras 8 intentos fallidos, códigos de invitación de un solo uso.
- Protecciones contra CSRF, clickjacking, DNS rebinding y lectura de archivos internos; cabeceras de seguridad (CSP) en todas las páginas.
- `backend/.env` (APP_SECRET y Telegram) y `backend/data/` (usuarios y llaves cifradas) son privados: no los compartas ni los subas a internet.
- El modo equipo usa HTTP sin cifrar dentro de tu Wi-Fi: úsalo solo en redes de confianza (casa u oficina), nunca en Wi-Fi públicas.
- Las ganancias son estimadas con el mejor precio del momento. Confirma siempre en Binance antes de pagar. No es asesoría financiera.

## Carpetas

```
crypto-jesus/
  backend/   Python (FastAPI): lee Binance (también en tiempo real), calcula oportunidades, avisos, usuarios e historial
    data/    SQLite y archivos (si no usas MySQL)
  web/       Next.js + TypeScript: la interfaz (se compila a web/out)
  deploy/    PM2, nginx y la guía del VPS
```

Si cambias algo en `web/src`: `cd web && npm run build` y luego `pm2 restart arbicrypto`.
