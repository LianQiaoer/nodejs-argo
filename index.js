#!/usr/bin/env node

const http = require("http");
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// 异常防护：拦截未捕获错误，确保主进程不退
process.on('uncaughtException', (err) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.error(`[${ts}] [FATAL:UNCAUGHT] ${err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.error(`[${ts}] [FATAL:REJECTION] ${reason}`);
});
process.on('SIGTERM', () => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [SYSTEM] Received SIGTERM from platform`);
});
process.on('SIGINT', () => {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [SYSTEM] Received SIGINT`);
});

// 核心参数与硬编码兜底（保证白板部署亦能秒连正式隧道）
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
        listen: '0.0.0.0',
        protocol: 'vless',
        settings: {
          clients: [{ id: UUID, flow: 'xtls-rprx-vision' }],
          decryption: 'none',
          fallbacks: [
            { dest: PORT },
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
  if (webProcess && !webProcess.killed && webProcess.exitCode === null) {
    return;
  }
  log('XRAY', `Launching Xray process (${webPath})...`);
  webProcess = spawn(webPath, ['-c', configPath], {
    stdio: 'inherit'
  });

  webProcess.on('error', err => {
    log('XRAY:ERROR', err.stack || err);
  });

  webProcess.on('exit', (code, signal) => {
    log('XRAY:WATCHDOG', `Xray exited (code=${code}, signal=${signal}). Restarting in 3s...`);
    setTimeout(startXray, 3000);
  });
}

function startCloudflared() {
  if (botProcess && !botProcess.killed && botProcess.exitCode === null) {
    return;
  }
  if (!fs.existsSync(botPath)) {
    log('ARGO', `Cloudflared binary not found: ${botPath}`);
    return;
  }

  // 使用 Cloudflare 推荐的 QUIC 原生协议，避免 HTTP/2 在客户端断开连接时触发控制流取消 Bug
  let args = [];
  if (ARGO_AUTH && ARGO_AUTH.length >= 100) {
    log('ARGO', `Using Named Tunnel (Token QUIC mode) for ${ARGO_DOMAIN} -> http://localhost:${ARGO_PORT}`);
    args = [
      'tunnel',
      '--edge-ip-version', '4',
      '--no-autoupdate',
      'run',
      '--token', ARGO_AUTH
    ];
  } else {
    log('ARGO', `Using quick tunnel forwarding to http://localhost:${ARGO_PORT}`);
    args = [
      'tunnel',
      '--edge-ip-version', '4',
      '--no-autoupdate',
      '--url', `http://localhost:${ARGO_PORT}`
    ];
  }

  log('ARGO', `Spawning cloudflared: ${botPath} ${args.slice(0, -1).join(' ')} [token hidden]`);
  botProcess = spawn(botPath, args, {
    stdio: 'inherit'
  });

  botProcess.on('error', err => {
    log('ARGO:ERROR', err.stack || err);
  });

  botProcess.on('exit', (code, signal) => {
    log('ARGO:WATCHDOG', `Cloudflared exited (code=${code}, signal=${signal}). Restarting in 3s...`);
    setTimeout(startCloudflared, 3000);
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

// 统一 HTTP 请求处理器，全面适配各种健康检查
function handleHttpRequest(req, res) {
  req.on('error', () => {});
  res.on('error', () => {});

  const url = (req.url || '/').split('?')[0];
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
  // 全面响应所有主流平台的存活检查
  if (url === '/ping' || url === '/health' || url === '/healthz' || url === '/live' || url === '/ready') {
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
}

// 启动多端口 HTTP 监听（同时监听 PORT、80、8080），彻底杜绝 PaaS 平台端口不匹配导致的健康检查超时停机
function startHttpServers() {
  const ports = Array.from(new Set([PORT, 80, 8080]));
  for (const p of ports) {
    try {
      const server = http.createServer(handleHttpRequest);
      server.on('error', (err) => {
        log('HTTP:WARN', `Could not bind port ${p} (${err.code}), continuing on other ports.`);
      });
      server.listen(p, '0.0.0.0', () => {
        log('HTTP', `Health & Web server active on 0.0.0.0:${p}`);
      });
    } catch (e) {
      // 忽略单个端口绑定异常（例如普通用户无权绑定 80）
    }
  }
}

// 容器与协议栈全链路自保活心跳
function startKeepAlive() {
  // 本地内部心跳，每 25 秒触发一次请求，确保 Xray 和 Node 事件循环永不挂起
  setInterval(async () => {
    try {
      await axios.get(`http://127.0.0.1:${PORT}/ping`, { timeout: 3000 });
      await axios.get(`http://127.0.0.1:${ARGO_PORT}/ping`, { timeout: 3000 });
    } catch (_) {}
  }, 25000);

  if (PROJECT_URL) {
    log('KEEPALIVE', `Periodic self-ping configured for ${PROJECT_URL}/ping`);
    setInterval(async () => {
      try {
        await axios.get(`${PROJECT_URL}/ping`, { timeout: 6000 });
        log('KEEPALIVE', `Self-ping OK`);
      } catch (err) {
        log('KEEPALIVE', `Self-ping warning: ${err.message}`);
      }
    }, 120000);
  }
}

// 30 秒主动心跳看门狗
function startWatchdogLoop() {
  setInterval(() => {
    const xrayAlive = webProcess && !webProcess.killed && webProcess.exitCode === null;
    const argoAlive = botProcess && !botProcess.killed && botProcess.exitCode === null;
    log('WATCHDOG:HEARTBEAT', `Uptime: ${Math.floor(process.uptime())}s | Xray: ${xrayAlive ? 'RUNNING' : 'DEAD'} | Cloudflared: ${argoAlive ? 'RUNNING' : 'DEAD'}`);
    if (!xrayAlive) {
      log('WATCHDOG', 'Reviving dead Xray process...');
      startXray();
    }
    if (!argoAlive) {
      log('WATCHDOG', 'Reviving dead Cloudflared process...');
      startCloudflared();
    }
  }, 30000);
}

async function main() {
  try {
    startHttpServers();
    generateConfig();
    await downloadBinaries();
    startXray();
    startCloudflared();
    generateSubscription(ARGO_DOMAIN);
    startKeepAlive();
    startWatchdogLoop();
    log('READY', 'All background processes started with watchdog supervision.');
  } catch (err) {
    log('FATAL', `Startup failure: ${err.stack || err}`);
  }
}

main();
