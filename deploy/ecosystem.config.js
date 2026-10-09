// PM2: mantiene ArbiCrypto encendido en el VPS (arranca con el servidor y se reinicia si se cae).
// Uso:  pm2 start deploy/ecosystem.config.js  &&  pm2 save  &&  pm2 startup
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "arbicrypto",
      cwd: path.join(ROOT, "backend"),
      script: "app.py",
      args: "--no-browser",
      interpreter: path.join(ROOT, "backend", ".venv", "bin", "python"),
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
      },
      out_file: path.join(ROOT, "logs", "arbicrypto.out.log"),
      error_file: path.join(ROOT, "logs", "arbicrypto.err.log"),
      time: true,
    },
  ],
};
