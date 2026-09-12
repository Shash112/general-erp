import React, { useState } from 'react';
import { ReturnLineTable, SalesReturnLineItem } from './ReturnLineTable.js';

export interface FullSalesReturn {
  id: string;
  returnNumber: string;
  customerId: string;
  originalSalesInvoiceId: string;
  returnDate: string;
  reason: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CREDIT_NOTE_CREATED' | 'CANCELLED';
  notes?: string | null;
  lines: SalesReturnLineItem[];
}

interface ReturnDetailsViewProps {
  salesReturn: FullSalesReturn;
  onSubmit?: () => Promise<void>;
  onApprove?: () => Promise<void>;
  onCreateCreditNote?: () => Promise<void>;
  onCancel?: (reason: string) => Promise<void>;
  onClose?: () => void;
}

export const ReturnDetailsView: React.FC<ReturnDetailsViewProps> = ({
  salesReturn,
  onSubmit,
  onApprove,
  onCreateCreditNote,
  onCancel,
  onClose
}) => {
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (actionFn?: () => Promise<void>) => {
    if (!actionFn) return;
    setIsProcessing(true);
    try {
      await actionFn();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelSubmit = async () => {
    if (!cancelReason.trim() || !onCancel) return;
    try {
      await onCancel(cancelReason);
      setShowCancelModal(false);
    } catch (err: any) {
      alert(err.message || 'Failed to cancel sales return');
    }
  };

  const isApproved = salesReturn.status === 'APPROVED' || salesReturn.status === 'CREDIT_NOTE_CREATED';

  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>{salesReturn.returnNumber}</h2>
            <span style={{
              fontSize: '12px',
              fontWeight: 600,
              color: isApproved ? '#15803d' : '#64748b',
              background: isApproved ? '#dcfce7' : '#f1f5f9',
              padding: '2px 8px',
              borderRadius: '4px'
            }}>
              {salesReturn.status}
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
            Date: {salesReturn.returnDate} | Reason: <strong>{salesReturn.reason}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {salesReturn.status === 'DRAFT' && onSubmit && (
            <button
              onClick={() => handleAction(onSubmit)}
              disabled={isProcessing}
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
              {isProcessing ? 'Submitting...' : 'Submit Return'}
            </button>
          )}

          {(salesReturn.status === 'SUBMITTED' || salesReturn.status === 'DRAFT') && onApprove && (
            <button
              onClick={() => handleAction(onApprove)}
              disabled={isProcessing}
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
              {isProcessing ? 'Approving...' : 'Approve Return'}
            </button>
          )}

          {salesReturn.status === 'APPROVED' && onCreateCreditNote && (
            <button
              onClick={() => handleAction(onCreateCreditNote)}
              disabled={isProcessing}
              style={{
                padding: '6px 14px',
                borderRadius: '4px',
                background: '#8b5cf6',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              {isProcessing ? 'Creating...' : 'Create Credit Note'}
            </button>
          )}

          {salesReturn.status !== 'CREDIT_NOTE_CREATED' && salesReturn.status !== 'CANCELLED' && onCancel && (
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
              Cancel Return
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#0f172a' }}>Return Line Items</h3>
        <ReturnLineTable lines={salesReturn.lines} />
      </div>

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
          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '8px', width: '400px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Cancel Sales Return</h3>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation..."
              rows={3}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowCancelModal(false)} style={{ padding: '6px 12px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '12px' }}>
                Close
              </button>
              <button onClick={handleCancelSubmit} style={{ padding: '6px 12px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: '12px' }}>
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
