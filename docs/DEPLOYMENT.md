# OpenBBS 部署指南

本文档面向生产环境部署，涵盖安装、更新、反向代理、HTTPS、备份恢复、Docker、Windows 注意事项与常见问题。

- 项目地址：<https://github.com/yaoyue996/OpenBBS>
- 运行要求：Node.js **≥ 22.13**（推荐 Node.js 24 LTS），无需编译原生模块。
- 数据目录：默认 `data/`，包含 SQLite 数据库、日志、PID 文件和初始管理员凭据。

---

## 1. 一键安装

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/yaoyue996/OpenBBS/main/scripts/install.sh | bash
```

默认安装到 `~/openbbs`。常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENBBS_DIR` | `~/openbbs` | 安装目录 |
| `OPENBBS_PORT` | `3000` | HTTP 端口 |
| `OPENBBS_SITE_URL` | `http://localhost:3000` | 对外访问地址 |
| `OPENBBS_BRANCH` | `main` | 下载分支 |
| `OPENBBS_NODE_VERSION` | `24.22.3` | 需要下载 Node.js 时使用的版本 |
| `OPENBBS_ADMIN_USERNAME` | `admin` | 初始管理员用户名 |
| `OPENBBS_ADMIN_EMAIL` | `admin@example.com` | 初始管理员邮箱 |

示例：

```bash
OPENBBS_DIR=/opt/openbbs \
OPENBBS_PORT=8080 \
OPENBBS_SITE_URL=https://bbs.example.com \
bash <(curl -fsSL https://raw.githubusercontent.com/yaoyue996/OpenBBS/main/scripts/install.sh)
```

> 通过管道执行时，环境变量需要写在接收管道的一端，例如
> `curl -fsSL ... | OPENBBS_PORT=8080 bash`。上面的 `bash <(curl ...)` 形式也可以，
> 环境变量会同时作用于 `curl` 与 `bash`，不影响结果。

安装脚本会：

1. 从 GitHub 下载源码到安装目录；
2. 检测系统 Node.js，低于 22.13 时下载官方 Node.js 到 `.runtime/`（无需 root / sudo）；
3. 生成 `.env`（若不存在）；
4. 执行 `npm install --omit=dev`；
5. 初始化数据库并创建管理员；
6. 后台启动服务并写入 `data/openbbs.pid`。

### Windows

在 PowerShell 中运行：

```powershell
irm https://raw.githubusercontent.com/yaoyue996/OpenBBS/main/scripts/install.ps1 | iex
```

默认安装到 `%USERPROFILE%\OpenBBS`。可先设置环境变量再执行：

```powershell
$env:OPENBBS_DIR = 'D:\OpenBBS'
$env:OPENBBS_PORT = '8080'
$env:OPENBBS_SITE_URL = 'https://bbs.example.com'
irm https://raw.githubusercontent.com/yaoyue996/OpenBBS/main/scripts/install.ps1 | iex
```

安装完成后初始管理员密码保存在：

```text
<安装目录>\data\initial-admin.txt
```

登录后请立即在「个人设置」中修改密码，修改成功后该文件会自动删除。

### Docker

```bash
git clone https://github.com/yaoyue996/OpenBBS.git
cd OpenBBS
docker compose up -d --build
```

首次启动查看管理员密码：

```bash
docker compose logs openbbs
# 或
docker compose exec openbbs cat /app/data/initial-admin.txt
```

数据保存在 Docker 命名卷 `openbbs-data` 中，容器重建不会丢失数据。

---

## 2. 手动安装

适合开发或自定义部署。

```bash
git clone https://github.com/yaoyue996/OpenBBS.git
cd OpenBBS
cp .env.example .env
npm install
npm run init
npm start
```

开发模式（修改后端文件自动重启）：

```bash
npm run dev
```

> `npm run dev` 使用 `node --watch`，仅监听后端文件；前端 CSS / JS 为原生资源，修改后刷新浏览器即可（生产环境静态资源带版本号，可能需要重启或改版本号）。

---

## 3. 配置说明

配置文件为项目根目录 `.env`，修改后需重启服务。环境变量优先级高于 `.env`，便于 Docker / systemd / 容器平台注入。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址。仅本机反代时可设为 `127.0.0.1` |
| `PORT` | `3000` | 服务端口 |
| `SITE_URL` | `http://localhost:3000` | 对外地址，必须与浏览器访问的协议、域名、端口一致 |
| `DATABASE_PATH` | `data/openbbs.db` | SQLite 文件路径；相对路径基于项目根目录 |
| `TRUST_PROXY` | `0` | 反向代理后设为 `1`（或代理层数 / IP 段） |
| `COOKIE_SECURE` | `auto` | `auto` 按请求协议自动加 Secure；`always` 强制；`never` 关闭 |
| `NODE_ENV` | `production` | 生产环境请保持 `production` |
| `ADMIN_USERNAME` | `admin` | 仅首次创建管理员时使用 |
| `ADMIN_PASSWORD` | 空 | 仅首次创建管理员时使用；留空自动生成 |
| `ADMIN_EMAIL` | `admin@example.com` | 仅首次创建管理员时使用 |
| `SITE_NAME` | `OpenBBS` | 初始站点名称 |
| `SITE_DESCRIPTION` | `一个属于你的开源社区` | 初始站点描述 |

关于 `SITE_URL`：

- 用于 Origin 校验、RSS / Sitemap 链接、邮件和页面中的绝对地址。
- 使用 HTTPS 时必须写成 `https://your-domain.com`。
- 不要以 `/` 结尾（程序会自动去掉末尾斜杠）。
- 如果通过非标准端口访问，需要带上端口，例如 `https://bbs.example.com:8443`。

关于 `TRUST_PROXY`：

- 直接暴露到公网：`TRUST_PROXY=0`。
- Nginx / Caddy / Traefik 单层反代：`TRUST_PROXY=1`。
- Cloudflare + Nginx 两层：`TRUST_PROXY=2`。
- 也可以设置为 `loopback` 或具体网段，具体参考 Express `trust proxy` 文档。

关于 `COOKIE_SECURE`：

- 全站 HTTPS：建议 `always`。
- 同时支持 HTTP 与 HTTPS：保持 `auto`。
- 仅本地 HTTP 调试：`never`（生产环境不要使用）。

站点名称、描述、公告、注册开关、分页大小、发帖冷却等可在后台「站点设置」修改，数据库中的值优先于环境变量。

---

## 4. 服务管理

### Linux / macOS

```bash
bash scripts/service.sh start
bash scripts/service.sh stop
bash scripts/service.sh restart
bash scripts/service.sh status
bash scripts/service.sh logs
```

- PID 文件：`data/openbbs.pid`
- 标准输出：`data/openbbs.log`
- 错误输出：`data/openbbs.err.log`

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 start
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 stop
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 restart
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 status
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 logs
```

日志文件位于 `data\openbbs.log` 与 `data\openbbs.err.log`。

#### 开机自启（Windows，可选）

`service.ps1` 只负责当前会话的进程管理，不会注册系统服务。若需要开机自启，可使用「任务计划程序」：

1. 打开任务计划程序 → 创建任务；
2. 触发器选择「登录时」或「启动时」；
3. 操作选择「启动程序」：
   - 程序：`powershell.exe`
   - 参数：`-NoProfile -ExecutionPolicy Bypass -File "D:\OpenBBS\scripts\service.ps1" start`
   - 起始于：`D:\OpenBBS`
4. 勾选「不管用户是否登录都要运行」（如需后台运行）并配置相应权限。

长期生产部署更推荐使用 WSL2 + Linux 部署，或 Windows Server 上使用 NSSM 将 `node server.js` 注册为服务。

### systemd（Linux 生产推荐）

创建 `/etc/systemd/system/openbbs.service`：

```ini
[Unit]
Description=OpenBBS forum
After=network.target

[Service]
Type=simple
User=openbbs
Group=openbbs
WorkingDirectory=/opt/openbbs
Environment=NODE_ENV=production
EnvironmentFile=-/opt/openbbs/.env
ExecStart=/opt/openbbs/.runtime/node/bin/node /opt/openbbs/server.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65535

# 安全加固（按需调整）
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/openbbs/data

[Install]
WantedBy=multi-user.target
```

如果使用系统 Node.js，将 `ExecStart` 改为 `/usr/bin/node /opt/openbbs/server.js`。

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openbbs
sudo systemctl status openbbs
sudo journalctl -u openbbs -f
```

> 使用 systemd 时不要再用 `service.sh` 启动，避免两个进程争用数据库和端口。

---

## 5. 反向代理与 HTTPS

生产环境强烈建议使用 Nginx 或 Caddy 终止 TLS，并只让 OpenBBS 监听本机或内网。

同时修改 `.env`：

```dotenv
HOST=127.0.0.1
PORT=3000
SITE_URL=https://bbs.example.com
TRUST_PROXY=1
COOKIE_SECURE=always
NODE_ENV=production
```

### Nginx

```nginx
server {
    listen 80;
    server_name bbs.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bbs.example.com;

    ssl_certificate     /etc/letsencrypt/live/bbs.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bbs.example.com/privkey.pem;

    client_max_body_size 4m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_read_timeout 60s;
    }

    location /healthz {
        proxy_pass http://127.0.0.1:3000/healthz;
        access_log off;
    }
}
```

申请证书（Certbot）：

```bash
sudo certbot --nginx -d bbs.example.com
```

### Caddy

Caddy 会自动申请和续期 HTTPS 证书：

```caddyfile
bbs.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
    }
}
```

### Cloudflare

- SSL/TLS 模式使用 **Full (strict)**，不要使用 Flexible。
- `.env` 中设置 `TRUST_PROXY=2`（Cloudflare + 本机 Nginx）或按实际链路调整。
- `SITE_URL` 使用 `https://` 域名。
- 若开启 Under Attack 等代理功能，注意登录 / 注册速率限制按真实 IP 统计，必须正确配置 `TRUST_PROXY`。

### 健康检查

```bash
curl -fsS http://127.0.0.1:3000/healthz
```

返回：

```json
{"status":"ok","version":"1.0.0","uptime":123,"time":"2026-01-01T00:00:00.000Z"}
```

数据库不可用时返回 HTTP 503。

---

## 6. 更新

### Linux / macOS

```bash
bash scripts/update.sh
```

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\update.ps1
```

更新流程：

1. 停止服务；
2. 使用 SQLite checkpoint 后备份 `data/openbbs.db` 为 `data/backup-YYYYMMDD-HHMMSS.db`；
3. 下载最新源码；
4. 覆盖程序文件，**保留** `.env`、`data/`、`.runtime/`、`node_modules/`；
5. `npm install --omit=dev`；
6. `npm run init` 执行数据库迁移；
7. 重新启动服务。

可在更新前手动指定分支：

```bash
OPENBBS_BRANCH=main bash scripts/update.sh
```

> 跨大版本更新前，请额外复制整个 `data/` 目录。更新脚本只自动备份主数据库文件，不备份已上传的附件等自定义数据（当前版本没有附件功能）。

如果更新后启动失败：

```bash
bash scripts/service.sh logs
```

或查看 `data/openbbs.err.log`，常见原因是 Node.js 版本过低、端口被占用、`.env` 配置错误或依赖下载失败。

---

## 7. 备份与恢复

### 通过后台下载备份

管理员登录后访问：

```text
/admin/backup
```

服务会执行 `wal_checkpoint` 后下载当前数据库的副本。建议定期备份。

### 命令行备份（推荐）

先停止服务，确保数据一致：

```bash
bash scripts/service.sh stop
cp data/openbbs.db "data/backup-$(date +%Y%m%d-%H%M%S).db"
bash scripts/service.sh start
```

如果数据库较大或不想停机，可以使用 SQLite 在线备份：

```bash
sqlite3 data/openbbs.db ".backup 'data/backup-$(date +%Y%m%d-%H%M%S).db'"
```

> 不要只复制正在写入的 `openbbs.db` 而忽略 `-wal` / `-shm` 文件，否则可能丢失最近的数据或备份不一致。

### 恢复

```bash
bash scripts/service.sh stop
cp data/backup-20260101-120000.db data/openbbs.db
rm -f data/openbbs.db-wal data/openbbs.db-shm
bash scripts/service.sh start
```

恢复后建议执行一次迁移检查：

```bash
npm run init
```

### 备份清单

| 路径 | 内容 | 是否必须 |
| --- | --- | --- |
| `data/openbbs.db` | 全部论坛数据 | 是 |
| `.env` | 站点配置 | 建议 |
| `public/` 自定义修改 | 自定义 logo / 样式 | 视情况 |
| `views/` 自定义修改 | 模板改动 | 视情况 |

---

## 8. Docker 部署

### 使用 Compose（推荐）

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f openbbs
```

自定义端口与站点地址，可在项目根目录创建 `.env`（Compose 会自动读取）：

```dotenv
OPENBBS_PORT=8080
SITE_URL=https://bbs.example.com
TRUST_PROXY=1
COOKIE_SECURE=always
SITE_NAME=我的论坛
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
```

也可以直接设置初始管理员密码（仅首次启动有效）：

```dotenv
ADMIN_PASSWORD=ChangeMe123!
```

> 注意：Compose 的 `.env` 与 OpenBBS 的 `.env` 同名但用途不同。容器内不会加载宿主机的 `.env`，变量通过 `environment` 注入；不要把数据库路径改成宿主机路径。

### 数据卷

```yaml
volumes:
  - openbbs-data:/app/data
```

备份：

```bash
docker compose exec openbbs sh -c "cp /app/data/openbbs.db /app/data/backup.db"
docker compose cp openbbs:/app/data/backup.db ./openbbs-backup.db
```

或使用临时容器：

```bash
docker run --rm -v openbbs-data:/data -v "$PWD":/backup alpine \
  cp /data/openbbs.db /backup/openbbs-backup.db
```

### 使用已有数据库

```bash
docker compose up -d
docker compose cp ./openbbs.db openbbs:/app/data/openbbs.db
docker compose restart openbbs
```

确保文件属主为容器内 `node` 用户（UID 1000）：

```bash
docker compose exec -u root openbbs chown node:node /app/data/openbbs.db
```

### 反向代理

将 Nginx / Caddy 指向宿主机映射端口即可，例如：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

并设置 `TRUST_PROXY=1`、`SITE_URL=https://...`、`COOKIE_SECURE=always`。

---

## 9. 常见问题

### 启动失败：`Cannot find module 'node:sqlite'`

Node.js 版本低于 22.13。请升级到 Node.js 22.13+（推荐 24 LTS），或重新运行安装脚本让程序下载本地运行时：

```bash
node -v
```

### 端口被占用

```bash
# Linux / macOS
lsof -i :3000
# 或
ss -ltnp | grep 3000

# Windows
netstat -ano | findstr :3000
```

修改 `.env` 中的 `PORT` 后重启服务。

### 登录后立即掉线 / Cookie 不生效

- 检查 `SITE_URL` 的协议、域名、端口是否与浏览器地址完全一致；
- 反向代理后没有设置 `TRUST_PROXY=1` 时，Secure Cookie 判断可能不正确；
- HTTPS 环境将 `COOKIE_SECURE` 设为 `always`；
- 检查浏览器是否禁用了 Cookie；
- 多实例部署不能共享同一个 SQLite 文件，请只运行一个实例。

### 提交表单提示「页面已过期或安全校验失败」

- 页面停留超过 CSRF Cookie 有效期（2 小时）后刷新页面重试；
- 反向代理改写了 Host 导致 Origin 校验失败，确认 `SITE_URL` 与代理的 `Host` 头正确；
- 不要同时打开多个不同域名的入口访问同一站点。

### 忘记管理员密码

在安装目录执行：

```bash
# 生成随机新密码
npm run reset-password -- admin

# 或指定新密码
npm run reset-password -- admin 'NewPassword123!'
```

Windows：

```powershell
npm.cmd run reset-password -- admin
```

该命令会使用 `.env` 中的数据库路径，并注销该用户的所有会话。执行前建议停止服务（SQLite 支持并发，但避免写入冲突更稳妥）。

### 注册关闭 / 开启

后台「站点设置」→「允许注册」。也可以通过数据库修改 `settings` 表中的 `registration_open`（`1` 开启，`0` 关闭）。

### 如何修改站点名称 / 公告

后台「站点设置」。修改后立即生效，无需重启。

### 日志在哪

- `data/openbbs.log`：标准输出
- `data/openbbs.err.log`：错误输出
- systemd：`journalctl -u openbbs -f`
- Docker：`docker compose logs -f openbbs`

### 如何清理旧备份

备份文件位于 `data/backup-*.db`，可安全删除旧文件。建议保留最近 7–30 天，并将重要备份复制到其他机器或对象存储。

### 升级 Node.js

- 一键安装：重新运行安装脚本会检测版本，但已有安装会被拒绝；请手动下载新版 Node.js 到 `.runtime/node`，或删除 `.runtime/node` 后重新运行安装程序（注意不要删除 `data/`）。
- 系统 Node.js：通过包管理器 / nvm 升级后重启服务。

### 能否多实例 / 负载均衡

当前版本使用 SQLite 与本地会话表，**只支持单实例**。如需水平扩展，需要迁移到 PostgreSQL / MySQL 并将会话存储改为共享存储，属于二次开发范畴。

---

## 10. 安全清单

- [ ] 使用 HTTPS，并设置 `COOKIE_SECURE=always`
- [ ] `SITE_URL` 使用正式域名
- [ ] 反向代理后正确设置 `TRUST_PROXY`
- [ ] 修改初始管理员密码，删除 `data/initial-admin.txt`
- [ ] 不要将 `.env`、`data/` 提交到 Git 或公开目录
- [ ] 定期备份数据库并验证可恢复
- [ ] 生产环境使用非 root 用户运行
- [ ] 限制 `data/` 目录权限（如 `chmod 700 data`，数据库文件 `600`）
- [ ] 关注 GitHub Releases / 安全公告，及时更新

---

## 11. 获取帮助

- 文档：<https://github.com/yaoyue996/OpenBBS#readme>
- 问题反馈：<https://github.com/yaoyue996/OpenBBS/issues>
- 安全漏洞：请阅读 [SECURITY.md](../SECURITY.md)，通过私密渠道报告。
