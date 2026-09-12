import React from 'react';

export interface SalesCreditNoteSummary {
  id: string;
  creditNoteNumber: string;
  originalInvoiceNumberSnapshot: string;
  customerId: string;
  creditNoteDate: string;
  totalAmount: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  lineCount: number;
}

interface CreditNoteListTableProps {
  creditNotes: SalesCreditNoteSummary[];
  onSelectCreditNote: (id: string) => void;
  selectedCreditNoteId?: string | undefined;
}

export const CreditNoteListTable: React.FC<CreditNoteListTableProps> = ({
  creditNotes,
  onSelectCreditNote,
  selectedCreditNoteId
}) => {
  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return { bg: '#f1f5f9', fg: '#475569' };
      case 'SUBMITTED':
      case 'APPROVED':
        return { bg: '#e0f2fe', fg: '#0369a1' };
      case 'POSTED':
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
            <th style={{ padding: '12px 16px' }}>Credit Note No</th>
            <th style={{ padding: '12px 16px' }}>Invoice Ref</th>
            <th style={{ padding: '12px 16px' }}>Date</th>
            <th style={{ padding: '12px 16px', textAlign: 'right' }}>Credit Amount</th>
            <th style={{ padding: '12px 16px' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {creditNotes.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                No sales credit notes found.
              </td>
            </tr>
          ) : (
            creditNotes.map(cn => {
              const badge = getStatusBadgeStyle(cn.status);
              const isSelected = cn.id === selectedCreditNoteId;
              return (
                <tr
                  key={cn.id}
                  onClick={() => onSelectCreditNote(cn.id)}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer',
                    background: isSelected ? '#f0f9ff' : 'transparent',
                    transition: 'background 0.15s ease'
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                    {cn.creditNoteNumber}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {cn.originalInvoiceNumberSnapshot}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>
                    {cn.creditNoteDate}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                    ₹{parseFloat(cn.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                      {cn.status}
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
