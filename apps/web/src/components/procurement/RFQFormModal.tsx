import React, { useState } from 'react';

export interface RFQFormValues {
  title: string;
  responseDueDate: string;
  purpose?: string;
  instructions?: string;
  terms?: string;
  lines: {
    description: string;
    requestedQuantity: string;
    uom: string;
    targetDate?: string;
  }[];
}

interface RFQFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: RFQFormValues) => Promise<void>;
  companyId: string;
}

export const RFQFormModal: React.FC<RFQFormModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [responseDueDate, setResponseDueDate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [instructions, setInstructions] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<{ description: string; requestedQuantity: string; uom: string; targetDate: string }[]>([
    { description: '', requestedQuantity: '1.0000', uom: 'PCS', targetDate: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAddLine = () => {
    setLines([...lines, { description: '', requestedQuantity: '1.0000', uom: 'PCS', targetDate: '' }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length === 1) return;
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        title,
        responseDueDate,
        purpose,
        instructions,
        terms,
        lines
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden my-8">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white tracking-tight">Create Request for Quotation (RFQ)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">RFQ Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q4 Component Sourcing Inquiry"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Response Due Date *</label>
              <input
                type="date"
                required
                value={responseDueDate}
                onChange={(e) => setResponseDueDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Purpose / Scope</label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Commercial rationale for sourcing inquiry"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Requested Items</h4>
              <button
                type="button"
                onClick={handleAddLine}
                className="px-3 py-1 bg-indigo-950 text-indigo-400 border border-indigo-800 hover:bg-indigo-900 rounded-lg text-xs font-semibold"
              >
                + Add Item
              </button>
            </div>

            {lines.map((line, idx) => (
              <div key={idx} className="bg-slate-950 p-3 rounded-xl border border-slate-800 grid grid-cols-12 gap-3 items-center">
                <div className="col-span-5">
                  <input
                    type="text"
                    required
                    placeholder="Description / Spec *"
                    value={line.description}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].description = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    step="0.0001"
                    required
                    placeholder="Qty *"
                    value={line.requestedQuantity}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].requestedQuantity = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="text"
                    required
                    placeholder="UOM (e.g. PCS) *"
                    value={line.uom}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].uom = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-1 text-right">
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(idx)}
                    className="text-rose-400 hover:text-rose-300 font-bold text-base"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20"
            >
              {isSubmitting ? 'Creating...' : 'Create RFQ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
