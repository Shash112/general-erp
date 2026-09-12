import React, { useState } from 'react';

export interface GoodsReceiptDetailLine {
  id: string;
  lineNumber: number;
  purchaseOrderLineId: string;
  productId?: string;
  productCodeSnapshot?: string;
  descriptionSnapshot: string;
  uom: string;
  orderedQuantity: string;
  previouslyReceivedQuantity: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  remainingQuantity: string;
  inspectionRequired: boolean;
  rejectionReason?: string;
  batchReference?: string;
  serialReference?: string;
  notes?: string;
}

export interface GoodsReceiptDetailData {
  id: string;
  grnNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber?: string;
  supplierId: string;
  supplierName?: string;
  supplierCode?: string;
  receiptDate: string;
  receivedAt: string;
  warehouseId?: string;
  receivingLocationId?: string;
  supplierDeliveryNoteNumber?: string;
  supplierDeliveryNoteDate?: string;
  transporter?: string;
  vehicleNumber?: string;
  lrNumber?: string;
  status: 'DRAFT' | 'RECEIVED' | 'INSPECTION_PENDING' | 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'REJECTED' | 'CANCELLED';
  inspectionStatus: 'NOT_REQUIRED' | 'PENDING' | 'PASSED' | 'PARTIALLY_PASSED' | 'FAILED';
  receivedBy: string;
  notes?: string;
  lines: GoodsReceiptDetailLine[];
}

interface GRNDetailsViewProps {
  receipt: GoodsReceiptDetailData;
  onBack: () => void;
  onInspect: () => void;
  onAccept: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
  onCancel: (reason?: string) => Promise<void>;
}

export const GRNDetailsView: React.FC<GRNDetailsViewProps> = ({
  receipt,
  onBack,
  onInspect,
  onAccept,
  onReject,
  onCancel,
}) => {
  const [loadingAction, setLoadingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    try {
      setLoadingAction(true);
      setError(null);
      await onAccept();
    } catch (err: any) {
      setError(err.message || 'Failed to accept Goods Receipt.');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleReject = async () => {
    const reason = prompt('Enter rejection reason:');
    if (reason === null) return;
    try {
      setLoadingAction(true);
      setError(null);
      await onReject(reason);
    } catch (err: any) {
      setError(err.message || 'Failed to reject Goods Receipt.');
    } finally {
      setLoadingAction(false);
    }
  };

  const handleCancel = async () => {
    const reason = prompt('Enter cancellation reason:');
    if (reason === null) return;
    try {
      setLoadingAction(true);
      setError(null);
      await onCancel(reason);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel Goods Receipt.');
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
          >
            ← Back to List
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-white font-mono tracking-tight">{receipt.grnNumber}</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-950 text-indigo-400 border border-indigo-800">
                {receipt.status}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              PO: <span className="text-indigo-400 font-mono font-semibold">{receipt.purchaseOrderNumber || receipt.purchaseOrderId}</span> | Supplier: {receipt.supplierName}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {['RECEIVED', 'INSPECTION_PENDING'].includes(receipt.status) && (
            <button
              onClick={onInspect}
              disabled={loadingAction}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-amber-600/20 disabled:opacity-50"
            >
              Quality Inspection
            </button>
          )}

          {['RECEIVED', 'INSPECTION_PENDING', 'PARTIALLY_ACCEPTED'].includes(receipt.status) && (
            <button
              onClick={handleAccept}
              disabled={loadingAction}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              Formally Accept GRN
            </button>
          )}

          {['RECEIVED', 'INSPECTION_PENDING'].includes(receipt.status) && (
            <button
              onClick={handleReject}
              disabled={loadingAction}
              className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              Reject GRN
            </button>
          )}

          {!['CANCELLED'].includes(receipt.status) && (
            <button
              onClick={handleCancel}
              disabled={loadingAction}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              Cancel GRN
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-xl text-xs">{error}</div>}

      {/* Metadata Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Receipt Date</span>
          <p className="text-sm font-semibold text-white mt-1">{receipt.receiptDate}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Warehouse / Location</span>
          <p className="text-sm font-semibold text-white mt-1">{receipt.warehouseId || 'MAIN-WH'} ({receipt.receivingLocationId || 'DOCK-1'})</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Supplier Delivery Note</span>
          <p className="text-sm font-semibold text-white mt-1">{receipt.supplierDeliveryNoteNumber || 'N/A'}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Inspection Status</span>
          <p className="text-sm font-semibold text-amber-400 mt-1">{receipt.inspectionStatus}</p>
        </div>
      </div>

      {/* Line Details Table */}
      <div className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900">
          <h3 className="text-sm font-bold text-white">Received Goods Items</h3>
        </div>
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase">
            <tr>
              <th className="py-3 px-4">Line</th>
              <th className="py-3 px-4">Description</th>
              <th className="py-3 px-4 text-right">Ordered</th>
              <th className="py-3 px-4 text-right">Prev. Rec</th>
              <th className="py-3 px-4 text-right">Received</th>
              <th className="py-3 px-4 text-right">Accepted</th>
              <th className="py-3 px-4 text-right">Rejected</th>
              <th className="py-3 px-4">Rejection Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {receipt.lines.map((line) => (
              <tr key={line.id} className="hover:bg-slate-800/30">
                <td className="py-3.5 px-4 font-mono text-slate-400">{line.lineNumber}</td>
                <td className="py-3.5 px-4 font-medium text-white">
                  {line.productCodeSnapshot ? `[${line.productCodeSnapshot}] ` : ''}
                  {line.descriptionSnapshot}
                </td>
                <td className="py-3.5 px-4 text-right font-mono">{parseFloat(line.orderedQuantity).toFixed(2)}</td>
                <td className="py-3.5 px-4 text-right font-mono text-slate-400">{parseFloat(line.previouslyReceivedQuantity).toFixed(2)}</td>
                <td className="py-3.5 px-4 text-right font-mono font-bold text-indigo-400">{parseFloat(line.receivedQuantity).toFixed(2)}</td>
                <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-400">{parseFloat(line.acceptedQuantity).toFixed(2)}</td>
                <td className="py-3.5 px-4 text-right font-mono font-bold text-rose-400">{parseFloat(line.rejectedQuantity).toFixed(2)}</td>
                <td className="py-3.5 px-4 text-slate-400 italic">{line.rejectionReason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Traceability Banner */}
      <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-2xl flex items-center justify-between text-xs">
        <span className="text-slate-400 font-semibold uppercase tracking-wider">Lineage Traceability</span>
        <div className="flex items-center gap-2 font-mono text-slate-300">
          <span>Purchase Order ({receipt.purchaseOrderNumber || 'PO'})</span>
          <span className="text-slate-600">→</span>
          <span className="text-indigo-400 font-bold">GRN ({receipt.grnNumber})</span>
          <span className="text-slate-600">→</span>
          <span className="text-slate-500">[Future Supplier Bill / AP]</span>
        </div>
      </div>
    </div>
  );
};
