# ⚡ FlashMesh
### The High-Performance, Unified File Manager for the Modern Age.

<p align="center">
  <img src="logo.png" alt="FlashMesh Logo" width="140" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux%20|%20Android%20|%20iOS-blue?style=for-the-badge&logo=tauri" alt="Platforms" />
  <img src="https://img.shields.io/badge/Status-Production%20Ready-success?style=for-the-badge" alt="Status" />
</p>

---

## 🌟 Overview

**FlashMesh** is a next-generation file manager designed to unify your digital life. Built on the powerhouse **Tauri v2** framework with a **Rust** engine and a **React 19** frontend, it delivers blistering speed and desktop-class features on every device you own.

Whether you're moving large ISO files on Windows, managing photos on Android, or accessing encrypted cloud clusters on macOS, FlashMesh provides a single, seamless, and premium interface.

---

## 📦 Download Latest Builds

We provide pre-built binaries for all major platforms. To get the latest version, visit our **[Releases](https://github.com/YOUR_USERNAME/FlashMesh/releases)** page.

### 💻 Desktop
*   **Windows:** `.msi` and `.exe` (WebView2)
*   **macOS:** `.dmg` and `.app` (Universal Apple Silicon & Intel)
*   **Linux:** `.deb`, `.rpm`, and `AppImage`

### 📱 Mobile
*   **Android:** `.apk` and `.aab` (Direct install or Play Store ready)
*   **iOS:** `.ipa` (Available via TestFlight or sideloading)

---

## ✨ Key Features

*   **🚀 Native Performance:** Rust backend ensures file operations (move, copy, delete) happen at hardware limits.
*   **🛡️ Encrypted Mesh:** Integrated client-side AES-GCM encryption for your cloud storage (Google Drive, Dropbox).
*   **🔄 Task Orchestration:** Smooth background task monitoring with real-time progress and instant cancellation.
*   **🎨 Premium UI:** A modern, glassmorphic design system with silky-smooth animations and dark mode support.
*   **🌐 Unified Pathing:** One consistent way to access local drives, network shares, and cloud buckets.

---

## 🛠️ Build it Yourself

If you'd like to build FlashMesh from source, follow these steps:

1.  **Clone & Install:**
    ```bash
    git clone https://github.com/YOUR_USERNAME/FlashMesh.git
    cd FlashMesh
    pnpm install
    ```

2.  **Run Development Suite:**
    - **Desktop:** `pnpm desktop:dev`
    - **Android:** `pnpm android:dev`
    - **iOS:** `pnpm ios:dev`

3.  **Generate Production Binaries:**
    ```bash
    pnpm desktop:build  # For your current OS
    pnpm android:build  # For Android
    ```

---

## 💡 Why FlashMesh?

Traditional file managers are either too simple (Mobile) or too cluttered (Desktop). FlashMesh bridges the gap, giving you **Desktop Power in your Pocket** and **Mobile Simplicity on your Desktop**.

**Elevanix — Engineering the Future of Storage.**

---
*Built with ❤️ using Tauri, Rust, and React.*
