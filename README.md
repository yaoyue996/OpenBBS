# OpenBBS

[![CI](https://github.com/yaoyue996/OpenBBS/actions/workflows/ci.yml/badge.svg)](https://github.com/yaoyue996/OpenBBS/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.13-brightgreen.svg)](https://nodejs.org/)

OpenBBS 是一个现代、轻量、可自托管的开源论坛系统（BBS）。使用 Node.js + Express 服务端渲染，内置 SQLite 数据库，无需编译任何原生模块，一条命令即可完成部署。

- 项目主页：<https://github.com/yaoyue996/OpenBBS>
- 问题反馈：<https://github.com/yaoyue996/OpenBBS/issues>
- 部署文档：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## 特性

- **零原生依赖** — 使用 Node.js 内置的 `node:sqlite`，Windows / Linux / macOS 均可直接运行，无需 Python、C++ 编译环境。
- **一键部署** — 提供 Windows、Linux、macOS 安装脚本，以及 Docker / Docker Compose 支持。
- **服务端渲染** — 基于 EJS 的 SSR，首屏快、对搜索引擎友好，大部分功能在禁用 JavaScript 时仍可使用。
- **完整的论坛功能** — 分类、主题、回复、引用、编辑、删除、置顶、锁定、点赞、收藏、通知、搜索、RSS、站点地图。
- **Markdown 支持** — 实时预览、代码高亮样式、XSS 过滤、外链安全属性。
- **管理后台** — 分类管理、用户管理（禁言 / 角色）、内容管理、站点设置、数据库备份。
- **深浅色主题** — 跟随系统或手动切换，偏好保存在浏览器本地。
- **安全默认** — scrypt 密码哈希、服务端会话、CSRF 与 Origin 校验、CSP、速率限制、软删除。

## 界面

首页、主题页、后台等界面均为响应式设计，支持桌面与移动端。

## 一键部署

> 需要能访问 GitHub 与 npm registry。脚本会在系统 Node.js 低于 22.13 时自动下载本地 Node.js 运行时，无需管理员权限。

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/yaoyue996/OpenBBS/main/scripts/install.sh | bash
```

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/yaoyue996/OpenBBS/main/scripts/install.ps1 | iex
```

默认安装到用户目录：Linux / macOS 为 `~/openbbs`，Windows 为 `%USERPROFILE%\OpenBBS`。可通过环境变量 `OPENBBS_DIR`、`OPENBBS_PORT`、`OPENBBS_SITE_URL` 自定义。

### Docker

```bash
git clone https://github.com/yaoyue996/OpenBBS.git
cd OpenBBS
docker compose up -d --build
```

首次启动后查看初始管理员密码：

```bash
docker compose logs openbbs
# 或
docker compose exec openbbs cat /app/data/initial-admin.txt
```

### 手动启动（开发）

```bash
npm install
npm run init
npm start
```

打开 <http://localhost:3000>。首次运行会自动创建管理员账户，密码会打印到控制台并保存在 `data/initial-admin.txt`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm start` | 启动服务 |
| `npm run dev` | 开发模式（文件变更自动重启） |
| `npm run init` | 初始化 / 迁移数据库 |
| `npm run reset-password` | 重置指定用户的密码 |
| `npm test` | 运行测试 |

### 服务管理脚本

Linux / macOS：

```bash
bash scripts/service.sh start
bash scripts/service.sh stop
bash scripts/service.sh restart
bash scripts/service.sh status
bash scripts/service.sh logs
```

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 start
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 stop
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 restart
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 status
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 logs
```

### 更新

```bash
# Linux / macOS
bash scripts/update.sh
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\update.ps1
```

更新脚本会保留 `.env`、`data/`、`.runtime/` 与 `node_modules/`，并在更新前备份数据库。

## 配置

复制 `.env.example` 为 `.env` 后按需修改。所有配置也可以通过环境变量提供（Docker / systemd / 进程管理器会覆盖 `.env` 中的同名项）。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3000` | 监听端口 |
| `SITE_URL` | `http://localhost:3000` | 站点公开地址，用于 Origin 校验、RSS 与链接 |
| `DATABASE_PATH` | `data/openbbs.db` | SQLite 数据库路径 |
| `TRUST_PROXY` | `0` | 位于反向代理后时设为 `1` 或代理层数 |
| `COOKIE_SECURE` | `auto` | `auto` / `always` / `never`，HTTPS 环境建议 `always` |
| `NODE_ENV` | `production` | 运行环境 |
| `ADMIN_USERNAME` | `admin` | 首次运行创建的管理员用户名 |
| `ADMIN_PASSWORD` | 空 | 首次运行管理员密码；留空则自动生成 |
| `ADMIN_EMAIL` | `admin@example.com` | 首次运行管理员邮箱 |
| `SITE_NAME` | `OpenBBS` | 初始站点名称（也可在后台修改） |
| `SITE_DESCRIPTION` | `一个属于你的开源社区` | 初始站点描述 |

> 修改站点名称、描述、公告、注册开关、分页大小等请登录后台「站点设置」。数据库中的设置优先于初始环境变量。

## 生产部署

请参考 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，其中包含：

- 反向代理（Nginx / Caddy）与 HTTPS 配置
- systemd 服务示例
- Windows 计划任务 / 开机自启
- 备份与恢复
- Docker 部署与数据卷
- 常见问题排查

## 技术栈

- Node.js ≥ 22.13（推荐 24 LTS）
- Express 5
- EJS
- `node:sqlite`（内置 SQLite）
- markdown-it + sanitize-html
- 原生 CSS / JavaScript，无前端构建步骤

## 项目结构

```text
OpenBBS/
├── server.js              # 启动入口
├── src/
│   ├── app.js             # Express 应用
│   ├── config.js          # 环境变量与配置
│   ├── db.js              # 数据库连接、迁移与种子数据
│   ├── middleware.js      # 会话、CSRF、CSP、限流等
│   ├── routes/            # 路由
│   └── services.js        # 数据访问与业务逻辑
├── views/                 # EJS 模板
├── public/                # 静态资源（CSS / JS / 图标）
├── scripts/               # 安装、更新、服务管理脚本
├── docs/                  # 部署文档
├── data/                  # SQLite 数据库与运行时文件（不提交）
└── test/                  # 自动化测试
```

## 安全

- 密码使用 scrypt + 随机盐哈希，登录使用恒定时间比较。
- 会话令牌仅保存在服务端数据库，Cookie 为 HttpOnly + SameSite=Lax，HTTPS 下自动加 Secure。
- 所有写操作校验 CSRF Token 与 Origin / Sec-Fetch-Site。
- Markdown 渲染经过 sanitize-html 白名单过滤，禁用原始 HTML。
- 全站 CSP、X-Content-Type-Options、Referrer-Policy、Permissions-Policy 等安全响应头。
- 登录、注册、发帖、回复均有速率限制。
- 删除操作采用软删除，管理员可恢复内容。

发现安全问题请阅读 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中披露漏洞细节。

## 贡献

欢迎提交 Issue 与 Pull Request，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 yaoyue996
