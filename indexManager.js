const { spawn, execSync } = require('child_process');
const simpleGit = require('simple-git');
const fs = require('fs');
const git = simpleGit();

if(fs.existsSync('./masscan.bin')) {
    console.log('masscan.bin exists');
} else {
    console.error('masscan.exe does not exist - installing masscan');
    //sudo apt-get --assume-yes install git make gcc
    //git clone https://github.com/robertdavidgraham/masscan
    //cd masscan
    //make

    try{
        execSync('apt-get --assume-yes install git make gcc');
        execSync('git clone https://github.com/robertdavidgraham/masscan')
        execSync('cd masscan');
        execSync('make');

        //make install

        execSync('make install');

        console.log('masscan installed');
    } catch (err) {
        console.error('Failed to install masscan:', err);
        process.exit(1);
    }
}

const token = process.env.GITHUB_TOKEN; // GitHub Personal Access Token
let indexerProcess;

function runIndexer() {
    indexerProcess = spawn('node', ['indexerLinux.js']);

    console.log('Running indexer.js...');


    indexerProcess.stdout.on('data', (data) => {
        console.log(data);
    });

    indexerProcess.stderr.on('data', (data) => {
        console.error(`error: ${data}`);
    });

    indexerProcess.on('close', async (code) => {
        console.log(`indexer.js process exited with code ${code}`);
        // Upload update to GitHub
        try {
            await git.add('servers.json');
            await git.commit('Update servers.json');
            await git.push('https://Lawtro37:'+token+'@github.com/Lawtro37/mcServerSearch.git', 'main'); // Adjust branch name if necessary
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
