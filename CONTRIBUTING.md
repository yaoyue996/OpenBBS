# 贡献指南

感谢你愿意为 OpenBBS 做出贡献！无论是报告问题、改进文档，还是提交代码，都非常欢迎。

## 行为准则

- 尊重他人，保持友善与耐心。
- 对事不对人，接受建设性的批评。
- 不发布歧视、骚扰、广告或违法内容。

## 报告问题

提交 Issue 前请先搜索现有 Issue，避免重复。

一个高质量的问题报告应包含：

- 操作系统与版本（Windows / Linux / macOS）
- Node.js 版本（`node -v`）
- OpenBBS 版本或提交哈希
- 复现步骤
- 期望行为与实际行为
- 相关日志（`data/openbbs.err.log`、浏览器控制台）
- 如涉及界面问题，附上截图

安全漏洞请不要公开提交 Issue，参阅 [SECURITY.md](SECURITY.md)。

## 开发环境

```bash
git clone https://github.com/yaoyue996/OpenBBS.git
cd OpenBBS
npm install
npm run init
npm run dev
```

- 需要 Node.js ≥ 22.13。
- 数据库默认位于 `data/openbbs.db`，已被 `.gitignore` 忽略。
- 初始管理员密码在首次 `npm run init` / `npm start` 后生成，保存于 `data/initial-admin.txt`。

## 代码结构

```text
server.js           启动入口
src/app.js          Express 应用与中间件装配
src/config.js       环境变量加载与配置
src/db.js           SQLite 连接、迁移、种子数据
src/middleware.js   会话、CSRF、CSP、限流、模板变量
src/routes/         路由（按领域拆分）
src/services.js     数据访问与业务辅助
views/              EJS 模板（partials 为公共片段）
public/             静态资源（原生 CSS / JS）
scripts/            安装、更新、服务管理与运维脚本
test/               自动化测试
```

## 编码规范

- 使用 CommonJS（`require` / `module.exports`），与服务端现有代码保持一致。
- 缩进 2 个空格，字符串使用单引号，语句结尾加分号。
- 路由中通过 `HTTPError` 抛出可预期的错误，由全局错误处理渲染。
- 数据库访问使用参数化查询（`?`），禁止拼接用户输入。
- 用户提交的 Markdown 必须经过 `renderMarkdown`（sanitize-html）输出。
- 所有写操作表单必须包含 `_csrf` 隐藏字段；前端 fetch 使用 `x-csrf-token`。
- 新增页面需提供 `page`、`pageTitle`、`metaDescription` 模板变量。
- 尽量保持无前端构建步骤，新增浏览器代码请使用兼容现代浏览器的原生 JavaScript。

## 测试

```bash
npm test
```

测试使用 Node.js 内置的 `node:test`，会创建临时数据库，不会影响本地 `data/`。

提交前请确保：

- [ ] `npm test` 全部通过
- [ ] 手动验证相关页面在桌面与移动尺寸下正常
- [ ] 没有提交 `.env`、数据库、日志或 `initial-admin.txt`
- [ ] 新增配置项已写入 `.env.example` 与 README / 部署文档

## 提交 Pull Request

1. Fork 仓库并从 `main` 创建分支，例如 `feat/topic-tags`。
2. 保持提交信息清晰，建议使用 `feat:`、`fix:`、`docs:`、`chore:` 前缀。
3. 在 PR 描述中说明动机、改动内容与测试方式。
4. 如涉及 UI，附上修改前后的截图。
5. 保持 PR 聚焦，避免混入无关格式化或重构。

维护者可能会请求修改。合并后你的贡献将遵循项目的 MIT 许可证。

## 许可证

通过提交 Pull Request，你同意你的贡献以 MIT 许可证发布。
