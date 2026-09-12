import React, { useState } from 'react';
import { CreditNoteListTable, SalesCreditNoteSummary } from './CreditNoteListTable.js';
import { CreditNoteDetailsView, FullSalesCreditNote } from './CreditNoteDetailsView.js';

interface SalesCreditNoteHubProps {
  creditNotes: FullSalesCreditNote[];
  onPostCreditNote: (id: string) => Promise<void>;
  onCancelCreditNote: (id: string, reason: string) => Promise<void>;
}

export const SalesCreditNoteHub: React.FC<SalesCreditNoteHubProps> = ({
  creditNotes,
  onPostCreditNote,
  onCancelCreditNote
}) => {
  const [selectedCreditNoteId, setSelectedCreditNoteId] = useState<string | undefined>(creditNotes[0]?.id);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredNotes = creditNotes.filter(cn => {
    if (statusFilter !== 'ALL' && cn.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !cn.creditNoteNumber.toLowerCase().includes(s) &&
        !cn.originalInvoiceNumberSnapshot.toLowerCase().includes(s)
      ) {
        return false;
      }
    }
    return true;
  });

  const selectedCreditNote = creditNotes.find(cn => cn.id === selectedCreditNoteId);

  const summaries: SalesCreditNoteSummary[] = filteredNotes.map(cn => ({
    id: cn.id,
    creditNoteNumber: cn.creditNoteNumber,
    originalInvoiceNumberSnapshot: cn.originalInvoiceNumberSnapshot,
    customerId: cn.customerId,
    creditNoteDate: cn.creditNoteDate,
    totalAmount: cn.totalAmount,
    status: cn.status,
    lineCount: cn.lines.length
  }));

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#0f172a' }}>Sales Credit Notes & AR Reversal Workbench</h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Post sales credit notes, trigger AR credit allocations, and record GL revenue & tax reversals.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search by credit note or invoice number..."
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
          <option value="POSTED">POSTED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedCreditNote ? '1fr 1fr' : '1fr', gap: '20px' }}>
        <div>
          <CreditNoteListTable
            creditNotes={summaries}
            onSelectCreditNote={id => setSelectedCreditNoteId(id)}
            selectedCreditNoteId={selectedCreditNoteId}
          />
        </div>

        {selectedCreditNote && (
          <div>
            <CreditNoteDetailsView
              creditNote={selectedCreditNote}
              onPost={() => onPostCreditNote(selectedCreditNote.id)}
              onCancel={reason => onCancelCreditNote(selectedCreditNote.id, reason)}
              onClose={() => setSelectedCreditNoteId(undefined)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
