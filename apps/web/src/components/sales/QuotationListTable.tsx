import React from 'react';

export interface QuotationListItem {
  id: string;
  quotationNumber: string;
  revisionNumber: number;
  customerName: string;
  quotationDate: string;
  validityDate: string;
  currency: string;
  totalAmount: string;
  status: string;
}

export interface QuotationListTableProps {
  quotations: QuotationListItem[];
  onSelectQuotation: (id: string) => void;
  onNewQuotation: () => void;
}

export function QuotationListTable({ quotations, onSelectQuotation, onNewQuotation }: QuotationListTableProps) {
  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'DRAFT': return { backgroundColor: '#f1f5f9', color: '#475569' };
      case 'PENDING_APPROVAL': return { backgroundColor: '#fef3c7', color: '#92400e' };
      case 'APPROVED': return { backgroundColor: '#dcfce7', color: '#166534' };
      case 'SENT': return { backgroundColor: '#e0f2fe', color: '#075985' };
      case 'ACCEPTED': return { backgroundColor: '#d1fae5', color: '#065f46' };
      case 'REJECTED': return { backgroundColor: '#fee2e2', color: '#991b1b' };
      case 'EXPIRED': return { backgroundColor: '#f3e8ff', color: '#6b21a8' };
      case 'REVISED': return { backgroundColor: '#ffedd5', color: '#9a3412' };
      case 'CANCELLED': return { backgroundColor: '#e2e8f0', color: '#64748b' };
      case 'CONVERTED': return { backgroundColor: '#ede9fe', color: '#5b21b6' };
      default: return { backgroundColor: '#f1f5f9', color: '#475569' };
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Sales Quotation Proposals</h2>
        <button
          type="button"
          onClick={onNewQuotation}
          style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
        >
          + Create New Quotation
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left', color: '#475569', borderBottom: '2px solid #e2e8f0' }}>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>Quote #</th>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>Rev</th>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>Customer</th>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>Date</th>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>Validity</th>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>Total Amount</th>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>Status</th>
            <th style={{ padding: '0.6rem', border: '1px solid #e2e8f0', textAlign: 'center' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {quotations.map((q) => {
            const badge = getStatusBadgeStyle(q.status);
            return (
              <tr key={q.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0', fontWeight: 600, color: '#2563eb' }}>{q.quotationNumber}</td>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0', textAlign: 'center' }}>{q.revisionNumber}</td>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>{q.customerName}</td>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>{q.quotationDate}</td>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>{q.validityDate}</td>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0', fontWeight: 600 }}>{q.currency} {q.totalAmount}</td>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0' }}>
                  <span style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, ...badge }}>
                    {q.status}
                  </span>
                </td>
                <td style={{ padding: '0.6rem', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => onSelectQuotation(q.id)}
                    style={{ backgroundColor: '#f1f5f9', color: '#1e293b', border: '1px solid #cbd5e1', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                  >
                    View / Manage
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default QuotationListTable;
