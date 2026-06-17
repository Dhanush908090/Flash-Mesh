import { poolApi } from '../api/tauri';
import { ab2b64, b642ab, aesGcmEncrypt, aesGcmDecrypt, sha256 } from './crypto';
import { MerkleSearchTree, MSTIndexManager } from './mst';

export class DataPoolManager {
  public pools = new Map<string, any>();
  public activePoolId: string | null = null;
  public userFp: string | null = null;
  private _poolMSTs = new Map<string, MerkleSearchTree>();
  private _poolIndexes = new Map<string, MSTIndexManager>();

  constructor() {
    this.userFp = localStorage.getItem('user_fingerprint') || null;
  }

  _getToken() {
    return localStorage.getItem('google_token') || '';
  }

  async init() {
    if (!this.userFp) {
      this.userFp = await this.generateUserFingerprint();
    }
    await this.loadMyPools();
  }

  async generateUserFingerprint(email?: string): Promise<string> {
    if (!email) {
      let fp = localStorage.getItem('user_fingerprint');
      if (fp) return fp;
      const data = `${navigator.userAgent}${Date.now()}${crypto.randomUUID()}`;
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      fp = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 16);
      localStorage.setItem('user_fingerprint', fp);
      return fp;
    } else {
      const data = `fmesh_v7_${email.trim().toLowerCase()}`;
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 16);
    }
  }

  async setIdentity(email: string) {
    if (!email) return;
    const newFp = await this.generateUserFingerprint(email);
    if (this.userFp !== newFp) {
      this.userFp = newFp;
      localStorage.setItem('user_fingerprint', newFp);
    }
  }

  async loadMyPools() {
    try {
      const tauriPools = await poolApi.listPools();
      for (const tp of tauriPools) {
        const access = this._getPoolAccess(tp.id);
        if (access) {
          try {
            const manifest = await this._loadManifest(access.hubFolderId, access.masterKeyB64, access.manifestId);
            if (manifest) {
              this.pools.set(tp.id, manifest);
              this._rebuildPoolMST(manifest);
            }
          } catch (err) {
            console.warn(`Failed to load manifest for pool ${tp.id}:`, err);
            this.pools.set(tp.id, {
              id: tp.id,
              name: tp.name,
              ownerFp: tp.owner_fp,
              hubFolderId: tp.hub_folder_id,
              inboxFolderId: tp.inbox_folder_id,
              members: tp.members.map(m => ({
                fp: m.fingerprint,
                name: m.nickname,
                joinedAt: m.joined_at,
                quota: m.quota_bytes
              })),
              files: [],
              folders: [],
            });
          }
        } else {
          this.pools.set(tp.id, {
            id: tp.id,
            name: tp.name,
            ownerFp: tp.owner_fp,
            hubFolderId: tp.hub_folder_id,
            inboxFolderId: tp.inbox_folder_id,
            members: tp.members.map(m => ({
              fp: m.fingerprint,
              name: m.nickname,
              joinedAt: m.joined_at,
              quota: m.quota_bytes
            })),
            files: [],
            folders: [],
          });
        }
      }
    } catch (e) {
      console.error("Failed to load my pools:", e);
    }
  }

  async _loadManifest(hubFolderId: string, masterKeyB64: string, manifestId: string) {
    try {
      const bytes = await this._fetchFromDrive(manifestId);
      const combined = new Uint8Array(bytes);
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const rawKey = b642ab(masterKeyB64);
      const decryptedBytes = await aesGcmDecrypt(rawKey, iv, encrypted);
      const dec = new TextDecoder();
      const payload = JSON.parse(dec.decode(decryptedBytes));

      const pool = payload.pool;
      if (pool) {
        pool.prevManifestHash = payload.prevHash || null;
        return pool;
      }
    } catch (err) {
      console.error("Failed to load manifest", err);
    }
    return null;
  }

  generateInviteCode(poolId: string): string {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool/Access not found.');
    const payload = `${poolId}|${pool.hubFolderId || access.hubFolderId}|${access.masterKeyB64}|${access.manifestId}`;
    const encoded = btoa(payload).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `flashmesh://join-pool/${encoded}`;
  }

  async _decodeInviteCode(code: string) {
    if (!code.startsWith('flashmesh://join-pool/')) {
      throw new Error('Invalid invite link format.');
    }
    const token = code.substring('flashmesh://join-pool/'.length);
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) {
      b64 += '=';
    }
    const payload = atob(b64);
    const parts = payload.split('|');
    if (parts.length < 4) {
      throw new Error('Invite payload contains insufficient parts');
    }
    return {
      poolId: parts[0],
      hubFolderId: parts[1],
      masterKeyB64: parts[2],
      manifestId: parts[3],
    };
  }

  async createPool(name: string, description: string, isPublic = true, allowMemberUploads = false, contributionLimitMB = 50) {
    if (!this.userFp) {
      this.userFp = await this.generateUserFingerprint();
    }
    const poolId = crypto.randomUUID();
    const slug = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const hubFolderName = `fmpool_hub_${slug}`;

    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawKey = await crypto.subtle.exportKey('raw', masterKey);
    const masterKeyB64 = ab2b64(rawKey);

    const driveHub = await this._createDriveFolder(hubFolderName, null);
    try {
      await this._makePublic(driveHub.id, 'writer');
      const driveInbox = await this._createDriveFolder('inbox', driveHub.id);
      await this._makePublic(driveInbox.id, 'writer');
      const driveChunks = await this._createDriveFolder('chunks', driveHub.id);
      await this._makePublic(driveChunks.id, 'writer');
      const driveMST = await this._createDriveFolder('mst', driveHub.id);
      await this._makePublic(driveMST.id, 'reader');

      const pool = {
        id: poolId,
        name,
        description,
        ownerFp: this.userFp,
        hubFolderId: driveHub.id,
        inboxFolderId: driveInbox.id,
        mstFolderId: driveMST.id,
        isPublic,
        allowMemberUploads,
        contributionLimitMB,
        replicationFactor: 3,
        ownerOffloadReplicaThreshold: 2,
        created: Date.now(),
        members: [{
          fp: this.userFp,
          name: 'Hub Creator',
          chunksFolderId: driveChunks.id,
          dropboxChunksPath: null,
          joinedAt: Date.now(),
          dummySlots: []
        }],
        files: [],
        pendingFiles: [],
        prevManifestHash: null
      };

      const manifestId = await this._saveManifest(pool, masterKeyB64, null);
      this._storePoolAccess(poolId, driveHub.id, masterKeyB64, manifestId);

      await poolApi.createPool(name, driveHub.id);

      this.pools.set(poolId, pool);
      this._rebuildPoolMST(pool);

      const inviteCode = this.generateInviteCode(poolId);
      return { pool, inviteCode };
    } catch (err) {
      await this._trashDriveFolder(driveHub.id).catch(() => {});
      throw err;
    }
  }

  async joinPool(inviteCode: string, userName: string) {
    if (!this.userFp) {
      this.userFp = await this.generateUserFingerprint();
    }
    const { poolId, hubFolderId, masterKeyB64, manifestId } = await this._decodeInviteCode(inviteCode);

    const pool = await this._loadManifest(hubFolderId, masterKeyB64, manifestId);
    if (!pool) throw new Error('Could not load pool manifest.');

    if (pool.members.find((m: any) => m.fp === this.userFp)) {
      this._storePoolAccess(pool.id, hubFolderId, masterKeyB64, manifestId);
      this.pools.set(pool.id, pool);
      return pool;
    }

    const dataFolderName = `fmpool_data_${pool.id.substring(0, 8)}`;
    const driveDataParent = await this._createDriveFolder(dataFolderName, null);
    try {
      const driveChunks = await this._createDriveFolder('chunks', driveDataParent.id);
      await this._makePublic(driveChunks.id, 'writer');

      const newMember = {
        fp: this.userFp,
        name: userName || 'Mesh Mate',
        chunksFolderId: driveChunks.id,
        dropboxChunksPath: null,
        joinedAt: Date.now(),
        dummySlots: []
      };

      const proposal = { type: 'JOIN', payload: newMember, timestamp: Date.now() };
      await this._submitProposal(pool, proposal, masterKeyB64);

      this._storePoolAccess(pool.id, hubFolderId, masterKeyB64, manifestId);

      await poolApi.joinPoolFromInvite(inviteCode);

      const virtualPool = { ...pool, isPendingSync: true };
      this.pools.set(pool.id, virtualPool);
      return virtualPool;
    } catch (err) {
      await this._trashDriveFolder(driveDataParent.id).catch(() => {});
      throw err;
    }
  }

  async _submitProposal(pool: any, proposalObj: any, masterKeyB64: string) {
    if (!pool.inboxFolderId) throw new Error('Inbox folder ID missing.');
    const proposalId = crypto.randomUUID();
    const payloadStr = JSON.stringify(proposalObj);

    const rawKey = b642ab(masterKeyB64);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await aesGcmEncrypt(rawKey, iv, new TextEncoder().encode(payloadStr));
    const combined = this._combineIvAndData(iv, encrypted);

    const fileName = `prop_${proposalId}.oro`;
    await this._uploadFileToDrive(fileName, 'application/octet-stream', combined, pool.inboxFolderId);
  }

  async _saveManifest(pool: any, masterKeyB64: string, manifestId: string | null): Promise<string> {
    const rawKey = b642ab(masterKeyB64);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = JSON.stringify({ prevHash: pool.prevManifestHash || null, pool });
    const encrypted = await aesGcmEncrypt(rawKey, iv, new TextEncoder().encode(payload));
    const combined = this._combineIvAndData(iv, encrypted);

    const encryptedB64 = ab2b64(encrypted);
    const hashBuf = await sha256(new TextEncoder().encode(encryptedB64));
    pool.prevManifestHash = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const fileName = `pool_manifest.oro`;
    let newFileId: string | null = manifestId;
    if (manifestId) {
      await this._updateFileToDrive(manifestId, 'application/octet-stream', combined);
    } else {
      const uploadedId = await this._uploadFileToDrive(fileName, 'application/octet-stream', combined, pool.hubFolderId);
      await this._makePublic(uploadedId, 'writer');
      newFileId = uploadedId;
    }

    if (newFileId && newFileId !== manifestId) {
      this._storePoolAccess(pool.id, pool.hubFolderId, masterKeyB64, newFileId);
    }

    if (!newFileId) {
      throw new Error("Failed to save pool manifest: file ID is empty");
    }

    return newFileId;
  }

  async processInbox(poolId: string) {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool access not found.');
    if (pool.ownerFp !== this.userFp) throw new Error('Only the owner can process the inbox.');

    const files = await this._listFilesInDriveFolder(pool.inboxFolderId, null);
    const proposals: any[] = [];
    const fileIdsToDelete: string[] = [];

    for (const f of files) {
      if (f.name.startsWith('prop_') && f.name.endsWith('.oro')) {
        try {
          const raw = await this._fetchFromDrive(f.id);
          const combined = new Uint8Array(raw);
          const iv = combined.slice(0, 12);
          const encrypted = combined.slice(12);
          const rawKey = b642ab(access.masterKeyB64);
          const decBytes = await aesGcmDecrypt(rawKey, iv, encrypted);
          const proposal = JSON.parse(new TextDecoder().decode(decBytes));
          proposals.push({
            proposal_id: f.name.replace('prop_', '').replace('.oro', ''),
            member_fp: proposal.payload?.fp || proposal.member_fp || 'remote',
            action: proposal.type.toLowerCase(),
            payload: proposal.payload,
            timestamp: new Date(proposal.timestamp || Date.now()).toISOString()
          });
          fileIdsToDelete.push(f.id);
        } catch (e) {
          console.warn("Failed to decrypt proposal:", f.name, e);
        }
      }
    }

    if (proposals.length === 0) return { processed: 0, failed: 0 };

    const currentManifestJson = JSON.stringify({
      files: pool.files || [],
      folders: pool.folders || [],
      members: pool.members.map((m: any) => ({
        fingerprint: m.fp,
        nickname: m.name,
        joined_at: new Date(m.joinedAt || Date.now()).toISOString(),
        quota_bytes: m.quota || (5 * 1024 * 1024 * 1024)
      }))
    });

    const [updatedManifestJson, result] = await poolApi.processPoolInbox(pool.id, proposals, currentManifestJson);

    const updatedObj = JSON.parse(updatedManifestJson);
    pool.files = updatedObj.files || [];
    pool.folders = updatedObj.folders || [];
    pool.members = (updatedObj.members || []).map((m: any) => ({
      fp: m.fingerprint,
      name: m.nickname,
      joinedAt: new Date(m.joined_at).getTime(),
      quota: m.quota_bytes,
      chunksFolderId: pool.members.find((pm: any) => pm.fp === m.fingerprint)?.chunksFolderId || ''
    }));

    await this._saveManifest(pool, access.masterKeyB64, access.manifestId);

    for (const fileId of fileIdsToDelete) {
      await this._deleteFromDrive(fileId).catch(() => {});
    }

    this._rebuildPoolMST(pool);

    return {
      processed: result.processed_count,
      failed: result.failed_count
    };
  }

  getPoolContents(poolId: string, folderId: string | null = null) {
    const pool = this.pools.get(poolId);
    if (!pool) return { folders: [], files: [] };

    const indexMgr = this._poolIndexes.get(poolId);
    if (indexMgr) {
      return this._getPoolContentsFromIndex(pool, indexMgr, folderId);
    }

    return this._getPoolContentsFlat(pool, folderId);
  }

  _getPoolContentsFlat(pool: any, folderId: string | null) {
    const allFolders = pool.folders || [];
    const filteredFolders = allFolders.filter((f: any) => (f.parentFolderId || null) === (folderId || null));

    const allFiles = pool.files || [];
    const files = allFiles
      .map((f: any) => this._applyFileMetadataDefaults(f))
      .filter((f: any) => (f.parentFolderId || null) === (folderId || null));

    return {
      folders: filteredFolders.map((f: any) => ({
        ...f,
        fileCount: allFiles.filter((pf: any) => pf.parentFolderId === f.id).length,
        folderCount: allFolders.filter((sf: any) => sf.parentFolderId === f.id).length
      })),
      files
    };
  }

  _getPoolContentsFromIndex(pool: any, indexMgr: MSTIndexManager, folderId: string | null) {
    const normFolderId = folderId || '/';
    const folderEntries = indexMgr.getByFolder(normFolderId);

    const folders: any[] = [];
    const files: any[] = [];

    for (const { key, value } of folderEntries) {
      if (!value) continue;
      if (value.type === 'folder') {
        const childEntries = indexMgr.getByFolder(value.id);
        const childFiles = childEntries.filter(e => e.value?.type === 'file');
        const childFolders = childEntries.filter(e => e.value?.type === 'folder');
        folders.push({
          id: value.id,
          name: value.name,
          parentFolderId: value.parentFolderId,
          created: value.created,
          fileCount: childFiles.length,
          folderCount: childFolders.length
        });
      } else if (value.type === 'file') {
        files.push(this._applyFileMetadataDefaults(value));
      }
    }
    return { folders, files };
  }

  _applyFileMetadataDefaults(fileEntry: any) {
    return {
      id: fileEntry.id,
      name: fileEntry.name,
      size: fileEntry.size,
      parentFolderId: fileEntry.parentFolderId || null,
      created: fileEntry.created || null,
      uploadedAt: fileEntry.uploadedAt || null,
      chunks: fileEntry.chunks || [],
      fileKey: fileEntry.fileKey || '',
      segmentGroupId: fileEntry.segmentGroupId || null,
      segmentRole: fileEntry.segmentRole || null,
      segmentSourceName: fileEntry.segmentSourceName || null
    };
  }

  _rebuildPoolMST(pool: any) {
    if (!pool?.id) return;
    const mst = new MerkleSearchTree();
    const entries = this._poolToMSTEntries(pool);
    mst.build(entries).then(rootHash => {
      this._poolMSTs.set(pool.id, mst);
      pool._mstRootHash = rootHash;

      const indexMgr = new MSTIndexManager();
      indexMgr.rebuildAll(entries.map(e => ({ key: e.key, value: e.value })));
      this._poolIndexes.set(pool.id, indexMgr);
    }).catch(e => {
      console.warn("Background MST rebuild failed:", e);
    });
  }

  _poolToMSTEntries(pool: any) {
    const entries: any[] = [];

    entries.push({
      key: `pool:${pool.id}`,
      value: {
        type: 'pool',
        id: pool.id,
        name: pool.name,
        ownerFp: pool.ownerFp,
        description: pool.description,
        created: pool.created
      }
    });

    for (const m of (pool.members || [])) {
      entries.push({
        key: `member:${m.fp}`,
        value: {
          type: 'member',
          fp: m.fp,
          name: m.name,
          chunksFolderId: m.chunksFolderId,
          joinedAt: m.joinedAt,
          dummySlots: m.dummySlots || []
        }
      });
    }

    for (const f of (pool.folders || [])) {
      entries.push({
        key: `folder:${f.id}`,
        value: {
          type: 'folder',
          ...f
        }
      });
    }

    for (const f of (pool.files || [])) {
      entries.push({
        key: `file:${f.id}`,
        value: {
          type: 'file',
          ...f
        }
      });
    }

    return entries.map(e => ({ key: e.key, keyHash: undefined, value: e.value }));
  }

  async uploadToPool(poolId: string, file: File, targetFolderId: string | null = null, onProgress?: (pct: number) => void) {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool not found/access denied');

    const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawFileKey = await crypto.subtle.exportKey('raw', fileKey);
    const fileKeyB64 = ab2b64(rawFileKey);

    const CHUNK_SIZE = 2 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const chunks: any[] = [];

    const members = pool.members || [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkSlice = file.slice(start, end);
      const chunkBytes = await chunkSlice.arrayBuffer();

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await aesGcmEncrypt(rawFileKey, iv, chunkBytes);
      const combined = this._combineIvAndData(iv, encrypted);

      const member = members[i % members.length] || members[0];
      const chunksFolderId = member.chunksFolderId || pool.members[0].chunksFolderId;

      const chunkFileName = `c_${crypto.randomUUID()}_${Date.now()}.enc`;
      const driveId = await this._uploadFileToDrive(chunkFileName, 'application/octet-stream', combined, chunksFolderId);

      chunks.push({
        chunkId: driveId,
        size: combined.byteLength,
        provider: 'google',
        driveId,
        memberFp: member.fp,
        replicas: [{ memberFp: member.fp, driveId }]
      });

      if (onProgress) onProgress(((i + 1) / totalChunks) * 100);
    }

    const fileEntry = {
      id: `fmpool_file_${crypto.randomUUID()}`,
      name: file.name,
      size: file.size,
      parentFolderId: targetFolderId,
      created: Date.now(),
      uploadedAt: Date.now(),
      uploadedBy: this.userFp,
      fileKey: fileKeyB64,
      chunks
    };

    if (pool.ownerFp === this.userFp) {
      pool.files.push(fileEntry);
      await this._saveManifest(pool, access.masterKeyB64, access.manifestId);
      this._rebuildPoolMST(pool);
    } else {
      const proposal = { type: 'UPLOAD', payload: fileEntry, timestamp: Date.now() };
      await this._submitProposal(pool, proposal, access.masterKeyB64);
    }

    return fileEntry;
  }

  async createFolder(poolId: string, name: string, parentFolderId: string | null = null) {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool not found');

    const newFolder = {
      id: `fmpool_folder_${crypto.randomUUID()}`,
      name,
      parentFolderId,
      created: Date.now()
    };

    if (pool.ownerFp === this.userFp) {
      pool.folders = pool.folders || [];
      pool.folders.push(newFolder);
      await this._saveManifest(pool, access.masterKeyB64, access.manifestId);
      this._rebuildPoolMST(pool);
    } else {
      const proposal = { type: 'MKDIR', payload: newFolder, timestamp: Date.now() };
      await this._submitProposal(pool, proposal, access.masterKeyB64);
    }

    return newFolder;
  }

  async renameFile(poolId: string, fileId: string, newName: string) {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool not found');

    if (pool.ownerFp === this.userFp) {
      const f = pool.files.find((x: any) => x.id === fileId);
      if (f) {
        f.name = newName;
        await this._saveManifest(pool, access.masterKeyB64, access.manifestId);
        this._rebuildPoolMST(pool);
      }
    } else {
      const proposal = { type: 'RENAME', payload: { id: fileId, name: newName }, timestamp: Date.now() };
      await this._submitProposal(pool, proposal, access.masterKeyB64);
    }
  }

  async renameFolder(poolId: string, folderId: string, newName: string) {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool not found');

    if (pool.ownerFp === this.userFp) {
      const f = pool.folders.find((x: any) => x.id === folderId);
      if (f) {
        f.name = newName;
        await this._saveManifest(pool, access.masterKeyB64, access.manifestId);
        this._rebuildPoolMST(pool);
      }
    } else {
      const proposal = { type: 'RENAME_FOLDER', payload: { id: folderId, name: newName }, timestamp: Date.now() };
      await this._submitProposal(pool, proposal, access.masterKeyB64);
    }
  }

  async deleteFile(poolId: string, fileId: string) {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool not found');

    if (pool.ownerFp === this.userFp) {
      const fileEntry = pool.files.find((f: any) => f.id === fileId);
      if (fileEntry) {
        for (const chunk of fileEntry.chunks) {
          if (chunk.memberFp === this.userFp) {
            await this._deleteFromDrive(chunk.driveId).catch(() => {});
          }
        }
        pool.files = pool.files.filter((f: any) => f.id !== fileId);
        await this._saveManifest(pool, access.masterKeyB64, access.manifestId);
        this._rebuildPoolMST(pool);
      }
    } else {
      const proposal = { type: 'DELETE', payload: { id: fileId }, timestamp: Date.now() };
      await this._submitProposal(pool, proposal, access.masterKeyB64);
    }
  }

  async deleteFolder(poolId: string, folderId: string) {
    const pool = this.pools.get(poolId);
    const access = this._getPoolAccess(poolId);
    if (!pool || !access) throw new Error('Pool not found');

    if (pool.ownerFp === this.userFp) {
      pool.folders = (pool.folders || []).filter((f: any) => f.id !== folderId);
      const filesToDelete = pool.files.filter((f: any) => f.parentFolderId === folderId);
      for (const f of filesToDelete) {
        await this.deleteFile(poolId, f.id).catch(() => {});
      }
      const foldersToDelete = pool.folders.filter((f: any) => f.parentFolderId === folderId);
      for (const f of foldersToDelete) {
        await this.deleteFolder(poolId, f.id).catch(() => {});
      }
      await this._saveManifest(pool, access.masterKeyB64, access.manifestId);
      this._rebuildPoolMST(pool);
    } else {
      const proposal = { type: 'DELETE_FOLDER', payload: { id: folderId }, timestamp: Date.now() };
      await this._submitProposal(pool, proposal, access.masterKeyB64);
    }
  }

  async _fetchChunkFromReplicas(chunk: any) {
    const replicas = this._normalizeChunkReplicas(chunk);
    let lastError = null;

    for (const rep of replicas) {
      try {
        return await this._fetchFromDrive(rep.driveId);
      } catch (err: any) {
        lastError = err;
        console.warn(`Chunk replica fetch failed for ${rep.driveId}:`, err.message);
      }
    }
    throw new Error('All replicas failed to fetch.');
  }

  _normalizeChunkReplicas(chunk: any) {
    if (!chunk.replicas) {
      chunk.replicas = [];
    }
    if (chunk.driveId && !chunk.replicas.find((r: any) => r.driveId === chunk.driveId)) {
      chunk.replicas.push({ memberFp: chunk.memberFp, driveId: chunk.driveId });
    }
    return chunk.replicas;
  }

  async downloadFromPool(poolId: string, fileId: string, onProgress?: (pct: number) => void): Promise<Blob> {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error('Pool not found.');

    let fileEntry = pool.files.find((f: any) => f.id === fileId);
    if (!fileEntry) fileEntry = (pool.pendingFiles || []).find((f: any) => f.id === fileId);
    if (!fileEntry) throw new Error('File not found in pool.');

    const fileKeyRaw = b642ab(fileEntry.fileKey);
    const totalChunks = fileEntry.chunks.length;
    const chunkDataArray = new Array(totalChunks);
    const queue = [...Array(totalChunks).keys()];
    let finished = 0;

    const downloadWorker = async () => {
      while (queue.length > 0) {
        const i = queue.shift();
        if (i === undefined) break;
        const chunk = fileEntry.chunks[i];
        const raw = await this._fetchChunkFromReplicas(chunk);
        const combined = new Uint8Array(raw);
        const ivPart = combined.slice(0, 12);
        const encryptedPart = combined.slice(12);
        const decrypted = await aesGcmDecrypt(fileKeyRaw, ivPart, encryptedPart);
        chunkDataArray[i] = decrypted;

        finished++;
        if (onProgress) onProgress((finished / totalChunks) * 100);
      }
    };

    const CONCURRENCY = 8;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(CONCURRENCY, totalChunks); w++) {
      workers.push(downloadWorker());
    }
    await Promise.all(workers);
    return new Blob(chunkDataArray, { type: fileEntry.mimeType || 'application/octet-stream' });
  }

  _getAccessListKey() {
    return `fmesh_pool_access_${this.userFp || 'global'}`;
  }

  _storePoolAccess(poolId: string, hubFolderId: string, masterKeyB64: string, manifestId: string) {
    const key = this._getAccessListKey();
    const accessList = JSON.parse(localStorage.getItem(key) || '{}');
    accessList[poolId] = { hubFolderId, masterKeyB64, manifestId };
    localStorage.setItem(key, JSON.stringify(accessList));
  }

  _getPoolAccess(poolId: string) {
    const key = this._getAccessListKey();
    const accessList = JSON.parse(localStorage.getItem(key) || '{}');
    return accessList[poolId] || null;
  }

  _removePoolAccess(poolId: string) {
    const key = this._getAccessListKey();
    const accessList = JSON.parse(localStorage.getItem(key) || '{}');
    if (accessList[poolId]) {
      delete accessList[poolId];
      localStorage.setItem(key, JSON.stringify(accessList));
    }
  }

  async _createDriveFolder(name: string, parentId: string | null) {
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + this._getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [] })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Drive folder creation failed: ${json.error?.message || res.status}`);
    return json;
  }

  async _makePublic(fileId: string, role = 'reader') {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + this._getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, type: 'anyone', allowFileDiscovery: false })
    });
  }

  async _trashDriveFolder(fileId: string) {
    if (!fileId) return;
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + this._getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
  }

  async _uploadFileToDrive(name: string, mimeType: string, data: Uint8Array | ArrayBuffer, parentId: string | null) {
    const metadata = { name, mimeType, parents: parentId ? [parentId] : [] };
    const boundary = 'fmesh_boundary';
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      data,
      `\r\n--${boundary}--`
    ]);
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + this._getToken(), 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const json = await res.json();
    if (!res.ok || !json.id) {
      throw new Error(`Drive upload failed for "${name}": ${json?.error?.message || res.status}`);
    }
    return json.id;
  }

  async _updateFileToDrive(fileId: string, mimeType: string, data: Uint8Array | ArrayBuffer) {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + this._getToken(), 'Content-Type': mimeType },
      body: data
    });
    if (!res.ok) {
      throw new Error(`Drive update failed: ${res.statusText}`);
    }
  }

  async _fetchFromDrive(fileId: string): Promise<ArrayBuffer> {
    const token = this._getToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) {
      throw new Error(`Drive fetch failed for ${fileId}: ${res.status}`);
    }
    return await res.arrayBuffer();
  }

  async _listFilesInDriveFolder(folderId: string, name: string | null) {
    const q = name ? `name='${name}' and '${folderId}' in parents and trashed=false` : `'${folderId}' in parents and trashed=false`;
    const baseUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,size)`;
    const res = await fetch(baseUrl, {
      headers: { 'Authorization': 'Bearer ' + this._getToken() }
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.files || [];
  }

  async _deleteFromDrive(fileId: string) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + this._getToken() }
    });
  }

  _combineIvAndData(iv: Uint8Array, data: ArrayBuffer) {
    const combined = new Uint8Array(iv.length + data.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(data), iv.length);
    return combined;
  }
}

export const dataPoolManager = new DataPoolManager();
