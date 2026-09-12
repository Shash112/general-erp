import React, { useState } from 'react';

export interface InspectionLineItem {
  lineId: string;
  lineNumber: number;
  descriptionSnapshot: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason?: string;
}

interface GRNInspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  grnNumber: string;
  lines: InspectionLineItem[];
  onSubmitInspection: (lines: Array<{ lineId: string; acceptedQuantity: string; rejectedQuantity: string; rejectionReason?: string }>) => Promise<void>;
}

export const GRNInspectionModal: React.FC<GRNInspectionModalProps> = ({
  isOpen,
  onClose,
  grnNumber,
  lines: initialLines,
  onSubmitInspection,
}) => {
  const [lines, setLines] = useState<InspectionLineItem[]>(initialLines);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLineUpdate = (index: number, field: string, value: string) => {
    const updated = [...lines];
    const target = { ...updated[index], [field]: value };

    if (field === 'acceptedQuantity') {
      const rec = parseFloat(target.receivedQuantity) || 0;
      const acc = parseFloat(value) || 0;
      target.rejectedQuantity = (rec - acc > 0 ? rec - acc : 0).toFixed(4);
    } else if (field === 'rejectedQuantity') {
      const rec = parseFloat(target.receivedQuantity) || 0;
      const rej = parseFloat(value) || 0;
      target.acceptedQuantity = (rec - rej > 0 ? rec - rej : 0).toFixed(4);
    }

    updated[index] = target;
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    for (const l of lines) {
      const rec = parseFloat(l.receivedQuantity) || 0;
      const acc = parseFloat(l.acceptedQuantity) || 0;
      const rej = parseFloat(l.rejectedQuantity) || 0;

      if (Math.abs(acc + rej - rec) > 0.0001) {
        setError(`Line ${l.lineNumber}: Accepted (${acc}) + Rejected (${rej}) must equal Received (${rec}).`);
        return;
      }

      if (rej > 0 && (!l.rejectionReason || !l.rejectionReason.trim())) {
        setError(`Line ${l.lineNumber}: Rejection reason is required when rejected quantity is > 0.`);
        return;
      }
    }

    try {
      setSubmitting(true);
      await onSubmitInspection(
        lines.map((l) => ({
          lineId: l.lineId,
          acceptedQuantity: l.acceptedQuantity,
          rejectedQuantity: l.rejectedQuantity,
          rejectionReason: l.rejectionReason,
        }))
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit quality inspection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Quality Inspection Workspace</h3>
            <p className="text-xs text-indigo-400 font-mono">GRN: {grnNumber}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-xl text-xs">{error}</div>}

          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase font-semibold">
                <tr>
                  <th className="p-2.5 text-left">Description</th>
                  <th className="p-2.5 text-right w-24">Received</th>
                  <th className="p-2.5 text-right w-24">Accepted *</th>
                  <th className="p-2.5 text-right w-24">Rejected *</th>
                  <th className="p-2.5 text-left">Rejection Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {lines.map((line, idx) => (
                  <tr key={line.lineId} className="hover:bg-slate-800/30">
                    <td className="p-2.5 font-medium text-white">{line.descriptionSnapshot}</td>
                    <td className="p-2.5 text-right font-mono font-bold text-indigo-400">{parseFloat(line.receivedQuantity).toFixed(2)}</td>
                    <td className="p-2.5 text-right">
                      <input
                        type="number"
                        step="0.0001"
                        value={line.acceptedQuantity}
                        onChange={(e) => handleLineUpdate(idx, 'acceptedQuantity', e.target.value)}
                        className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right font-mono text-emerald-400"
                      />
                    </td>
                    <td className="p-2.5 text-right">
                      <input
                        type="number"
                        step="0.0001"
                        value={line.rejectedQuantity}
                        onChange={(e) => handleLineUpdate(idx, 'rejectedQuantity', e.target.value)}
                        className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right font-mono text-rose-400"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="text"
                        value={line.rejectionReason || ''}
                        placeholder="Reason if rejected..."
                        onChange={(e) => handleLineUpdate(idx, 'rejectionReason', e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              {submitting ? 'Submitting Inspection...' : 'Complete Quality Inspection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
