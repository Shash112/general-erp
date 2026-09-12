import React from 'react';

export interface SalesReturnSummary {
  id: string;
  returnNumber: string;
  originalSalesInvoiceId: string;
  customerId: string;
  returnDate: string;
  reason: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CREDIT_NOTE_CREATED' | 'CANCELLED';
  lineCount: number;
}

interface ReturnListTableProps {
  returns: SalesReturnSummary[];
  onSelectReturn: (id: string) => void;
  selectedReturnId?: string | undefined;
}

export const ReturnListTable: React.FC<ReturnListTableProps> = ({
  returns,
  onSelectReturn,
  selectedReturnId
}) => {
  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return { bg: '#f1f5f9', fg: '#475569' };
      case 'SUBMITTED':
        return { bg: '#e0f2fe', fg: '#0369a1' };
      case 'APPROVED':
        return { bg: '#fef3c7', fg: '#b45309' };
      case 'CREDIT_NOTE_CREATED':
        return { bg: '#dcfce7', fg: '#15803d' };
      case 'CANCELLED':
        return { bg: '#fee2e2', fg: '#b91c1c' };
      default:
        return { bg: '#f1f5f9', fg: '#475569' };
    }
  };

  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
            <th style={{ padding: '12px 16px' }}>Return No</th>
            <th style={{ padding: '12px 16px' }}>Date</th>
            <th style={{ padding: '12px 16px' }}>Reason</th>
            <th style={{ padding: '12px 16px', textAlign: 'center' }}>Lines</th>
            <th style={{ padding: '12px 16px' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {returns.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                No sales returns found.
              </td>
            </tr>
          ) : (
            returns.map(ret => {
              const badge = getStatusBadgeStyle(ret.status);
              const isSelected = ret.id === selectedReturnId;
              return (
                <tr
                  key={ret.id}
                  onClick={() => onSelectReturn(ret.id)}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer',
                    background: isSelected ? '#f0f9ff' : 'transparent',
                    transition: 'background 0.15s ease'
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                    {ret.returnNumber}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>
                    {ret.returnDate}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {ret.reason}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: '#475569' }}>
                    {ret.lineCount}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: badge.bg,
                        color: badge.fg
                      }}
                    >
                      {ret.status}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
