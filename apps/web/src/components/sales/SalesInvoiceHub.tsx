import React, { useState } from 'react';
import { InvoiceListTable, SalesInvoiceSummary } from './InvoiceListTable.js';
import { InvoiceDetailsView, FullSalesInvoice } from './InvoiceDetailsView.js';

interface SalesInvoiceHubProps {
  invoices: FullSalesInvoice[];
  onPostInvoice: (id: string) => Promise<void>;
  onCancelInvoice: (id: string, reason: string) => Promise<void>;
}

export const SalesInvoiceHub: React.FC<SalesInvoiceHubProps> = ({
  invoices,
  onPostInvoice,
  onCancelInvoice
}) => {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | undefined>(invoices[0]?.id);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredInvoices = invoices.filter(inv => {
    if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !inv.invoiceNumber.toLowerCase().includes(s) &&
        (!inv.salesOrderNumber || !inv.salesOrderNumber.toLowerCase().includes(s))
      ) {
        return false;
      }
    }
    return true;
  });

  const selectedInvoice = invoices.find(inv => inv.id === selectedInvoiceId);

  const invoiceSummaries: SalesInvoiceSummary[] = filteredInvoices.map(inv => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    salesOrderNumber: inv.salesOrderNumber,
    customerId: inv.customerId,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    totalAmount: inv.totalAmount,
    status: inv.status,
    lineCount: inv.lines.length
  }));

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#0f172a' }}>Sales Invoicing & AR Workbench</h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Generate tax invoices, manage AR postings, and trigger AccountingCore GL journals.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search by invoice or order number..."
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
          <option value="PARTIALLY_SETTLED">PARTIALLY_SETTLED</option>
          <option value="SETTLED">SETTLED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedInvoice ? '1fr 1fr' : '1fr', gap: '20px' }}>
        <div>
          <InvoiceListTable
            invoices={invoiceSummaries}
            onSelectInvoice={id => setSelectedInvoiceId(id)}
            selectedInvoiceId={selectedInvoiceId}
          />
        </div>

        {selectedInvoice && (
          <div>
            <InvoiceDetailsView
              invoice={selectedInvoice}
              onPost={() => onPostInvoice(selectedInvoice.id)}
              onCancel={reason => onCancelInvoice(selectedInvoice.id, reason)}
              onClose={() => setSelectedInvoiceId(undefined)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
