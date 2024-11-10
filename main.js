const http = require('http');
const os = require('os');
const fs = require('fs');
const dns = require('dns');
const net = require('net');

function formatMinecraftText(text) {
    if (typeof text != "string") return text;
    if (!text) return text;
    return text
        .replace(/§0/g, '<span style="color: #000000;">')
        .replace(/§1/g, '<span style="color: #0000AA;">')
        .replace(/§2/g, '<span style="color: #00AA00;">')
        .replace(/§3/g, '<span style="color: #00AAAA;">')
        .replace(/§4/g, '<span style="color: #AA0000;">')
        .replace(/§5/g, '<span style="color: #AA00AA;">')
        .replace(/§6/g, '<span style="color: #FFAA00;">')
        .replace(/§7/g, '<span style="color: #AAAAAA;">')
        .replace(/§8/g, '<span style="color: #555555;">')
        .replace(/§9/g, '<span style="color: #5555FF;">')
        .replace(/§a/g, '<span style="color: #55FF55;">')
        .replace(/§b/g, '<span style="color: #55FFFF;">')
        .replace(/§c/g, '<span style="color: #FF5555;">')
        .replace(/§d/g, '<span style="color: #FF55FF;">')
        .replace(/§e/g, '<span style="color: #FFFF55;">')
        .replace(/§f/g, '<span style="color: #FFFFFF;">')
        .replace(/§l/g, '<span style="font-weight: bold;">')
        .replace(/§m/g, '<span style="text-decoration: line-through;">')
        .replace(/§n/g, '<span style="text-decoration: underline;">')
        .replace(/§o/g, '<span style="font-style: italic;">')
        .replace(/§k/g, '<span style="visibility: hidden;">')
        .replace(/§r/g, '</span>')
        .replace(/\n/g, '<br>')
        .replace(/&0/g, '<span style="color: #000000;">')
        .replace(/&1/g, '<span style="color: #0000AA;">')
        .replace(/&2/g, '<span style="color: #00AA00;">')
        .replace(/&3/g, '<span style="color: #00AAAA;">')
        .replace(/&4/g, '<span style="color: #AA0000;">')
        .replace(/&5/g, '<span style="color: #AA00AA;">')
        .replace(/&6/g, '<span style="color: #FFAA00;">')
        .replace(/&7/g, '<span style="color: #AAAAAA;">')
        .replace(/&8/g, '<span style="color: #555555;">')
        .replace(/&9/g, '<span style="color: #5555FF;">')
        .replace(/&a/g, '<span style="color: #55FF55;">')
        .replace(/&b/g, '<span style="color: #55FFFF;">')
        .replace(/&c/g, '<span style="color: #FF5555;">')
        .replace(/&d/g, '<span style="color: #FF55FF;">')
        .replace(/&e/g, '<span style="color: #FFFF55;">')
        .replace(/&f/g, '<span style="color: #FFFFFF;">')
        .replace(/&l/g, '<span style="font-weight: bold;">')
        .replace(/&m/g, '<span style="text-decoration: line-through;">')
        .replace(/&n/g, '<span style="text-decoration: underline;">')
        .replace(/&o/g, '<span style="font-style: italic;">')
        .replace(/&r/g, '</span>')
}

const data = JSON.parse(fs.readFileSync('servers.json'));

const RESULTS_PER_PAGE = 25; // Number of results per page

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

function ping(ip, port, protocol, timeout) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        const timeoutCheck = setTimeout(() => {
            client.destroy();
            resolve(false);
        }, timeout);

        client.connect(port, ip, () => {
            const handshakePacket = Buffer.concat([
                Buffer.from([0x00]),
                Buffer.from(varint.encode(protocol)),
                Buffer.from([ip.length]),
                Buffer.from(ip, 'utf-8'),
                Buffer.from(new Uint16Array([port]).buffer).reverse(),
                Buffer.from([0x01]),
                Buffer.from([0x01]),
                Buffer.from([0x00])
            ]);
            const packetLength = Buffer.alloc(1);
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

function handleSearchQuery(searchParams, res) {
    const version = searchParams.get('version');
    const search = searchParams.get('search')?.toLowerCase();
    const edition = searchParams.get('edition');
    const page = parseInt(searchParams.get('page')) || 1;
    let results = data;

    if (version && version !== 'all' && version !== '') {
        console.log(`filtering by version: ${version}`);
        results = results.filter(server => server.version.includes(version));
    }

    if (edition && edition !== 'all' && edition !== '') {
        console.log(`filtering by edition: ${edition}`);
        results = results.filter(server => server.type === edition);
    }

    if (search) {
        console.log(`searching for: ${search}`);
        results = results.filter(server =>
            (server.description && typeof server.description === "string" && server.description.toLowerCase().includes(search)) ||
            (server.motd && typeof server.motd === "string" && server.motd.toLowerCase().includes(search)) ||
            (server.hostname && typeof server.hostname === "string" && server.hostname.toLowerCase().includes(search)) ||
            (server.ip && typeof server.ip === "string" && server.ip.toLowerCase().includes(search))
        );
    }

    const totalResults = results.length;
    const totalPages = Math.ceil(totalResults / RESULTS_PER_PAGE);
    const startIndex = (page - 1) * RESULTS_PER_PAGE;
    const endIndex = Math.min(startIndex + RESULTS_PER_PAGE, totalResults);
    results = results.slice(startIndex, endIndex);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(`
        <head>
            <style>
                body { font-family: Arial; }
                img { width: 64px; height: 64px; float: left; margin-right: 10px; }
                h2 { margin-bottom: 0; }
                h3 { margin-top: 0; }
                p { margin-top: 0; }
                .server { 
                    margin-bottom: 20px; 
                    border: 1px solid black;
                    padding: 10px;
                    border-radius: 5px;
                    overflow: auto; /* Ensure the container clears the floated image */
                }
                .header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 10px;
                    background-color: #555555;
                    padding: 5px;
                    border-radius: 5px;
                }
                .header img {
                    width: 100px;
                    height: 100px;
                    margin-right: 20px;
                }
                .pagination {
                    margin-top: 20px;
                }
                .pagination a {
                    margin: 0 5px;
                    text-decoration: none;
                    color: blue;
                }
                .space {
                    margin-bottom: 20px;
                }
                a, a:link, a:visited, a:hover, a:active {
                    text-decoration: none;
                    color: inherit;
                }
                @media (prefers-color-scheme: dark) {
                    body { background-color: #121212; color: #ffffff; }
                    .server { border-color: #ffffff; }
                    .pagination a { color: #bb86fc; }
                }
                @media (prefers-color-scheme: light) {
                    body { background-color: #ffffff; color: #000000; }
                    .server { border-color: #000000; }
                    .pagination a { color: blue; }
                }
            </style>
            <script src=""></script>
        </head>`);
    res.write(`
        <div class="header">
            <a href="/">
                <img src="data:image/png;base64,${fs.readFileSync("./mc search.png").toString("base64")}" alt="logo">
            </a>
            <div>
                <h1>Mc Server Search</h1>
                <form action="/" method="get">
                    <label for="search">Search:</label>
                    <input type="text" id="search" name="search">
                    <label for="version">Version:</label>
                    <select id="version" name="version">
                        <option value="all">All</option>
                        <option value="1.21">1.21</option>
                        <option value="1.20">1.20</option>
                        <option value="1.20.6">1.20.6</option>
                        <option value="1.20.5">1.20.5</option>
                        <option value="1.20.4">1.20.4</option>
                        <option value="1.20.3">1.20.3</option>
                        <option value="1.20.2">1.20.2</option>
                        <option value="1.20.1">1.20.1</option>
                        <option value="1.19">1.19</option>
                        <option value="1.19.4">1.19.4</option>
                        <option value="1.19.3">1.19.3</option>
                        <option value="1.19.2">1.19.2</option>
                        <option value="1.19.1">1.19.1</option>
                        <option value="1.18">1.18</option>
                        <option value="1.17">1.17</option>
                        <option value="1.16">1.16</option>
                        <option value="1.15">1.15</option>
                        <option value="1.14">1.14</option>
                        <option value="1.13">1.13</option>
                        <option value="1.12">1.12</option>
                        <option value="1.11">1.11</option>
                        <option value="1.10">1.10</option>
                        <option value="1.9">1.9</option>
                        <option value="1.8.9">1.8.9</option>
                        <option value="1.8.7">1.8.7</option>
                        <option value="1.8.6">1.8.6</option>
                        <option value="1.8.5">1.8.5</option>
                        <option value="1.8.4">1.8.4</option>
                        <option value="1.8.3">1.8.3</option>
                        <option value="1.8.2">1.8.2</option>
                        <option value="1.8.1">1.8.1</option>
                        <option value="1.8">1.8</option>
                        <option value="1.7">1.7</option>   
                        <option value="1.6">1.6</option>
                        <option value="1.5">1.5</option>
                        <option value="1.4">1.4</option>
                        <option value="1.3">1.3</option>
                        <option value="1.2">1.2</option>
                        <option value="1.1">1.1</option>
                        <option value="1.0">1.0</option>
                        <option value="Paper">Paper</option>
                        <option value="Spigot">Spigot</option>
                        <option value="Bukkit">Bukkit</option>
                    </select>
                    <label for="edition">Edition:</label>
                    <select id="edition" name="edition">
                        <option value="all">All</option>
                        <option value="java">Java</option>
                        <option value="bedrock">Bedrock</option>
                    </select>
                    <input type="submit" value="Submit">
                </form>
            </div>
        </div>
    `);
    res.write('<h2>Search Results</h2>');
    res.write(`retrieved ${totalResults} results`);
    res.write('<div class="space"></div>');

    if (results.length > 0) {
        let pendingLookups = results.length;

        const lookupPromises = results.map(server => {
            return new Promise((resolve) => {
                if (server.isEulaBlocked) {
                    pendingLookups--;
                    resolve();
                    return;
                }

                let description = server.description || "no description";
                let motd = server.motd || "no message of the day";
                writeResponse(server.hostname, server, description, motd, res);
                pendingLookups--;
                resolve();
            });
        });

        Promise.all(lookupPromises).then(() => {
            if (pendingLookups === 0) {
                res.write('<div class="pagination">');
                if (page > 1) {
                    res.write(`<a href="?search=${search}&version=${version}&page=${page - 1}">Previous</a>`);
                }
                if (page < totalPages) {
                    res.write(`<a href="?search=${search}&version=${version}&page=${page + 1}">Next</a>`);
                }
                res.write(`Page ${page} of ${totalPages}`);
                res.write('</div>');
                res.end();
            }
        });
    } else {
        res.write('<p>No results found</p>');
        res.write(`
            <div style="text-align: center;">
                <img style="width: 50%; height: 50%" src="data:image/png;base64,${fs.readFileSync("./cob.png").toString("base64")}" alt="No results found">
            </div>
        `);
        res.end();
    }
}

function formatExtraDescription(extraDescription) {
    return extraDescription.map(part => {
        if (typeof part === 'string') {
            return part;
        }

        let style = '';
        if (part.color) {
            style += `color: ${part.color};`;
        }
        if (part.bold) {
            style += 'font-weight: bold;';
        }

        let text = part.text || '';
        if (part.extra) {
            text += formatExtraDescription(part.extra);
        }

        return `<span style="${style}">${text}</span>`;
    }).join('');
}

function writeResponse(hostname, server, description, motd, res) {
    res.write('<div class="server">');
    if (server.icon) {
        res.write(`<img src="${server.icon}"/>`);
    } else {
        res.write(fs.readFileSync('image.txt'));
    }
    res.write(`<a href="/server?ip=${server.ip}">`);
    if (hostname && hostname !== server.ip) {
        res.write(`<h2>${hostname} (${server.ip})</h2>`);
    } else {
        res.write(`<h2>${server.ip}</h2>`);
    }
    res.write('</a>');
    if (description) {
        res.write(`<h3>${formatMinecraftText(description)}</h3>`);
    } else if (server.extraDescription != "") {
        res.write(`<h3>${formatExtraDescription(server.extraDescription)}</h3>`);
    } else {
        res.write('<h3>no description</h3>');
    }
    res.write(`<p>${formatMinecraftText(motd)}</p>`);
    res.write(`<p>max players: ${server.maxPlayers || "?"}</p>`);
    res.write(`<p style="text-size: 5px;">${server.version || "unknown version"}</p>`);
    res.write('</div>');
}

function handleServerDetails(ip, res) {
    const server = data.find(s => s.ip === ip);
    if (!server) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.write('<h1>404 Not Found</h1>');
        res.end();
        return;
    }

    dns.reverse(server.ip, (err, hostnames) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(`
            <head>
                <style>
                    body { font-family: Arial; }
                    img { width: 64px; height: 64px; float: left; margin-right: 10px; }
                    h2 { margin-bottom: 0; }
                    h3 { margin-top: 0; }
                    p { margin-top: 0; }
                    .server { 
                        margin-bottom: 20px; 
                        padding: 10px;
                        overflow: auto; /* Ensure the container clears the floated image */
                    }
                    @media (prefers-color-scheme: dark) {
                        body { background-color: #121212; color: #ffffff; }
                        .server { border-color: #ffffff; }
                    }
                    @media (prefers-color-scheme: light) {
                        body { background-color: #ffffff; color: #000000; }
                        .server { border-color: #000000; }
                    }
                </style>
            </head>`);
        res.write('<div class="server">');
        if (server.icon) {
            res.write(`<img src="${server.icon}"/>`);
        } else {
            res.write(fs.readFileSync('image.txt'));
        }
        if(server.hostname && server.hostname !== server.ip) {
            res.write(`<h1>${server.hostname} (${server.ip})</h1>`);
        } else {
            res.write(`<h1>${server.ip}</h1>`);
        }
        res.write(`<h2>${formatMinecraftText(server.description) || "no description"}</h2>`);
        res.write(`<p>${formatMinecraftText(server.motd) || "no message of the day"}</p>`);
        res.write(`<p>max players: ${server.maxPlayers || "?"}</p>`);
        res.write(`<p>version: ${server.version || "unknown version"}</p>`);
        res.write(`<div class="space"></div>`);
        res.write(`<div class="space"></div>`);
        res.write(`<h1>dev Info</h1>`);
        let formattedJson = JSON.stringify(server, null, 2)
            .replace(/\n/g, '<br>')
            .replace(/ /g, '&nbsp;');
        res.write(`<pre>${formattedJson}</pre>`);
        res.write('<p>hostnames: </p>');
        res.write(`<pre>${hostnames || ""}</pre>`);
        res.write('</div>');
        res.end();
    });
}

const server = http.createServer((req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;
        const searchParams = url.searchParams;

        if (path === '/') {
            if (searchParams.get('search') || searchParams.get('version')) {
                handleSearchQuery(searchParams, res);
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.write(fs.readFileSync('./website/index.html'));
                res.end();
                return;
            }
        } else if (path === '/about') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.write('<h1>About Us</h1>');
            res.end();
        } else if (path === '/contact') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.write('<h1>Contact Us</h1>');
            res.end();
        } else if (path === '/data') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write(JSON.stringify({ message: 'Hello World!' }));
            res.end();
        } else if (path === '/server') {
            const ip = searchParams.get('ip');
            handleServerDetails(ip, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.write('<h1>404 Not Found</h1>');
            res.end();
        }
    } catch (error) {
        console.error(`Error handling request: ${error.message}`);
    }
});

server.listen(443, "https://mcserversearch.onrender.com", () => {
    console.log(`Server running at http://${getNetworkIP()}(https://mcserversearch.onrender.com):3000/`);
});
