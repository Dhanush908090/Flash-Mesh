import { CloudAdapter } from '../../types/mesh';

export class GoogleAdapter implements CloudAdapter {
  provider: 'google' = 'google';
  private accessToken: string | null = null;
  private getClientId(): string {
    return localStorage.getItem('google_client_id') || '376295481193-2gr1nfv4ef1u7dpqv865idj9p6m7m5ot.apps.googleusercontent.com';
  }

  private getApiKey(): string {
    return localStorage.getItem('google_api_key') || 'AIzaSyBbBro9SszCodv6dP6ZXLARaIOwTdL1uOo';
  }

  constructor() {
    // Restore session token persisted by CloudAccountsTab
    const saved = localStorage.getItem('google_token');
    if (saved) this.accessToken = saved;
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  // Legacy popup authenticate (kept for reference, unused when SettingsPanel manages auth)
  async authenticate(): Promise<string | null> {
    return new Promise((resolve) => {
      const token = localStorage.getItem('google_token');
      if (token) {
        this.accessToken = token;
        resolve(token);
        return;
      }
      
      const clientId = this.getClientId();
      const redirectUri = window.location.origin;
      const scope = 'https://www.googleapis.com/auth/drive.file';
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}`;

      const popup = window.open(authUrl, 'Google Auth', 'width=500,height=600');
      
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
              localStorage.setItem('google_token', token);
              popup.close();
              clearInterval(pollTimer);
              resolve(token);
            }
          }
        } catch (e) {
          // Expected cross-origin error while user is on google.com
        }
      }, 500);
    });
  }

  async getQuota(): Promise<{ usedSpace: number; totalSpace: number } | null> {
    if (!this.accessToken) return null;
    const res = await fetch(`https://www.googleapis.com/drive/v3/about?fields=storageQuota&key=${this.getApiKey()}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      usedSpace: parseInt(data.storageQuota.usage || '0', 10),
      totalSpace: parseInt(data.storageQuota.limit || '15000000000', 10)
    };
  }

  async listFolder(path: string): Promise<any[]> {
    if (!this.accessToken) throw new Error("Google Adapter not authenticated");
    
    const query = encodeURIComponent(`trashed = false and '${path}' in parents`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,size,mimeType,modifiedTime)&key=${this.getApiKey()}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    
    if (!res.ok) throw new Error(`Google API Error: ${res.statusText}`);
    const data = await res.json();
    return data.files || [];
  }

  async uploadChunk(data: ArrayBuffer, fileName: string): Promise<string> {
    if (!this.accessToken) throw new Error("Google Adapter not authenticated");

    const metadata = {
      name: fileName,
      mimeType: 'application/octet-stream',
      // parents: ['flashmesh_chunk_folder_id'] (Omitted for prototype outline)
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([data], { type: 'application/octet-stream' }));

    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&key=${this.getApiKey()}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form
    });

    if (!res.ok) throw new Error(`Google Upload Error: ${res.statusText}`);
    const result = await res.json();
    return result.id;
  }

  async downloadChunk(fileId: string): Promise<ArrayBuffer> {
    if (!this.accessToken) throw new Error("Google Adapter not authenticated");
    
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${this.getApiKey()}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    
    if (!res.ok) throw new Error(`Google Download Error: ${res.statusText}`);
    return await res.arrayBuffer();
  }

  async deleteChunk(fileId: string): Promise<void> {
    if (!this.accessToken) throw new Error("Google Adapter not authenticated");
    
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?key=${this.getApiKey()}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
  }

  async uploadManifest(manifestStr: string, fileName: string): Promise<string> {
    const encoder = new TextEncoder();
    return this.uploadChunk(encoder.encode(manifestStr).buffer, fileName);
  }
}
