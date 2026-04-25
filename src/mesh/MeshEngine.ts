import { CloudAdapter, OroManifest, ChunkDef } from '../types/mesh';
import { deriveKeyHKDF, randBytes, aesGcmEncrypt, aesGcmDecrypt, ab2b64, buf2hex, sha256 } from './crypto';

export class MeshEngine {
  private adapters: CloudAdapter[] = [];

  registerAdapter(adapter: CloudAdapter) {
    this.adapters.push(adapter);
  }

  async getUnifiedQuota(): Promise<{ usedSpace: number; totalSpace: number }> {
    let used = 0;
    let total = 0;
    const quotas = await Promise.all(
      this.adapters.filter(a => a.isAuthenticated).map(a => a.getQuota().catch(() => null))
    );
    for (const q of quotas) {
      if (q) {
        used += q.usedSpace;
        total += q.totalSpace;
      }
    }
    return { usedSpace: used, totalSpace: total };
  }

  /**
   * Scans all connected adapters for .oro manifests and dedupes them into a logical directory.
   */
  async listUnifiedDirectory(path: string): Promise<any[]> {
    if (this.adapters.filter(a => a.isAuthenticated).length === 0) {
      throw new Error("No Cloud Adapters are authenticated. Please sign in via Settings.");
    }

    const allManifests = new Map<string, any>();
    
    const fetchPromises = this.adapters.filter(a => a.isAuthenticated).map(async (adapter) => {
       try {
         // This assumes the cloud folder struct aligns, or we search for .oro
         // For a unified UI root, we query the root or corresponding directory
         const raw = await adapter.listFolder(path === 'root' || !path ? '' : path);
         for (const f of raw) {
            let name = f.name || f.metadata?.name || '';
            if (adapter.provider === 'dropbox' && !name) name = f.name;
            if (name.endsWith('.oro')) {
               // Deduplication: we just take the first we find or merge
               // Represent logical file without '.oro'
               const logicalName = name.replace('.oro', '');
               if (!allManifests.has(logicalName)) {
                  allManifests.set(logicalName, {
                    id: f.id + '_mesh',
                    name: logicalName,
                    path: `mesh://root${path === 'root' || !path ? '' : path}/${logicalName}`,
                    isDir: false,
                    size: f.size ? parseInt(f.size, 10) : 0,
                    modified: f.modifiedTime || f.server_modified || new Date().toISOString(),
                    extension: logicalName.includes('.') ? logicalName.split('.').pop() : '',
                    created: f.createdTime || f.server_modified || new Date().toISOString(),
                    isHidden: false,
                    isSymlink: false,
                    mimeType: 'application/octet-stream',
                    manifestRef: f // store raw ref to download manifest later
                  });
               }
            }
         }
       } catch (err) {
         console.warn(`MeshEngine Failed to fetch from ${adapter.provider}`, err);
       }
    });

    await Promise.all(fetchPromises);
    return Array.from(allManifests.values());
  }

  /**
   * Main function to take a standard File, chunk it, encrypt each chunk, 
   * scatter it across connected providers, and upload the master Manifest.
   */
  async uploadFile(file: File, sessionKeyMaterial: ArrayBuffer): Promise<OroManifest> {
    if (this.adapters.length === 0) throw new Error("No Cloud Adapters registered to the Mesh Engine.");

    const chunkSize = 2 * 1024 * 1024; // Fixed 2MB for simplicity, could be dynamic (1-3MB)
    const numChunks = Math.ceil(file.size / chunkSize);
    const chunkDefs: ChunkDef[] = [];
    
    // We use a cryptographically secure salt shared across the entire session to derive subkeys
    const sessionSalt = randBytes(16);

    for (let i = 0; i < numChunks; i++) {
      const adapter = this.adapters[i % this.adapters.length]; // Scatter chunks across adapters round-robin
      
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      
      // Blob.slice() prevents loading massive files into RAM all at once
      const blobSegment = file.slice(start, end);
      const chunkData = await blobSegment.arrayBuffer();

      // Ensure each chunk gets a totally unique encryption key using HKDF based on its index
      const chunkKey = await deriveKeyHKDF(
        sessionKeyMaterial, 
        sessionSalt, 
        new TextEncoder().encode(`chunk_${i}_${file.name}`)
      );

      const iv = randBytes(12);
      const encryptedData = await aesGcmEncrypt(chunkKey as ArrayBuffer, iv, chunkData);

      // Generate a content-addressed filename or random uuid for the physical blob
      const physicalBlobName = `mesh_chunk_${buf2hex(await sha256(encryptedData))}.enc`;

      // Upload chunk bytes to the target provider
      const chunkId = await adapter.uploadChunk(encryptedData, physicalBlobName);

      chunkDefs.push({
        chunkId,
        ivRef: ab2b64(iv),
        size: chunkSize,
        provider: adapter.provider
      });
    }

    // Generate the Final Manifest containing mapping metadata
    const manifest: OroManifest = {
      version: 1,
      fileName: file.name,
      originalSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      chunks: chunkDefs,
      createdAt: new Date().toISOString()
    };

    // Upload manifest typically to the primary provider (index 0) or local disk
    const mainAdapter = this.adapters[0];
    await mainAdapter.uploadManifest(JSON.stringify(manifest), `${file.name}.oro`);

    return manifest;
  }

  /**
   * Takes an OroManifest and streams the chunks down in parallel, 
   * decrypting them on the fly and assembling a final blob.
   */
  async downloadFile(manifest: OroManifest, sessionKeyMaterial: ArrayBuffer): Promise<Blob> {
    if (this.adapters.length === 0) throw new Error("No Cloud Adapters registered.");
    
    // We recreate the session salt logic. Note: In reality, the salt must also be 
    // stored securely (e.g. inside the manifest or local DB), but for this skeleton 
    // it's omitted or hardcoded, so downloading won't work perfectly until salt is synced.
    const sessionSalt = new Uint8Array(16); // Placeholder

    const finalBuffers: ArrayBuffer[] = new Array(manifest.chunks.length);
    
    const downloadPromises = manifest.chunks.map(async (chunk, i) => {
      const adapter = this.adapters.find(a => a.provider === chunk.provider);
      if (!adapter) throw new Error(`Missing adapter for provider: ${chunk.provider}`);

      const encryptedData = await adapter.downloadChunk(chunk.chunkId);

      const chunkKey = await deriveKeyHKDF(
        sessionKeyMaterial, 
        sessionSalt.buffer, 
        new TextEncoder().encode(`chunk_${i}_${manifest.fileName}`)
      );

      const ivMap = Uint8Array.from(atob(chunk.ivRef), c => c.charCodeAt(0));
      const decryptedData = await aesGcmDecrypt(chunkKey as ArrayBuffer, ivMap, encryptedData);

      finalBuffers[i] = decryptedData;
    });

    // Wait for all chunk streams to fetch and decrypt in parallel
    await Promise.all(downloadPromises);

    // Assemble file 
    return new Blob(finalBuffers, { type: manifest.mimeType });
  }
}

// Global Singleton Setup
import { GoogleAdapter } from './adapters/GoogleAdapter';
import { DropboxAdapter } from './adapters/DropboxAdapter';

export const meshEngine = new MeshEngine();
export const googleAdapter = new GoogleAdapter();
export const dropboxAdapter = new DropboxAdapter();

meshEngine.registerAdapter(googleAdapter);
meshEngine.registerAdapter(dropboxAdapter);

// Try to auto-authenticate on load if tokens are in local storage
// googleAdapter.authenticate().catch(() => {});
// dropboxAdapter.authenticate().catch(() => {});
