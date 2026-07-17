import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

// One build stamp per `vite build`, shared by the value baked into the bundle
// (__APP_VERSION__) and the emitted dist/version.json. A running tab compares
// the two: when the deployed version.json no longer matches the constant the
// tab was built with, it knows it is running an older build and offers a refresh.
const BUILD_ID = String(Date.now());

// Writes dist/version.json after the build so the server can serve it.
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      fs.mkdirSync(outDir, {recursive: true});
      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify({version: BUILD_ID}) + '\n',
      );
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), emitVersionJson()],
    define: {
      __APP_VERSION__: JSON.stringify(BUILD_ID),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
