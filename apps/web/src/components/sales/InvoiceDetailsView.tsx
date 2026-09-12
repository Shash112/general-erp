import React, { useState } from 'react';
import { InvoiceLineTable, SalesInvoiceLineItem } from './InvoiceLineTable.js';

export interface FullSalesInvoice {
  id: string;
  invoiceNumber: string;
  salesOrderId?: string | null;
  salesOrderNumber?: string | null;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  billingAddressSnapshot: Record<string, any>;
  shippingAddressSnapshot: Record<string, any>;
  contactSnapshot?: Record<string, any> | null;
  notes?: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED' | 'REVERSED';
  subtotalAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  totalAmount: string;
  arDocumentId?: string | null;
  journalEntryId?: string | null;
  postedAt?: Date | string | null;
  lines: SalesInvoiceLineItem[];
}

interface InvoiceDetailsViewProps {
  invoice: FullSalesInvoice;
  onPost?: () => Promise<void>;
  onCancel?: (reason: string) => Promise<void>;
  onClose?: () => void;
}

export const InvoiceDetailsView: React.FC<InvoiceDetailsViewProps> = ({
  invoice,
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
      alert(err.message || 'Failed to cancel invoice');
    }
  };

  const isPosted = invoice.status === 'POSTED' || invoice.status === 'SETTLED' || invoice.status === 'PARTIALLY_SETTLED';

  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>{invoice.invoiceNumber}</h2>
            <span style={{
              fontSize: '12px',
              fontWeight: 600,
              color: isPosted ? '#15803d' : '#64748b',
              background: isPosted ? '#dcfce7' : '#f1f5f9',
              padding: '2px 8px',
              borderRadius: '4px'
            }}>
              {invoice.status}
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
            Order: <strong>{invoice.salesOrderNumber || 'N/A'}</strong> | Date: {invoice.invoiceDate} | Due: {invoice.dueDate}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!isPosted && invoice.status !== 'CANCELLED' && onPost && (
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
              {isPosting ? 'Posting...' : 'Post Invoice & AR'}
            </button>
          )}

          {!isPosted && invoice.status !== 'CANCELLED' && onCancel && (
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
          <strong>Posted Financial Controls:</strong> AR Document ID: <code>{invoice.arDocumentId}</code> | GL Journal Entry: <code>{invoice.journalEntryId}</code>
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#0f172a' }}>Invoice Line Items</h3>
        <InvoiceLineTable lines={invoice.lines} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
        <div style={{ width: '280px', background: '#f8fafc', padding: '12px 16px', borderRadius: '6px', fontSize: '13px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span>Subtotal:</span>
            <span>₹{parseFloat(invoice.subtotalAmount).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span>Taxable Amount:</span>
            <span>₹{parseFloat(invoice.taxableAmount).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: '#0284c7' }}>
            <span>GST Amount:</span>
            <span>₹{parseFloat(invoice.taxAmount).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '15px', color: '#0f172a', borderTop: '1px solid #e2e8f0', paddingTop: '6px' }}>
            <span>Total Amount:</span>
            <span>₹{parseFloat(invoice.totalAmount).toFixed(2)}</span>
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
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Cancel Draft Sales Invoice</h3>
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
