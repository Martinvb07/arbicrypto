# ArbiCrypto

Panel en vivo de **arbitraje en Binance** para ti y tu equipo: comprar barato y vender más caro al mismo tiempo, en P2P (pesos) y dentro de Binance Spot, solo con criptos principales. Todo se mide en **pesos por dólar (USDT)** y ya descuenta comisiones de Binance, el redondeo de cantidades, un colchón por movimiento de precio y el 4x1000 **solo sobre la ganancia** (lo que llega de más a Nequi; el capital va y vuelve sin cobro por los topes exentos).

## Cómo abrirlo

| Quiero… | Haz doble clic en |
|---|---|
| Usarlo en este PC | **ArbiCrypto** en el escritorio (o `iniciar.bat`) |
| Que mi equipo entre desde sus celulares o PCs (misma red Wi-Fi de confianza) | `iniciar_equipo.bat` |

Se abre una ventana negra (el servidor) y el navegador en `http://127.0.0.1:8787`. **Si cierras la ventana negra, el panel se apaga.**

## En un servidor (VPS)

Para tenerlo en un VPS con dominio y HTTPS (Ubuntu + nginx + PM2 + MySQL) sigue **deploy/LEEME-VPS.md**. El backend corre en FastAPI + uvicorn; sin `DATABASE_URL` usa SQLite y los archivos de `backend/data`, con `DATABASE_URL=mysql://...` usa MySQL.

## Usuarios

- Administrador: **jesuscrypto**. Cambia la contraseña en el menú de tu usuario (arriba a la derecha) → *Cambiar contraseña*.
- Invitar a alguien: pestaña **Equipo → Generar código** (sirve una sola vez y vence en 7 días). La persona toca *“Tengo un código de invitación”* y crea su usuario.
- **Cada usuario pone su propio capital** (Arbitraje → Capital) y ve las rutas y avisos para su monto. La **cuenta de Binance es personal**: solo la ve (saldos, órdenes, bitácora automática) quien la conectó, aunque haya otros administradores, y nadie más puede desconectarla ni reemplazarla. Los administradores cambian 4x1000 y avisos, invita gente y **cambia la contraseña de cualquier usuario** (Equipo → Contraseña).
- ¿Olvidaste la contraseña? Cierra el panel y en la carpeta `backend` ejecuta `python auth.py` → opción 2.

## Cómo se usa

- **Arbitraje**: indicadores arriba (estado, mejor ruta, dólar compra y venta) y la tabla de rutas de mejor a peor. En la barra de la tabla: filtro *Todas / P2P / Spot*, **Capital** (escríbelo y presiona Enter) y el interruptor **4x1000**. Toca *Pasos* para ver a quién comprarle y a quién venderle. Los precios de Spot llegan en **tiempo real** y las rutas cercanas a cero se calculan con el **precio real para tu monto** (profundidad del libro y comisión real de cada par).
- **¿Dónde vendo? (Mis monedas)**: agrega cada moneda que tienes (cuánto tienes y cuánto te costó). La lista muestra en vivo cuánto ganas o pierdes si vendes ya, a quién venderle, cuánto falta para tu meta y el paso a paso. Cada moneda tiene un switch **Avisarme cuando gane** (sonido, Windows y Telegram), y se puede editar o quitar.
- **Precios P2P**: gráfico del día y anuncios de cada cripto en verde (buen precio y anunciante confiable) o rojo.
- **Historial**: cuántas oportunidades hubo, cuánto duraron y a qué hora del día el mercado se acerca más a dar ganancia. Se llena solo mientras el panel está prendido.
- **Bitácora**: anota tus operaciones reales (cuánto pagaste y cuánto recibiste) y compara contra lo que estimaba el panel. *Exportar a Excel* sirve como soporte (por ejemplo, para la DIAN).
- **Mi Binance** (administrador): saldos y todas tus órdenes P2P guardadas (Binance solo entrega las últimas; el panel las va acumulando), con exportación a Excel.
- **Equipo** (administrador): códigos de invitación y usuarios.
- Verde = ganancia, rojo = pérdida, gris = cero. Debajo de cada tabla dice qué costos incluye.

Fijo para que sea simple: todos los métodos de pago, criptos principales y anunciantes con 20+ órdenes.

**Cálculos conservadores:** cada cambio en Spot descuenta comisión, el redondeo de cantidades de Binance y un colchón de 0,1 % por movimiento de precio. Toda ruta con ganancia real que llegue a tu mínimo de aviso suena; si deja menos de **0,6 %** (P2P) o **0,1 %** (Spot) sale como *Justa · actúa rápido*: gana poco y si un precio cambia mientras operas puede volverse pérdida. En Spot usa siempre **orden de Mercado, nunca Convertir**, y si en un paso te llega menos del mínimo que indica el panel, no sigas.

## Funcionamiento 24/7

- **Arranca solo con Windows** (minimizado, sin abrir el navegador). Para quitarlo: tecla Windows + R → `shell:startup` → borra *ArbiCrypto (inicio automatico)*.
- **Se reinicia solo** si el panel se cae.
- **Vigilante**: si el escáner de Spot o P2P deja de responder, te llega un aviso (también por Telegram) y otro cuando vuelve.
- Para que no se detenga, configura Windows para que el PC **no entre en suspensión** (Configuración → Sistema → Inicio/apagado y suspensión → Nunca).
- Para entrar desde fuera de tu Wi-Fi de forma segura, la opción más simple es instalar **Tailscale** (gratis) en este PC y en los celulares del equipo y usar `iniciar_equipo.bat`.

## Avisos (botón **Avisos** en la barra de arriba)

- **Avisar desde**: cuántos pesos por dólar debe dejar una ruta para avisarte (por defecto $3).
- **Sonido**: el navegador solo deja sonar después de tocar la página una vez.
- **Notificaciones de Windows**: llegan aunque estés en otra pestaña, con el panel abierto.
- **Celular (Telegram)**: *Configurar* → crea un bot con @BotFather, pega el token, escríbele `/start` y toca *Buscar mi chat*. Para el equipo, agrega el bot a un grupo y escribe `/start` ahí.
- Solo suena cuando aparece una ruta **nueva** con ganancia. Se ignora lo que promete más del 3 % (casi siempre son precios viejos) y las rutas de Spot deben confirmarse en 2 revisiones seguidas.

## Seguridad

- La llave de Binance debe ser **solo lectura**: el panel rechaza llaves con trading, retiros o transferencias, y solo se conecta desde este PC.
- Contraseñas cifradas con PBKDF2-SHA256 (600.000 iteraciones). Sesiones con cookie HttpOnly y SameSite=Strict, bloqueo tras 8 intentos fallidos, códigos de invitación de un solo uso.
- Protecciones contra CSRF, clickjacking, DNS rebinding y lectura de archivos internos; cabeceras de seguridad (CSP) en todas las páginas.
- `backend/.env` (llaves) y `backend/data/` (usuarios) son privados: no los compartas ni los subas a internet.
- El modo equipo usa HTTP sin cifrar dentro de tu Wi-Fi: úsalo solo en redes de confianza (casa u oficina), nunca en Wi-Fi públicas.
- Las ganancias son estimadas con el mejor precio del momento. Confirma siempre en Binance antes de pagar. No es asesoría financiera.

## Carpetas

```
crypto-jesus/
  iniciar.bat, iniciar_equipo.bat, compilar_interfaz.bat
  backend/   Python: lee Binance (también en tiempo real), calcula oportunidades, avisos, usuarios e historial
    data/cryptojesus.db  historial, avisos, bitácora y órdenes guardadas
  web/       Next.js + TypeScript: la interfaz (se compila a web/out)
  scripts/   arb_scanner.py, tu script original
```

Si cambias algo en `web/src`, ejecuta `compilar_interfaz.bat` y reinicia el panel.
