import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// En produccion Next.js genera archivos estaticos (carpeta out/) que sirve el backend de Python.
// En desarrollo (npm run dev) las llamadas /api se reenvian al backend en el puerto 8787.
const nextConfig: NextConfig = isDev
  ? {
      async rewrites() {
        return [{ source: "/api/:path*", destination: "http://127.0.0.1:8787/api/:path*" }];
      },
    }
  : { output: "export", images: { unoptimized: true } };

export default nextConfig;
