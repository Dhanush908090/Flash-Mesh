/**
 * FlashMesh: Mesh Engine Types
 */

export interface ChunkDef {
  chunkId: string;     // The blob's physical filename / id on the provider (optionally encrypted)
  ivRef: string;       // Base64 encoded Initialization Vector for decrypting the chunkId or content
  size: number;        // Size in bytes
  provider: 'google' | 'dropbox';
  methodId?: 'AES-GCM' | 'AES-CBC-HMAC' | 'RAW';
  isRaw?: boolean;
  iv?: string | null;  // Initialization Vector for the chunk content itself
  hash16?: string;     // Base64 encoded first 16 bytes of chunk hash
}

export interface OroManifest {
  version: number;
  fileName: string;
  originalSize: number;
  mimeType: string;
  chunks: ChunkDef[];
  createdAt: string;
  sessionSeed?: string;       // Base64 encoded session key
  kdfSalt?: string;           // Base64 encoded KDF salt
  contentFingerprint?: string;// 6-char unique ref code for deduplication
}

export interface MeshTaskAction {
  id: string;
  type: 'upload' | 'download';
  name: string;
  totalSize: number;
  progress: number;    // 0 to 1
  status: 'pending' | 'running' | 'paused' | 'error' | 'completed';
}

export interface CloudAdapter {
  provider: 'google' | 'dropbox';
  isAuthenticated: boolean;
  authenticate(): Promise<string | null>;
  getQuota(): Promise<{ usedSpace: number; totalSpace: number } | null>;
  listFolder(path: string): Promise<any[]>;
  uploadChunk(data: ArrayBuffer, fileName: string): Promise<string>;
  downloadChunk(fileId: string): Promise<ArrayBuffer>;
  deleteChunk(fileId: string): Promise<void>;
  uploadManifest(manifestStr: string, fileName: string): Promise<string>;
}
