import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/ucsb-surplus-scanner/",
  build: { target: "es2022" },
  server: { port: 5173 },
  preview: { port: 4173 },
});
