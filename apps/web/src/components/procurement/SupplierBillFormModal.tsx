import React, { useState } from 'react';

export interface PurchaseOrderOption {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  currency: string;
  lines: Array<{
    id: string;
    productId?: string;
    description: string;
    productCodeSnapshot?: string;
    uom: string;
    orderedQuantity: string;
    acceptedQuantity?: string;
    unitPrice: string;
    taxableAmount: string;
    taxRatePercent?: string;
  }>;
}

interface SupplierBillFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseOrders: PurchaseOrderOption[];
  onSubmit: (data: any) => Promise<void>;
}

export const SupplierBillFormModal: React.FC<SupplierBillFormModalProps> = ({
  isOpen,
  onClose,
  purchaseOrders,
  onSubmit,
}) => {
  const [selectedPoId, setSelectedPoId] = useState<string>('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(new Date().toISOString().substring(0, 10));
  const [billDate, setBillDate] = useState(new Date().toISOString().substring(0, 10));
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10));
  const [remarks, setRemarks] = useState('');

  const [lines, setLines] = useState<
    Array<{
      purchaseOrderLineId?: string;
      goodsReceiptLineId?: string;
      productId?: string;
      descriptionSnapshot: string;
      productCodeSnapshot?: string;
      uom: string;
      billedQuantity: string;
      unitPrice: string;
      discount: string;
      cgstAmount: string;
      sgstAmount: string;
      igstAmount: string;
    }>
  >([
    {
      descriptionSnapshot: '',
      uom: 'PCS',
      billedQuantity: '1',
      unitPrice: '0.00',
      discount: '0.00',
      cgstAmount: '0.00',
      sgstAmount: '0.00',
      igstAmount: '0.00',
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePoSelect = (poId: string) => {
    setSelectedPoId(poId);
    const po = purchaseOrders.find((p) => p.id === poId);
    if (po && po.lines.length > 0) {
      setLines(
        po.lines.map((l) => ({
          purchaseOrderLineId: l.id,
          productId: l.productId,
          descriptionSnapshot: l.description,
          productCodeSnapshot: l.productCodeSnapshot,
          uom: l.uom,
          billedQuantity: l.acceptedQuantity || l.orderedQuantity,
          unitPrice: l.unitPrice,
          discount: '0.00',
          cgstAmount: '0.00',
          sgstAmount: '0.00',
          igstAmount: '0.00',
        }))
      );
    }
  };

  const handleAddLine = () => {
    setLines([
      ...lines,
      {
        descriptionSnapshot: '',
        uom: 'PCS',
        billedQuantity: '1',
        unitPrice: '0.00',
        discount: '0.00',
        cgstAmount: '0.00',
        sgstAmount: '0.00',
        igstAmount: '0.00',
      },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, field: string, value: string) => {
    const updated = [...lines];
    (updated[idx] as any)[field] = value;
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!supplierInvoiceNumber.trim()) {
      setErrorMsg('Supplier Invoice Number is required.');
      return;
    }

    if (lines.length === 0) {
      setErrorMsg('At least one line item is required.');
      return;
    }

    const selectedPo = purchaseOrders.find((p) => p.id === selectedPoId);

    const payload = {
      purchaseOrderId: selectedPoId || undefined,
      supplierId: selectedPo?.supplierId || 'supplier_default',
      supplierInvoiceNumber: supplierInvoiceNumber.trim(),
      supplierInvoiceDate,
      billDate,
      dueDate,
      remarks,
      lines: lines.map((l) => ({
        purchaseOrderLineId: l.purchaseOrderLineId || undefined,
        productId: l.productId || undefined,
        descriptionSnapshot: l.descriptionSnapshot,
        productCodeSnapshot: l.productCodeSnapshot || undefined,
        uom: l.uom,
        billedQuantity: l.billedQuantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
      })),
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create Supplier Bill.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Create Supplier Bill</h3>
            <p className="text-xs text-slate-400">Record supplier invoice and reference source Purchase Order / GRN.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg font-bold">
            ✕
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-md">
              {errorMsg}
            </div>
          )}

          {/* Form Header Fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Source Purchase Order (Optional)</label>
              <select
                value={selectedPoId}
                onChange={(e) => handlePoSelect(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Direct Bill / No PO --</option>
                {purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.poNumber} — {po.supplierName || po.supplierId}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Supplier Invoice # *</label>
              <input
                type="text"
                required
                placeholder="e.g. INV-2026-9001"
                value={supplierInvoiceNumber}
                onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Supplier Invoice Date *</label>
              <input
                type="date"
                required
                value={supplierInvoiceDate}
                onChange={(e) => setSupplierInvoiceDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">ERP Bill Date *</label>
              <input
                type="date"
                required
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Due Date *</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Remarks / Notes</label>
              <input
                type="text"
                placeholder="Optional supplier bill remarks..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Line Items Section */}
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
              <h4 className="font-semibold text-slate-200 text-sm">Bill Line Items</h4>
              <button
                type="button"
                onClick={handleAddLine}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-400 text-xs font-semibold rounded"
              >
                + Add Line Item
              </button>
            </div>

            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <div className="md:col-span-2">
                      <label className="block text-slate-500 mb-1">Item Description</label>
                      <input
                        type="text"
                        required
                        placeholder="Description snapshot..."
                        value={line.descriptionSnapshot}
                        onChange={(e) => handleLineChange(idx, 'descriptionSnapshot', e.target.value)}
                        className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">UOM</label>
                      <input
                        type="text"
                        required
                        value={line.uom}
                        onChange={(e) => handleLineChange(idx, 'uom', e.target.value)}
                        className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 uppercase focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">Billed Qty</label>
                      <input
                        type="number"
                        step="0.0001"
                        required
                        value={line.billedQuantity}
                        onChange={(e) => handleLineChange(idx, 'billedQuantity', e.target.value)}
                        className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 font-mono focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div>
                      <label className="block text-slate-500 mb-1">Unit Price (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={line.unitPrice}
                        onChange={(e) => handleLineChange(idx, 'unitPrice', e.target.value)}
                        className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 font-mono focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">Discount (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={line.discount}
                        onChange={(e) => handleLineChange(idx, 'discount', e.target.value)}
                        className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 font-mono focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">CGST (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={line.cgstAmount}
                        onChange={(e) => handleLineChange(idx, 'cgstAmount', e.target.value)}
                        className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 font-mono focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">SGST (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={line.sgstAmount}
                        onChange={(e) => handleLineChange(idx, 'sgstAmount', e.target.value)}
                        className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 font-mono focus:outline-none"
                      />
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="w-full">
                        <label className="block text-slate-500 mb-1">IGST (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={line.igstAmount}
                          onChange={(e) => handleLineChange(idx, 'igstAmount', e.target.value)}
                          className="w-full px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-slate-200 font-mono focus:outline-none"
                        />
                      </div>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="ml-2 p-1.5 text-rose-400 hover:text-rose-300 font-bold"
                          title="Remove line"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium shadow"
            >
              {submitting ? 'Creating Draft...' : 'Save Draft Supplier Bill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
