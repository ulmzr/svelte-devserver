const http = require("http");
const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const WebSocket = require("ws");
const chokidar = require("chokidar");

const esbuild = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin");
const sveltePlugin = require("esbuild-svelte");
const sveltePreprocess = require("svelte-preprocess");

const cwd = process.cwd();
const dev = process.argv.includes("-watch");
const build = process.argv.includes("-build");
const configPath = path.join(cwd, "config.js");
const config = fs.existsSync(configPath) ? require(configPath) : {};
const port = config.port || 3000;
const public = config.public || "public";
const esbuildConfig = config.esbuild || {};
const env = config.env || {};

function serve() {
    if (!build) {
        const server = http.createServer(async (req, res) => {
            const filePath = path.join(cwd, public, req.url === "/" ? "index.html" : req.url); // Get the file path based on the requested URL
            const contentType = getContentType(filePath); // Get the content type based on the file extension
            if (filePath.endsWith("index.html")) serveIndexHtml(res);
            else
                try {
                    // Read the file
                    const data = await fsp.readFile(filePath);
                    // Serve the requested file
                    res.writeHead(200, { "Content-Type": contentType });
                    res.end(data);
                    if (dev) console.log("🌏", path.basename(filePath));
                } catch (error) {
                    // If the file does not exist or there's an error reading it, serve index.html instead
                    serveIndexHtml(res);
                }
        });

        // Function to serve index.html
        async function serveIndexHtml(res) {
            const reloadScript = `<script>
   let ws = 'ws://' + window.location.host;
   let sock = new WebSocket(ws)
   sock.onmessage = () => location.reload()
   sock.onclose = function(){
      reconnect()
      function reconnect(){
         sock = new WebSocket(ws)
         sock.onclose = () => setTimeout(reconnect, 2000)
         sock.onopen = () => location.reload()
      }
   }
   </script></head>`;
            try {
                const indexPath = path.join(cwd, public, "index.html");
                let data = await fsp.readFile(indexPath, "utf8");
                data = dev ? data.replace("</head>", reloadScript) : data;
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(data);
                if (dev) console.log("🌏", "index.html");
            } catch (error) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Internal Server Error");
            }
        }

        if (dev) compile();

        // Start the server
        server.listen(port, () => {
            console.log(`Server is running on port ${port}`);
            if (dev) {
                const wss = new WebSocket.Server({ server });
                const publicFolderPath = path.join(cwd, "public");

                // Initialize chokidar to watch for file changes
                const watcher = chokidar.watch(publicFolderPath, { persistent: true });

                watcher.on("change", (filePath) => {
                    // Notify all clients about the file change
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send("reload");
                        }
                    });
                });
            }
        });

        // Function to get content type based on file extension
        function getContentType(filePath) {
            const mime = {
                html: "text/html",
                css: "text/css",
                js: "text/javascript",
                json: "application/json",
                ico: "image/ico",
                png: "image/png",
                jpg: "image/jpg",
                jpeg: "image/jpeg",
                webp: "image/webp",
                gif: "image/gif",
                svg: "image/svg+xml",
                mp3: "audio/mpeg",
                wav: "audio/wav",
                ogg: "audio/ogg",
                mp4: "video/mp4",
                webm: "video/webm",
                ogv: "video/ogg",
                pdf: "application/pdf",
            };
            const extname = path.extname(filePath)?.slice(1);
            return mime[extname] || "application/octet-stream";
        }
    } else {
        compile();
    }

    async function compile() {
        const ctx = await esbuild.context({
            entryPoints: ["src/main.js"],
            outfile: public + "/main.js",
            bundle: true,
            minify: !dev,
            plugins: [
                sveltePlugin({
                    preprocess: sveltePreprocess(),
                }),
                sassPlugin(),
            ],
            define: {
                process: JSON.stringify({
                    env: {
                        production: !dev,
                        ...env,
                    },
                }),
            },
            ...esbuildConfig,
        });

        await ctx.watch();
        if (!dev) await ctx.dispose();
    }
}

module.exports = serve;
