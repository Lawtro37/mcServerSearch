const { spawn, execSync } = require('child_process');
const simpleGit = require('simple-git');
const fs = require('fs');
const git = simpleGit();

if (fs.existsSync('./masscan.exe')) {
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
    indexerProcess.kill();
});
process.on('SIGINT', () => {
    console.log('Exiting...');
    indexerProcess.kill();
    process.exit();
});
process.on('SIGTERM', () => {
    console.log('Exiting...');
    indexerProcess.kill();
    process.exit();
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    indexerProcess.kill();
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    indexerProcess.kill();
    process.exit(1);
});
