import { CloudAdapter } from '../../types/mesh';

export class DropboxAdapter implements CloudAdapter {
  provider: 'dropbox' = 'dropbox';
  private accessToken: string | null = null;
  private clientId: string = 'YOUR_DROPBOX_CLIENT_ID';

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  async authenticate(): Promise<string | null> {
    return new Promise((resolve) => {
      const token = localStorage.getItem('dropbox_token');
      if (token) {
        this.accessToken = token;
        resolve(token);
        return;
      }
      
      this.clientId = 'cw5hv2tiupwm67c';
      const redirectUri = window.location.origin;
      const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token`;

      const popup = window.open(authUrl, 'Dropbox Auth', 'width=500,height=600');
      
      const pollTimer = setInterval(() => {
        try {
          if (!popup || popup.closed) {
            clearInterval(pollTimer);
            resolve(null);
            return;
          }
          if (popup.location.href.includes('access_token=')) {
            const hash = popup.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            const token = params.get('access_token');
            if (token) {
              this.accessToken = token;
              localStorage.setItem('dropbox_token', token);
              popup.close();
              clearInterval(pollTimer);
              resolve(token);
            }
          }
        } catch (e) {
          // Expected cross-origin error while user is on dropbox.com
        }
      }, 500);
    });
  }

  async getQuota(): Promise<{ usedSpace: number; totalSpace: number } | null> {
    if (!this.accessToken) return null;
    const res = await fetch('https://api.dropboxapi.com/2/users/get_space_usage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      usedSpace: data.used || 0,
      totalSpace: data.allocation?.allocated || 2000000000
    };
  }

  async listFolder(path: string): Promise<any[]> {
    if (!this.accessToken) throw new Error("Dropbox Adapter not authenticated");

    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        path: path === '/' ? '' : path,
        recursive: false,
        include_media_info: false
      })
    });

    if (!res.ok) throw new Error(`Dropbox API Error: ${res.statusText}`);
    const data = await res.json();
    return data.entries || [];
  }

  async uploadChunk(data: ArrayBuffer, fileName: string): Promise<string> {
    if (!this.accessToken) throw new Error("Dropbox Adapter not authenticated");

    // In Dropbox, we upload by path, not parent ID
    const targetPath = `/FlashMesh/Chunks/${fileName}`;

    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: targetPath,
          mode: 'add',
          autorename: true,
          mute: true,
          strict_conflict: false
        }),
        'Content-Type': 'application/octet-stream'
      },
      body: data
    });

    if (!res.ok) throw new Error(`Dropbox Upload Error: ${res.statusText}`);
    const result = await res.json();
    return result.id;
  }

  async downloadChunk(fileId: string): Promise<ArrayBuffer> {
    if (!this.accessToken) throw new Error("Dropbox Adapter not authenticated");

    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: fileId })
      }
    });

    if (!res.ok) throw new Error(`Dropbox Download Error: ${res.statusText}`);
    return await res.arrayBuffer();
  }

  async deleteChunk(fileId: string): Promise<void> {
    if (!this.accessToken) throw new Error("Dropbox Adapter not authenticated");

    await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: fileId })
    });
  }

  async uploadManifest(manifestStr: string, fileName: string): Promise<string> {
    const targetPath = `/FlashMesh/Manifests/${fileName}`;
    if (!this.accessToken) throw new Error("Dropbox Adapter not authenticated");

    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: targetPath, mode: 'overwrite' }),
        'Content-Type': 'application/octet-stream'
      },
      body: new TextEncoder().encode(manifestStr)
    });

    if (!res.ok) throw new Error(`Dropbox Manifest Error: ${res.statusText}`);
    const result = await res.json();
    return result.id;
  }
}
