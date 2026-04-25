# FlashMesh Platform Builds

FlashMesh is a Tauri v2 app with one shared React UI and Rust filesystem backend.

## Local Files

Desktop targets browse normal mounted filesystems:

- Linux: `/`, `/home`, `/media`, `/mnt`, removable drives, trash where supported by the desktop environment.
- Windows: drive-letter paths like `C:\Users\...` and UNC paths like `\\server\share`.
- macOS: normal user folders and mounted volumes.

Mobile targets browse app-owned local storage by default. Android and iOS do not allow arbitrary whole-device filesystem access the way desktop operating systems do; broader file access must go through system pickers/document providers in a later UI pass.

## Android Setup On Linux

This repo expects local toolchains in:

- JDK: `~/.local/share/flashmesh-toolchains/jdk-17`
- Android SDK: `~/Android/Sdk`

Load the environment:

```bash
source scripts/flashmesh-android-env.sh
```

Install Rust Android targets:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Initialize and build:

```bash
pnpm android:init
pnpm android:build
```

For a connected device:

```bash
pnpm android:dev
```

## iOS Setup

iOS builds require macOS with full Xcode installed. On the Mac:

```bash
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
brew install cocoapods
pnpm ios:init
pnpm ios:build
```

## Desktop Builds

Build on each target operating system for the native installer formats:

```bash
pnpm desktop:build
```

Aliases are provided for clarity:

```bash
pnpm linux:build
pnpm windows:build
pnpm macos:build
```

Windows and macOS signing/notarization are separate release steps and require their native platform credentials/toolchains.
