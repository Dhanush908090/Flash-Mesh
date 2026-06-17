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

  private async _collectRemoteEntries(
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
  /** folder path → set of entry keys in that folder */
  private folderIndex: Map<string, Set<string>> = new Map();

  /** extension string → set of entry keys with that extension */
  private extensionIndex: Map<string, Set<string>> = new Map();

  /**
   * Inverted token index: each word/token (lowercase) of a filename
   * maps to the set of entry keys containing that token.
   */
  private tokenIndex: Map<string, Set<string>> = new Map();

  /** Raw entry storage by key */
  private entryMap: Map<string, IndexedEntry> = new Map();

  // ── Build ────────────────────────────────────────────────────────────────

  /** Rebuild all indices from the given entry list. O(n) */
  buildIndex(entries: IndexedEntry[]): void {
    this.folderIndex.clear();
    this.extensionIndex.clear();
    this.tokenIndex.clear();
    this.entryMap.clear();

    for (const entry of entries) {
      const enriched = this._enrich(entry);
      this.entryMap.set(enriched.key, enriched);
      this._indexEntry(enriched);
    }
  }

  /** Add or update a single entry without rebuilding everything. O(tokens) */
  upsertEntry(entry: IndexedEntry): void {
    if (this.entryMap.has(entry.key)) {
      this._removeEntry(this.entryMap.get(entry.key)!);
    }
    const enriched = this._enrich(entry);
    this.entryMap.set(enriched.key, enriched);
    this._indexEntry(enriched);
  }

  /** Remove an entry from all indices. */
  removeEntry(key: string): void {
    const entry = this.entryMap.get(key);
    if (!entry) return;
    this._removeEntry(entry);
    this.entryMap.delete(key);
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Returns all entries directly inside the given folder path.
   * O(1) lookup + O(m) result assembly where m is the number of items.
   */
  filterByFolder(folder: string): IndexedEntry[] {
    const keys = this.folderIndex.get(this._normFolder(folder));
    if (!keys) return [];
    return [...keys]
      .map(k => this.entryMap.get(k)!)
      .filter(Boolean);
  }

  /**
   * Returns all entries with the given file extension (without leading dot).
   * Case-insensitive. O(1) lookup.
   */
  filterByExtension(ext: string): IndexedEntry[] {
    const keys = this.extensionIndex.get(ext.toLowerCase().replace(/^\./, ''));
    if (!keys) return [];
    return [...keys]
      .map(k => this.entryMap.get(k)!)
      .filter(Boolean);
  }

  /**
   * Full-text-style search across entry keys using tokenized matching.
   * Returns entries whose filename contains ALL whitespace-separated tokens
   * in the query (AND semantics). O(1) per token via inverted index.
   */
  searchByToken(query: string): IndexedEntry[] {
    const tokens = this._tokenize(query);
    if (tokens.length === 0) return [...this.entryMap.values()];

    let candidateKeys: Set<string> | null = null;

    for (const token of tokens) {
      const matching = this.tokenIndex.get(token);
      if (!matching || matching.size === 0) return [];

      if (candidateKeys === null) {
        candidateKeys = new Set(matching);
      } else {
        // Intersection
        for (const k of candidateKeys) {
          if (!matching.has(k)) candidateKeys.delete(k);
        }
      }
    }

    if (!candidateKeys) return [];
    return [...candidateKeys]
      .map(k => this.entryMap.get(k)!)
      .filter(Boolean);
  }

  /** Total number of indexed entries. */
  get size(): number {
    return this.entryMap.size;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _enrich(entry: IndexedEntry): IndexedEntry {
    const key = entry.key;
    const lastSlash = key.lastIndexOf('/');
    const folder = lastSlash > 0 ? key.slice(0, lastSlash) : '/';
    const basename = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
    const dotIdx = basename.lastIndexOf('.');
    const ext = dotIdx > 0 ? basename.slice(dotIdx + 1).toLowerCase() : '';
    return { ...entry, folder, ext };
  }

  private _normFolder(folder: string): string {
    return folder.endsWith('/') && folder !== '/' ? folder.slice(0, -1) : folder;
  }

  private _indexEntry(entry: IndexedEntry): void {
    // Folder index
    const folderKey = this._normFolder(entry.folder || '/');
    if (!this.folderIndex.has(folderKey)) this.folderIndex.set(folderKey, new Set());
    this.folderIndex.get(folderKey)!.add(entry.key);

    // Extension index
    if (entry.ext) {
      if (!this.extensionIndex.has(entry.ext)) this.extensionIndex.set(entry.ext, new Set());
      this.extensionIndex.get(entry.ext)!.add(entry.key);
    }

    // Token index
    for (const token of this._tokenize(entry.key)) {
      if (!this.tokenIndex.has(token)) this.tokenIndex.set(token, new Set());
      this.tokenIndex.get(token)!.add(entry.key);
    }
  }

  private _removeEntry(entry: IndexedEntry): void {
    const folderKey = this._normFolder(entry.folder || '/');
    this.folderIndex.get(folderKey)?.delete(entry.key);

    if (entry.ext) this.extensionIndex.get(entry.ext)?.delete(entry.key);

    for (const token of this._tokenize(entry.key)) {
      this.tokenIndex.get(token)?.delete(entry.key);
    }
  }

  private _tokenize(text: string): string[] {
    // Split on non-alphanumeric chars (slashes, dots, underscores, spaces, etc.)
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 2);
  }
}
