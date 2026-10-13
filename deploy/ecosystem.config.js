// PM2: mantiene ArbiCrypto encendido (en el VPS y en tu PC) y lo reinicia si se cae.
// Son dos apps del mismo repositorio:
//   arbicrypto         el panel de arbitraje (backend/ + web/)            -> 127.0.0.1:8787  (panel.arbicrypto.org)
//   arbicrypto-wallet  contabilidad e impuestos (wallet/backend + web)    -> 127.0.0.1:8788  (wallet.arbicrypto.org)
// Solo este PC / VPS:      pm2 start deploy/ecosystem.config.js
// Equipo en tu Wi-Fi:      pm2 start deploy/ecosystem.config.js --env equipo   (solo afecta al panel)
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WIN = process.platform === "win32";
// Python del entorno virtual si existe (VPS, uno solo para las dos apps); si no, el Python instalado (Windows)
const VENV = path.join(ROOT, "backend", ".venv", WIN ? "Scripts\\python.exe" : "bin/python");
function windowsPython() {
  const base = path.join(process.env.LOCALAPPDATA || "", "Programs", "Python");
  const found = fs.existsSync(base)
    ? fs.readdirSync(base).filter((d) => /^Python3\d+$/.test(d)).map((d) => path.join(base, d, "python.exe")).filter(fs.existsSync)
    : [];
  return found.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] || "python";
}
const PYTHON = fs.existsSync(VENV) ? VENV : WIN ? windowsPython() : "python3";

module.exports = {
  apps: [
    {
      name: "arbicrypto",
      cwd: path.join(ROOT, "backend"),
      script: "app.py",
      args: "--no-browser",
      interpreter: PYTHON,
      // UNA sola copia: los escáneres y los datos en vivo están en memoria (no usar cluster ni instances > 1)
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      kill_timeout: 8000,
      max_memory_restart: "600M",
      env: {
        HOST: "127.0.0.1", // solo nginx habla con el panel; el puerto 8787 nunca se abre a internet
        PORT: "8787",
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
      },
      // --env equipo: tu equipo entra desde la misma red Wi-Fi (http://IP-de-este-PC:8787)
      env_equipo: {
        EQUIPO: "1",
      },
      out_file: path.join(ROOT, "logs", "arbicrypto.out.log"),
      error_file: path.join(ROOT, "logs", "arbicrypto.err.log"),
      time: true,
    },
    {
      name: "arbicrypto-wallet",
      cwd: path.join(ROOT, "wallet", "backend"),
      script: "app.py",
      interpreter: PYTHON,
      // UNA sola copia: la sincronización con Binance y los cierres automáticos corren dentro del proceso
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      kill_timeout: 8000,
      max_memory_restart: "500M",
      env: {
        HOST: "127.0.0.1", // solo nginx habla con la wallet; el puerto 8788 nunca se abre a internet
        PORT: "8788",
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
      },
      out_file: path.join(ROOT, "logs", "arbicrypto-wallet.out.log"),
      error_file: path.join(ROOT, "logs", "arbicrypto-wallet.err.log"),
      time: true,
    },
  ],
};
