import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    electron({
      main: {
        entry: 'src-electron/main.ts',
      },
      preload: {
        input: 'src-electron/preload.ts',
      },
      renderer: {},
    }),
  ],
})
