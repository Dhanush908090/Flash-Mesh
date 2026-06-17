import React from 'react';
import { Cpu, Zap, Activity, ShieldCheck, Heart } from 'lucide-react';

export function PetView() {
  return (
    <div className="pet-view" style={{ 
      height: '100%', 
      background: 'linear-gradient(180deg, #031021 0%, #07051a 100%)',
      display: 'flex',
      flexDirection: 'column',
      padding: 24,
      overflowY: 'auto',
      color: '#dff9ff',
      fontFamily: "'Roboto Mono', monospace"
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ 
            fontFamily: "'Orbitron', sans-serif", 
            fontSize: 24, 
            margin: 0, 
            color: '#4ee7f0',
            textShadow: '0 0 20px rgba(78,231,240,0.4)'
          }}>PET AI <span style={{ color: '#8e6bff' }}>v2.1</span></h1>
          <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: 12 }}>NEURAL INTERFACE CONNECTED</p>
        </div>
        <div style={{ padding: '8px 16px', borderRadius: 20, background: 'rgba(78,231,240,0.1)', border: '1px solid rgba(78,231,240,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ee7f0', boxShadow: '0 0 8px #4ee7f0' }} />
          <span style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1 }}>ONLINE</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <StatCard icon={<Cpu size={20} />} label="CORE SYNC" value="98.4%" color="#4ee7f0" />
        <StatCard icon={<Zap size={20} />} label="ENERGY" value="82.1%" color="#fbbf24" />
        <StatCard icon={<Activity size={20} />} label="NEURAL" value="STABLE" color="#8e6bff" />
        <StatCard icon={<ShieldCheck size={20} />} label="SECURITY" value="ACTIVE" color="#10b981" />
      </div>

      <div style={{ 
        flex: 1, 
        background: 'rgba(255,255,255,0.02)', 
        border: '1px solid rgba(255,255,255,0.05)', 
        borderRadius: 24,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Animated Orbs */}
        <div style={{ 
           width: 120, height: 120, borderRadius: '50%', 
           background: 'radial-gradient(circle, #4ee7f0 0%, transparent 70%)',
           opacity: 0.3,
           position: 'absolute',
           filter: 'blur(40px)',
           animation: 'pulse 3s infinite ease-in-out'
        }} />
        
        <Heart size={64} color="#4ee7f0" style={{ marginBottom: 20, filter: 'drop-shadow(0 0 15px rgba(78,231,240,0.5))' }} />
        <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 18, marginBottom: 12 }}>Ready for Interaction</h2>
        <p style={{ opacity: 0.7, fontSize: 13, lineHeight: 1.6, maxWidth: 280 }}>
          Your AI Companion is synchronized with your local filesystem. Ask anything or explore your digital world together.
        </p>

        <button style={{ 
          marginTop: 32,
          background: 'linear-gradient(90deg, #4ee7f0, #8e6bff)',
          color: '#000',
          border: 'none',
          padding: '12px 32px',
          borderRadius: 12,
          fontWeight: 'bold',
          fontFamily: "'Orbitron', sans-serif",
          cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(78,231,240,0.3)'
        }}>
          INITIALIZE CHAT
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.5); opacity: 0.4; }
          100% { transform: scale(1); opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode, label: string, value: string, color: string }) {
  return (
    <div style={{ 
      padding: 16, 
      borderRadius: 16, 
      background: 'rgba(255,255,255,0.03)', 
      border: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }}>
      <div style={{ color, opacity: 0.8 }}>{icon}</div>
      <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 'bold', color }}>{value}</div>
    </div>
  );
}
