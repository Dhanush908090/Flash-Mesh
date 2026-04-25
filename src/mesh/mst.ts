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
