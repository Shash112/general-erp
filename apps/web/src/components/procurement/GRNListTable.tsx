import React from 'react';

export interface GoodsReceiptListItem {
  id: string;
  grnNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber?: string;
  supplierId: string;
  supplierName?: string;
  receiptDate: string;
  warehouseId?: string;
  status: 'DRAFT' | 'RECEIVED' | 'INSPECTION_PENDING' | 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'REJECTED' | 'CANCELLED';
  inspectionStatus: 'NOT_REQUIRED' | 'PENDING' | 'PASSED' | 'PARTIALLY_PASSED' | 'FAILED';
  supplierDeliveryNoteNumber?: string;
}

interface GRNListTableProps {
  receipts: GoodsReceiptListItem[];
  onSelectReceipt: (id: string) => void;
  onNewReceipt: () => void;
}

export const GRNListTable: React.FC<GRNListTableProps> = ({
  receipts,
  onSelectReceipt,
  onNewReceipt,
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">DRAFT</span>;
      case 'RECEIVED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-950 text-blue-400 border border-blue-800">RECEIVED</span>;
      case 'INSPECTION_PENDING':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-400 border border-amber-800">INSPECT PENDING</span>;
      case 'ACCEPTED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">ACCEPTED</span>;
      case 'PARTIALLY_ACCEPTED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-400 border border-purple-800">PARTIAL ACCEPT</span>;
      case 'REJECTED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950 text-rose-400 border border-rose-800">REJECTED</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-500">CANCELLED</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">{status}</span>;
    }
  };

  const getInspectionBadge = (status: string) => {
    switch (status) {
      case 'NOT_REQUIRED':
        return <span className="px-2 py-0.5 rounded text-xs text-slate-400 bg-slate-800/60">N/A</span>;
      case 'PENDING':
        return <span className="px-2 py-0.5 rounded text-xs text-amber-300 bg-amber-950/80">Pending</span>;
      case 'PASSED':
        return <span className="px-2 py-0.5 rounded text-xs text-emerald-300 bg-emerald-950/80">Passed</span>;
      case 'PARTIALLY_PASSED':
        return <span className="px-2 py-0.5 rounded text-xs text-purple-300 bg-purple-950/80">Partial</span>;
      case 'FAILED':
        return <span className="px-2 py-0.5 rounded text-xs text-rose-300 bg-rose-950/80">Failed</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs text-slate-400 bg-slate-800">{status}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">Goods Receipt Notes (GRNs)</h2>
          <p className="text-xs text-slate-400">Manage physical inventory receipts, inspection status, and PO fulfillment</p>
        </div>
        <button
          onClick={onNewReceipt}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20"
        >
          + Record Goods Receipt
        </button>
      </div>

      <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="py-3.5 px-4">GRN Number</th>
              <th className="py-3.5 px-4">PO Number</th>
              <th className="py-3.5 px-4">Supplier</th>
              <th className="py-3.5 px-4">Receipt Date</th>
              <th className="py-3.5 px-4">Inspection</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {receipts.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500 font-medium">
                  No Goods Receipt Notes found.
                </td>
              </tr>
            ) : (
              receipts.map((grn) => (
                <tr key={grn.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-indigo-400">{grn.grnNumber}</td>
                  <td className="py-3.5 px-4 font-mono text-slate-300">{grn.purchaseOrderNumber || grn.purchaseOrderId}</td>
                  <td className="py-3.5 px-4 font-medium text-white">{grn.supplierName || grn.supplierId}</td>
                  <td className="py-3.5 px-4">{grn.receiptDate}</td>
                  <td className="py-3.5 px-4">{getInspectionBadge(grn.inspectionStatus)}</td>
                  <td className="py-3.5 px-4">{getStatusBadge(grn.status)}</td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => onSelectReceipt(grn.id)}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold"
                    >
                      View Details
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
