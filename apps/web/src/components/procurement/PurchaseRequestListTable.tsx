import React from 'react';

export interface PurchaseRequestListItem {
  id: string;
  requestNumber: string;
  requestDate: string;
  requiredDate: string;
  requesterUserId: string;
  departmentId?: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ORDERED';
  estimatedTotal: string;
  currency: string;
  purpose?: string | null;
}

interface PurchaseRequestListTableProps {
  requests: PurchaseRequestListItem[];
  onSelectRequest: (id: string) => void;
  onNewRequest: () => void;
}

export const PurchaseRequestListTable: React.FC<PurchaseRequestListTableProps> = ({
  requests,
  onSelectRequest,
  onNewRequest
}) => {
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      DRAFT: 'bg-slate-700 text-slate-300 border-slate-600',
      SUBMITTED: 'bg-blue-900/50 text-blue-300 border-blue-700',
      APPROVED: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
      REJECTED: 'bg-rose-900/50 text-rose-300 border-rose-700',
      CANCELLED: 'bg-zinc-800 text-zinc-400 border-zinc-700',
      ORDERED: 'bg-indigo-900/50 text-indigo-300 border-indigo-700',
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[status] || 'bg-gray-800 text-gray-300'}`}>
        {status}
      </span>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      LOW: 'bg-slate-800 text-slate-400 border-slate-700',
      NORMAL: 'bg-sky-950 text-sky-400 border-sky-800',
      HIGH: 'bg-amber-950 text-amber-400 border-amber-800',
      URGENT: 'bg-rose-950 text-rose-400 border-rose-800 animate-pulse',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${styles[priority] || 'bg-gray-800 text-gray-400'}`}>
        {priority}
      </span>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 gap-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">Purchase Requests</h2>
          <p className="text-sm text-slate-400 mt-1">Manage internal operational procurement demand</p>
        </div>
        <button
          onClick={onNewRequest}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-lg shadow-indigo-600/20 transition-all text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          + New Purchase Request
        </button>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-slate-800/80 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-500">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-300">No Purchase Requests Found</h3>
          <p className="text-sm text-slate-500 mt-1">Create a purchase request to request items or services for procurement.</p>
        </div>
      ) : (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="text-xs uppercase bg-slate-950/60 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3.5 px-4 font-semibold">Request #</th>
                <th className="py-3.5 px-4 font-semibold">Date</th>
                <th className="py-3.5 px-4 font-semibold">Required By</th>
                <th className="py-3.5 px-4 font-semibold">Requester</th>
                <th className="py-3.5 px-4 font-semibold">Priority</th>
                <th className="py-3.5 px-4 font-semibold text-right">Estimated Total</th>
                <th className="py-3.5 px-4 font-semibold text-center">Status</th>
                <th className="py-3.5 px-4 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {requests.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-medium text-indigo-400">{item.requestNumber}</td>
                  <td className="py-3.5 px-4 text-slate-400">{item.requestDate}</td>
                  <td className="py-3.5 px-4 text-slate-300 font-medium">{item.requiredDate}</td>
                  <td className="py-3.5 px-4 text-slate-300">{item.requesterUserId}</td>
                  <td className="py-3.5 px-4">{getPriorityBadge(item.priority)}</td>
                  <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-100">
                    {item.currency} {parseFloat(item.estimatedTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3.5 px-4 text-center">{getStatusBadge(item.status)}</td>
                  <td className="py-3.5 px-4 text-center">
                    <button
                      onClick={() => onSelectRequest(item.id)}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium border border-slate-700 transition-colors"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
