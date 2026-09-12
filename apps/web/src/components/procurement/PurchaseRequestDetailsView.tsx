import React, { useState } from 'react';

export interface PurchaseRequestDetailsProps {
  request: {
    id: string;
    requestNumber: string;
    requestDate: string;
    requiredDate: string;
    requesterUserId: string;
    departmentId?: string | null;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ORDERED';
    purpose?: string | null;
    justification?: string | null;
    notes?: string | null;
    estimatedTotal: string;
    currency: string;
    submittedAt?: Date | null;
    submittedBy?: string | null;
    approvedAt?: Date | null;
    approvedBy?: string | null;
    rejectedAt?: Date | null;
    rejectedBy?: string | null;
    rejectionReason?: string | null;
    cancelledAt?: Date | null;
    cancelledBy?: string | null;
    cancellationReason?: string | null;
    lines: Array<{
      id: string;
      lineNumber: number;
      productId?: string | null;
      description: string;
      requestedQuantity: string;
      orderedQuantity: string;
      remainingQuantity: string;
      uom: string;
      estimatedUnitPrice: string;
      estimatedLineTotal: string;
    }>;
  };
  onBack: () => void;
  onSubmit: (id: string) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onCancel: (id: string, reason: string) => Promise<void>;
}

export const PurchaseRequestDetailsView: React.FC<PurchaseRequestDetailsProps> = ({
  request,
  onBack,
  onSubmit,
  onApprove,
  onReject,
  onCancel,
}) => {
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [reasonInput, setReasonInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAction = async (actionFn: () => Promise<void>) => {
    try {
      setIsProcessing(true);
      setErrorMsg(null);
      await actionFn();
    } catch (err: any) {
      setErrorMsg(err.message || 'Action failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!reasonInput.trim()) return;
    await handleAction(() => onReject(request.id, reasonInput.trim()));
    setRejectModalOpen(false);
    setReasonInput('');
  };

  const handleCancelSubmit = async () => {
    if (!reasonInput.trim()) return;
    await handleAction(() => onCancel(request.id, reasonInput.trim()));
    setCancelModalOpen(false);
    setReasonInput('');
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to List
        </button>

        <div className="flex items-center gap-3">
          {request.status === 'DRAFT' && (
            <>
              <button
                onClick={() => handleAction(() => onSubmit(request.id))}
                disabled={isProcessing}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-sm transition-all"
              >
                Submit for Approval
              </button>
              <button
                onClick={() => { setReasonInput(''); setCancelModalOpen(true); }}
                disabled={isProcessing}
                className="px-4 py-2 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel Request
              </button>
            </>
          )}

          {request.status === 'SUBMITTED' && (
            <>
              <button
                onClick={() => handleAction(() => onApprove(request.id))}
                disabled={isProcessing}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-all"
              >
                Approve Request
              </button>
              <button
                onClick={() => { setReasonInput(''); setRejectModalOpen(true); }}
                disabled={isProcessing}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-lg text-sm transition-all"
              >
                Reject Request
              </button>
              <button
                onClick={() => { setReasonInput(''); setCancelModalOpen(true); }}
                disabled={isProcessing}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel Request
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Primary Details Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold font-mono text-indigo-400">{request.requestNumber}</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                request.status === 'APPROVED' ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700' :
                request.status === 'SUBMITTED' ? 'bg-blue-900/50 text-blue-300 border-blue-700' :
                request.status === 'REJECTED' ? 'bg-rose-900/50 text-rose-300 border-rose-700' :
                'bg-slate-800 text-slate-300 border-slate-700'
              }`}>
                {request.status}
              </span>
              <span className="px-2.5 py-0.5 rounded text-xs font-medium border bg-amber-950 text-amber-400 border-amber-800">
                {request.priority} Priority
              </span>
            </div>
            {request.purpose && <p className="text-slate-300 mt-2 font-medium">{request.purpose}</p>}
          </div>

          <div className="text-left md:text-right bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            <span className="text-xs uppercase font-semibold text-slate-400">Estimated Total</span>
            <div className="text-2xl font-bold font-mono text-slate-100">
              {request.currency} {parseFloat(request.estimatedTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-xs text-slate-400 block uppercase font-medium">Request Date</span>
            <span className="text-slate-200 font-medium">{request.requestDate}</span>
          </div>
          <div>
            <span className="text-xs text-slate-400 block uppercase font-medium">Required By Date</span>
            <span className="text-indigo-300 font-semibold">{request.requiredDate}</span>
          </div>
          <div>
            <span className="text-xs text-slate-400 block uppercase font-medium">Requester User</span>
            <span className="text-slate-200">{request.requesterUserId}</span>
          </div>
          <div>
            <span className="text-xs text-slate-400 block uppercase font-medium">Department</span>
            <span className="text-slate-200">{request.departmentId || 'Default'}</span>
          </div>
        </div>

        {request.justification && (
          <div className="bg-slate-950/40 p-4 rounded-lg border border-slate-800">
            <span className="text-xs text-slate-400 block uppercase font-medium mb-1">Business Justification</span>
            <p className="text-sm text-slate-300">{request.justification}</p>
          </div>
        )}

        {/* Rejection / Cancellation Banners */}
        {request.status === 'REJECTED' && (
          <div className="bg-rose-950/50 border border-rose-800/80 p-4 rounded-lg text-rose-300 text-sm">
            <span className="font-bold block mb-1">Rejected by {request.rejectedBy}</span>
            Reason: {request.rejectionReason}
          </div>
        )}

        {request.status === 'CANCELLED' && (
          <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-400 text-sm">
            <span className="font-bold block text-slate-300 mb-1">Cancelled by {request.cancelledBy}</span>
            Reason: {request.cancellationReason}
          </div>
        )}

        {/* Lines Table */}
        <div>
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide mb-3">Line Items</h3>
          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/80 text-xs text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">#</th>
                  <th className="py-3 px-4 font-semibold">Description</th>
                  <th className="py-3 px-4 font-semibold text-right">Requested Qty</th>
                  <th className="py-3 px-4 font-semibold">UOM</th>
                  <th className="py-3 px-4 font-semibold text-right">Est. Unit Price</th>
                  <th className="py-3 px-4 font-semibold text-right">Est. Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {request.lines.map((line) => (
                  <tr key={line.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 font-mono text-slate-400">{line.lineNumber}</td>
                    <td className="py-3 px-4 text-slate-200">{line.description}</td>
                    <td className="py-3 px-4 text-right font-mono font-medium text-slate-100">{line.requestedQuantity}</td>
                    <td className="py-3 px-4 text-slate-400">{line.uom}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-300">{line.estimatedUnitPrice}</td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-indigo-300">{line.estimatedLineTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reject Modal */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-slate-100 mb-2">Reject Purchase Request</h3>
            <p className="text-xs text-slate-400 mb-4">Please specify a reason for rejecting request {request.requestNumber}:</p>
            <textarea
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-200 mb-4 focus:outline-none focus:border-rose-500"
              placeholder="Rejection reason..."
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRejectModalOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm">Cancel</button>
              <button onClick={handleRejectSubmit} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium">Confirm Rejection</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-slate-100 mb-2">Cancel Purchase Request</h3>
            <p className="text-xs text-slate-400 mb-4">Please specify a reason for cancelling request {request.requestNumber}:</p>
            <textarea
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-slate-200 mb-4 focus:outline-none focus:border-indigo-500"
              placeholder="Cancellation reason..."
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setCancelModalOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm">Close</button>
              <button onClick={handleCancelSubmit} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium">Confirm Cancellation</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
