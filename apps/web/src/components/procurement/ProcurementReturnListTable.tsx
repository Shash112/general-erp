import React from 'react';

export interface ProcurementReturnItem {
  id: string;
  returnNumber: string;
  supplierId: string;
  supplierName?: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  returnDate: string;
  reason: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  debitNoteId?: string;
  createdAt: string;
}

interface ProcurementReturnListTableProps {
  returns: ProcurementReturnItem[];
  onSelectReturn: (ret: ProcurementReturnItem) => void;
  onCreateNew: () => void;
}

export const ProcurementReturnListTable: React.FC<ProcurementReturnListTableProps> = ({
  returns,
  onSelectReturn,
  onCreateNew,
}) => {
  const getStatusBadge = (status: ProcurementReturnItem['status']) => {
    switch (status) {
      case 'DRAFT':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#f3f4f6', color: '#4b5563' }}>Draft</span>;
      case 'SUBMITTED':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>Submitted</span>;
      case 'APPROVED':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>Approved</span>;
      case 'COMPLETED':
        return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: '#dcfce7', color: '#166534' }}>Completed</span>;
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
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', margin: 0 }}>Procurement Returns</h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '4px 0 0 0' }}>Manage commercial return claims for accepted receiving goods</p>
        </div>
        <button
          onClick={onCreateNew}
          style={{
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
            transition: 'all 0.2s ease',
          }}
        >
          + Create Procurement Return
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', color: '#4b5563', fontWeight: 600 }}>
              <th style={{ padding: '12px 16px' }}>Return Number</th>
              <th style={{ padding: '12px 16px' }}>Return Date</th>
              <th style={{ padding: '12px 16px' }}>Reason</th>
              <th style={{ padding: '12px 16px' }}>Total Amount</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px' }}>Linked Debit Note</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {returns.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                  No procurement returns found. Click "Create Procurement Return" to start.
                </td>
              </tr>
            ) : (
              returns.map((item) => (
                <tr
                  key={item.id}
                  style={{ borderBottom: '1px solid #f3f4f6', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: '#2563eb' }}>{item.returnNumber}</td>
                  <td style={{ padding: '14px 16px', color: '#374151' }}>{item.returnDate}</td>
                  <td style={{ padding: '14px 16px', color: '#4b5563', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.reason}</td>
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: '#111827' }}>₹{item.totalAmount}</td>
                  <td style={{ padding: '14px 16px' }}>{getStatusBadge(item.status)}</td>
                  <td style={{ padding: '14px 16px', color: '#6b7280' }}>
                    {item.debitNoteId ? (
                      <span style={{ color: '#059669', fontWeight: 600 }}>Linked</span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>None</span>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => onSelectReturn(item)}
                      style={{
                        background: '#eff6ff',
                        color: '#2563eb',
                        border: '1px solid #bfdbfe',
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
