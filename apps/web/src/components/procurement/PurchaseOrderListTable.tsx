import React from 'react';

export interface PurchaseOrderListItem {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  poDate: string;
  expectedDeliveryDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'ISSUED' | 'ACKNOWLEDGED' | 'PARTIALLY_RECEIVED' | 'COMPLETED' | 'CANCELLED';
  currency: string;
  grandTotal: string;
  purchaseRequestNumber?: string;
  rfqNumber?: string;
}

interface PurchaseOrderListTableProps {
  orders: PurchaseOrderListItem[];
  onSelectOrder: (id: string) => void;
  onNewOrder: () => void;
}

export const PurchaseOrderListTable: React.FC<PurchaseOrderListTableProps> = ({
  orders,
  onSelectOrder,
  onNewOrder
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">DRAFT</span>;
      case 'SUBMITTED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-400 border border-amber-800">SUBMITTED</span>;
      case 'APPROVED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-950 text-blue-400 border border-blue-800">APPROVED</span>;
      case 'ISSUED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-950 text-indigo-400 border border-indigo-800">ISSUED</span>;
      case 'ACKNOWLEDGED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">ACKNOWLEDGED</span>;
      case 'PARTIALLY_RECEIVED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-400 border border-purple-800">PARTIAL REC</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-950 text-teal-400 border border-teal-800">COMPLETED</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950 text-rose-400 border border-rose-800">CANCELLED</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">{status}</span>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white tracking-tight">Purchase Orders (POs)</h2>
        <button
          onClick={onNewOrder}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20"
        >
          + Create Purchase Order
        </button>
      </div>

      <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="py-3.5 px-4">PO Number</th>
              <th className="py-3.5 px-4">Supplier</th>
              <th className="py-3.5 px-4">PO Date</th>
              <th className="py-3.5 px-4">Delivery Date</th>
              <th className="py-3.5 px-4">Grand Total</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500 font-medium">
                  No Purchase Orders found.
                </td>
              </tr>
            ) : (
              orders.map((po) => (
                <tr key={po.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-indigo-400">{po.poNumber}</td>
                  <td className="py-3.5 px-4 font-medium text-white">{po.supplierName || po.supplierId}</td>
                  <td className="py-3.5 px-4">{po.poDate}</td>
                  <td className="py-3.5 px-4">{po.expectedDeliveryDate}</td>
                  <td className="py-3.5 px-4 font-mono font-bold text-emerald-400">
                    ₹{parseFloat(po.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3.5 px-4">{getStatusBadge(po.status)}</td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => onSelectOrder(po.id)}
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
