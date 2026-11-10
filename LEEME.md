# ArbiCrypto

Panel en vivo de **arbitraje en Binance** para ti y tu equipo: comprar barato y vender más caro al mismo tiempo, en P2P (pesos) y dentro de Binance Spot, solo con criptos principales. Todo se mide en **pesos por dólar (USDT)** y ya descuenta comisiones de Binance, el redondeo de cantidades, un colchón por movimiento de precio y el 4x1000 (ver *Precios P2P → Mis costos*). La renta no se descuenta: se cuadra por aparte.

En el mismo repositorio está **ArbiCrypto Wallet** (carpeta `wallet/`): la contabilidad de tus cripto, ganancias e impuestos en Colombia (DIAN, formulario 210). Usa las mismas tecnologías y se prende con el mismo PM2; ver **wallet/LEEME.md**.

| App | Carpeta | En tu PC | En el VPS |
|---|---|---|---|
| Portada y login | `web/src/app/inicio` + `login` (los sirve el panel) | http://127.0.0.1:8787 sin sesión | arbicrypto.org · arbicrypto.org/login |
| Panel (bot y oportunidades) | `backend/` + `web/` | http://127.0.0.1:8787 | panel.arbicrypto.org |
| Wallet (ganancias e impuestos) | `wallet/backend/` + `wallet/web/` | http://127.0.0.1:8788 | wallet.arbicrypto.org |

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
- Invitar a alguien: pestaña **Equipo → Códigos de acceso → Generar código** (sirve una sola vez y vence en 7 días). La persona toca *“Tengo un código de invitación”* y crea su usuario. **Entra sin equipo.**
- **Equipos**: cada quien está en un equipo o en ninguno, y solo ve y le escribe (chat General y privados) a los de su equipo; los administradores le pueden escribir a cualquiera. En la pestaña **Equipo**, quien no tiene equipo **crea uno** (queda de dueño) o **pide unirse** a otro; el dueño acepta o rechaza las solicitudes, invita a gente sin equipo, cambia el nombre y saca miembros. Los administradores, en *Equipo → Administración*, crean equipos, ponen a cualquiera en uno (o lo dejan sin equipo) y los borran. La primera vez, todos los usuarios que ya existían quedan en *Equipo principal* con el chat General de siempre.
- **Cada usuario pone su propio capital** (Arbitraje → Capital) y ve las rutas y avisos para su monto.
- **Cada usuario conecta SU cuenta de Binance** en *Mi Binance* (llave de solo lectura). Solo esa persona ve sus saldos y órdenes; ni los administradores las ven, y nadie puede desconectar la cuenta de otro. Si un administrador borra un usuario, su llave se borra con él.
- **Wallet**: menú de tu usuario (arriba a la derecha) → *Wallet*. Abre TU contabilidad e impuestos (wallet.arbicrypto.org) con la misma sesión, sin otro login. Cada usuario tiene la suya; nadie más la ve, ni los administradores.
- Los administradores cambian 4x1000 y avisos, invitan gente y **cambian la contraseña de cualquier usuario** (Equipo → Contraseña).
- ¿Olvidaste la contraseña? Apaga el panel (`pm2 stop arbicrypto`) y en la carpeta `backend` ejecuta `python auth.py` → opción 2.

## Cómo se usa

- **Arbitraje**: indicadores arriba (estado, mejor ruta, dólar compra y venta) y la tabla de rutas de mejor a peor. En la barra de la tabla: filtro *Todas / P2P / Spot*, **Capital** (escríbelo y presiona Enter) y el interruptor **4x1000**. Toca *Pasos* para ver a quién comprarle y a quién venderle: cada paso trae un botón que abre al anunciante (o el par de Spot) en Binance y otro que copia el monto para pegarlo allá. Debajo, **También gana con otro monto** muestra lo que gana con anunciantes recomendables (50+ órdenes, 97 %+ completadas) que no aceptan tu capital, con el monto más cercano que sí aceptan. Los precios de Spot llegan en **tiempo real** y las rutas cercanas a cero se calculan con el **precio real para tu monto** (profundidad del libro y comisión real de cada par).
- **¿Dónde vendo? (Mis monedas)**: agrega cada moneda que tienes (cuánto tienes y cuánto te costó). La lista muestra en vivo cuánto ganas o pierdes si vendes ya, a quién venderle, cuánto falta para tu meta y el paso a paso con botones a Binance. Con tu Binance conectado, **se ajusta sola** con tus órdenes P2P hechas después de anotarla: si vendes una parte queda lo que te quedó con su costo proporcional, si compras más se suma, y si vendes todo pasa a *Terminadas*. Si **compras una cripto que no tenías en la lista**, se agrega sola con lo que te llegó (sin la comisión) y lo que pagaste, con el aviso prendido; cada fila dice **a cuánto vender lo que te queda para no perder**. Si un comprador **no recibe todo pero sí una parte** (p. ej. compra de $200.000 a $300.000) y con esa parte ganas, también te avisa y la fila lo muestra (*Parte 93,90 → +$1.257*). Cada moneda tiene un switch **Avisarme cuando gane** (sonido, Windows y Telegram), y se puede editar o quitar.
- **Precios P2P**: arriba tu capital, **Mis costos** y **Mis medios**, y tres vistas:
  - **Con mi capital** (la de siempre al abrir): solo anuncios que aceptan tu capital y tus medios de pago. Muestra a quién comprarle y a quién venderle, el desglose (pagas, recibes, comisión P2P, 4x1000 → te queda), el paso a paso con botones a Binance, todas las criptos con lo que te queda con tu capital y los anuncios que sirven para ti.
  - **Todos los anuncios**: el libro completo con el gráfico del día, el filtro *Solo mis medios* y, aparte (para que no se confunda con tu capital), lo que gana **con otro monto**.
  - **Alertas**: avisos cuando **comprar esté barato** (precio igual o menor a tu meta) o **vender pague bien** (igual o mayor). Pueden contar solo anuncios con tu capital y tus medios, avisar una vez o cada vez que el precio cruce la meta, pausarse y editarse. Suenan con su propia campana, notificación y Telegram.
  - **Mis costos**: comisión P2P (automática según tus órdenes o la que pongas; con mínimo de 0,07 USDT por orden) y el 4x1000. **Mis medios**: con qué pagas al comprar y dónde recibes al vender. Ambos se usan en todo el panel: rutas de Inicio, avisos y precios.
- **Mis anuncios**: para publicar tus propios anuncios de compra y venta en P2P. Arriba eliges la cripto, el monto por vuelta, cuántas vueltas haces al día y tu comisión de Binance por anuncio (si conectaste tu cuenta, sale de tus órdenes como anunciante; si no, la más alta sin ser comerciante verificado: 0,35 %). Tiene dos vistas:
  - **Asesor · a cuánto publicar**: con el libro en vivo te dice a cuánto poner cada anuncio. Solo cuenta a los rivales que de verdad compiten por tu monto y te da tres precios por lado: *Rápido* (sales 1.º), *Equilibrado* (top 3) y *Paciente* (puesto 8). Cada precio dice en qué puesto quedas y **cuánto tardaría en llenarse** con tu monto: el panel mide cuánto se mueve cada puesto viendo bajar el saldo de los anuncios en cada escaneo (descuenta las órdenes canceladas), así que necesita unos 10 minutos prendido para estimar. Debajo de cada lado están los **rivales cerca de tu precio** con sus órdenes del mes, su tasa de finalización y cuántas órdenes por hora les toman, y cuánto se movió por hora en cada puesto (1.º, 2-3, 4-8, 9-20). Recomienda la combinación que **se llena antes** dejando al menos el margen seguro (0,6 %) y, si es lenta, te muestra también la más rápida que igual gana; si solo gana poco sale como *Justa*, y si ninguna gana te dice que hoy no conviene publicar y a cuánto tendría que estar. Debajo están **todas las combinaciones** (también tomar un anuncio en vez de publicar), las **mejores horas** para publicar (margen entre anuncios hora por hora en las últimas 24 h), **lo que dicen tus anuncios** (con tu Binance conectado: cuántas órdenes te tomaron, a qué precio, a qué horas y cuánto mejor que tomar uno) y **Vigilar mi anuncio**: escribes el precio con el que lo publicaste y en qué puesto lo quieres (1.º, top 3 o top 5) y te avisa (campana, notificación y Telegram) si **te pasan** (con el precio para volver a tu puesto) o si **puedes ganar más**: pagar menos en tu compra o cobrar más en tu venta sin salir de tu puesto. Toca cualquier precio o cualquier celda de la tabla para elegir otra combinación: la ganancia y los límites (*compra hasta* / *vende desde* para no perder y para ganar el margen seguro) se recalculan con lo que elegiste. El puesto siempre se cuenta contra los anuncios que compiten por tu monto. El panel solo lee tu cuenta: publicar o cambiar el precio se hace en Binance.
  - **Simular**: pones el precio de cada anuncio (o tomas uno que ya existe, o lo que mandó el asesor con *Llevar al simulador*). Descuenta la comisión de anunciante (en tu anuncio de venta Binance la cobra aparte de tu saldo), la de tomar un anuncio con su mínimo por orden y el 4x1000 de lo que pagas. Muestra lo que te queda por vuelta, por dólar, al día y al mes, en qué puesto saldría tu anuncio y a cuánto debes vender (o hasta cuánto comprar) para no perder.
- **Historial**: cuántas oportunidades hubo, cuánto duraron y a qué hora del día el mercado se acerca más a dar ganancia. Se llena solo mientras el panel está prendido.
- **Mi Binance** (cada usuario, la suya): saldos y todas tus órdenes P2P guardadas (Binance solo entrega las últimas; el panel las va acumulando), con exportación a Excel.
- **Equipo** (administrador): códigos de invitación y usuarios.
- **Chat**: canal **General** para todo el equipo y **mensajes privados** entre dos personas (solo ellas los ven, ni siquiera el administrador). Como en WhatsApp: **responde** un mensaje (queda citado y al tocar la cita te lleva al original), **reacciona** con un emoji (doble toque = ❤️) y **envía imágenes** pegándolas (Ctrl+V), arrastrándolas o con el botón de imagen (se reducen solas antes de enviarse). Muestra quién está conectado, cuenta los no leídos y avisa con un sonido suave tipo burbuja, distinto al de las oportunidades. Cada quien puede borrar sus mensajes; el administrador también puede borrar del General.
- **Avisos**: salen arriba a la derecha (en celular, arriba), con un ícono por tipo y una barra que muestra cuánto les queda; los del chat salen abajo, junto a la burbuja. Cada tipo suena distinto: oportunidad (fanfarria fuerte), alerta de precio (campana), mensaje (burbuja suave) y sistema (dos tonos graves).
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
  wallet/    ArbiCrypto Wallet: contabilidad e impuestos (mismas tecnologías, ver wallet/LEEME.md)
    backend/ Python (FastAPI) + SQLite o MySQL
    web/     Next.js + TypeScript (se compila a wallet/web/out)
  deploy/    PM2 (las dos apps), nginx (panel y wallet) y la guía del VPS
```

Si cambias algo en `web/src`: `cd web && npm run build` y luego `pm2 restart arbicrypto`.
