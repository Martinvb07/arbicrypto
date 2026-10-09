// PM2: mantiene ArbiCrypto encendido (en el VPS y en tu PC) y lo reinicia si se cae.
// Solo este PC / VPS:      pm2 start deploy/ecosystem.config.js
// Equipo en tu Wi-Fi:      pm2 start deploy/ecosystem.config.js --env equipo
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WIN = process.platform === "win32";
// Python del entorno virtual si existe (VPS); si no, el Python instalado (Windows)
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
  ],
};
