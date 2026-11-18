# 安全政策

## 支持的版本

OpenBBS 目前处于 1.x 阶段，仅对最新发布版本提供安全修复。

| 版本 | 支持 |
| --- | --- |
| 1.x（最新） | ✅ |
| 更早版本 | ❌ |

## 报告漏洞

**请不要在公开 Issue、讨论区或 Pull Request 中披露安全漏洞。**

请通过以下方式私下联系维护者：

- 在 GitHub 上使用 [Security Advisories](https://github.com/yaoyue996/OpenBBS/security/advisories/new)（推荐）
- 或发送邮件至仓库所有者公开的邮箱（见 GitHub 个人主页）

报告中请尽量包含：

- 漏洞类型与影响范围
- 受影响的版本 / 提交
- 复现步骤或最小 PoC
- 可能的修复建议
- 是否已公开披露

我们会在收到报告后尽快确认，并在修复发布后致谢（如你愿意）。

## 安全设计

OpenBBS 在实现中采取以下措施：

- **密码**：scrypt（N=16384, r=8, p=1）+ 每用户随机盐，恒定时间比较。
- **会话**：随机 32 字节令牌，仅哈希后存入数据库；Cookie 为 `HttpOnly` + `SameSite=Lax`，HTTPS 下自动 `Secure`。
- **CSRF**：双提交 Cookie + 表单隐藏字段 / `x-csrf-token`，并校验 `Origin` 与 `Sec-Fetch-Site`。
- **XSS**：EJS 默认转义；Markdown 关闭原始 HTML，并经 sanitize-html 白名单过滤；CSP 限制脚本来源。
- **SQL 注入**：全部使用参数化查询。
- **点击劫持**：`X-Frame-Options: DENY` 与 CSP `frame-ancestors 'none'`。
- **速率限制**：登录、注册、发帖、回复按 IP / 用户限流。
- **权限**：基于角色的访问控制（admin / moderator / member），后台路由统一鉴权。
- **软删除**：内容删除标记而非物理删除，降低误操作风险。
- **上传**：当前版本不提供文件上传功能，减少攻击面。

## 部署建议

安全不仅取决于代码，也取决于部署方式：

- 使用 HTTPS，并设置 `COOKIE_SECURE=always`。
- 正确设置 `SITE_URL` 与 `TRUST_PROXY`。
- 使用非 root 用户运行，限制 `data/` 目录权限。
- 不要将 `.env`、数据库或日志暴露到 Web 根目录。
- 定期备份并关注更新。
- 若在反向代理 / CDN 后，确保真实 IP 传递正确，否则速率限制可能失效。

## 已知限制

- SQLite 单文件数据库，仅支持单实例部署。
- 未内置多因素认证（MFA）。
- 未内置邮件发送；注册不验证邮箱。
- 速率限制存储在进程内存中，重启后清零。

这些限制会在后续版本中评估改进。
