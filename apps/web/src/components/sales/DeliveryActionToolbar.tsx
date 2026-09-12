import React, { useState } from 'react';

interface DeliveryActionToolbarProps {
  status: 'DRAFT' | 'PICKED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  onPick?: () => Promise<void>;
  onPack?: () => Promise<void>;
  onDispatch?: () => Promise<void>;
  onDeliver?: () => Promise<void>;
  onCancel?: (reason: string) => Promise<void>;
}

export const DeliveryActionToolbar: React.FC<DeliveryActionToolbarProps> = ({
  status,
  onPick,
  onPack,
  onDispatch,
  onDeliver,
  onCancel
}) => {
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCancelSubmit = async () => {
    if (!cancelReason.trim() || !onCancel) return;
    setIsSubmitting(true);
    try {
      await onCancel(cancelReason);
      setShowCancelModal(false);
      setCancelReason('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      {status === 'DRAFT' && onPick && (
        <button
          onClick={onPick}
          style={{
            padding: '6px 14px',
            borderRadius: '4px',
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          Mark Picked
        </button>
      )}

      {(status === 'DRAFT' || status === 'PICKED') && onPack && (
        <button
          onClick={onPack}
          style={{
            padding: '6px 14px',
            borderRadius: '4px',
            background: '#d97706',
            color: '#ffffff',
            border: 'none',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          Mark Packed
        </button>
      )}

      {(status === 'DRAFT' || status === 'PICKED' || status === 'PACKED') && onDispatch && (
        <button
          onClick={onDispatch}
          style={{
            padding: '6px 14px',
            borderRadius: '4px',
            background: '#7c3aed',
            color: '#ffffff',
            border: 'none',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          Dispatch Shipment
        </button>
      )}

      {status === 'DISPATCHED' && onDeliver && (
        <button
          onClick={onDeliver}
          style={{
            padding: '6px 14px',
            borderRadius: '4px',
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          Mark Delivered
        </button>
      )}

      {status !== 'DELIVERED' && status !== 'DISPATCHED' && status !== 'CANCELLED' && onCancel && (
        <button
          onClick={() => setShowCancelModal(true)}
          style={{
            padding: '6px 14px',
            borderRadius: '4px',
            background: '#ef4444',
            color: '#ffffff',
            border: 'none',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          Cancel Delivery
        </button>
      )}

      {showCancelModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#ffffff',
            padding: '24px',
            borderRadius: '8px',
            width: '400px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#0f172a' }}>Cancel Sales Delivery</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b' }}>
              Please provide a reason for cancelling this delivery. Releasing allocated delivery quantities back to order lines.
            </p>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation..."
              rows={3}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                marginBottom: '16px'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={isSubmitting}
                style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '12px' }}
              >
                Close
              </button>
              <button
                onClick={handleCancelSubmit}
                disabled={isSubmitting || !cancelReason.trim()}
                style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: '12px' }}
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
