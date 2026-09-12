import React, { useState } from 'react';

export interface SupplierBillDetailData {
  bill: {
    id: string;
    billNumber: string;
    supplierInvoiceNumber: string;
    supplierInvoiceDate: string;
    supplierId: string;
    supplierName?: string;
    purchaseOrderId?: string | null;
    poNumber?: string | null;
    primaryGrnId?: string | null;
    grnNumber?: string | null;
    billDate: string;
    dueDate: string;
    currency: string;
    exchangeRate: string;
    paymentTermsDays: number;
    subtotal: string;
    discount: string;
    taxableAmount: string;
    taxAmount: string;
    rounding: string;
    grandTotal: string;
    matchStatus: string;
    matchOverrideReason?: string | null;
    status: string;
    apDocumentId?: string | null;
    apOpenItemId?: string | null;
    journalEntryId?: string | null;
    postedAt?: string | null;
    remarks?: string | null;
    createdAt: string;
  };
  lines: Array<{
    id: string;
    lineNumber: number;
    descriptionSnapshot: string;
    productCodeSnapshot?: string | null;
    uom: string;
    billedQuantity: string;
    unitPrice: string;
    discount: string;
    taxableAmount: string;
    taxRatePercent: string;
    cgstAmount: string;
    sgstAmount: string;
    igstAmount: string;
    taxAmount: string;
    lineTotal: string;
  }>;
  exceptions?: Array<any>;
}

interface SupplierBillDetailsViewProps {
  data: SupplierBillDetailData;
  onBack: () => void;
  onOpenMatchWorkspace: () => void;
  onApprove: () => Promise<void>;
  onPost: () => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
}

export const SupplierBillDetailsView: React.FC<SupplierBillDetailsViewProps> = ({
  data,
  onBack,
  onOpenMatchWorkspace,
  onApprove,
  onPost,
  onCancel,
}) => {
  const { bill, lines } = data;
  const [actionLoading, setActionLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await onApprove();
    } finally {
      setActionLoading(false);
    }
  };

  const handlePost = async () => {
    setActionLoading(true);
    try {
      await onPost();
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelReason.trim()) return;
    setActionLoading(true);
    try {
      await onCancel(cancelReason.trim());
      setShowCancelModal(false);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6 text-slate-200">
      {/* Top Navigation & Action Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded"
          >
            ← Back to List
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold font-mono text-indigo-400">{bill.billNumber}</h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {bill.status}
              </span>
            </div>
            <p className="text-xs text-slate-400">Supplier Invoice: <span className="font-mono text-slate-200">{bill.supplierInvoiceNumber}</span></p>
          </div>
        </div>

        {/* Workflow Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenMatchWorkspace}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold rounded border border-indigo-900/60"
          >
            ⚡ 3-Way Match Workspace
          </button>

          {['MATCHED', 'RESOLVED', 'DRAFT'].includes(bill.status) && bill.status !== 'APPROVED' && bill.status !== 'POSTED' && (
            <button
              onClick={handleApprove}
              disabled={actionLoading}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded shadow"
            >
              Approve Bill
            </button>
          )}

          {['APPROVED', 'MATCHED', 'RESOLVED'].includes(bill.status) && bill.status !== 'POSTED' && (
            <button
              onClick={handlePost}
              disabled={actionLoading}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded shadow"
            >
              {actionLoading ? 'Posting to AP/GL...' : 'Post Bill (AP & GL)'}
            </button>
          )}

          {bill.status !== 'POSTED' && bill.status !== 'CANCELLED' && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-400 text-xs font-semibold rounded"
            >
              Cancel Bill
            </button>
          )}
        </div>
      </div>

      {/* Upstream Traceability Breadcrumb Banner */}
      <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs flex flex-wrap items-center gap-2 text-slate-400">
        <span className="font-semibold text-slate-300">Procurement Traceability:</span>
        {bill.poNumber ? (
          <span className="px-2 py-0.5 bg-slate-900 rounded font-mono text-indigo-400">PO: {bill.poNumber}</span>
        ) : (
          <span className="text-slate-500">No PO</span>
        )}
        <span>→</span>
        {bill.grnNumber ? (
          <span className="px-2 py-0.5 bg-slate-900 rounded font-mono text-indigo-400">GRN: {bill.grnNumber}</span>
        ) : (
          <span className="text-slate-500">Direct Bill</span>
        )}
        <span>→</span>
        <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 rounded font-mono border border-indigo-800">
          Bill: {bill.billNumber}
        </span>
        <span>→</span>
        {bill.apDocumentId ? (
          <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 rounded font-mono border border-emerald-800">
            AP Doc: {bill.apDocumentId}
          </span>
        ) : (
          <span className="text-slate-500">AP Pending</span>
        )}
        <span>→</span>
        {bill.journalEntryId ? (
          <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 rounded font-mono border border-emerald-800">
            GL Journal: {bill.journalEntryId}
          </span>
        ) : (
          <span className="text-slate-500">GL Pending</span>
        )}
      </div>

      {/* Primary Key Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
          <div className="text-slate-400">Grand Total</div>
          <div className="text-lg font-bold text-slate-100 font-mono mt-1">
            {bill.currency} {parseFloat(bill.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
          <div className="text-slate-400">3-Way Match Status</div>
          <div className="text-sm font-semibold text-emerald-400 mt-1">{bill.matchStatus}</div>
        </div>
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
          <div className="text-slate-400">Bill Date / Due Date</div>
          <div className="text-xs font-medium text-slate-200 mt-1">{bill.billDate} / <span className="text-amber-400">{bill.dueDate}</span></div>
        </div>
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
          <div className="text-slate-400">Supplier</div>
          <div className="text-xs font-semibold text-slate-100 mt-1 truncate">{bill.supplierName || bill.supplierId}</div>
        </div>
      </div>

      {/* Authoritative AP & GL Status Section if Posted */}
      {bill.status === 'POSTED' && (
        <div className="p-4 bg-emerald-950/30 border border-emerald-800/80 rounded-lg space-y-2 text-xs text-emerald-200">
          <div className="font-semibold text-emerald-400 text-sm">✓ Authoritative AP Document & GL Journal Posted</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-slate-300">
            <div>AP Document ID: <span className="text-emerald-300 font-semibold">{bill.apDocumentId}</span></div>
            <div>AP Open Item ID: <span className="text-emerald-300 font-semibold">{bill.apOpenItemId}</span></div>
            <div>GL Journal Entry ID: <span className="text-emerald-300 font-semibold">{bill.journalEntryId}</span></div>
          </div>
        </div>
      )}

      {/* Line Items Table */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Supplier Bill Line Items ({lines.length})</h3>
        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Description</th>
                <th className="p-3 text-right">Billed Qty</th>
                <th className="p-3 text-right">Unit Price</th>
                <th className="p-3 text-right">Discount</th>
                <th className="p-3 text-right">Taxable</th>
                <th className="p-3 text-right">GST Tax</th>
                <th className="p-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {lines.map((l) => (
                <tr key={l.id} className="hover:bg-slate-800/30">
                  <td className="p-3 font-semibold text-slate-400">{l.lineNumber}</td>
                  <td className="p-3 font-sans text-slate-200">{l.descriptionSnapshot}</td>
                  <td className="p-3 text-right font-semibold text-slate-100">{l.billedQuantity} {l.uom}</td>
                  <td className="p-3 text-right text-slate-300">₹{parseFloat(l.unitPrice).toFixed(2)}</td>
                  <td className="p-3 text-right text-slate-400">₹{parseFloat(l.discount).toFixed(2)}</td>
                  <td className="p-3 text-right text-slate-200">₹{parseFloat(l.taxableAmount).toFixed(2)}</td>
                  <td className="p-3 text-right text-indigo-400">₹{parseFloat(l.taxAmount).toFixed(2)}</td>
                  <td className="p-3 text-right font-bold text-slate-100">₹{parseFloat(l.lineTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commercial Financial Totals Summary */}
      <div className="flex justify-end">
        <div className="w-full max-w-sm p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Subtotal:</span>
            <span className="font-mono text-slate-200">₹{parseFloat(bill.subtotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Total Discount:</span>
            <span className="font-mono text-slate-200">- ₹{parseFloat(bill.discount).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Taxable Amount:</span>
            <span className="font-mono text-slate-200">₹{parseFloat(bill.taxableAmount).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Total Tax (GST):</span>
            <span className="font-mono text-indigo-400">+ ₹{parseFloat(bill.taxAmount).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-400 pt-2 border-t border-slate-800 font-semibold text-slate-100">
            <span>Grand Total:</span>
            <span className="font-mono text-sm text-indigo-400">
              {bill.currency} {parseFloat(bill.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl text-slate-200 text-xs">
            <h3 className="text-base font-semibold text-slate-100">Cancel Supplier Bill</h3>
            <p className="text-slate-400">Are you sure you want to cancel draft bill {bill.billNumber}?</p>

            <div>
              <label className="block text-slate-300 mb-1 font-medium">Cancellation Reason *</label>
              <textarea
                required
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded"
              >
                Back
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={actionLoading || !cancelReason.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded font-semibold"
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
