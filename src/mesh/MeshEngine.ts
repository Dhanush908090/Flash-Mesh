import { CloudAdapter, OroManifest, ChunkDef } from '../types/mesh';
import { deriveKeyHKDF, randBytes, aesGcmEncrypt, aesGcmDecrypt, aesCbcEncryptWithHmac, aesCbcDecryptWithHmac, ab2b64, b642ab, buf2hex, sha256 } from './crypto';

// Concurrency queue runner helper
async function runWithConcurrencyLimit<T>(
  concurrency: number,
  tasks: (() => Promise<T>)[]
): Promise<T[]> {
  const results: T[] = [];
  let nextTaskIndex = 0;
  
  const worker = async () => {
    while (nextTaskIndex < tasks.length) {
      const index = nextTaskIndex++;
      results[index] = await tasks[index]();
    }
  };
  
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    workers.push(worker());
  }
  
  await Promise.all(workers);
  return results;
}

function getEngineSettings() {
  try {
    const raw = localStorage.getItem('flashmesh.settings.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      const turbo = parsed.turboMode ?? true;
      return {
        turboMode: turbo,
        concurrencyLimit: parsed.concurrencyLimit ?? (turbo ? 16 : 1),
        chunkSizeRange: parsed.chunkSizeRange ?? '1-3mb',
        encryptionStrategy: parsed.encryptionStrategy ?? 'adaptive',
      };
    }
  } catch (e) {
    console.warn("Failed to read settings from localStorage", e);
  }
  return {
    turboMode: true,
    concurrencyLimit: 16,
    chunkSizeRange: '1-3mb',
    encryptionStrategy: 'adaptive'
  };
}

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
         const raw = await adapter.listFolder(path === 'root' || !path ? '' : path);
         for (const f of raw) {
            let name = f.name || f.metadata?.name || '';
            if (adapter.provider === 'dropbox' && !name) name = f.name;
            if (name.endsWith('.oro')) {
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
                     provider: adapter.provider,
                     manifestRef: f
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
   * Calculates weighting for cloud providers based on free storage space.
   */
  async getQuotaWeights(): Promise<{ provider: 'google' | 'dropbox'; weight: number }[]> {
    const activeAdapters = this.adapters.filter(a => a.isAuthenticated);
    if (activeAdapters.length === 0) return [];
    if (activeAdapters.length === 1) {
      return [{ provider: activeAdapters[0].provider, weight: 1.0 }];
    }

    try {
      const quotas = await Promise.all(
        activeAdapters.map(async (adapter) => {
          try {
            const q = await adapter.getQuota();
            if (q) {
              const free = Math.max(0, q.totalSpace - q.usedSpace);
              return { provider: adapter.provider, free };
            }
          } catch (e) {
            console.warn(`Failed to get quota for ${adapter.provider}`, e);
          }
          return { provider: adapter.provider, free: 0 };
        })
      );

      const totalFree = quotas.reduce((sum, item) => sum + item.free, 0);
      if (totalFree === 0) {
        return activeAdapters.map(a => ({ provider: a.provider, weight: 1 / activeAdapters.length }));
      }

      return quotas.map(q => ({
        provider: q.provider,
        weight: q.free / totalFree
      }));
    } catch {
      return activeAdapters.map(a => ({ provider: a.provider, weight: 1 / activeAdapters.length }));
    }
  }

  /**
   * Main function to take a standard File, chunk it, encrypt each chunk, 
   * scatter it across connected providers, and upload the master Manifest.
   */
  async uploadFile(file: File, sessionKeyMaterial: ArrayBuffer): Promise<OroManifest> {
    const activeAdapters = this.adapters.filter(a => a.isAuthenticated);
    if (activeAdapters.length === 0) {
      throw new Error("No Cloud Adapters are authenticated. Please sign in via Settings.");
    }

    const settings = getEngineSettings();
    const concurrency = settings.concurrencyLimit;

    // 1. Determine chunk sizing
    const chunkSizes: number[] = [];
    let bytesRemaining = file.size;
    while (bytesRemaining > 0) {
      let size = 2 * 1024 * 1024; // Default 2MB
      if (settings.chunkSizeRange === '1-3mb') {
        size = Math.floor((1 + Math.random() * 2) * 1024 * 1024); // Random 1-3MB
      }
      const actualSize = Math.min(bytesRemaining, size);
      chunkSizes.push(actualSize);
      bytesRemaining -= actualSize;
    }

    const numChunks = chunkSizes.length;
    const chunkDefs: ChunkDef[] = new Array(numChunks);
    
    // Cryptographically secure salt shared across the entire session to derive subkeys
    const kdfSalt = randBytes(16);
    const weights = await this.getQuotaWeights();

    const selectAdapter = (): CloudAdapter => {
      if (weights.length === 0) return activeAdapters[0];
      const r = Math.random();
      let cumulative = 0;
      for (const w of weights) {
        cumulative += w.weight;
        if (r <= cumulative) {
          const matched = activeAdapters.find(a => a.provider === w.provider);
          if (matched) return matched;
        }
      }
      return activeAdapters[0];
    };

    // Prepare upload tasks
    let chunkOffset = 0;
    const tasks = chunkSizes.map((chunkSize, i) => {
      const start = chunkOffset;
      chunkOffset += chunkSize;

      return async () => {
        const adapter = selectAdapter();
        const blobSegment = file.slice(start, start + chunkSize);
        const chunkData = await blobSegment.arrayBuffer();

        // 2. Encryption Strategy
        let shouldEncrypt = true;
        let method: 'AES-GCM' | 'AES-CBC-HMAC' | 'RAW' = 'AES-GCM';

        if (settings.encryptionStrategy === 'none') {
          shouldEncrypt = false;
          method = 'RAW';
        } else if (settings.encryptionStrategy === 'aes-gcm') {
          shouldEncrypt = true;
          method = 'AES-GCM';
        } else if (settings.encryptionStrategy === 'aes-cbc-hmac') {
          shouldEncrypt = true;
          method = 'AES-CBC-HMAC';
        } else {
          // Adaptive Strategy
          if (numChunks < 10 || i === 0) {
            shouldEncrypt = true;
          } else {
            shouldEncrypt = Math.random() > 0.25; // 75% encrypted
          }
          if (shouldEncrypt) {
            method = Math.random() > 0.5 ? 'AES-GCM' : 'AES-CBC-HMAC';
          } else {
            method = 'RAW';
          }
        }

        let encryptedData: ArrayBuffer;
        let ivB64: string | null = null;
        let hash16B64 = '';

        if (shouldEncrypt) {
          const hash = await sha256(chunkData);
          const first16 = new Uint8Array(hash).slice(0, 16);
          hash16B64 = ab2b64(first16);

          // Derive a 512-bit key to satisfy CBC+HMAC requirements if chosen
          const chunkKeyBytes = await deriveKeyHKDF(
            sessionKeyMaterial,
            first16,
            new TextEncoder().encode(`chunk${i}`),
            '',
            512
          ) as ArrayBuffer;

          if (method === 'AES-CBC-HMAC') {
            const iv = randBytes(16);
            ivB64 = ab2b64(iv);
            encryptedData = await aesCbcEncryptWithHmac(chunkKeyBytes, iv, chunkData);
          } else {
            const iv = randBytes(12);
            ivB64 = ab2b64(iv);
            encryptedData = await aesGcmEncrypt(chunkKeyBytes.slice(0, 32), iv, chunkData);
          }
        } else {
          encryptedData = chunkData;
        }

        // 3. Physical Storage Upload
        const physicalBlobName = `mesh_chunk_${buf2hex(await sha256(encryptedData))}.enc`;
        const physicalId = await adapter.uploadChunk(encryptedData, physicalBlobName);

        // 4. Encrypt Cloud Path/ID Reference in Manifest
        const refSalt = await sha256(new TextEncoder().encode(`ref${i}`));
        const rawRefKey = await deriveKeyHKDF(
          sessionKeyMaterial,
          refSalt,
          new TextEncoder().encode(`refinfo${i}`),
          '',
          256
        ) as ArrayBuffer;

        const ivRef = randBytes(12);
        const encryptedId = await aesGcmEncrypt(rawRefKey, ivRef, new TextEncoder().encode(physicalId));

        chunkDefs[i] = {
          chunkId: ab2b64(encryptedId),
          ivRef: ab2b64(ivRef),
          size: chunkSize,
          provider: adapter.provider,
          methodId: method,
          isRaw: !shouldEncrypt,
          iv: ivB64,
          hash16: hash16B64
        };
      };
    });

    // Run parallel uploads with concurrency limit
    await runWithConcurrencyLimit(concurrency, tasks);

    // 5. Construct Ouroboros Manifest
    const manifest: OroManifest = {
      version: 2,
      fileName: file.name,
      originalSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      chunks: chunkDefs,
      createdAt: new Date().toISOString(),
      sessionSeed: ab2b64(sessionKeyMaterial),
      kdfSalt: ab2b64(kdfSalt),
      contentFingerprint: Math.random().toString(36).substring(2, 8).toUpperCase()
    };

    // Upload manifest typically to the primary provider (index 0) or local disk
    const mainAdapter = activeAdapters[0];
    await mainAdapter.uploadManifest(JSON.stringify(manifest), `${file.name}.oro`);

    return manifest;
  }

  /**
   * Takes an OroManifest and streams the chunks down in parallel, 
   * decrypting them on the fly and assembling a final blob.
   */
  async downloadFile(manifest: OroManifest, sessionKeyMaterial: ArrayBuffer): Promise<Blob> {
    const activeAdapters = this.adapters.filter(a => a.isAuthenticated);
    if (activeAdapters.length === 0) {
      throw new Error("No Cloud Adapters are authenticated. Please sign in via Settings.");
    }

    const settings = getEngineSettings();
    const concurrency = settings.concurrencyLimit;

    const kdfSaltBytes = b642ab(manifest.kdfSalt || ab2b64(new Uint8Array(16)));
    const finalBuffers: ArrayBuffer[] = new Array(manifest.chunks.length);

    // Prepare download tasks
    const tasks = manifest.chunks.map((chunk, i) => {
      return async () => {
        const adapter = this.adapters.find(a => a.provider === chunk.provider);
        if (!adapter) throw new Error(`Missing adapter for provider: ${chunk.provider}`);

        // 1. Decrypt Cloud Path/ID Reference
        const refSalt = await sha256(new TextEncoder().encode(`ref${i}`));
        const rawRefKey = await deriveKeyHKDF(
          sessionKeyMaterial,
          refSalt,
          new TextEncoder().encode(`refinfo${i}`),
          '',
          256
        ) as ArrayBuffer;

        const ivRefBytes = b642ab(chunk.ivRef);
        const encryptedIdBytes = b642ab(chunk.chunkId);
        const decryptedIdBytes = await aesGcmDecrypt(rawRefKey, ivRefBytes, encryptedIdBytes);
        const physicalId = new TextDecoder().decode(decryptedIdBytes);

        // 2. Fetch Chunk Bytes
        const encryptedData = await adapter.downloadChunk(physicalId);

        // 3. Decrypt Chunk Content
        if (chunk.isRaw || chunk.methodId === 'RAW') {
          finalBuffers[i] = encryptedData;
        } else {
          const first16 = b642ab(chunk.hash16 || '');
          const ivBytes = b642ab(chunk.iv || '');

          const chunkKeyBytes = await deriveKeyHKDF(
            sessionKeyMaterial,
            first16,
            new TextEncoder().encode(`chunk${i}`),
            '',
            512
          ) as ArrayBuffer;

          let decryptedData: ArrayBuffer;
          if (chunk.methodId === 'AES-CBC-HMAC') {
            decryptedData = await aesCbcDecryptWithHmac(chunkKeyBytes, ivBytes, encryptedData);
          } else {
            decryptedData = await aesGcmDecrypt(chunkKeyBytes.slice(0, 32), ivBytes.slice(0, 12), encryptedData);
          }

          finalBuffers[i] = decryptedData;
        }
      };
    });

    // Run parallel downloads with concurrency limit
    await runWithConcurrencyLimit(concurrency, tasks);

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
