const { spawn, execSync } = require('child_process');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const git = simpleGit();

const masscanPath = path.join(__dirname, 'masscan.exe');
const excludeFilePath = path.join(__dirname, 'exclude.conf');

// print ./ as tree
console.log(fs.readdirSync('./', { withFileTypes: true }).map(dirent => (dirent.isDirectory() ? `${dirent.name}/` : dirent.name)).join('\n'));

if (fs.existsSync(masscanPath)) {
    console.log('masscan.exe exists');
} else {
    console.error('masscan.exe does not exist - installing masscan');
    try {
        // Install Chocolatey if not installed
        execSync('@powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((New-Object System.Net.WebClient).DownloadString(\'https://community.chocolatey.org/install.ps1\'))"');
        // Install masscan using Chocolatey
        execSync('choco install masscan -y');
        console.log('masscan installed');
    } catch (err) {
        console.error('Failed to install masscan:', err);
        process.exit(1);
    }
}

// Set Git user name and email
try {
    git.addConfig('user.email', 'lawton37@hotmail.com');
    git.addConfig('user.name', 'Lawtro37');
} catch (err) {
    console.error('Failed to set Git user name and email:', err);
    process.exit(1);
}

const token = process.env.GITHUB_TOKEN; // GitHub Personal Access Token
let indexerProcess;

function runIndexer() {
    if (!fs.existsSync(masscanPath)) {
        console.error(`masscan.exe not found at ${masscanPath}`);
        process.exit(1);
    }

    try {
        fs.accessSync(masscanPath, fs.constants.X_OK);
    } catch (err) {
        console.error(`masscan.exe does not have execute permissions: ${err.message}`);
        process.exit(1);
    }

    indexerProcess = spawn('node', ['indexer.js']);

    console.log('Running indexer.js...');

    indexerProcess.stdout.on('data', (data) => {
        console.log(data.toString());
    });

    indexerProcess.stderr.on('data', (data) => {
        console.error(`error: ${data.toString()}`);
    });

    indexerProcess.on('close', async (code) => {
        console.log(`indexer.js process exited with code ${code}`);
        // Upload update to GitHub
        try {
            await git.add('servers.json');
            await git.commit('Update servers.json');
            await git.push(`https://${token}@github.com/Lawtro37/mcServerSearch.git`, 'main'); // Adjust branch name if necessary
            console.log('servers.json has been updated and pushed to GitHub.');
            
            //restart
            runIndexer();
            
        } catch (err) {
            console.error('Failed to update servers.json to GitHub:', err);
        }
    });
}

runIndexer();

// Listen for process exit events and kill the child process
process.on('exit', () => {
    console.log('Exiting...');
    if (indexerProcess) indexerProcess.kill();
});
process.on('SIGINT', () => {
    console.log('Exiting...');
    if (indexerProcess) indexerProcess.kill();
    process.exit();
});
process.on('SIGTERM', () => {
    console.log('Exiting...');
    if (indexerProcess) indexerProcess.kill();
    process.exit();
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    if (indexerProcess) indexerProcess.kill();
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    if (indexerProcess) indexerProcess.kill();
    process.exit(1);
});
