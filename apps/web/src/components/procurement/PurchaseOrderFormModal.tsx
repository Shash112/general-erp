import React, { useState } from 'react';

export interface PurchaseOrderFormValues {
  supplierId: string;
  expectedDeliveryDate: string;
  purchaseRequestId?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  notes?: string;
  lines: {
    description: string;
    orderedQuantity: string;
    uom: string;
    unitPrice: string;
    discount?: string;
    taxRate?: string;
  }[];
}

interface PurchaseOrderFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: PurchaseOrderFormValues) => Promise<void>;
  companyId: string;
}

export const PurchaseOrderFormModal: React.FC<PurchaseOrderFormModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [supplierId, setSupplierId] = useState('sup_vendor_01');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [purchaseRequestId, setPurchaseRequestId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [deliveryTerms, setDeliveryTerms] = useState('FOB Destination');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{
    description: string;
    orderedQuantity: string;
    uom: string;
    unitPrice: string;
    discount: string;
    taxRate: string;
  }[]>([
    { description: 'High-Grade Steel Alloy Rods 10mm', orderedQuantity: '10.0000', uom: 'PCS', unitPrice: '500.00', discount: '0.00', taxRate: '18.00' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAddLine = () => {
    setLines([...lines, { description: '', orderedQuantity: '1.0000', uom: 'PCS', unitPrice: '0.00', discount: '0.00', taxRate: '18.00' }]);
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
        supplierId,
        expectedDeliveryDate,
        purchaseRequestId: purchaseRequestId || undefined,
        paymentTerms,
        deliveryTerms,
        notes,
        lines
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden my-8">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white tracking-tight">Create Purchase Order (PO)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Supplier ID *</label>
              <input
                type="text"
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="sup_01"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Expected Delivery Date *</label>
              <input
                type="date"
                required
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Source PR Number (Optional)</label>
              <input
                type="text"
                value={purchaseRequestId}
                onChange={(e) => setPurchaseRequestId(e.target.value)}
                placeholder="PR-2026-0001"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Payment Terms</label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Delivery Terms</label>
              <input
                type="text"
                value={deliveryTerms}
                onChange={(e) => setDeliveryTerms(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Purchase Order Items</h4>
              <button
                type="button"
                onClick={handleAddLine}
                className="px-3 py-1 bg-indigo-950 text-indigo-400 border border-indigo-800 hover:bg-indigo-900 rounded-lg text-xs font-semibold"
              >
                + Add Item
              </button>
            </div>

            {lines.map((l, idx) => (
              <div key={idx} className="bg-slate-950 p-3 rounded-xl border border-slate-800 grid grid-cols-12 gap-3 items-center">
                <div className="col-span-4">
                  <input
                    type="text"
                    required
                    placeholder="Description *"
                    value={l.description}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].description = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.0001"
                    required
                    placeholder="Qty *"
                    value={l.orderedQuantity}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].orderedQuantity = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="text"
                    required
                    placeholder="UOM *"
                    value={l.uom}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].uom = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Unit Price *"
                    value={l.unitPrice}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].unitPrice = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="col-span-1 text-right">
                  <span className="font-mono font-bold text-emerald-400 text-xs">
                    {((parseFloat(l.orderedQuantity) || 0) * (parseFloat(l.unitPrice) || 0)).toFixed(2)}
                  </span>
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
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20"
            >
              {isSubmitting ? 'Creating...' : 'Create Draft PO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
