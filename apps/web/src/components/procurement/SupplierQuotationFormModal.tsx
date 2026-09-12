import React, { useState } from 'react';

export interface SupplierQuotationFormValues {
  supplierId: string;
  supplierQuoteNumber: string;
  validUntil: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  lines: {
    description: string;
    quotedQuantity: string;
    uom: string;
    unitPrice: string;
    discount?: string;
    tax?: string;
    leadTimeDays?: number;
  }[];
}

interface SupplierQuotationFormModalProps {
  isOpen: boolean;
  rfqId?: string | null;
  onClose: () => void;
  onSubmit: (values: SupplierQuotationFormValues) => Promise<void>;
}

export const SupplierQuotationFormModal: React.FC<SupplierQuotationFormModalProps> = ({
  isOpen,
  rfqId,
  onClose,
  onSubmit
}) => {
  const [supplierId, setSupplierId] = useState('');
  const [supplierQuoteNumber, setSupplierQuoteNumber] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [deliveryTerms, setDeliveryTerms] = useState('FOB Origin');
  const [lines, setLines] = useState<{
    description: string;
    quotedQuantity: string;
    uom: string;
    unitPrice: string;
    discount: string;
    tax: string;
    leadTimeDays: number;
  }[]>([
    { description: 'Item Quote', quotedQuantity: '10.0000', uom: 'PCS', unitPrice: '100.00', discount: '0.00', tax: '0.00', leadTimeDays: 7 }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        supplierId: supplierId || 'sup_01',
        supplierQuoteNumber,
        validUntil,
        paymentTerms,
        deliveryTerms,
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
          <h3 className="text-lg font-bold text-white tracking-tight">Log Supplier Quotation Response</h3>
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
                placeholder="sup_vendor_01"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Supplier Quote Ref *</label>
              <input
                type="text"
                required
                value={supplierQuoteNumber}
                onChange={(e) => setSupplierQuoteNumber(e.target.value)}
                placeholder="SQ-VEND-9921"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Valid Until *</label>
              <input
                type="date"
                required
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
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

          {/* Lines */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Quoted Lines</h4>
            {lines.map((l, idx) => (
              <div key={idx} className="bg-slate-950 p-4 rounded-xl border border-slate-800 grid grid-cols-12 gap-3 items-center">
                <div className="col-span-4">
                  <label className="block text-[10px] text-slate-400">Description</label>
                  <input
                    type="text"
                    required
                    value={l.description}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].description = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-400">Qty</label>
                  <input
                    type="number"
                    required
                    value={l.quotedQuantity}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].quotedQuantity = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-400">Unit Price (INR)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={l.unitPrice}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].unitPrice = e.target.value;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-400">Lead Time (Days)</label>
                  <input
                    type="number"
                    value={l.leadTimeDays}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx].leadTimeDays = parseInt(e.target.value) || 0;
                      setLines(updated);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white"
                  />
                </div>
                <div className="col-span-2 text-right">
                  <label className="block text-[10px] text-slate-400">Total (INR)</label>
                  <span className="font-mono font-bold text-emerald-400 text-xs">
                    {((parseFloat(l.quotedQuantity) || 0) * (parseFloat(l.unitPrice) || 0)).toFixed(2)}
                  </span>
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
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold"
            >
              {isSubmitting ? 'Submitting...' : 'Save Quotation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
