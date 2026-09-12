import React, { useState } from 'react';

export interface FormLineInput {
  productId?: string;
  description: string;
  requestedQuantity: string;
  uom: string;
  estimatedUnitPrice: string;
  estimatedDiscount?: string;
  estimatedTax?: string;
  specification?: string;
}

export interface PurchaseRequestFormValues {
  companyId: string;
  requiredDate: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  purpose?: string;
  justification?: string;
  notes?: string;
  lines: FormLineInput[];
}

interface PurchaseRequestFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: PurchaseRequestFormValues) => Promise<void>;
  companyId: string;
}

export const PurchaseRequestFormModal: React.FC<PurchaseRequestFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  companyId,
}) => {
  const [requiredDate, setRequiredDate] = useState<string>(
    new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  );
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [purpose, setPurpose] = useState<string>('');
  const [justification, setJustification] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [lines, setLines] = useState<FormLineInput[]>([
    { description: 'Raw Material Batch A', requestedQuantity: '10.0000', uom: 'PCS', estimatedUnitPrice: '500.00' }
  ]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddLine = () => {
    setLines([...lines, { description: '', requestedQuantity: '1.0000', uom: 'PCS', estimatedUnitPrice: '0.00' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length === 1) return;
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleLineChange = (index: number, field: keyof FormLineInput, value: string) => {
    const updated = [...lines];
    updated[index] = { ...updated[index], [field]: value };
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (lines.length === 0) {
      setErrorMsg('At least one item line is required');
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].description.trim()) {
        setErrorMsg(`Line ${i + 1}: Description is required`);
        return;
      }
      if (parseFloat(lines[i].requestedQuantity || '0') <= 0) {
        setErrorMsg(`Line ${i + 1}: Requested quantity must be greater than zero`);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        companyId,
        requiredDate,
        priority,
        purpose,
        justification,
        notes,
        lines,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create purchase request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-950/40">
          <div>
            <h3 className="text-lg font-bold text-slate-100">Create Purchase Request</h3>
            <p className="text-xs text-slate-400 mt-0.5">Internal request for operational materials or services</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg text-rose-300 text-sm">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Required Date *</label>
              <input
                type="date"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="LOW">LOW</option>
                <option value="NORMAL">NORMAL</option>
                <option value="HIGH">HIGH</option>
                <option value="URGENT">URGENT</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Purpose / Title</label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Q3 Manufacturing Raw Material"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Business Justification</label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              placeholder="Reason for procurement request..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Lines Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wide">Requested Line Items</h4>
              <button
                type="button"
                onClick={handleAddLine}
                className="px-3 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 rounded text-xs font-medium transition-colors"
              >
                + Add Item
              </button>
            </div>

            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg flex flex-col md:flex-row gap-3 items-start md:items-center">
                  <div className="flex-1 w-full">
                    <input
                      type="text"
                      placeholder="Item Description *"
                      value={line.description}
                      onChange={(e) => handleLineChange(idx, 'description', e.target.value)}
                      required
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="w-28">
                    <input
                      type="number"
                      step="0.0001"
                      placeholder="Qty *"
                      value={line.requestedQuantity}
                      onChange={(e) => handleLineChange(idx, 'requestedQuantity', e.target.value)}
                      required
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="w-24">
                    <input
                      type="text"
                      placeholder="UOM"
                      value={line.uom}
                      onChange={(e) => handleLineChange(idx, 'uom', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="w-32">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Est. Price"
                      value={line.estimatedUnitPrice}
                      onChange={(e) => handleLineChange(idx, 'estimatedUnitPrice', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(idx)}
                      className="text-rose-400 hover:text-rose-300 p-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm shadow-lg shadow-indigo-600/20 transition-all"
            >
              {isSubmitting ? 'Saving...' : 'Save Draft Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
