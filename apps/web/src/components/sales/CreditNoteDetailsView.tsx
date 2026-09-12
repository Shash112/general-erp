import React, { useState } from 'react';

export interface SalesCreditNoteLineItem {
  id: string;
  lineNumber: number;
  originalInvoiceLineId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  uom: string;
  returnedQuantity: string;
  unitPrice: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
}

export interface FullSalesCreditNote {
  id: string;
  creditNoteNumber: string;
  originalSalesInvoiceId: string;
  originalInvoiceNumberSnapshot: string;
  customerId: string;
  creditNoteDate: string;
  reason: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  subtotalAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  totalAmount: string;
  arDocumentId?: string | null;
  arAllocationId?: string | null;
  journalEntryId?: string | null;
  postedAt?: Date | string | null;
  notes?: string | null;
  lines: SalesCreditNoteLineItem[];
}

interface CreditNoteDetailsViewProps {
  creditNote: FullSalesCreditNote;
  onPost?: () => Promise<void>;
  onCancel?: (reason: string) => Promise<void>;
  onClose?: () => void;
}

export const CreditNoteDetailsView: React.FC<CreditNoteDetailsViewProps> = ({
  creditNote,
  onPost,
  onCancel,
  onClose
}) => {
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  const handlePost = async () => {
    if (!onPost) return;
    setIsPosting(true);
    try {
      await onPost();
    } finally {
      setIsPosting(false);
    }
  };

  const handleCancelSubmit = async () => {
    if (!cancelReason.trim() || !onCancel) return;
    try {
      await onCancel(cancelReason);
      setShowCancelModal(false);
    } catch (err: any) {
      alert(err.message || 'Failed to cancel credit note');
    }
  };

  const isPosted = creditNote.status === 'POSTED';

  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>{creditNote.creditNoteNumber}</h2>
            <span style={{
              fontSize: '12px',
              fontWeight: 600,
              color: isPosted ? '#15803d' : '#64748b',
              background: isPosted ? '#dcfce7' : '#f1f5f9',
              padding: '2px 8px',
              borderRadius: '4px'
            }}>
              {creditNote.status}
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
            Original Invoice: <strong>{creditNote.originalInvoiceNumberSnapshot}</strong> | Date: {creditNote.creditNoteDate}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!isPosted && creditNote.status !== 'CANCELLED' && onPost && (
            <button
              onClick={handlePost}
              disabled={isPosting}
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
              {isPosting ? 'Posting...' : 'Post Credit Note & AR Reversal'}
            </button>
          )}

          {!isPosted && creditNote.status !== 'CANCELLED' && onCancel && (
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
              Cancel Draft
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

      {isPosted && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', fontSize: '12px', color: '#166534' }}>
          <strong>Posted Financial Controls:</strong> AR Credit Doc: <code>{creditNote.arDocumentId}</code> | AR Allocation: <code>{creditNote.arAllocationId}</code> | GL Reversal Journal: <code>{creditNote.journalEntryId}</code>
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#0f172a' }}>Credit Note Reversal Items</h3>
        <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                <th style={{ padding: '10px 14px', width: '40px' }}>#</th>
                <th style={{ padding: '10px 14px' }}>Product</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>UOM</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Credited Qty</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Unit Price</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Taxable</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Tax Reversal</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Total Credit</th>
              </tr>
            </thead>
            <tbody>
              {creditNote.lines.map((line) => (
                <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{line.lineNumber}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{line.productNameSnapshot}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Code: {line.productCodeSnapshot}</div>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: '#475569' }}>{line.uom}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                    {parseFloat(line.returnedQuantity).toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>
                    ₹{parseFloat(line.unitPrice).toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>
                    ₹{parseFloat(line.taxableAmount).toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#0284c7' }}>
                    ₹{parseFloat(line.taxAmount).toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                    ₹{parseFloat(line.lineTotal).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
        <div style={{ width: '280px', background: '#f8fafc', padding: '12px 16px', borderRadius: '6px', fontSize: '13px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span>Taxable Credit:</span>
            <span>₹{parseFloat(creditNote.taxableAmount).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: '#0284c7' }}>
            <span>GST Reversal:</span>
            <span>₹{parseFloat(creditNote.taxAmount).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '15px', color: '#dc2626', borderTop: '1px solid #e2e8f0', paddingTop: '6px' }}>
            <span>Total Credit Amount:</span>
            <span>₹{parseFloat(creditNote.totalAmount).toFixed(2)}</span>
          </div>
        </div>
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
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Cancel Draft Credit Note</h3>
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
