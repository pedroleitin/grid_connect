import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// React 19 + Tailwind v4 (mesma stack do grid-gen-2)
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
