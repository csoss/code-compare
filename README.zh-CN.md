# Code Compare

[English](README.md) | [简体中文](README.zh-CN.md)

Code Compare 是一款快速、注重隐私且完全离线运行的文件夹与文本对比桌面工具，
支持 macOS 和 Windows。文件内容只在本机处理，不会上传到远程服务。

> 项目目前处于早期阶段。欢迎试用、报告问题和参与改进。

## 下载

请前往 [GitHub Releases](https://github.com/csoss/code-compare/releases/latest)
下载最新的 macOS 或 Windows 安装包。

## 功能

- 递归扫描并对比两个文件夹
- 以目录树展示相同、已修改、仅左侧和仅右侧文件
- 搜索路径，并按差异状态筛选
- 支持名称、路径和 Glob 排除规则
- 对比任意两个文本文件，或直接粘贴两段文本
- 支持双栏同步滚动、行内差异、语法高亮和差异导航
- 在后台统计新增和删除行数
- 识别二进制文件，并对大文件提供读取与计算保护
- 缓存文件签名和行数统计，加快重复对比
- 在本机保存最近使用的文件夹，方便快速重新选择

## 技术栈

- Electron
- React + TypeScript
- Monaco Editor
- electron-vite

## 快速开始

### 环境要求

- Node.js 22.12 或更高版本
- npm 10 或兼容版本

### 安装与运行

```bash
npm install
npm run dev
```

### 验证

```bash
npm test
npm run typecheck
npm run build
```

## 打包

在目标操作系统上执行对应命令：

```bash
# macOS
npm run package:mac

# Windows
npm run package:win
```

安装包会生成在 `release/`。面向最终用户分发时，应配置 Apple Developer ID
或 Windows 代码签名证书，避免系统显示未知开发者警告。

## 隐私与安全

Code Compare 不包含遥测、账号系统或云端接口。Electron 渲染进程启用了上下文
隔离和沙箱，并关闭了 Node.js 集成。安全问题请按照
[安全策略](SECURITY.md) 私下报告。

## 参与贡献

欢迎提交 Issue 和 Pull Request。开始开发前，请阅读
[贡献指南](CONTRIBUTING.md)和[社区行为准则](CODE_OF_CONDUCT.md)。

## 支持项目

如果 Code Compare 对你有帮助，欢迎为仓库点亮一个 ⭐ **Star**。你的支持可以
帮助更多人发现这个项目，也是持续维护和改进项目的重要动力。也欢迎分享项目，
或者通过代码和文档参与贡献。

## License

本项目采用 [MIT License](LICENSE)。
