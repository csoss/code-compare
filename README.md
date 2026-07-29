# Code Compare

[English](README.md) | [简体中文](README.zh-CN.md)

A fast, private, and offline desktop app for comparing folders and text files on
macOS and Windows. Your files are processed locally and are never uploaded to a
remote service.

> Code Compare is at an early stage. Feedback, bug reports, and contributions
> are welcome.

## Download

Download the latest installer for macOS or Windows from
[GitHub Releases](https://github.com/csoss/code-compare/releases/latest).

## Features

- Recursively scan and compare two folders
- Browse identical, modified, left-only, and right-only files in a directory tree
- Search paths and filter files by comparison status
- Exclude files with names, paths, or glob patterns
- Compare any two text files or paste two text snippets directly
- Navigate changes with synchronized scrolling, inline diffs, and syntax highlighting
- Calculate added and removed lines in the background
- Detect binary files and protect against excessive work on large files
- Cache file signatures and line statistics to speed up repeated comparisons
- Save recently used folders locally for quick access

## Tech Stack

- Electron
- React and TypeScript
- Monaco Editor
- electron-vite

## Getting Started

### Requirements

- Node.js 22.12 or later
- npm 10 or a compatible version

### Install and Run

```bash
npm install
npm run dev
```

### Verify

```bash
npm test
npm run typecheck
npm run build
```

## Packaging

Run the appropriate command on the target operating system:

```bash
# macOS
npm run package:mac

# Windows
npm run package:win
```

Artifacts are written to `release/`. Publicly distributed builds should be
signed with an Apple Developer ID or a Windows code-signing certificate to
avoid unknown-developer warnings.

## Privacy and Security

Code Compare has no telemetry, account system, or cloud API. The Electron
renderer uses context isolation and sandboxing with Node.js integration
disabled. Please report vulnerabilities privately according to the
[security policy](SECURITY.md).

## Contributing

Issues and pull requests are welcome. Please read the
[contributing guide](CONTRIBUTING.md) and
[code of conduct](CODE_OF_CONDUCT.md) before getting started.

## Support the Project

If Code Compare is useful to you, please consider giving the repository a
⭐ **Star**. It helps more people discover the project and motivates continued
development. Sharing the project and contributing code or documentation are
also greatly appreciated.

## License

Code Compare is available under the [MIT License](LICENSE).
