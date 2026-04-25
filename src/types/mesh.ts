/**
 * FlashMesh: Mesh Engine Types
 */

export interface ChunkDef {
  chunkId: string;     // The blob's physical filename / id on the provider
  ivRef: string;       // Base64 encoded Initialization Vector for decryption
  size: number;        // Size in bytes
  provider: 'google' | 'dropbox';
}

export interface OroManifest {
  version: number;
  fileName: string;
  originalSize: number;
  mimeType: string;
  chunks: ChunkDef[];
  createdAt: string;
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
