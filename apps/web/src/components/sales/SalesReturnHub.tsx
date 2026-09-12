import React, { useState } from 'react';
import { ReturnListTable, SalesReturnSummary } from './ReturnListTable.js';
import { ReturnDetailsView, FullSalesReturn } from './ReturnDetailsView.js';

interface SalesReturnHubProps {
  returns: FullSalesReturn[];
  onSubmitReturn: (id: string) => Promise<void>;
  onApproveReturn: (id: string) => Promise<void>;
  onCreateCreditNote: (returnId: string) => Promise<void>;
  onCancelReturn: (id: string, reason: string) => Promise<void>;
}

export const SalesReturnHub: React.FC<SalesReturnHubProps> = ({
  returns,
  onSubmitReturn,
  onApproveReturn,
  onCreateCreditNote,
  onCancelReturn
}) => {
  const [selectedReturnId, setSelectedReturnId] = useState<string | undefined>(returns[0]?.id);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredReturns = returns.filter(ret => {
    if (statusFilter !== 'ALL' && ret.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!ret.returnNumber.toLowerCase().includes(s) && !ret.reason.toLowerCase().includes(s)) {
        return false;
      }
    }
    return true;
  });

  const selectedReturn = returns.find(ret => ret.id === selectedReturnId);

  const returnSummaries: SalesReturnSummary[] = filteredReturns.map(ret => ({
    id: ret.id,
    returnNumber: ret.returnNumber,
    originalSalesInvoiceId: ret.originalSalesInvoiceId,
    customerId: ret.customerId,
    returnDate: ret.returnDate,
    reason: ret.reason,
    status: ret.status,
    lineCount: ret.lines.length
  }));

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#0f172a' }}>Sales Returns Workbench</h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Process commercial return requests, manage return approvals, and initiate credit note generation.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search by return number or reason..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '300px', fontSize: '13px' }}
        />

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="SUBMITTED">SUBMITTED</option>
          <option value="APPROVED">APPROVED</option>
          <option value="CREDIT_NOTE_CREATED">CREDIT_NOTE_CREATED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedReturn ? '1fr 1fr' : '1fr', gap: '20px' }}>
        <div>
          <ReturnListTable
            returns={returnSummaries}
            onSelectReturn={id => setSelectedReturnId(id)}
            selectedReturnId={selectedReturnId}
          />
        </div>

        {selectedReturn && (
          <div>
            <ReturnDetailsView
              salesReturn={selectedReturn}
              onSubmit={() => onSubmitReturn(selectedReturn.id)}
              onApprove={() => onApproveReturn(selectedReturn.id)}
              onCreateCreditNote={() => onCreateCreditNote(selectedReturn.id)}
              onCancel={reason => onCancelReturn(selectedReturn.id, reason)}
              onClose={() => setSelectedReturnId(undefined)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
