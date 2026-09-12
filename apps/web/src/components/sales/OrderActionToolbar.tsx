import React, { useState } from 'react';

interface OrderActionToolbarProps {
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  onConfirm: (overrideReason?: string) => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
  disabled?: boolean;
}

export const OrderActionToolbar: React.FC<OrderActionToolbarProps> = ({
  status,
  onConfirm,
  onCancel,
  disabled = false
}) => {
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(false);

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'DRAFT': return { bg: '#e2e8f0', fg: '#475569' };
      case 'CONFIRMED': return { bg: '#dbeafe', fg: '#1e40af' };
      case 'COMPLETED': return { bg: '#dcfce7', fg: '#166534' };
      case 'CANCELLED': return { bg: '#fee2e2', fg: '#991b1b' };
      default: return { bg: '#f1f5f9', fg: '#334155' };
    }
  };

  const color = getStatusColor(status);

  const handleNormalConfirm = async () => {
    try {
      setLoading(true);
      await onConfirm();
    } catch (err: any) {
      if (err.message && err.message.includes('CREDIT_LIMIT_EXCEEDED')) {
        setShowOverrideModal(true);
      } else {
        alert(err.message || 'Confirmation failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOverrideConfirmSubmit = async () => {
    if (!overrideReason.trim()) {
      alert('Credit override reason is mandatory when credit limit is exceeded.');
      return;
    }
    try {
      setLoading(true);
      await onConfirm(overrideReason);
      setShowOverrideModal(false);
    } catch (err: any) {
      alert(err.message || 'Credit override confirmation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubmit = async () => {
    if (!cancelReason.trim()) {
      alert('Cancellation reason is required.');
      return;
    }
    try {
      setLoading(true);
      await onCancel(cancelReason);
      setShowCancelModal(false);
    } catch (err: any) {
      alert(err.message || 'Cancellation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', borderRadius: '6px 6px 0 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Order State:</span>
        <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, backgroundColor: color.bg, color: color.fg }}>
          {status}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {status === 'DRAFT' && (
          <button
            onClick={handleNormalConfirm}
            disabled={disabled || loading}
            style={{ padding: '6px 16px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
          >
            {loading ? 'Confirming...' : 'Confirm Order'}
          </button>
        )}

        {(status === 'DRAFT' || status === 'CONFIRMED') && (
          <button
            onClick={() => setShowCancelModal(true)}
            disabled={disabled || loading}
            style={{ padding: '6px 16px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
          >
            Cancel Order
          </button>
        )}
      </div>

      {showOverrideModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '8px', width: '400px' }}>
            <h3 style={{ marginTop: 0, color: '#dc2626' }}>Credit Limit Exceeded</h3>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              This customer has exceeded their credit limit. To proceed with order confirmation, a valid credit override reason is required.
            </p>
            <textarea
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder="Enter mandatory credit override reason..."
              style={{ width: '100%', height: '80px', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowOverrideModal(false)} style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px' }}>Cancel</button>
              <button onClick={handleOverrideConfirmSubmit} disabled={loading} style={{ padding: '6px 12px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px' }}>
                Confirm With Override
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '8px', width: '400px' }}>
            <h3 style={{ marginTop: 0, color: '#dc2626' }}>Cancel Sales Order</h3>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              Please provide a cancellation reason.
            </p>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Enter cancellation reason..."
              style={{ width: '100%', height: '80px', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowCancelModal(false)} style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px' }}>Close</button>
              <button onClick={handleCancelSubmit} disabled={loading} style={{ padding: '6px 12px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px' }}>
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
