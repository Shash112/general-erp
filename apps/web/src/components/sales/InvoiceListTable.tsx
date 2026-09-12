import React from 'react';

export interface SalesInvoiceSummary {
  id: string;
  invoiceNumber: string;
  salesOrderNumber?: string | null;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'CANCELLED' | 'REVERSED';
  lineCount: number;
}

interface InvoiceListTableProps {
  invoices: SalesInvoiceSummary[];
  onSelectInvoice: (id: string) => void;
  selectedInvoiceId?: string | undefined;
}

export const InvoiceListTable: React.FC<InvoiceListTableProps> = ({
  invoices,
  onSelectInvoice,
  selectedInvoiceId
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
      case 'PARTIALLY_SETTLED':
        return { bg: '#fef3c7', fg: '#b45309' };
      case 'SETTLED':
        return { bg: '#d1fae5', fg: '#047857' };
      case 'CANCELLED':
      case 'REVERSED':
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
            <th style={{ padding: '12px 16px' }}>Invoice No</th>
            <th style={{ padding: '12px 16px' }}>Order Ref</th>
            <th style={{ padding: '12px 16px' }}>Date</th>
            <th style={{ padding: '12px 16px', textAlign: 'right' }}>Total Amount</th>
            <th style={{ padding: '12px 16px' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                No sales invoices found.
              </td>
            </tr>
          ) : (
            invoices.map(inv => {
              const badge = getStatusBadgeStyle(inv.status);
              const isSelected = inv.id === selectedInvoiceId;
              return (
                <tr
                  key={inv.id}
                  onClick={() => onSelectInvoice(inv.id)}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer',
                    background: isSelected ? '#f0f9ff' : 'transparent',
                    transition: 'background 0.15s ease'
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                    {inv.invoiceNumber}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {inv.salesOrderNumber || 'Standalone'}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>
                    {inv.invoiceDate}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                    ₹{parseFloat(inv.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                      {inv.status}
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
