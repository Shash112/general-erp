import React, { useState } from 'react';

interface PurchaseOrderDetailsViewProps {
  order: any;
  onBack: () => void;
  onSubmit: (id: string) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onIssue: (id: string) => Promise<void>;
  onAcknowledge: (id: string) => Promise<void>;
  onCancel: (id: string, reason: string) => Promise<void>;
}

export const PurchaseOrderDetailsView: React.FC<PurchaseOrderDetailsViewProps> = ({
  order,
  onBack,
  onSubmit,
  onApprove,
  onIssue,
  onAcknowledge,
  onCancel
}) => {
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">DRAFT</span>;
      case 'SUBMITTED':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-950 text-amber-400 border border-amber-800">SUBMITTED FOR APPROVAL</span>;
      case 'APPROVED':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-950 text-blue-400 border border-blue-800">APPROVED</span>;
      case 'ISSUED':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-950 text-indigo-400 border border-indigo-800">ISSUED TO SUPPLIER</span>;
      case 'ACKNOWLEDGED':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">ACKNOWLEDGED BY SUPPLIER</span>;
      case 'CANCELLED':
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-950 text-rose-400 border border-rose-800">CANCELLED</span>;
      default:
        return <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300">{status}</span>;
    }
  };

  const handleAction = async (actionFn: () => Promise<void>) => {
    setIsProcessing(true);
    try {
      await actionFn();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-4">
        <div>
          <button onClick={onBack} className="text-xs font-semibold text-indigo-400 hover:underline mb-1">
            ← Back to Purchase Orders
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black text-white">{order.poNumber}</h2>
            {getStatusBadge(order.status)}
          </div>
          <p className="text-xs text-slate-400 mt-1">PO Date: {order.poDate} • Delivery Target: {order.expectedDeliveryDate}</p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {order.status === 'DRAFT' && (
            <button
              disabled={isProcessing}
              onClick={() => handleAction(() => onSubmit(order.id))}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20"
            >
              Submit for Approval
            </button>
          )}

          {order.status === 'SUBMITTED' && (
            <button
              disabled={isProcessing}
              onClick={() => handleAction(() => onApprove(order.id))}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/20"
            >
              Approve Order
            </button>
          )}

          {order.status === 'APPROVED' && (
            <button
              disabled={isProcessing}
              onClick={() => handleAction(() => onIssue(order.id))}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20"
            >
              Issue to Supplier
            </button>
          )}

          {order.status === 'ISSUED' && (
            <button
              disabled={isProcessing}
              onClick={() => handleAction(() => onAcknowledge(order.id))}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/20"
            >
              Record Supplier Acknowledgement
            </button>
          )}

          {order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && (
            <button
              disabled={isProcessing}
              onClick={() => setShowCancelModal(true)}
              className="px-4 py-2 bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-xl text-xs font-bold"
            >
              Cancel PO
            </button>
          )}
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-5 space-y-3">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Supplier Information</h4>
          <div className="text-xs space-y-1">
            <p className="font-bold text-white text-sm">{order.supplierName || order.supplierId}</p>
            <p className="text-slate-400">Payment Terms: {order.paymentTerms || 'Net 30'}</p>
            <p className="text-slate-400">Delivery Terms: {order.deliveryTerms || 'FOB Destination'}</p>
          </div>
        </div>

        <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-5 space-y-3">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Upstream Traceability</h4>
          <div className="text-xs space-y-1">
            <p className="text-slate-300">Purchase Request: <span className="font-mono text-indigo-400 font-bold">{order.purchaseRequestNumber || 'N/A'}</span></p>
            <p className="text-slate-300">RFQ Reference: <span className="font-mono text-indigo-400 font-bold">{order.rfqNumber || 'N/A'}</span></p>
            <p className="text-slate-300">Supplier Quote: <span className="font-mono text-emerald-400 font-bold">{order.supplierQuoteNumber || 'N/A'}</span></p>
          </div>
        </div>

        <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-5 space-y-3">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Commercial Total</h4>
          <div className="text-xs space-y-1">
            <div className="flex justify-between text-slate-400"><span>Subtotal:</span><span>₹{order.subtotal || '0.00'}</span></div>
            <div className="flex justify-between text-slate-400"><span>Tax Amount:</span><span>₹{order.tax || '0.00'}</span></div>
            <div className="flex justify-between text-base font-bold text-emerald-400 pt-2 border-t border-slate-800">
              <span>Grand Total:</span>
              <span>₹{order.grandTotal}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl overflow-hidden shadow-xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">PO Line Items</h4>
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase">
            <tr>
              <th className="py-2.5 px-3">#</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3 text-right">Ordered Qty</th>
              <th className="py-2.5 px-3 text-right">Unit Price</th>
              <th className="py-2.5 px-3 text-right">Tax Rate</th>
              <th className="py-2.5 px-3 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {order.lines.map((line: any, idx: number) => (
              <tr key={idx} className="hover:bg-slate-800/40">
                <td className="py-3 px-3 font-mono text-slate-500">{line.lineNumber}</td>
                <td className="py-3 px-3 font-medium text-white">{line.description}</td>
                <td className="py-3 px-3 text-right font-mono">{line.orderedQuantity} {line.uom}</td>
                <td className="py-3 px-3 text-right font-mono">₹{line.unitPrice}</td>
                <td className="py-3 px-3 text-right font-mono">{line.taxRate}%</td>
                <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400">₹{line.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-5 space-y-4">
            <h3 className="text-lg font-bold text-white">Cancel Purchase Order</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Reason for Cancellation *</label>
              <textarea
                required
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white"
                placeholder="Specify reason..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCancelModal(false)} className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs">
                Back
              </button>
              <button
                disabled={!cancelReason.trim()}
                onClick={async () => {
                  setShowCancelModal(false);
                  await handleAction(() => onCancel(order.id, cancelReason));
                }}
                className="px-4 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
