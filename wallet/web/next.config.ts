import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// En produccion Next.js genera archivos estaticos (carpeta out/) que sirve el backend de Python (wallet/backend).
// En desarrollo (npm run dev) las llamadas /api se reenvian al backend de la wallet en el puerto 8788.
const nextConfig: NextConfig = isDev
  ? {
      devIndicators: false,
      async rewrites() {
        return [{ source: "/api/:path*", destination: "http://127.0.0.1:8788/api/:path*" }];
      },
    }
  : { output: "export", images: { unoptimized: true }, poweredByHeader: false, devIndicators: false };

export default nextConfig;
