import React, { useState } from 'react';

export interface SupplierBillListItem {
  id: string;
  billNumber: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  supplierName?: string;
  supplierId: string;
  poNumber?: string;
  grnNumber?: string;
  billDate: string;
  dueDate: string;
  grandTotal: string;
  currency: string;
  matchStatus: 'UNMATCHED' | 'MATCHING' | 'MATCHED' | 'EXCEPTION' | 'RESOLVED';
  status: 'DRAFT' | 'SUBMITTED' | 'MATCHED' | 'MATCH_EXCEPTION' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  apDocumentId?: string | null;
  journalEntryId?: string | null;
  createdAt: string;
}

interface SupplierBillListTableProps {
  bills: SupplierBillListItem[];
  onSelectBill: (id: string) => void;
  onNewBill: () => void;
}

export const SupplierBillListTable: React.FC<SupplierBillListTableProps> = ({
  bills,
  onSelectBill,
  onNewBill,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>('ALL');

  const filtered = bills.filter((item) => {
    const matchesSearch =
      item.billNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.supplierInvoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.supplierName && item.supplierName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.poNumber && item.poNumber.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    const matchesMatchStatus = matchStatusFilter === 'ALL' || item.matchStatus === matchStatusFilter;

    return matchesSearch && matchesStatus && matchesMatchStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700 text-slate-300">Draft</span>;
      case 'MATCHED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">Matched</span>;
      case 'MATCH_EXCEPTION':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-rose-950 text-rose-400 border border-rose-800">Match Exception</span>;
      case 'APPROVED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-950 text-indigo-400 border border-indigo-800">Approved</span>;
      case 'POSTED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">Posted</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-800 text-slate-500">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700 text-slate-300">{status}</span>;
    }
  };

  const getMatchBadge = (status: string) => {
    switch (status) {
      case 'UNMATCHED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-800 text-slate-400">Unmatched</span>;
      case 'MATCHED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-950 text-emerald-300 border border-emerald-800">✓ Matched</span>;
      case 'EXCEPTION':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-rose-950 text-rose-300 border border-rose-800">⚠ Exception</span>;
      case 'RESOLVED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-950 text-amber-300 border border-amber-800">⚡ Overridden</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-800 text-slate-300">{status}</span>;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      {/* Header Bar */}
      <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Supplier Bills</h2>
          <p className="text-xs text-slate-400">
            Manage supplier invoice claims, perform 3-way matching, and post authoritative AP payables.
          </p>
        </div>
        <button
          onClick={onNewBill}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition-colors flex items-center gap-1.5 self-start md:self-auto"
        >
          <span>+ Create Supplier Bill</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 bg-slate-900/50 border-b border-slate-800 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by Bill #, Supplier Invoice #, Supplier, PO #..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-xs text-slate-200 focus:outline-none focus:border-indigo-500 min-w-[280px]"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="MATCHED">Matched</option>
          <option value="MATCH_EXCEPTION">Match Exception</option>
          <option value="APPROVED">Approved</option>
          <option value="POSTED">Posted</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <select
          value={matchStatusFilter}
          onChange={(e) => setMatchStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="ALL">All Match States</option>
          <option value="UNMATCHED">Unmatched</option>
          <option value="MATCHED">Matched</option>
          <option value="EXCEPTION">Exception</option>
          <option value="RESOLVED">Resolved / Overridden</option>
        </select>

        <div className="ml-auto text-xs text-slate-400">
          Showing <span className="font-semibold text-slate-200">{filtered.length}</span> of {bills.length} bills
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
            <tr>
              <th className="p-3">Bill Number</th>
              <th className="p-3">Supplier Invoice #</th>
              <th className="p-3">Supplier</th>
              <th className="p-3">Source PO</th>
              <th className="p-3">Bill Date</th>
              <th className="p-3">Due Date</th>
              <th className="p-3 text-right">Grand Total</th>
              <th className="p-3">3-Way Match</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-500">
                  No supplier bills found matching criteria.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => onSelectBill(item.id)}
                  className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                >
                  <td className="p-3 font-mono font-medium text-indigo-400">{item.billNumber}</td>
                  <td className="p-3 font-mono text-slate-200">{item.supplierInvoiceNumber}</td>
                  <td className="p-3 font-medium text-slate-200">{item.supplierName || item.supplierId}</td>
                  <td className="p-3 font-mono text-slate-400">{item.poNumber || '—'}</td>
                  <td className="p-3 text-slate-300">{item.billDate}</td>
                  <td className="p-3 text-slate-300">{item.dueDate}</td>
                  <td className="p-3 text-right font-mono font-semibold text-slate-100">
                    {item.currency} {parseFloat(item.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-3">{getMatchBadge(item.matchStatus)}</td>
                  <td className="p-3">{getStatusBadge(item.status)}</td>
                  <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onSelectBill(item.id)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded transition-colors"
                    >
                      View
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
