import { defineConfig } from 'vite';
import jsconfigPaths from 'vite-jsconfig-paths';
import javascriptObfuscator from 'vite-plugin-javascript-obfuscator';
import localNotices from './server/local-notices.cjs';

const apiProxy = () => ({ '/api': { target: process.env.API_UPSTREAM_URL || 'http://localhost:8080', changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') } });

export default defineConfig({
    plugins: [
        {name:'stratops-local-notices',configureServer(server){localNotices.mountLocalNotices(server.middlewares);},configurePreviewServer(server){localNotices.mountLocalNotices(server.middlewares);}},
        jsconfigPaths(),
        javascriptObfuscator({
            options: {
                compact: true,
                controlFlowFlattening: false,
                deadCodeInjection: false,
                debugProtection: true,
                debugProtectionInterval: 4000,
                disableConsoleOutput: true,
                identifierNamesGenerator: 'hexadecimal',
                rotateStringArray: true,
                selfDefending: true,
                shuffleStringArray: true,
                splitStrings: true,
                splitStringsChunkLength: 10,
                stringArray: true,
                stringArrayEncoding: ['base64'],
                stringArrayThreshold: 0.75,
                transformObjectKeys: true,
                unicodeEscapeSequence: false,
            },
        }),
    ],
    server: {proxy:apiProxy()},
    preview: {proxy:apiProxy()},
    build: {
        sourcemap: false,
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,
                pure_funcs: ['console.log', 'console.warn', 'console.info'],
            },
            mangle: {
                toplevel: true,
                properties: {
                    regex: /^__/,
                },
            },
            format: {
                comments: false,
            },
        },
        rollupOptions: {
            output: {
                manualChunks: undefined,
                entryFileNames: `assets/[name].[hash].js`,
                chunkFileNames: `assets/[name].[hash].js`,
                assetFileNames: `assets/[name].[hash].[ext]`,
            },
        },
    },
});
