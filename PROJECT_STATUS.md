# ⚡ FlashMesh: Project Status & Architecture Report

Welcome to the current architectural and implementation status overview of **FlashMesh**—the high-performance, next-generation unified file manager built for modern desktop and mobile platforms.

This report summarizes everything that has been implemented, how the components fit together, and the current state of the repository.

---

## 🏗️ Core Technology Stack

FlashMesh is built with a dual-layer architecture combining web-based frontend ergonomics with the speed and safety of system-level Rust code:

1.  **Frontend (React 19 + TypeScript + Vite):** A modern, high-fidelity responsive user interface featuring glassmorphic components, fluid animation layers (via Framer Motion), and customizable themes (including a custom **Elevanix** theme).
2.  **Backend (Tauri v2 + Rust):** High-performance Rust engine wrapping OS APIs, performing heavy file transfers, managing state registries, and serving background workers.
3.  **Cross-Platform Targets:** Single shared codebase buildable for:
    *   **Desktop:** Windows (`.msi`, `.exe`), macOS (`.dmg`, `.app`), and Linux (`.deb`, `.rpm`, `AppImage`).
    *   **Mobile:** Android (`.apk`, `.aab`) and iOS (`.ipa`).

---

## 🌟 Key Modules & Implemented Features

### 1. Asynchronous File Operations (`operations.rs`)
*   **The Problem Fixed:** Heavily blocking synchronous operations previously froze the Tauri main thread (causing the UI to lock up).
*   **Current State:** Fully refactored to use Rust's asynchronous runtime.
*   **How it Works:** 
    *   Tauri commands `copy_items` and `move_items` are defined as `async fn` and instantly return `Ok(())` acknowledgment back to React.
    *   Inside Rust, `tauri::async_runtime::spawn` triggers a background thread pool to carry out recursive file copies/moves.
    *   Rust streams real-time `ProgressEvent` payloads (`file-operation-progress` events) reporting the current percentage, file names, and throughput back to the UI.
    *   Support for **Instant Cancellation** (`cancel_operation` and `CANCELLED_OPERATIONS` thread-safe hashset) allows users to cancel in-progress operations gracefully.
    *   Automatic fallback to copy-and-delete when executing moves across different physical disks/filesystems.

### 2. Collaborative Data Pools — The "Outpost Model" (`pool.rs`)
*   **Overview:** FlashMesh enables collaborative shared storage pools on top of regular cloud storage without relying on centralized database servers.
*   **How it Works:**
    *   **Hub Folder:** The pool creator hosts a Google Drive folder acting as the central mesh hub.
    *   **Inbox Proposals:** Members post small, encrypted JSON proposal files (`prop_UUID.oro`) describing actions they wish to take (e.g. uploading a file chunk, creating a directory, deleting files, or joining the pool).
    *   **Processing Inbox:** The hub owner polls and merges inbox proposals sequentially inside Rust, writing updates to the master `pool_manifest.oro` manifest state, and clearing processed proposals.
    *   **Tauri Bindings:** Implemented commands like `list_pools`, `create_pool`, `process_pool_inbox`, and registry management (`pools.json` locally stored under `~/.flashmesh`).
    *   **Invite System:** Fully encoded base64-based invite links (`flashmesh://join-pool/<base64_payload>`) to easily onboard new members.

### 3. Merkle Search Trees (MST) & Delta Synchronization (`mst.ts`)
*   **Overview:** To synchronize pool folders with minimal API overhead, FlashMesh utilizes a deterministic Merkle Search Tree.
*   **Key Design:**
    *   Nodes are ordered by SHA-256 hashes of file keys.
    *   Clients compute their tree's root hash. If two clients have different root hashes, they run a quick delta traversal, comparing only the paths where hashes diverge, thus avoiding downloading the entire directory structure.
    *   An index manager `MSTIndexManager` caches records for instant search filtering and folder-based views.

### 4. RFC 8252-Compliant Local OAuth Redirect Server (`oauth.rs`)
*   **Overview:** Since Google deprecated Out-Of-Band (OOB) authentication redirects (where users had to manually copy/paste an auth code), FlashMesh implements modern loopback redirection.
*   **How it Works:**
    *   Tauri spins up a temporary `TcpListener` on a random free port on local loopback `127.0.0.1`.
    *   The app opens the provider sign-in page (Google Drive/Dropbox) in the system browser, setting the redirect URL to the temporary local server.
    *   Upon successful sign-in, the callback redirects back to the local port.
    *   The loopback server serves a clean, glassmorphic capture HTML landing page, extracts the token/code parameter, triggers the Tauri event `flashmesh:oauth-token`, and immediately terminates.

### 5. UI Layout, Theme, & Mobile Adaptations (`App.tsx`, `App.css`)
*   **Radial Context Menu (Omnitrix):** Custom context menus positioned dynamically on right-click. Mathematically computes cursor angles ($\theta = \operatorname{atan2}(dy, dx)$) to highlight menu options and supports Arrow Keys for rapid navigation.
*   **Android/iOS Integration:**
    *   Permission bootstrap checks and triggers Android storage access requests.
    *   Wires physical back-button events (`system-back`) from Android's system interface to trigger React's folder traversal back-stack.
    *   Disables hover-to-open logic on touch displays for a native feel.
*   **Customization:** Full support for standard Light, Dark, and the premium glassmorphic *Elevanix* visual theme.

### 6. Production Security & Hardening
*   **Rust Release Optimization:** Symbols are stripped and optimized (`opt-level = 3`) to yield small, fast machine code binaries.
*   **Frontend Obfuscation:** Vite config embeds `rollup-plugin-javascript-obfuscator` applying control flow flattening and string array encoding to prevent static analysis on web resources inside the built package.

---

## 📂 File Map & Code Directory Structure

Below is an overview of where key assets are located:

```
FlashMesh/
├── src-tauri/                 # Tauri Backend (Rust)
│   ├── Cargo.toml             # Rust package & build configurations
│   └── src/
│       ├── lib.rs             # Tauri app builder and registered command handlers
│       ├── main.rs            # Entry point for Tauri binary
│       └── commands/          # Rust command implementations
│           ├── operations.rs  # Asynchronous file operations (copy, move, delete, cancel)
│           ├── fs.rs          # Directory listings, metadata, and trash handling
│           ├── pool.rs        # Decentralized Data Pool proposal processor
│           ├── oauth.rs       # Temporary TCP server for browser auth redirection
│           ├── drives.rs      # System drive-detection utilities
│           ├── platform.rs    # Platform capabilities and Android permission checks
│           └── terminal.rs    # Host terminal integration helper
│
├── src/                       # Frontend (React 19 + TypeScript)
│   ├── main.tsx               # React entry point
│   ├── App.tsx                # AppShell routing, mobile event handlers, and dialogs
│   ├── App.css                # Design system styling, glassmorphism tokens, and layout
│   ├── api/
│   │   └── tauri.ts           # Type-safe wrappers invoking Tauri rust commands
│   ├── components/            # Reusable UI component modules
│   │   ├── Sidebar/           # Navigation panel
│   │   ├── Toolbar/           # Toolbar, breadcrumbs, search toggle, and Mobile Nav
│   │   ├── FilePane/          # Grid view of directories and items
│   │   ├── PreviewPanel/      # Floating inspector for images, code files, and PDFs
│   │   ├── DataPool/          # Outpost collaboration dashboard
│   │   └── ContextMenu/       # Radial/Omnitrix gesture-based context menu
│   ├── store/
│   │   └── AppContext.tsx     # Global React State Manager (history, clipboard, active view)
│   └── mesh/
│       └── mst.ts             # Merkle Search Tree delta-sync engine
│
└── package.json               # NPM scripts and project dependencies
```

---

## 🛠️ How to Build and Run locally

### 1. Dev Servers
*   **Desktop Dev Mode:** Runs Vite alongside the Tauri development window:
    ```bash
    pnpm desktop:dev
    ```
*   **Android Dev Mode:** Requires standard Android Studio SDK setup:
    ```bash
    pnpm android:dev
    ```

### 2. Building Production Packages
*   **Desktop Binary:** Builds the native installer for your current OS:
    ```bash
    pnpm desktop:build
    ```
*   **Android APK/AAB:**
    ```bash
    pnpm android:build
    ```
