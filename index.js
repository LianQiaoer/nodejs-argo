#!/usr/bin/env node

const http = require("http");
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// 环境变量配置与缺省值（内置永久固定隧道配置，即便平台未填环境变量亦可秒级自愈）
const FILE_PATH = process.env.FILE_PATH || path.join(process.cwd(), '.npm');
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '3000', 10);
const UUID = process.env.UUID || 'cfac9249-36c8-4790-a918-d38fa847d099';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || 'wb3.re99.ccwu.cc';
const ARGO_AUTH = process.env.ARGO_AUTH || 'eyJhIjoiYmJlYmQ5YjU2OGFiMWRlNzlkZTI0NWIyZmFjNmMwZjEiLCJ0IjoiZjgxNWE4MGItZWEzNS00NGY2LTgzMDQtNWIxOGQ2MDIwNjJlIiwicyI6ImVDWHJYdzNYeC95OXpGa3FoVU9tTE5VVUJmYStZK1JhbC9hUVU0SW4wclZLa3B5czN2ZFhoK2kwOU1aVmVTTmNGOWVPa1d5RDlZSVlDZGRwRUx3elh3PT0ifQ==';
const ARGO_PORT = parseInt(process.env.ARGO_PORT || '8003', 10);
const CFIP = process.env.CFIP || '104.21.36.66';
const CFPORT = parseInt(process.env.CFPORT || '443', 10);
const NAME = process.env.NAME || 'CA-OVHcloud';
const PROJECT_URL = process.env.PROJECT_URL || '';

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH, { recursive: true });
}

function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

const webName = generateRandomName();
const botName = generateRandomName();
const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);
const subPath = path.join(FILE_PATH, 'sub.txt');
const configPath = path.join(FILE_PATH, 'config.json');

let subContent = null;
let webProcess = null;
let botProcess = null;

function log(tag, message) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [${tag}] ${message}`);
}

// 生成 Xray 配置
function generateConfig() {
  const config = {
    log: { access: 'none', error: '', loglevel: 'warning' },
    inbounds: [
      {
        port: ARGO_PORT,
        listen: '::',
        protocol: 'vless',
        settings: {
          clients: [{ id: UUID, flow: 'xtls-rprx-vision' }],
          decryption: 'none',
          fallbacks: [
            { dest: 3001 },
            { path: '/vless-argo', dest: 3002 },
            { path: '/vmess-argo', dest: 3003 },
            { path: '/trojan-argo', dest: 3004 }
          ]
        },
        streamSettings: { network: 'tcp' }
      },
      {
        port: 3001,
        listen: '127.0.0.1',
        protocol: 'vless',
        settings: { clients: [{ id: UUID }], decryption: 'none' },
        streamSettings: { network: 'tcp', security: 'none' }
      },
      {
        port: 3002,
        listen: '127.0.0.1',
        protocol: 'vless',
        settings: { clients: [{ id: UUID, level: 0 }], decryption: 'none' },
        streamSettings: {
          network: 'ws',
          security: 'none',
          wsSettings: { path: '/vless-argo' }
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], metadataOnly: false }
      },
      {
        port: 3003,
        listen: '127.0.0.1',
        protocol: 'vmess',
        settings: { clients: [{ id: UUID, alterId: 0 }] },
        streamSettings: {
          network: 'ws',
          wsSettings: { path: '/vmess-argo' }
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], metadataOnly: false }
      },
      {
        port: 3004,
        listen: '127.0.0.1',
        protocol: 'trojan',
        settings: { clients: [{ password: UUID }] },
        streamSettings: {
          network: 'ws',
          security: 'none',
          wsSettings: { path: '/trojan-argo' }
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], metadataOnly: false }
      }
    ],
    dns: { servers: ['https+local://8.8.8.8/dns-query'] },
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'block' }
    ]
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  log('CONFIG', `Xray config generated at ${configPath} (listening on port ${ARGO_PORT})`);
}

function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  }
  return 'amd';
}

function downloadFile(filePath, url) {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 30000
    })
      .then(response => {
        response.data.pipe(writer);
        writer.on('finish', () => {
          writer.close();
          log('DOWNLOAD', `Saved ${path.basename(filePath)} from ${url}`);
          resolve(filePath);
        });
        writer.on('error', err => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      })
      .catch(err => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
  });
}

async function downloadBinaries() {
  const arch = getSystemArchitecture();
  const baseUrl = arch === 'arm' ? 'https://arm64.ssss.nyc.mn' : 'https://amd64.ssss.nyc.mn';

  log('SYSTEM', `Detected architecture: ${arch}`);
  await downloadFile(webPath, `${baseUrl}/web`);
  await downloadFile(botPath, `${baseUrl}/bot`);

  fs.chmodSync(webPath, 0o775);
  fs.chmodSync(botPath, 0o775);
  log('PERM', `Permissions 775 applied to binaries in ${FILE_PATH}`);
}

function startXray() {
  log('XRAY', `Launching Xray process (${webPath})...`);
  webProcess = spawn(webPath, ['-c', configPath], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  webProcess.stdout.on('data', data => {
    const s = data.toString().trim();
    if (s) log('XRAY:OUT', s);
  });

  webProcess.stderr.on('data', data => {
    const s = data.toString().trim();
    if (s) log('XRAY:ERR', s);
  });

  webProcess.on('exit', (code, signal) => {
    log('XRAY:WATCHDOG', `Xray exited (code=${code}, signal=${signal}). Auto-restarting in 5s...`);
    setTimeout(startXray, 5000);
  });
}

function startCloudflared() {
  if (!fs.existsSync(botPath)) {
    log('ARGO', `Cloudflared binary not found: ${botPath}`);
    return;
  }

  let args = [];
  if (ARGO_AUTH && ARGO_AUTH.length >= 100) {
    log('ARGO', `Using Named Tunnel (Token mode) for ${ARGO_DOMAIN} -> http://localhost:${ARGO_PORT}`);
    args = [
      'tunnel',
      '--edge-ip-version', 'auto',
      '--no-autoupdate',
      '--protocol', 'http2',
      'run',
      '--token', ARGO_AUTH
    ];
  } else {
    log('ARGO', `Using quick tunnel forwarding to http://localhost:${ARGO_PORT}`);
    args = [
      'tunnel',
      '--edge-ip-version', 'auto',
      '--no-autoupdate',
      '--protocol', 'http2',
      '--url', `http://localhost:${ARGO_PORT}`
    ];
  }

  log('ARGO', `Spawning cloudflared: ${botPath} ${args.slice(0, -1).join(' ')} [token hidden]`);
  botProcess = spawn(botPath, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const handleOutput = (data, isErr) => {
    const text = data.toString();
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      log(isErr ? 'ARGO:ERR' : 'ARGO:OUT', trimmed);

      // 提取临时隧道域名（仅在 quick tunnel 模式下）
      if (!ARGO_AUTH || ARGO_AUTH.length < 100) {
        const m = trimmed.match(/https?:\/\/([a-zA-Z0-9.-]+\.trycloudflare\.com)/);
        if (m && m[1]) {
          log('ARGO', `Quick tunnel active domain: ${m[1]}`);
          generateSubscription(m[1]);
        }
      }
    }
  };

  botProcess.stdout.on('data', data => handleOutput(data, false));
  botProcess.stderr.on('data', data => handleOutput(data, true));

  botProcess.on('exit', (code, signal) => {
    log('ARGO:WATCHDOG', `Cloudflared exited (code=${code}, signal=${signal}). Auto-restarting in 5s...`);
    setTimeout(startCloudflared, 5000);
  });
}

function generateSubscription(domain) {
  const targetDomain = domain || ARGO_DOMAIN;
  if (!targetDomain) return;

  const vmessObj = {
    v: '2',
    ps: NAME,
    add: CFIP,
    port: CFPORT,
    id: UUID,
    aid: '0',
    scy: 'none',
    net: 'ws',
    type: 'none',
    host: targetDomain,
    path: '/vmess-argo?ed=2560',
    tls: 'tls',
    sni: targetDomain,
    alpn: '',
    fp: 'firefox'
  };

  const lines = [
    `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${targetDomain}&fp=firefox&type=ws&host=${targetDomain}&path=%2Fvless-argo%3Fed%3D2560#${encodeURIComponent(NAME)}`,
    '',
    `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`,
    '',
    `trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${targetDomain}&fp=firefox&type=ws&host=${targetDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${encodeURIComponent(NAME)}`
  ].join('\n');

  subContent = Buffer.from(lines).toString('base64');
  fs.writeFileSync(subPath, subContent);
  log('SUB', `Saved subscription to ${subPath} (domain: ${targetDomain})`);
  console.log('\n--- SUBSCRIPTION BASE64 ---\n' + subContent + '\n--- END SUBSCRIPTION ---\n');
}

function startHttpServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/' + SUB_PATH) {
      if (subContent) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(subContent);
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Subscription initializing...');
      }
      return;
    }
    if (url === '/ping' || url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }
    if (url === '/') {
      const htmlPath = path.join(__dirname, 'index.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(htmlPath, 'utf8'));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Argo Proxy Node is running normally.');
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    log('HTTP', `Web server listening on 0.0.0.0:${PORT} (Subscription URL: /${SUB_PATH})`);
  });
}

// 容器自保活心跳（防止免费 PaaS 平台因空闲停机）
function startKeepAlive() {
  if (PROJECT_URL) {
    log('KEEPALIVE', `Periodic self-ping configured for ${PROJECT_URL}/ping`);
    setInterval(async () => {
      try {
        await axios.get(`${PROJECT_URL}/ping`, { timeout: 6000 });
        log('KEEPALIVE', `Self-ping OK`);
      } catch (err) {
        log('KEEPALIVE', `Self-ping warning: ${err.message}`);
      }
    }, 120000); // 每2分钟一次
  }
}

async function main() {
  try {
    startHttpServer();
    generateConfig();
    await downloadBinaries();
    startXray();
    startCloudflared();
    generateSubscription(ARGO_DOMAIN);
    startKeepAlive();
    log('READY', 'All background processes started with watchdog supervision.');
  } catch (err) {
    log('FATAL', `Startup failure: ${err.stack || err}`);
  }
}

main();
