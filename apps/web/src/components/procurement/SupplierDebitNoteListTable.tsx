import React from 'react';

export interface SupplierDebitNoteItem {
  id: string;
  debitNoteNumber: string;
  supplierId: string;
  procurementReturnId?: string;
  originalSupplierBillId?: string;
  debitNoteDate: string;
  reason: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  apDocumentId?: string;
  journalEntryId?: string;
  createdAt: string;
}

interface SupplierDebitNoteListTableProps {
  debitNotes: SupplierDebitNoteItem[];
  onSelectDebitNote: (dn: SupplierDebitNoteItem) => void;
  onCreateNew: () => void;
}

export const SupplierDebitNoteListTable: React.FC<SupplierDebitNoteListTableProps> = ({
  debitNotes,
  onSelectDebitNote,
  onCreateNew,
}) => {
  const getStatusBadge = (status: SupplierDebitNoteItem['status']) => {
    switch (status) {
      case 'DRAFT':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#f3f4f6', color: '#4b5563' }}>Draft</span>;
      case 'APPROVED':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>Approved</span>;
      case 'POSTED':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#dcfce7', color: '#166534' }}>Posted</span>;
      case 'CANCELLED':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#fee2e2', color: '#991b1b' }}>Cancelled</span>;
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', margin: 0 }}>Supplier Debit Notes</h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '4px 0 0 0' }}>Financial AP liability adjustments against supplier returns</p>
        </div>
        <button
          onClick={onCreateNew}
          style={{
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(5, 150, 105, 0.2)',
          }}
        >
          + Create Debit Note
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', color: '#4b5563', fontWeight: 600 }}>
              <th style={{ padding: '12px 16px' }}>Debit Note #</th>
              <th style={{ padding: '12px 16px' }}>Date</th>
              <th style={{ padding: '12px 16px' }}>Reason</th>
              <th style={{ padding: '12px 16px' }}>Total Claim (₹)</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px' }}>AP Document</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {debitNotes.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                  No supplier debit notes found. Click "Create Debit Note" to issue a claim.
                </td>
              </tr>
            ) : (
              debitNotes.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: '#059669' }}>{item.debitNoteNumber}</td>
                  <td style={{ padding: '14px 16px', color: '#374151' }}>{item.debitNoteDate}</td>
                  <td style={{ padding: '14px 16px', color: '#4b5563' }}>{item.reason}</td>
                  <td style={{ padding: '14px 16px', fontWeight: 700, color: '#111827' }}>₹{item.totalAmount}</td>
                  <td style={{ padding: '14px 16px' }}>{getStatusBadge(item.status)}</td>
                  <td style={{ padding: '14px 16px', color: '#6b7280' }}>{item.apDocumentId ? 'Linked' : 'None'}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => onSelectDebitNote(item)}
                      style={{
                        background: '#ecfdf5',
                        color: '#059669',
                        border: '1px solid #a7f3d0',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
