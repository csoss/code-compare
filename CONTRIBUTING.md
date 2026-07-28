# 贡献指南

感谢你愿意改进 Code Compare。

## 提交问题

提交问题前请先搜索是否已有相同报告。Bug 报告建议包含：

- 操作系统、CPU 架构、Node.js 版本和应用版本
- 可稳定复现问题的最短步骤
- 预期行为与实际行为
- 必要的截图或错误日志

请先移除日志和截图中的个人路径、源代码、密钥及其他敏感信息。安全漏洞不要
创建公开 Issue，请遵循[安全策略](SECURITY.md)。

## 本地开发

```bash
npm install
npm run dev
```

提交改动前请运行：

```bash
npm test
npm run typecheck
npm run build
```

## Pull Request

- 一个 Pull Request 聚焦一个问题，避免混入无关重构。
- 新增或修复核心比较逻辑时，请同步补充测试。
- 保持用户可见文案清晰、一致；当前界面主要使用简体中文。
- 说明改动动机、验证方式以及可能影响的 macOS/Windows 行为。
- 不要提交 `node_modules/`、`out/`、`release/`、IDE 配置或本机数据。

提交贡献即表示你有权提交相关内容，并同意按本项目的 MIT License 发布它们。
