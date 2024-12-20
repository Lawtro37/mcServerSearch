const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { env } = require('process');

let servers = fs.readFileSync('../servers.json')
servers = JSON.parse(servers);
let indexedIps = servers.length;

// Get environment variables
let STRICT_REFERER = process.env.STRICT_REFERER || false;
STRICT_REFERER = STRICT_REFERER === 'true' || STRICT_REFERER === '1';
const REFERER = process.env.REFERER || 'mcserversearch.lawtrostudios.com';

console.log(`STRICT_REFERER: ${STRICT_REFERER}`);
console.log(`REFERER: ${REFERER}`);

function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

const server = http.createServer((req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Set Cache-Control header
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    const perams = req.url.split('/');

    if (req.url === '/favicon.ico') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    if (req.url === '/servercount') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`${indexedIps}`);
        return;
    }

    if (perams.length === 5 && perams[1] === 'status' && perams[2] === '1') {
        const ip = perams[3];
        const port = perams[4];

        if (STRICT_REFERER && req.headers.referer !== REFERER) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end(`This function is only available to "${REFERER}" \n Error 403 (Forbidden)`);
            console.log(`access denied from ${req.headers.referer}`);
            return;
        }

        https.get(`https://api.mcsrvstat.us/3/${ip}:${port}`, (resp) => {
            let data = '';

            resp.on('data', (chunk) => {
                data += chunk;
            });

            resp.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
            });

        }).on('error', (err) => {
            console.log(`API Error: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        });

        return;
    }

    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Malformed request \n structure: /status/1/ip/port');
});

function start() {
    server.listen(443, () => {
        console.log(`Server running at http://${getNetworkIP()}(https://mcserversearch-api.onrender.com):443/`);
    });
}

start();

server.on('error', (err) => {
    console.error(`Server error: ${err.message}`);
});

process.on('uncaughtException', (err) => {
    console.error(`Uncaught exception: ${err.message}`);
    // Restart the server
    server.close(() => {
        start();
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`Unhandled rejection: ${reason}`);
    // Restart the server
    server.close(() => {
        start();
    });
});
