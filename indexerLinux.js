const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const varint = require('varint');
const dns = require('dns');
const { spawn } = require('child_process');

let scanStatus = 'idle';
let results = [];
const dnsCache = {};
const masscanProcesses = []; // Array to track masscan processes

const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

// Initialize the JSON file with an empty array if it doesn't exist
const jsonFilePath = './servers.json';
if (!fs.existsSync(jsonFilePath)) {
    fs.writeFileSync(jsonFilePath, '[]');
}

// Load existing data from the JSON file
try {
    results = JSON.parse(fs.readFileSync(jsonFilePath));
} catch (error) {
    console.error(`Error reading from servers.json: ${error.message}`);
}

function saveResults() {
    fs.readFile(jsonFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error(`Error reading from servers.json: ${err.message}`);
            return;
        }

        // Write the updated array back to the file
        fs.writeFile(jsonFilePath, JSON.stringify(results, null, 2), (err) => {
            if (err) {
                console.error(`Error writing to servers.json: ${err.message}`);
            }
        });
    });
}

function splitIpRange(startIp, endIp, numChunks) {
    const start = ipToLong(startIp);
    const end = ipToLong(endIp);
    const range = end - start + 1;
    const chunkSize = Math.ceil(range / numChunks);
    const chunks = [];

    for (let i = 0; i < numChunks; i++) {
        const chunkStart = longToIp(start + i * chunkSize);
        const chunkEnd = longToIp(Math.min(start + (i + 1) * chunkSize - 1, end));
        chunks.push({ start: chunkStart, end: chunkEnd });
    }

    return chunks;
}

function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function longToIp(long) {
    return [
        (long >>> 24) & 0xff,
        (long >>> 16) & 0xff,
        (long >>> 8) & 0xff,
        long & 0xff
    ].join('.');
}

function fullPort(port) {
    console.log('[1] ', 'Starting Masscan scan...');
    scanStatus = 'running';
    let ipCounter = 0; // Counter for scanned IPs

    const masscanPath = "./masscan.bin"; // Path to the masscan binary
    const excludeFilePath = "./exclude.conf";
    const numThreads = 12; // Number of parallel masscan processes
    const ipChunks = splitIpRange('0.0.0.0', '255.255.255.255', numThreads);

    ipChunks.forEach(chunk => {
        const args = [
            '--open',
            '--rate', '100000000',
            '--excludefile', excludeFilePath,
            '--randomize-hosts',
            `-p${port}`,
            `${chunk.start}-${chunk.end}`
        ];

        console.log(`Executing: ${masscanPath} ${args.join(' ')}`);

        const masscanProcess = spawn(masscanPath, args);
        masscanProcesses.push(masscanProcess); // Track the process

        masscanProcess.stdout.on('data', (data) => {
            if (VERBOSE) {
                console.log(`Masscan stdout: ${data}`);
            }
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                const match = line.match(/Discovered open port (\d+)\/tcp on ([\d.]+)/);
                if (match) {
                    const port = match[1];
                    const ip = match[2];
                    ipCounter++;
                    console.log(`Found ${ip}:${port}`);
                    queryServer(ip, port);
                }
            });
        });

        masscanProcess.stderr.on('data', (data) => {
            if(VERBOSE) {
                console.error(`Masscan Info: ${data}`);
            }
        });

        masscanProcess.on('close', (code) => {
            console.log(`Masscan process exited with code ${code}`);
        });
    });
}

function ping(ip, port, protocol, timeout) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();

        const timeoutCheck = setTimeout(() => {
            client.destroy();
            resolve(false);
        }, timeout);

        client.connect(port, ip, () => {
            const handshakePacket = Buffer.concat([
                Buffer.from([0x00]), // packet ID
                Buffer.from(varint.encode(protocol)), // protocol version
                Buffer.from([ip.length]),
                Buffer.from(ip, 'utf-8'), // ip
                Buffer.from(new Uint16Array([port]).buffer).reverse(), // port
                Buffer.from([0x01]), // next state (2)
                Buffer.from([0x01]), // status request size
                Buffer.from([0x00]) // status request
            ]);
            var packetLength = Buffer.alloc(1);
            packetLength.writeUInt8(handshakePacket.length - 2);
            const buffer = Buffer.concat([packetLength, handshakePacket]);
            client.write(buffer);
        });

        client.on('data', (data) => {
            client.destroy();
            clearTimeout(timeoutCheck);
            try {
                varint.decode(data);
                const packetId = data[varint.decode.bytes];
                data = data.slice(varint.decode.bytes + 1);
                varint.decode(data);
                data = data.slice(varint.decode.bytes);
                const serverInfo = JSON.parse(data.toString());
                resolve(serverInfo);
            } catch (e) {
                console.error(`Error parsing server info: ${e.message}`);
                resolve(false);
            }
        });

        client.on('error', (err) => {
            if(VERBOSE){
                console.error(`Ping error: ${err.message}`);
            }
            client.destroy();
            resolve(false);
        });

        client.on('close', () => {
            client.destroy();
        });
    });
}

function checkIfWhitelisted(ip, port, version) {
    const sanitizedVersion = version.replace(/[^0-9.]/g, '');
    const child = spawn('node', ['joinBot.js', ip, port, sanitizedVersion]);

    child.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    child.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    child.on('close', (code) => {
        if (code !== 0) {
            console.error(`child process exited with code ${code}`);
        }
    });
}

async function queryServer(ip, port, retries = 3) {
    if (results.some(element => element.ip === ip && element.port === port)) {
        console.log(`Server already indexed: ${ip}:${port}`);
        return;
    }

    try {
        const serverInfo = await ping(ip, port, 0, 10000); // Adjust protocol and timeout as needed

        let hostname = dnsCache[ip] || ip;

        if (serverInfo) {
            if (!dnsCache[ip]) {
                dns.reverse(ip, (err, hostnames) => {
                    if (!err) {
                        dnsCache[ip] = hostnames.find(name => /^[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/.test(name)) || ip;
                    } else {
                        console.error(`Error resolving hostname for ${ip}: ${err.message}`);
                    }
                });
            }

            hostname = dnsCache[ip];
            console.log(`Server online: ${ip}:${port}`);
            console.log(serverInfo);

            if (serverInfo.translate) {
                console.error(`Minecraft server connection error for ${ip}:${port} - ${serverInfo.translate}`);
            }

            if (serverInfo.text) {
                console.error(`Minecraft server connection error for ${ip}:${port} - ${serverInfo.text}`);
            }

            let description;
            if (serverInfo.description) {
                if (typeof serverInfo.description === 'string') {
                    description = serverInfo.description;
                } else if (serverInfo.description.text) {
                    description = serverInfo.description.text;
                }
            }

            let extraDescription;
            if (serverInfo.description.extra) {
                extraDescription = serverInfo.description.extra;
            }

            const serverData = {
                ip: ip,
                port: port,
                hostname: hostname || '', // Fetch hostname
                description: description || '', // Fetch description
                extraDescription: extraDescription || '', // Fetch extra description
                version: serverInfo.version.name || '', // Fetch version
                type: 'Java',
                maxPlayers: serverInfo.players.max || 0, // Fetch maxPlayers
                onlinePlayers: serverInfo.players.online || 0, // Fetch online players
                protocol: serverInfo.version.protocol || 127, // Fetch protocol version
                icon: serverInfo.favicon || '', // Fetch favicon
                modInfo: serverInfo.modinfo || '', // Fetch mod info
                motd: serverInfo.description.text || '', // Fetch Message of the Day (MOTD)
                isModded: serverInfo.modinfo ? true : false, // Check if server is running Forge or other mods
                isEulaBlocked: serverInfo.eulaBlocked || false, // Check if server is blocked by EULA
                preventsChatReports: serverInfo.preventsChatReports || false, // Check if server prevents chat reports
                whitelisted: null
            };
            results.push(serverData);
            saveResults();
            //checkIfWhitelisted(ip, port, version.replace(/[^0-9.]/g, ''));
            console.log(`Server Indexed: ${ip}:${port}`);
        } else {
            if(VERBOSE) {
                console.log(`Server offline: ${ip}:${port}`);
            }
        }
    } catch (err) {
        if(VERBOSE) {
            console.error(`Error pinging ${ip}:${port} - ${err.message}`);
            if (retries > 0) {
                console.log(`Retrying... (${retries} attempts left)`);
                setTimeout(() => queryServer(ip, port, retries - 1), 1000); // Retry after 1 second
            }
        }
    }
}



// Function to kill all running masscan processes
function killMasscanProcesses() {
    masscanProcesses.forEach(process => {
        process.kill();
    });
}

// Listen for process exit events and kill masscan processes
process.on('exit', () => {
    killMasscanProcesses()
    console.log('Exiting... (wait for a max of 10 seconds for the session to close)');
});
process.on('SIGINT', killMasscanProcesses);
process.on('SIGTERM', killMasscanProcesses);
process.on('uncaughtException', (err) => {
    console.error(`Uncaught exception: ${err.message}`);
    killMasscanProcesses();
    process.exit(1); // Exit the process after handling the exception
});

fullPort(25565);