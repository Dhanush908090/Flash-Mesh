/**
 * FlashMesh Merkle Search Tree (MST)
 * A deterministic, self-balancing search tree used to sync files/folders robustly.
 */
import { enc, sha256 } from './crypto';

export interface MSTEntry {
  key: string;
  keyHash?: string;
  value: any;
}

export interface MSTChild {
  slot: number;
  hash: string;
}

export type MSTNode =
  | { type: 'leaf'; entries: MSTEntry[]; children: null }
  | { type: 'internal'; entries: null; children: MSTChild[] };

export class MerkleSearchTree {
  public nodes: Map<string, MSTNode>;
  public rootHash: string | null;
  private _keyHashCache: Map<string, string>;

  static readonly BITS_PER_LEVEL = 5;
  static readonly FANOUT = 1 << MerkleSearchTree.BITS_PER_LEVEL;
  static readonly LEAF_MAX = 64;

  constructor() {
    this.nodes = new Map();
    this.rootHash = null;
    this._keyHashCache = new Map();
  }

  static leaf(entries: MSTEntry[]): MSTNode {
    return {
      type: 'leaf',
      entries: [...entries].sort((a, b) => ((a.keyHash || '') < (b.keyHash || '') ? -1 : 1)),
      children: null,
    };
  }

  static internal(children: MSTChild[]): MSTNode {
    return {
      type: 'internal',
      entries: null,
      children: [...children].sort((a, b) => a.slot - b.slot),
    };
  }

  async build(entries: MSTEntry[]): Promise<string> {
    this.nodes.clear();
    this._keyHashCache.clear();

    if (!entries || entries.length === 0) {
      const emptyLeaf = MerkleSearchTree.leaf([]);
      const hash = await this._hashNode(emptyLeaf);
      this.nodes.set(hash, emptyLeaf);
      this.rootHash = hash;
      return hash;
    }

    const enriched: MSTEntry[] = [];
    for (const entry of entries) {
      const keyHash = await this._hashKey(entry.key);
      enriched.push({ key: entry.key, keyHash, value: entry.value });
    }

    const rootHash = await this._buildSubtree(enriched, 0);
    this.rootHash = rootHash;
    return rootHash;
  }

  private async _buildSubtree(entries: MSTEntry[], depth: number): Promise<string> {
    if (entries.length <= MerkleSearchTree.LEAF_MAX) {
      const leaf = MerkleSearchTree.leaf(entries);
      const hash = await this._hashNode(leaf);
      this.nodes.set(hash, leaf);
      return hash;
    }

    const buckets = new Map<number, MSTEntry[]>();
    for (const entry of entries) {
      const slot = this._slotAtDepth(entry.keyHash!, depth);
      if (!buckets.has(slot)) buckets.set(slot, []);
      buckets.get(slot)!.push(entry);
    }

    const children: MSTChild[] = [];
    for (const [slot, bucketEntries] of buckets.entries()) {
      const childHash = await this._buildSubtree(bucketEntries, depth + 1);
      children.push({ slot, hash: childHash });
    }

    if (children.length === 1) {
      return children[0].hash;
    }

    const internal = MerkleSearchTree.internal(children);
    const hash = await this._hashNode(internal);
    this.nodes.set(hash, internal);
    return hash;
  }

  async diff(
    remoteRootHash: string,
    fetchNode: (hash: string) => Promise<MSTNode | null>
  ): Promise<{ added: MSTEntry[]; removed: MSTEntry[]; unchanged: number }> {
    if (this.rootHash === remoteRootHash) {
      return { added: [], removed: [], unchanged: this._countEntries() };
    }

    const localEntries = this.rootHash ? this._collectEntries(this.rootHash) : [];
    const remoteEntries = await this._collectRemoteEntries(remoteRootHash, fetchNode);

    const localMap = new Map(localEntries.map(e => [e.key, e]));
    const remoteMap = new Map(remoteEntries.map(e => [e.key, e]));

    const added: MSTEntry[] = [];
    const removed: MSTEntry[] = [];
    let unchanged = 0;

    for (const [key, entry] of remoteMap.entries()) {
      if (!localMap.has(key)) added.push(entry);
    }
    for (const [key, entry] of localMap.entries()) {
      if (!remoteMap.has(key)) removed.push(entry);
      else unchanged++;
    }

    return { added, removed, unchanged };
  }

  public async _collectRemoteEntries(
    nodeHash: string,
    fetchNode: (hash: string) => Promise<MSTNode | null>
  ): Promise<MSTEntry[]> {
    if (this.nodes.has(nodeHash)) {
      return this._collectEntries(nodeHash);
    }

    const node = await fetchNode(nodeHash);
    if (!node) return [];

    this.nodes.set(nodeHash, node);

    if (node.type === 'leaf') {
      return node.entries || [];
    }

    const results: MSTEntry[] = [];
    for (const child of node.children || []) {
      const childEntries = await this._collectRemoteEntries(child.hash, fetchNode);
      results.push(...childEntries);
    }
    return results;
  }

  private _collectEntries(nodeHash: string): MSTEntry[] {
    const node = this.nodes.get(nodeHash);
    if (!node) return [];

    if (node.type === 'leaf') {
      return node.entries || [];
    }

    const results: MSTEntry[] = [];
    for (const child of node.children || []) {
      results.push(...this._collectEntries(child.hash));
    }
    return results;
  }

  private _countEntries(): number {
    let count = 0;
    for (const node of this.nodes.values()) {
      if (node.type === 'leaf' && node.entries) {
        count += node.entries.length;
      }
    }
    return count;
  }

  async put(key: string, value: any): Promise<string> {
    const keyHash = await this._hashKey(key);
    const entry = { key, keyHash, value };

    if (!this.rootHash) {
      return await this.build([entry]);
    }

    const newRootHash = await this._putInSubtree(this.rootHash, entry, 0);
    this.rootHash = newRootHash;
    return newRootHash;
  }

  async remove(key: string): Promise<string | null> {
    const keyHash = await this._hashKey(key);
    if (!this.rootHash) return null;

    const newRootHash = await this._removeFromSubtree(this.rootHash, keyHash, 0);
    this.rootHash = newRootHash;
    return newRootHash;
  }

  private async _putInSubtree(nodeHash: string, entry: MSTEntry, depth: number): Promise<string> {
    const node = this.nodes.get(nodeHash);
    if (!node) {
      const leaf = MerkleSearchTree.leaf([entry]);
      const hash = await this._hashNode(leaf);
      this.nodes.set(hash, leaf);
      return hash;
    }

    if (node.type === 'leaf') {
      const entries = (node.entries || []).filter(e => e.key !== entry.key);
      entries.push(entry);

      if (entries.length <= MerkleSearchTree.LEAF_MAX) {
        const newLeaf = MerkleSearchTree.leaf(entries);
        const hash = await this._hashNode(newLeaf);
        this.nodes.set(hash, newLeaf);
        return hash;
      }

      return await this._buildSubtree(entries, depth);
    }

    const slot = this._slotAtDepth(entry.keyHash!, depth);
    const existingChild = (node.children || []).find(c => c.slot === slot);

    let newChildHash;
    if (existingChild) {
      newChildHash = await this._putInSubtree(existingChild.hash, entry, depth + 1);
    } else {
      const leaf = MerkleSearchTree.leaf([entry]);
      newChildHash = await this._hashNode(leaf);
      this.nodes.set(newChildHash, leaf);
    }

    const newChildren = (node.children || [])
      .filter(c => c.slot !== slot)
      .concat([{ slot, hash: newChildHash }]);

    const newInternal = MerkleSearchTree.internal(newChildren);
    const hash = await this._hashNode(newInternal);
    this.nodes.set(hash, newInternal);
    return hash;
  }

  private async _removeFromSubtree(nodeHash: string, keyHash: string, depth: number): Promise<string> {
    const node = this.nodes.get(nodeHash);
    if (!node) return nodeHash;

    if (node.type === 'leaf') {
      const entries = (node.entries || []).filter(e => e.keyHash !== keyHash);
      if (entries.length === (node.entries || []).length) return nodeHash;

      const newLeaf = MerkleSearchTree.leaf(entries);
      const hash = await this._hashNode(newLeaf);
      this.nodes.set(hash, newLeaf);
      return hash;
    }

    const slot = this._slotAtDepth(keyHash, depth);
    const existingChild = (node.children || []).find(c => c.slot === slot);
    if (!existingChild) return nodeHash;

    const newChildHash = await this._removeFromSubtree(existingChild.hash, keyHash, depth + 1);

    const childNode = this.nodes.get(newChildHash);
    const childIsEmpty = childNode?.type === 'leaf' && (!childNode.entries || childNode.entries.length === 0);

    let newChildren;
    if (childIsEmpty) {
      newChildren = (node.children || []).filter(c => c.slot !== slot);
    } else {
      newChildren = (node.children || [])
        .filter(c => c.slot !== slot)
        .concat([{ slot, hash: newChildHash }]);
    }

    if (newChildren.length === 1) {
      const onlyChild = this.nodes.get(newChildren[0].hash);
      if (onlyChild?.type === 'leaf') {
        return newChildren[0].hash;
      }
    }

    if (newChildren.length === 0) {
      const emptyLeaf = MerkleSearchTree.leaf([]);
      const hash = await this._hashNode(emptyLeaf);
      this.nodes.set(hash, emptyLeaf);
      return hash;
    }

    const newInternal = MerkleSearchTree.internal(newChildren);
    const hash = await this._hashNode(newInternal);
    this.nodes.set(hash, newInternal);
    return hash;
  }

  async get(key: string): Promise<any | null> {
    const keyHash = await this._hashKey(key);
    if (!this.rootHash) return null;
    return this._getFromSubtree(this.rootHash, keyHash, 0);
  }

  private _getFromSubtree(nodeHash: string, keyHash: string, depth: number): any | null {
    const node = this.nodes.get(nodeHash);
    if (!node) return null;

    if (node.type === 'leaf') {
      const found = (node.entries || []).find(e => e.keyHash === keyHash);
      return found ? found.value : null;
    }

    const slot = this._slotAtDepth(keyHash, depth);
    const child = (node.children || []).find(c => c.slot === slot);
    if (!child) return null;

    return this._getFromSubtree(child.hash, keyHash, depth + 1);
  }

  getStats(): {
    rootHash: string | null;
    leafNodes: number;
    internalNodes: number;
    totalNodes: number;
    entries: number;
    maxDepth: number;
    fanout: number;
  } {
    let leafCount = 0;
    let internalCount = 0;
    let entryCount = 0;
    let maxDepth = 0;

    const walk = (hash: string, depth: number) => {
      const node = this.nodes.get(hash);
      if (!node) return;
      if (node.type === 'leaf') {
        leafCount++;
        entryCount += (node.entries || []).length;
        maxDepth = Math.max(maxDepth, depth);
      } else {
        internalCount++;
        for (const child of (node.children || [])) {
          walk(child.hash, depth + 1);
        }
      }
    };

    if (this.rootHash) walk(this.rootHash, 0);

    return {
      rootHash: this.rootHash,
      leafNodes: leafCount,
      internalNodes: internalCount,
      totalNodes: leafCount + internalCount,
      entries: entryCount,
      maxDepth,
      fanout: MerkleSearchTree.FANOUT
    };
  }

  getChangedNodes(knownHashes: Set<string>): Array<{ hash: string; node: MSTNode; serialized: string }> {
    const changed: Array<{ hash: string; node: MSTNode; serialized: string }> = [];
    for (const [hash, node] of this.nodes) {
      if (!knownHashes.has(hash)) {
        changed.push({
          hash,
          node,
          serialized: this.serializeNode(node)
        });
      }
    }
    return changed;
  }

  importNode(hash: string, node: MSTNode): void {
    this.nodes.set(hash, node);
  }

  getReachableHashes(): Set<string> {
    const reachable = new Set<string>();
    this._walkReachable(this.rootHash, reachable);
    return reachable;
  }

  private _walkReachable(nodeHash: string | null, set: Set<string>): void {
    if (!nodeHash || set.has(nodeHash)) return;
    set.add(nodeHash);
    const node = this.nodes.get(nodeHash);
    if (!node) return;
    if (node.type === 'internal' && node.children) {
      for (const child of node.children) {
        this._walkReachable(child.hash, set);
      }
    }
  }

  serializeNode(node: MSTNode): string {
    if (node.type === 'leaf') {
      return JSON.stringify({
        t: 'L',
        e: (node.entries || []).map(e => ({ k: e.key, h: e.keyHash, v: e.value })),
      });
    }
    return JSON.stringify({
      t: 'I',
      c: (node.children || []).map(c => ({ s: c.slot, h: c.hash })),
    });
  }

  deserializeNode(jsonStr: string): MSTNode {
    const obj = JSON.parse(jsonStr);
    if (obj.t === 'L') {
      return {
        type: 'leaf',
        entries: (obj.e || []).map((e: any) => ({ key: e.k, keyHash: e.h, value: e.v })),
        children: null,
      };
    }
    return {
      type: 'internal',
      entries: null,
      children: (obj.c || []).map((c: any) => ({ slot: c.s, hash: c.h })),
    };
  }

  private async _hashKey(key: string): Promise<string> {
    if (this._keyHashCache.has(key)) return this._keyHashCache.get(key)!;
    const buf = await sha256(enc.encode(key));
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    this._keyHashCache.set(key, hex);
    return hex;
  }

  private async _hashNode(node: MSTNode): Promise<string> {
    const serialized = this.serializeNode(node);
    const buf = await sha256(enc.encode(serialized));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private _slotAtDepth(keyHash: string, depth: number): number {
    const BITS = MerkleSearchTree.BITS_PER_LEVEL;
    const bitStart = depth * BITS;
    const charStart = Math.floor(bitStart / 4);

    if (charStart >= keyHash.length) return 0;

    const hexChars = keyHash.substring(charStart, charStart + 2);
    const num = parseInt(hexChars, 16) || 0;
    const bitOffset = bitStart % 4;
    const shifted = num >> (8 - BITS - bitOffset);
    return shifted & (MerkleSearchTree.FANOUT - 1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MST Index Manager — Secondary in-memory indices for O(1) lookups
// Ported from the base version (basic build/FlashMesh/src/core/mst.js)
// ═══════════════════════════════════════════════════════════════════════════

export interface IndexedEntry extends MSTEntry {
  /** Parent folder path derived from the key (e.g. "/home/user/docs") */
  folder?: string;
  /** Lowercased file extension without dot (e.g. "pdf") */
  ext?: string;
}

export class MSTIndexManager {
  public folderIndex: Map<string, Set<string>> = new Map();
  public typeIndex: Map<string, Set<string>> = new Map();
  public memberIndex: Map<string, Set<string>> = new Map();
  public statusIndex: Map<string, Set<string>> = new Map();
  public searchIndex: Map<string, Set<string>> = new Map();
  public entryCache: Map<string, IndexedEntry> = new Map();

  private get entryMap() { return this.entryCache; }
  private get extensionIndex() { return this.typeIndex; }
  private get tokenIndex() { return this.searchIndex; }

  // ── Build/Mutate ─────────────────────────────────────────────────────────

  rebuildAll(entries: MSTEntry[]): void {
    this.folderIndex.clear();
    this.typeIndex.clear();
    this.memberIndex.clear();
    this.statusIndex.clear();
    this.searchIndex.clear();
    this.entryCache.clear();

    for (const entry of entries) {
      this._indexEntry(entry.key, entry.value);
    }
  }

  buildIndex(entries: IndexedEntry[]): void {
    this.rebuildAll(entries);
  }

  addEntry(key: string, value: any): void {
    if (this.entryCache.has(key)) {
      this.removeEntry(key);
    }
    this._indexEntry(key, value);
  }

  upsertEntry(entry: IndexedEntry): void {
    this.addEntry(entry.key, entry.value);
  }

  removeEntry(key: string): void {
    const cached = this.entryCache.get(key);
    if (!cached) return;

    const value = cached.value;

    const folderId = this._extractFolderId(key, value);
    this._removeFromIndex(this.folderIndex, folderId, key);

    const ext = this._extractExtension(key, value);
    if (ext) this._removeFromIndex(this.typeIndex, ext, key);

    const member = this._extractMember(key, value);
    if (member) this._removeFromIndex(this.memberIndex, member, key);

    const status = this._extractStatus(key, value);
    if (status) this._removeFromIndex(this.statusIndex, status, key);

    const tokens = this._extractSearchTokens(key, value);
    for (const token of tokens) {
      this._removeFromIndex(this.searchIndex, token, key);
    }

    this.entryCache.delete(key);
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getByFolder(folderId: string | null): IndexedEntry[] {
    const keyStr = folderId === null || folderId === undefined ? '__root__' : folderId;
    return this._resolveKeys(this.folderIndex.get(keyStr));
  }

  filterByFolder(folder: string): IndexedEntry[] {
    const keyStr = this._normFolder(folder);
    return this._resolveKeys(this.folderIndex.get(keyStr));
  }

  getByType(extension: string): IndexedEntry[] {
    return this._resolveKeys(this.typeIndex.get(extension.toLowerCase()));
  }

  filterByExtension(ext: string): IndexedEntry[] {
    return this.getByType(ext);
  }

  getByMember(memberFp: string): IndexedEntry[] {
    return this._resolveKeys(this.memberIndex.get(memberFp));
  }

  getByStatus(status: string): IndexedEntry[] {
    return this._resolveKeys(this.statusIndex.get(status));
  }

  search(query: string): IndexedEntry[] {
    if (!query) return [];
    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryTokens.length === 0) return [];

    let resultKeys: Set<string> | undefined = undefined;
    for (const qt of queryTokens) {
      const matching = new Set<string>();
      for (const [token, keys] of this.searchIndex) {
        if (token.includes(qt)) {
          for (const k of keys) matching.add(k);
        }
      }
      if (resultKeys === undefined) {
        resultKeys = matching;
      } else {
        for (const k of resultKeys) {
          if (!matching.has(k)) resultKeys.delete(k);
        }
      }
    }

    return this._resolveKeys(resultKeys);
  }

  searchByToken(query: string): IndexedEntry[] {
    return this.search(query);
  }

  getByFolderAndStatus(folderId: string | null, status: string): IndexedEntry[] {
    const folderKey = folderId === null || folderId === undefined ? '__root__' : folderId;
    const folderKeys = this.folderIndex.get(folderKey);
    const statusKeys = this.statusIndex.get(status);

    if (!folderKeys || !statusKeys) return [];

    const [smaller, larger] = folderKeys.size < statusKeys.size
      ? [folderKeys, statusKeys] : [statusKeys, folderKeys];

    const results: IndexedEntry[] = [];
    for (const key of smaller) {
      if (larger.has(key)) {
        const cached = this.entryCache.get(key);
        if (cached) results.push(cached);
      }
    }
    return results;
  }

  getCounts(): {
    totalEntries: number;
    folders: number;
    fileTypes: number;
    members: number;
    approved: number;
    pending: number;
    searchTokens: number;
  } {
    return {
      totalEntries: this.entryCache.size,
      folders: this.folderIndex.size,
      fileTypes: this.typeIndex.size,
      members: this.memberIndex.size,
      approved: (this.statusIndex.get('approved') || new Set()).size,
      pending: (this.statusIndex.get('pending') || new Set()).size,
      searchTokens: this.searchIndex.size
    };
  }

  get size(): number {
    return this.entryCache.size;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _indexEntry(key: string, value: any): void {
    const enriched: IndexedEntry = this._enrich({ key, value });
    this.entryCache.set(key, enriched);

    const folderId = this._extractFolderId(key, value);
    this._addToIndex(this.folderIndex, folderId, key);

    const ext = this._extractExtension(key, value);
    if (ext) this._addToIndex(this.typeIndex, ext, key);

    const member = this._extractMember(key, value);
    if (member) this._addToIndex(this.memberIndex, member, key);

    const status = this._extractStatus(key, value);
    if (status) this._addToIndex(this.statusIndex, status, key);

    const tokens = this._extractSearchTokens(key, value);
    for (const token of tokens) {
      this._addToIndex(this.searchIndex, token, key);
    }
  }

  private _addToIndex(index: Map<string, Set<string>>, dimensionValue: string, key: string): void {
    if (!index.has(dimensionValue)) index.set(dimensionValue, new Set());
    index.get(dimensionValue)!.add(key);
  }

  private _removeFromIndex(index: Map<string, Set<string>>, dimensionValue: string, key: string): void {
    const set = index.get(dimensionValue);
    if (set) {
      set.delete(key);
      if (set.size === 0) index.delete(dimensionValue);
    }
  }

  private _resolveKeys(keySet: Set<string> | undefined | null): IndexedEntry[] {
    if (!keySet) return [];
    const results: IndexedEntry[] = [];
    for (const key of keySet) {
      const cached = this.entryCache.get(key);
      if (cached) results.push(cached);
    }
    return results;
  }

  private _normFolder(folder: string): string {
    if (!folder) return '__root__';
    return folder.endsWith('/') && folder !== '/' ? folder.slice(0, -1) : folder;
  }

  private _enrich(entry: IndexedEntry): IndexedEntry {
    const key = entry.key;
    const lastSlash = key.lastIndexOf('/');
    const folder = lastSlash > 0 ? key.slice(0, lastSlash) : '/';
    const basename = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
    const dotIdx = basename.lastIndexOf('.');
    const ext = dotIdx > 0 ? basename.slice(dotIdx + 1).toLowerCase() : '';
    return { ...entry, folder, ext };
  }

  private _extractFolderId(key: string, value: any): string {
    if (!value) return '__root__';
    const fid = value.parentFolderId || value.folderId || null;
    if (fid === null || fid === undefined) {
      const lastSlash = key.lastIndexOf('/');
      const pathFolder = lastSlash > 0 ? key.slice(0, lastSlash) : '/';
      return this._normFolder(pathFolder);
    }
    return fid;
  }

  private _extractExtension(key: string, value: any): string | null {
    if (value && value.name) {
      const name = value.name;
      const dot = name.lastIndexOf('.');
      if (dot >= 0 && dot < name.length - 1) {
        return name.substring(dot + 1).toLowerCase();
      }
    }
    const lastSlash = key.lastIndexOf('/');
    const basename = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
    const dotIdx = basename.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < basename.length - 1) {
      return basename.slice(dotIdx + 1).toLowerCase();
    }
    return null;
  }

  private _extractMember(key: string, value: any): string | null {
    if (!value) return null;
    return value.uploadedBy || value.fp || null;
  }

  private _extractStatus(key: string, value: any): string | null {
    if (!value) return null;
    if (value.type === 'file') return value.status || 'approved';
    return value.type || null;
  }

  private _extractSearchTokens(key: string, value: any): Set<string> {
    const tokens = new Set<string>();
    if (!value) return tokens;

    const name = value.name || value.description || '';
    if (name) {
      const parts = name.toLowerCase().split(/[^a-z0-9]+/).filter((t: string) => t.length > 1);
      for (const p of parts) tokens.add(p);
      const fullLower = name.toLowerCase().replace(/\s+/g, '');
      if (fullLower.length > 1) tokens.add(fullLower);
    }

    if (value.type === 'member' && value.name) {
      const memberParts = value.name.toLowerCase().split(/[^a-z0-9]+/).filter((t: string) => t.length > 1);
      for (const p of memberParts) tokens.add(p);
    }

    const keyParts = key.toLowerCase().split(/[^a-z0-9]+/).filter((t: string) => t.length > 1);
    for (const p of keyParts) tokens.add(p);

    return tokens;
  }
}
