# Developer Setup Guide — FlashMesh API Key Configuration

To make FlashMesh fully functional, you need to configure API credentials for both **Google Drive** and **Dropbox**. Follow these steps to obtain and apply your credentials:

---

## 1. Google Drive Integration

### A. Obtain API Credentials
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. In the sidebar, navigate to **APIs & Services** > **Library**.
4. Search for **Google Drive API** and click **Enable**.
5. Go to **APIs & Services** > **OAuth consent screen**:
   - Choose **External** user type.
   - Fill out the app name and developer contact email.
   - In the **Scopes** step, add the `https://www.googleapis.com/auth/drive.file` scope (allows access to files created or opened by the app).
   - Add your email under **Test users** (required while in testing/development mode).
6. Go to **APIs & Services** > **Credentials**:
   - Click **+ Create Credentials** > **OAuth client ID**.
   - Select **Web application** as the application type.
   - Add `http://localhost:5173` (or the specific port/domain of your Tauri app frontend) under **Authorized JavaScript origins**.
   - Add `http://localhost:5173` under **Authorized redirect URIs**.
7. Click **Create** and copy the generated **Client ID**.

### B. Configure Client ID in Code
Open `src/mesh/adapters/GoogleAdapter.ts` and set your client ID on line 6:
```typescript
private clientId: string = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
```

---

## 2. Dropbox Integration

### A. Obtain API Credentials
1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps).
2. Click **Create app**:
   - Choose **Scoped access** API.
   - Select **Full Dropbox** (or **App folder** depending on security preference).
   - Name your app (e.g. `FlashMesh-Dev`).
3. Under the **Settings** tab:
   - Copy the **App key** (Client ID).
   - In the **Redirect URIs** section, add `http://localhost:5173` (or your Tauri app URL) and click **Add**.
4. Under the **Permissions** tab, check the following scopes:
   - `files.metadata.write`
   - `files.metadata.read`
   - `files.metadata.content.write`
   - `files.metadata.content.read`
5. Click **Submit** at the bottom of the page to save permissions.

### B. Configure App Key in Code
Open `src/mesh/adapters/DropboxAdapter.ts` and set your App Key on line 6:
```typescript
private clientId: string = 'YOUR_DROPBOX_APP_KEY';
```

---

## 3. Launching & Logging In
Once the client IDs are set:
1. Run `cargo tauri dev` or `npm run dev`.
2. Open **Settings** (Gear icon at the bottom of the sidebar) in the application.
3. Click the **Cloud Accounts** tab.
4. Click **Sign In** for Google Drive and/or Dropbox.
5. Grant authorizations in the browser. 
6. Tokens will be securely saved in your browser's local storage (`google_token` and `dropbox_token`), and FlashMesh will now seamlessly partition, encrypt, and stream your files!
