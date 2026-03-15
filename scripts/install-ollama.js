const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

async function installOllama() {
  console.log('=== Johnny AI Assistant - Ollama Installer ===\n');
  
  const platform = os.platform();
  
  try {
    // Prüfe ob Ollama bereits installiert ist
    try {
      const { stdout } = await execAsync('ollama --version');
      console.log('✓ Ollama is already installed:', stdout.trim());
      return true;
    } catch (error) {
      console.log('Ollama not found, starting installation...\n');
    }

    if (platform === 'win32') {
      await installWindowsOllama();
    } else if (platform === 'darwin') {
      console.log('macOS detected. Please install Ollama manually:');
      console.log('Visit: https://ollama.com/download/mac');
      console.log('\nOr use Homebrew:');
      console.log('  brew install ollama');
    } else if (platform === 'linux') {
      await installLinuxOllama();
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    console.log('\n✓ Ollama installation completed!');
    console.log('\nNext steps:');
    console.log('1. Ollama will start automatically with Johnny');
    console.log('2. The gemma2:27b model will be downloaded on first run');
    console.log('3. This may take some time depending on your internet connection');
    
    return true;
  } catch (error) {
    console.error('\n✗ Installation failed:', error.message);
    console.log('\nPlease install Ollama manually from: https://ollama.com');
    return false;
  }
}

async function installWindowsOllama() {
  console.log('Downloading Ollama for Windows...\n');
  
  const downloadUrl = 'https://ollama.com/download/OllamaSetup.exe';
  const downloadPath = path.join(os.tmpdir(), 'OllamaSetup.exe');
  
  // Download
  await downloadFile(downloadUrl, downloadPath);
  
  console.log('\nInstalling Ollama...');
  console.log('This will open the installer. Please follow the installation steps.\n');
  
  // Starte Installer
  await execAsync(`"${downloadPath}"`);
  
  console.log('Waiting for installation to complete...');
  await new Promise(resolve => setTimeout(resolve, 15000));
}

async function installLinuxOllama() {
  console.log('Installing Ollama for Linux...\n');
  
  const installScript = 'curl -fsSL https://ollama.com/install.sh | sh';
  
  console.log('Running installation script...');
  const { stdout, stderr } = await execAsync(installScript);
  
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return downloadFile(response.headers.location, destination).then(resolve).catch(reject);
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      
      response.pipe(file);
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = ((downloadedSize / totalSize) * 100).toFixed(1);
        process.stdout.write(`\rProgress: ${progress}% (${Math.round(downloadedSize / 1024 / 1024)} MB / ${Math.round(totalSize / 1024 / 1024)} MB)`);
      });
      
      file.on('finish', () => {
        file.close();
        console.log('\n✓ Download completed');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destination, () => {});
      reject(err);
    });
  });
}

// Run installation
installOllama().then((success) => {
  process.exit(success ? 0 : 1);
});
