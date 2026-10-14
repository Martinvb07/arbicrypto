# ArbiCrypto Wallet · Contabilidad DIAN

Lleva la contabilidad de tus criptomonedas y prepara los datos para la declaración de renta de persona natural (formulario 210).

## Abrirlo (PM2)

La wallet vive en el mismo repositorio que el panel de ArbiCrypto (carpeta `wallet/`) y se maneja igual, con **PM2**:
un solo `pm2 start deploy/ecosystem.config.js` (desde la raíz del repo) prende el panel (**8787**) y la wallet (**8788**).
En el VPS queda en **wallet.arbicrypto.org** (ver `deploy/LEEME-VPS.md`).

La primera vez, en la raíz del repositorio:

```bash
pip install -r wallet/backend/requirements.txt
cd wallet/web && npm install && npm run build && cd ../..
```

**Se entra desde el panel**: menú de tu usuario (arriba a la derecha) → **Wallet**. No hay otro usuario ni otra contraseña:
la wallet usa la misma sesión del panel. Si abres la wallet directo sin sesión, te manda al login del panel y vuelve sola.

| Quiero… | Comando (en la raíz del repositorio) |
|---|---|
| Prender panel y wallet | `pm2 start deploy/ecosystem.config.js` |
| Ver si está prendida | `pm2 status` |
| Ver qué está pasando | `pm2 logs arbicrypto-wallet` |
| Reiniciarla | `pm2 restart arbicrypto-wallet` |
| Apagarla | `pm2 stop arbicrypto-wallet` |

En este PC: panel en http://127.0.0.1:8787 → menú → Wallet (abre http://127.0.0.1:8788). Si cambias algo en `wallet/web/src`: `cd wallet/web && npm run build` y `pm2 restart arbicrypto-wallet`.

## Primeros pasos

1. **Inicio → Conecta tu Binance**: crea en Binance una API Key **solo de lectura** y pégala una vez. Desde ahí la app trae sola tus P2P, Convert y Spot cada 30 minutos.
2. **P2P de hace más de 6 meses**: Binance no los entrega por API. Descárgalos en Binance (P2P → Órdenes → Exportar) y súbelos una vez en *Subir archivo*, sin abrirlos antes en Excel.
3. **Ajustes**: escribe tu cédula (para la fecha límite) y deja marcado *Compro y vendo de forma habitual* si haces arbitraje o trading.
4. **Inicio → Inicia tu caja**: escribe la cuenta (por ejemplo Nequi) y cuánta plata tienes hoy en ella. Desde ahí la app
   lleva tu caja: lo de Binance entra solo y lo demás lo anotas con **Entrada** (plata tuya que metes) o **Salida** (para ti
   o gasto del negocio, con su 4x1000). La tarjeta dice cuánto debes tener en la cuenta y sus últimos movimientos; el registro
   completo está en Libros → Caja diaria.
5. Revisa **Resultados → Cada operación**: si alguna venta dice *Sin costo*, falta su compra. Agrégala, aunque sea de años anteriores.

## A fin de año (para declarar)

1. Después del 31 de diciembre abre **Declaración** y completa tus otros datos del año (sueldo, otros bienes, el 4x1000 del certificado del banco si lo tienes).
2. Descarga **Excel para la DIAN** (botón amarillo en Declaración o en Libros). Trae todo explicado: el resumen del año, qué va en cada casilla del formulario 210, el kardex, las operaciones, el 4x1000, los libros contables y las comprobaciones.
3. Revisa la sección **Comprobaciones** del Excel: todo debe decir *Cuadra*. Si algo dice *Revisar*, la misma fila dice qué falta.
4. Si vas con contador, mándale el **Paquete para el contador** (.zip): el mismo Excel más los CSV para su programa.

Lo que no esté en Binance (otros exchanges, billeteras propias) se agrega a mano o con la plantilla CSV.

## Cómo está organizada

| Pestaña | Qué hay |
|---|---|
| **Inicio** | Lo simple: cuánto tienes en total, en Binance, en pesos y cuánto vas ganando en el año; tu Binance por moneda con **los mismos saldos y precios que Mi Binance en el panel** (se refresca cada minuto, igual que allá), tu caja en pesos y los últimos movimientos |
| **Movimientos** | Todas las operaciones, gastos, aportes y retiros. Agregar a mano o subir archivo |
| **Cuentas** | Tus bancos y billeteras fuera de Binance: subes los extractos (PDF con o sin clave, Excel o CSV) y la app clasifica cada movimiento (Binance P2P, 4x1000, entre tus cuentas, salario, consumos, cuota de manejo…), los cruza con tus órdenes P2P y te da los valores para la declaración (saldos al 31/12, consignaciones, 4x1000 real) |
| **Resultados** | Resumen (estado de resultados, mes a mes, por moneda), rondas de arbitraje y cada operación |
| **Libros** | En el orden de un contador: libros oficiales (diario, mayor y balances), estados financieros (balance general, estado de resultados), auxiliares (caja diaria, kardex cripto, registro de operaciones) y cierres |
| **Declaración** | Fin de año: si debes declarar, impuesto, fecha límite, patrimonio al 31/12 y casillas del formulario 210 |
| **Ajustes** | Binance, perfil fiscal y 4x1000 por cuenta (usuario, contraseña y equipo están en el panel) |

## Contabilidad, libros y cierres

- **Contabilidad**: resultado del año y del mes, estado de resultados, mes a mes, por moneda y **rondas de arbitraje**
  (cada vuelta de pesos a cripto y de vuelta a pesos, con lo que de verdad ganaste antes y después del 4x1000).
- **Movimientos**: además de compras y ventas, registra **gastos del negocio** (internet, celular, banco, contador: se descuentan
  en la casilla 77), **aportes** (plata tuya que metes para operar) y **retiros** (plata que sacas para ti).
- **4x1000**: en Ajustes eliges si tu banco te lo cobra: siempre, cuenta exenta o exenta hasta 350 UVT al mes, y también
  **por cuenta** (Nequi, Bre-B, Bancolombia…). El medio de pago de cada P2P llega solo desde Binance.
- **Libro cripto (kardex)**: por cada cripto, cada entrada y salida con cantidad, costo unitario y total, el saldo corrido y la
  utilidad de cada venta. Comprueba solo que saldo inicial + entradas − salidas = saldo final.
- **Registro de operaciones**: todo numerado (OP-2026-0001…) con el número de orden de Binance, la comisión, el 4x1000 y cuánto
  salió o entró de tus bancos.
- **Comisiones de Binance**: en P2P Binance se queda un poco de cripto en cada orden (por ejemplo 0,07 USDT). La app la trae sola,
  la muestra en pesos en cada compra y la suma al costo, como manda la norma.
- **Excel para la DIAN** (en Libros o Declaración): un solo archivo con todo explicado en palabras sencillas: resumen, casillas
  del formulario 210, topes, comprobaciones, kardex, operaciones, ganancias, rondas, 4x1000, patrimonio y libros contables.
- **Paquete para el contador** (en Libros y en Declaración): un .zip con el mismo Excel más los archivos numerados en el
  orden de los libros: 01 diario, 02 mayor y balances, 03 inventarios y balances, 04 situación financiera, 05 resultados,
  06 cambios en el patrimonio, 07 flujo de efectivo, 08 notas, 09 caja diaria, 10 kardex, 11 registro de operaciones,
  12 ganancias, 13 inventario fiscal al 31/12, 14 rondas y 15 cierres.
- **Libros**: partida doble con cuentas del PUC (Decreto 2650): las que usan tus operaciones (1110 Bancos, 1435
  Criptoactivos, 4135 Ventas, 6135 Costo de ventas, 5115 4x1000, 5305 Comisiones…) y las comunes para el contador
  (caja, deudores, equipo, depreciación, proveedores, cuentas por pagar, retenciones, impuesto de renta…). Todos con el
  mismo encabezado (contribuyente, cédula, periodo, moneda), por mes o año, en CSV o impresos.
  - **Libros oficiales**: diario, mayor y balances, e inventarios y balances (el balance al corte con cada cripto: cantidad,
    costo unitario, costo total y valor de mercado informativo de Binance × TRM).
  - **Estados financieros completos**: situación financiera (activo, pasivo y patrimonio), resultados con la estructura del
    PUC (utilidad bruta, operacional, antes de impuestos y neta), cambios en el patrimonio, flujos de efectivo por el método
    directo y **notas** generadas con las cifras: entidad, bases de preparación, políticas contables, el detalle de cada
    cuenta, las diferencias con la declaración y de dónde sale cada número.
  - **Notas de contabilidad** (Libro diario → *Nota de contabilidad*): asientos manuales del contador con cualquier cuenta del
    plan, débitos = créditos, fecha y soporte. Respetan los periodos congelados. Cambian los libros, no el cálculo de la
    declaración (que sale de las operaciones).
- **Caja diaria (cierre de caja automático)**: cada día con movimiento en tus cuentas se cierra solo a medianoche: saldo
  inicial, entradas, salidas, 4x1000 y saldo final de la cuenta 1110, con sus comprobantes y el saldo corrido. Queda
  congelado con el cierre automático del mes. También sale en el Excel (hoja *Caja diaria*).
- **Cierres automáticos**: 3 días después de terminar cada mes, la app cierra el mes sola: congela el periodo (nada antes de
  esa fecha se puede cambiar, ni a mano ni desde Binance) y guarda una foto de los estados financieros. Diciembre se cierra
  como año y guarda además las casillas de la declaración. Si tus libros dicen que tienes pesos en negativo, el cierre registra
  lo que falta como aporte tuyo. Solo cierra si todo está completo: Binance sincronizado, ninguna venta sin su compra, todo con
  valor en pesos y tus cripto cuadrando con Binance. Si algo falta, en Libros → Cierres dice qué es.
- **Cuadrar caja** (opcional, en Libros → Cierres): escribe cuánta plata tienes de verdad hoy; la diferencia con los libros
  queda como aporte o retiro tuyo. No congela nada.
- **Reabrir**: solo el último cierre. Reabrir un mes pone en pausa los cierres automáticos para que no se vuelva a cerrar
  mientras corriges; actívalos de nuevo con el interruptor cuando termines.

## Cómo calcula

Según el Estatuto Tributario y el **Concepto Unificado DIAN 1621 de 2023**:

| Tema | Regla |
|---|---|
| Patrimonio | Las cripto se declaran a **costo fiscal** (lo que pagaste), no a valor de mercado (art. 267 ET). |
| Permuta | Cambiar una cripto por otra es una **venta**: se gana o pierde la diferencia con su valor comercial (art. 90 ET). |
| Operación habitual | Trading o arbitraje: todo es **renta ordinaria** (tabla del art. 241 ET). |
| Inversión de 2 años o más | Si no eres habitual: **ganancia ocasional** al 15 % (arts. 300 y 314 ET). |
| Staking, Earn, minería | Renta ordinaria por su valor el día que la recibes. |
| Airdrops | Ganancia ocasional. |
| Pesos | Dólares × **TRM** del día de cada operación (art. 269 ET), tomada de datos.gov.co. |
| 4x1000 | $4.000 por cada $1.000.000 que pagas comprando desde el banco; la mitad es deducible (art. 115 ET). Si escribes el valor del certificado del banco, manda ese. Por eso tu resultado contable (resta todo el 4x1000) y la renta para la DIAN (resta la mitad) no son iguales. |
| Comisiones | Las de compra hacen parte del costo de la cripto (art. 69 ET); las de venta se restan del valor de venta. |
| Costo | PEPS (primero en entrar, primero en salir) o promedio ponderado, a elección. |

Topes (patrimonio de 4.500 UVT, o ingresos, consignaciones o compras de 1.400 UVT):

| Año | UVT | Patrimonio | Ingresos / consignaciones / compras | Se declara |
|---|---|---|---|---|
| 2026 (en curso) | $52.374 | $235.683.000 | $73.323.600 | ago–oct 2027 (calendario sin publicar) |
| 2025 | $49.799 | $224.095.500 | $69.718.600 | ago–oct 2026, según los 2 últimos dígitos de la cédula |

Para el año en curso la app muestra las cifras hasta hoy y, a este ritmo, cómo cerrarías el año.

**Es un cálculo informativo. Revísalo con un contador antes de declarar.**

## Ten en cuenta

- Una permuta se valora con el precio en dólares × TRM. Si compraste USDT por P2P más caro que la TRM, cambiarlos por otra cripto puede mostrar una pequeña pérdida. Es correcto según el valor comercial, pero puedes editar el valor si tu contador usa otro criterio.
- Los retiros y depósitos entre billeteras no se importan porque no son ventas.
- Si Binance no devuelve órdenes muy antiguas, agrégalas con la plantilla CSV.
- Formulario 160 (activos en el exterior): la app avisa si tus cripto superan 2.000 UVT. Confirma con tu contador si te aplica.

## Usuarios: los mismos del panel, cada uno con SU wallet

- Los usuarios, contraseñas, invitaciones y roles se manejan **en el panel**. La wallet no tiene login propio.
- Cada usuario del panel tiene **su propia wallet**: sus movimientos, su Binance (su llave de solo lectura), sus extractos,
  sus cierres y su declaración. Nadie más los ve, **ni los administradores**.
- La wallet reconoce a cada persona SOLO por un id fijo del panel, nunca por el nombre: si le cambian el nombre sigue viendo lo suyo, y si alguien nuevo se registra con el nombre de otra persona, empieza con su wallet vacía.
- Cómo entra: el panel firma un pase de un solo uso que vence en 60 segundos (`SSO_SECRET`) y la wallet abre la sesión de esa persona.
  La sesión de la wallet dura 12 horas y se renueva sola mientras la del panel siga abierta. *Cerrar sesión* en la wallet cierra las dos.
- `SSO_SECRET` lo crea el panel en `backend/.env` la primera vez que arranca y la wallet lo lee de ahí (mismo servidor). No hay que configurar nada.

## Seguridad

- Sin contraseñas propias: se entra con el pase firmado del panel (HMAC-SHA256, un solo uso, 60 s). Sesiones en cookie HttpOnly y SameSite=Strict; solo se guarda su huella.
- Solo acepta API Keys de Binance de lectura (lo revisa en cada sincronización). Se guardan **cifradas** (Fernet) con la
  clave `APP_SECRET` de `wallet/backend/.env`, igual que en el panel: funciona en Windows y en el VPS. *Desconectar* las borra.
  **Guarda `APP_SECRET` en un lugar seguro**: sin ella hay que conectar Binance otra vez.
- Sin Binance conectado no hay datos de Binance: la wallet de cada persona empieza vacía y se llena solo con SU cuenta.
  *Desconectar* borra la llave y los movimientos que se trajeron de Binance (lo de meses ya cerrados queda congelado).
- Solo escucha en `127.0.0.1` (en el VPS, solo nginx habla con ella). Encabezados de seguridad (CSP, anti-iframe), protección contra DNS rebinding (`ALLOWED_HOSTS`) y CSRF.
- Datos: SQLite en `wallet/backend/data/wallet.db`, o **MySQL** con `DATABASE_URL` en `wallet/backend/.env`. La primera vez que arranca
  con MySQL vacío copia sola todo lo de `wallet.db` (el archivo queda como respaldo). Los extractos originales que subes quedan en
  `wallet/backend/data/extractos`. Nada de `data/` ni `.env` va a git.

## Para desarrolladores

Las mismas tecnologías que el panel:

```
wallet/
  backend/   Python: FastAPI + uvicorn (httpkit.py), SQLite o MySQL (storage.py, db.py)
             app.py = rutas, tax.py = motor contable, ledger.py = partida doble, workbook.py = Excel para la DIAN,
             rates.py = TRM y precios, importers.py = Binance y archivos, banks.py + statements.py = extractos,
             keys.py = llaves de Binance cifradas, auth.py = sesiones, sso.py = entrada desde el panel
    data/    SQLite y extractos (si no usas MySQL)
  web/       Next.js + TypeScript, exportado como HTML estático a wallet/web/out
```

- Pruebas: `cd wallet/backend && python -m unittest -v`
- Desarrollo de la interfaz: `cd wallet/web && npm run dev` (http://localhost:3001, las llamadas `/api` van a la wallet en 8788)
- Variables de `wallet/backend/.env`: `DATABASE_URL` (MySQL), `APP_SECRET` (se crea sola), `COOKIE_SECURE=1` y
  `ALLOWED_HOSTS=wallet.arbicrypto.org` en el VPS. `HOST` y `PORT` los pone PM2. `PANEL_URL` solo si el panel no está en
  panel.<mismo dominio> (en el panel, `WALLET_URL` para lo mismo al revés).
- Cada `git push` a `main` revisa y prueba la wallet junto con el panel y despliega los dos (`.github/workflows/deploy.yml`).
