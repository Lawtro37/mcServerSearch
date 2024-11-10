const http = require('http');
const fs = require('fs');
const { Masscan } = require('node-masscan');
const path = require('path');
const net = require('net');
const varint = require('varint');
const minecraftPing = require('minecraft-ping');
const dns = require('dns');
const { Transform, PassThrough } = require('stream');
const asy = require('async');

let masscan = new Masscan(masscan_path = 'masscan.exe');

let scanStatus = 'idle';
let results = [];
const dnsCache = {};

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

function fullPort(port) {
    console.log('[1] ', 'Starting Masscan scan...');
    scanStatus = 'running';
    let ipCounter = 0; // Counter for scanned IPs

    masscan.on('found', (ip, port) => {
        ipCounter++;
        console.log(`Found ${ip}:${port}`);
        console.log(`Percentage : ${masscan.percentage}%`);
        queryServer(ip, port);
    });

    masscan.on('complete', (data) => {
        console.log('[1] ', 'Masscan scan complete.');
        console.log('[1] ', `Masscan finished. Total IPs scanned: ${ipCounter}`);
    });

    masscan.on('error', (message) => {
        console.error(`Masscan scan error: ${message}`);
        scanStatus = 'idle';
    });

    masscan.start('0.0.0.0/0', port.toString(), 1000000, 'exclude.conf');
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
                resolve({ ...serverInfo });
            } catch (e) {
                resolve(false);
            }
        });

        client.on('error', client.destroy);

        client.on('close', client.destroy);
    });
}

const queue = asy.queue((task, callback) => {
    task(callback);
}, 10); // Limit to 10 concurrent operations

function queryServer(ip, port, retries = 3) {
    if (results.some(element => element.ip === ip && element.port === port)) {
        console.log(`Server already indexed: ${ip}:${port}`);
        return;
    }

    async function attemptPing(retriesLeft) {
        try {
            const serverInfo = await ping(ip, port, 0, 1000); // Adjust protocol and timeout as needed

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
                    preventsChatReports: serverInfo.preventsChatReports || false // Check if server prevents chat reports
                };
                results.push(serverData);
                saveResults();
                console.log(`Server Indexed: ${ip}:${port}`);
            } else {
                console.log(`Server offline: ${ip}:${port}`);
            }
        } catch (err) {
            console.error(`Error pinging ${ip}:${port} - ${err.message}`);
            if (retriesLeft > 0) {
                console.log(`Retrying... (${retriesLeft} attempts left)`);
                setTimeout(() => attemptPing(retriesLeft - 1), 1000); // Retry after 1 second
            }
        }
    }

    queue.push(callback => {
        attemptPing(retries).then(callback);
    });
}

fullPort(25565);