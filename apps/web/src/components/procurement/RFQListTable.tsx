import React from 'react';

export interface RFQListItem {
  id: string;
  rfqNumber: string;
  rfqDate: string;
  responseDueDate: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'RESPONSE_OPEN' | 'RESPONSE_CLOSED' | 'EVALUATED' | 'AWARDED' | 'CANCELLED';
  currency: string;
  invitedSupplierCount?: number;
  quotationCount?: number;
}

interface RFQListTableProps {
  rfqs: RFQListItem[];
  onSelectRfq: (id: string) => void;
  onNewRfq: () => void;
  onNewQuotation: (rfqId: string) => void;
  onCompare: (rfqId: string) => void;
}

export const RFQListTable: React.FC<RFQListTableProps> = ({
  rfqs,
  onSelectRfq,
  onNewRfq,
  onNewQuotation,
  onCompare
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">DRAFT</span>;
      case 'PUBLISHED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-950 text-blue-400 border border-blue-800">PUBLISHED</span>;
      case 'RESPONSE_OPEN':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-950 text-indigo-400 border border-indigo-800">RESPONSE OPEN</span>;
      case 'RESPONSE_CLOSED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-400 border border-amber-800">CLOSED</span>;
      case 'EVALUATED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-400 border border-purple-800">EVALUATED</span>;
      case 'AWARDED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">AWARDED</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950 text-rose-400 border border-rose-800">CANCELLED</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">{status}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white tracking-tight">Requests for Quotation (RFQs)</h2>
        <button
          onClick={onNewRfq}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20"
        >
          + New RFQ
        </button>
      </div>

      <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="py-3.5 px-4">RFQ Number</th>
              <th className="py-3.5 px-4">Title</th>
              <th className="py-3.5 px-4">RFQ Date</th>
              <th className="py-3.5 px-4">Due Date</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-center">Responses</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rfqs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500 font-medium">
                  No Requests for Quotation found.
                </td>
              </tr>
            ) : (
              rfqs.map((rfq) => (
                <tr key={rfq.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-indigo-400">{rfq.rfqNumber}</td>
                  <td className="py-3.5 px-4 font-medium text-white">{rfq.title}</td>
                  <td className="py-3.5 px-4">{rfq.rfqDate}</td>
                  <td className="py-3.5 px-4">{rfq.responseDueDate}</td>
                  <td className="py-3.5 px-4">{getStatusBadge(rfq.status)}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded font-mono font-bold">
                      {rfq.quotationCount || 0} quotes
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right space-x-2">
                    <button
                      onClick={() => onSelectRfq(rfq.id)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold"
                    >
                      View
                    </button>
                    {(rfq.status === 'PUBLISHED' || rfq.status === 'RESPONSE_OPEN') && (
                      <button
                        onClick={() => onNewQuotation(rfq.id)}
                        className="px-2.5 py-1 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-300 rounded-lg font-semibold border border-emerald-700"
                      >
                        + Log Quote
                      </button>
                    )}
                    {(rfq.status === 'RESPONSE_OPEN' || rfq.status === 'RESPONSE_CLOSED' || rfq.status === 'EVALUATED') && (
                      <button
                        onClick={() => onCompare(rfq.id)}
                        className="px-2.5 py-1 bg-purple-900/60 hover:bg-purple-800 text-purple-300 rounded-lg font-semibold border border-purple-700"
                      >
                        Compare & Award
                      </button>
                    )}
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
