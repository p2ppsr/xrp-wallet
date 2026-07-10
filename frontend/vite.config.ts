import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build'
  },
  server: {
    host: '::',
    port: 8080
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
