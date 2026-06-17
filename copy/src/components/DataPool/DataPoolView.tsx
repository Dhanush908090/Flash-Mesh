/**
 * Data Pools — Collaborative shared vault system.
 *
 * Ported from the base version (basic build/FlashMesh/src/core/datapool.js)
 *
 * This is the frontend Data Pool browser and creation UI.
 * The Outpost Model: members write proposals to the owner's inbox,
 * the owner processes them and updates the pool manifest.
 */

import React, { useState, useEffect } from 'react';
import { Database, Plus, Users, RefreshCw, Link, FolderOpen, Shield, ArrowLeft } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { poolApi, DataPool as TauriDataPool } from '../../api/tauri';
import { showToast } from '../Toast/Toast';

export interface PoolMember {
  fingerprint: string;
  nickname: string;
  joinedAt: string;
  quota: number; // bytes contributed
}

export interface DataPool {
  id: string;
  name: string;
  ownerFp: string;
  isOwner: boolean;
  memberCount: number;
  totalSize: number;
  usedSize: number;
  hubFolderId: string;
  createdAt: string;
  status: 'online' | 'offline' | 'syncing';
}

interface DataPoolCardProps {
  pool: DataPool;
  onOpen: (pool: DataPool) => void;
  onGenerateInvite: (pool: DataPool) => void;
}

function DataPoolCard({ pool, onOpen, onGenerateInvite }: DataPoolCardProps) {
  const usagePct = pool.totalSize > 0 ? (pool.usedSize / pool.totalSize) * 100 : 0;
  const statusColor = pool.status === 'online' ? '#06b6d4' : pool.status === 'syncing' ? '#fbbf24' : '#6b7280';

  return (
    <div
      className="data-pool-card"
      onClick={() => onOpen(pool)}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        cursor: 'pointer',
        transition: 'all 200ms var(--ease-out)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-glow)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLElement).style.transform = '';
        (e.currentTarget as HTMLElement).style.boxShadow = '';
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--radius-md)',
          background: 'var(--accent-muted)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', flexShrink: 0,
        }}>
          <Database size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pool.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            {pool.status === 'online' ? 'Online' : pool.status === 'syncing' ? 'Syncing...' : 'Offline'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {pool.isOwner && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 99, background: 'rgba(6, 182, 212, 0.15)', color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>
              <Shield size={10} /> Host
            </div>
          )}
        </div>
      </div>

      {/* Usage bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          <span>{formatBytes(pool.usedSize)} used</span>
          <span>{formatBytes(pool.totalSize)} total</span>
        </div>
        <div style={{ height: 4, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${usagePct}%`, background: 'var(--accent-gradient)', borderRadius: 2, transition: 'width 600ms var(--ease-out)' }} />
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} />
          {pool.memberCount} member{pool.memberCount !== 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onGenerateInvite(pool);
            }}
            style={{
              background: 'none', border: 'none', color: 'var(--accent)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 600, padding: 0
            }}
          >
            <Link size={12} /> Invite
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Pool Modal ─────────────────────────────────────────────────────────

interface CreatePoolModalProps {
  onClose: () => void;
  onCreate: (name: string) => void;
}

function CreatePoolModal({ onClose, onCreate }: CreatePoolModalProps) {
  const [name, setName] = useState('');

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        style={{ width: 420, padding: 28 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dialog__title">Create Data Pool</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>
          A Data Pool is a collaborative encrypted vault shared with trusted members. You become the hub host — members will sync proposals through your cloud drive.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Pool name (e.g. Project Alpha)"
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); onClose(); } }}
            style={{
              background: 'var(--bg-overlay)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', padding: '10px 14px',
              borderRadius: 'var(--radius-sm)', fontSize: 14, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn btn--primary"
              disabled={!name.trim()}
              onClick={() => { if (name.trim()) { onCreate(name.trim()); onClose(); } }}
            >
              Create Pool
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main DataPool View ────────────────────────────────────────────────────────

export function DataPoolView() {
  const { dispatch } = useApp();
  const [pools, setPools] = useState<DataPool[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const mapTauriPoolToFrontend = (p: TauriDataPool): DataPool => ({
    id: p.id,
    name: p.name,
    ownerFp: p.owner_fp,
    isOwner: p.owner_fp === 'local-user',
    memberCount: p.members.length,
    totalSize: p.total_size,
    usedSize: p.used_size,
    hubFolderId: p.hub_folder_id,
    createdAt: p.created_at,
    status: p.status as 'online' | 'offline' | 'syncing'
  });

  const loadPools = async () => {
    try {
      const list = await poolApi.listPools();
      setPools(list.map(mapTauriPoolToFrontend));
    } catch (e: any) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadPools();
  }, []);

  const goBack = () => dispatch({ type: 'SET_VIEW', view: 'files' });

  const handleCreate = async (name: string) => {
    try {
      const dummyFolderId = 'gdrive_folder_' + Math.random().toString(36).substring(7);
      const newPool = await poolApi.createPool(name, dummyFolderId);
      setPools(prev => [mapTauriPoolToFrontend(newPool), ...prev]);
      showToast({ message: `Created pool: ${name}` });
    } catch (e: any) {
      showToast({ message: `Error creating pool: ${e?.message || String(e)}` });
    }
  };

  const handleJoinPrompt = async () => {
    const invite = prompt("Enter pool invite link (flashmesh://join-pool/...)");
    if (!invite) return;
    try {
      setSyncing(true);
      const joined = await poolApi.joinPoolFromInvite(invite);
      setPools(prev => [mapTauriPoolToFrontend(joined), ...prev]);
      showToast({ message: `Joined pool: ${joined.name}` });
    } catch (e: any) {
      showToast({ message: `Error joining pool: ${e?.message || String(e)}` });
    } finally {
      setSyncing(false);
    }
  };

  const handleGenerateInvite = async (pool: DataPool) => {
    try {
      const invite = await poolApi.generatePoolInvite(pool.id, pool.hubFolderId);
      await navigator.clipboard.writeText(invite);
      showToast({ message: "Invite link copied to clipboard!" });
    } catch (e: any) {
      showToast({ message: `Failed to copy invite: ${e}` });
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Outpost Model: Hub owners process members' concurrent upload/join proposals in Rust.
      // Create mock proposals to simulate active member uploads & joins.
      const mockProposals = [
        {
          proposal_id: 'prop-join-8',
          member_fp: 'remote-fp-99',
          action: 'join',
          payload: {
            nickname: 'Developer Dhanush',
            fingerprint: 'remote-fp-99',
            quota_bytes: 8 * 1024 * 1024 * 1024
          },
          timestamp: new Date().toISOString()
        },
        {
          proposal_id: 'prop-upload-12',
          member_fp: 'remote-fp-99',
          action: 'upload',
          payload: {
            id: 'file_mock_999_mesh',
            name: 'design_specs.pdf',
            path: 'mesh://team-space/design_specs.pdf',
            isDir: false,
            size: 45 * 1024 * 1024,
            modified: new Date().toISOString(),
            extension: 'pdf'
          },
          timestamp: new Date().toISOString()
        }
      ];

      for (const pool of pools) {
        if (pool.isOwner) {
          const [_, result] = await poolApi.processPoolInbox(pool.id, mockProposals, '');
          if (result.errors.length > 0) {
            console.warn("Proposal errors during sync:", result.errors);
          }
        }
      }

      await loadPools();
      showToast({ message: "Data Pools synced successfully!" });
    } catch (e: any) {
      showToast({ message: `Sync failed: ${e?.message || String(e)}` });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--glass-bg)', backdropFilter: 'blur(20px)',
        gap: 16,
      }}>
        {/* Back button */}
        <button
          onClick={goBack}
          className="toolbar__btn"
          title="Back to Files"
          style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} />
          <span style={{ display: 'var(--hide-on-mobile, inline)' }}>Files</span>
        </button>

        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Database size={18} color="var(--accent)" /> Data Pools
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Collaborative encrypted vaults — Mesh Outpost Model
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            className="btn btn--secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            onClick={handleJoinPrompt}
          >
            <Link size={13} /> Join Pool
          </button>
          <button
            className="btn btn--secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            className="btn btn--primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            onClick={() => setShowCreate(true)}
          >
            <Plus size={13} /> New Pool
          </button>
        </div>
      </div>

      {/* Pool Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {pools.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 80, color: 'var(--text-muted)' }}>
            <Database size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
            <p style={{ fontSize: 15, fontWeight: 500 }}>No Data Pools yet</p>
            <p style={{ fontSize: 13, marginTop: 8, opacity: 0.7 }}>Create a pool and invite members to start sharing files securely.</p>
            <button className="btn btn--primary" style={{ marginTop: 24 }} onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Create your first pool
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {pools.map(pool => (
              <DataPoolCard
                key={pool.id}
                pool={pool}
                onOpen={() => {}}
                onGenerateInvite={handleGenerateInvite}
              />
            ))}
          </div>
        )}

        {/* Info banner */}
        <div style={{
          marginTop: 32, padding: 20, borderRadius: 'var(--radius-lg)',
          background: 'var(--accent-muted)', border: '1px solid var(--border-active)',
          display: 'flex', gap: 14, alignItems: 'flex-start',
        }}>
          <Link size={18} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>How Data Pools work</div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              The pool host (hub owner) provides a Google Drive folder as the coordination hub. Members upload encrypted chunks to their own drives and drop proposals to the hub's inbox. The hub owner's client processes proposals, updates the master manifest, and publishes it — enabling zero-conflict concurrent editing across all members.
            </p>
          </div>
        </div>
      </div>

      {showCreate && <CreatePoolModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
