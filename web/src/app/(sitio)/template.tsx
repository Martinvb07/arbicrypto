"use client";

import { motion } from "framer-motion";

// template.tsx se vuelve a montar en cada página: el contenido entra con un fundido (solo opacidad, para no mover la navbar fija)
export default function SitioTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
