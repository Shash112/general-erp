import React, { useState, useEffect } from 'react';

export interface PoReceivableLine {
  purchaseOrderLineId: string;
  productId?: string;
  productCodeSnapshot?: string;
  productNameSnapshot?: string;
  description: string;
  uom: string;
  orderedQuantity: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  remainingReceivableQuantity: string;
}

export interface PurchaseOrderOption {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
}

interface GRNFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseOrders: PurchaseOrderOption[];
  onFetchReceivableLines: (poId: string) => Promise<PoReceivableLine[]>;
  onSubmit: (data: any) => Promise<void>;
}

export const GRNFormModal: React.FC<GRNFormModalProps> = ({
  isOpen,
  onClose,
  purchaseOrders,
  onFetchReceivableLines,
  onSubmit,
}) => {
  const [selectedPoId, setSelectedPoId] = useState('');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);
  const [warehouseId, setWarehouseId] = useState('MAIN-WH');
  const [receivingLocationId, setReceivingLocationId] = useState('DOCK-1');
  const [supplierDeliveryNoteNumber, setSupplierDeliveryNoteNumber] = useState('');
  const [supplierDeliveryNoteDate, setSupplierDeliveryNoteDate] = useState(new Date().toISOString().split('T')[0]);
  const [transporter, setTransporter] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<
    Array<{
      purchaseOrderLineId: string;
      productId?: string;
      descriptionSnapshot: string;
      productCodeSnapshot: string;
      uom: string;
      orderedQuantity: string;
      previouslyReceivedQuantity: string;
      remainingReceivableQuantity: string;
      receivedQuantity: string;
      acceptedQuantity: string;
      rejectedQuantity: string;
      inspectionRequired: boolean;
      rejectionReason: string;
    }>
  >([]);

  const [loadingLines, setLoadingLines] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPoId) {
      setLoadingLines(true);
      onFetchReceivableLines(selectedPoId)
        .then((recLines) => {
          setLines(
            recLines.map((l) => ({
              purchaseOrderLineId: l.purchaseOrderLineId,
              productId: l.productId,
              descriptionSnapshot: l.description,
              productCodeSnapshot: l.productCodeSnapshot || '',
              uom: l.uom,
              orderedQuantity: l.orderedQuantity,
              previouslyReceivedQuantity: l.receivedQuantity,
              remainingReceivableQuantity: l.remainingReceivableQuantity,
              receivedQuantity: l.remainingReceivableQuantity,
              acceptedQuantity: l.remainingReceivableQuantity,
              rejectedQuantity: '0.0000',
              inspectionRequired: false,
              rejectionReason: '',
            }))
          );
        })
        .catch((err) => setError(err.message || 'Failed to load PO receivable lines.'))
        .finally(() => setLoadingLines(false));
    } else {
      setLines([]);
    }
  }, [selectedPoId, onFetchReceivableLines]);

  if (!isOpen) return null;

  const handleLineChange = (index: number, field: string, value: any) => {
    const updated = [...lines];
    const target = { ...updated[index], [field]: value };

    if (field === 'receivedQuantity') {
      const rec = parseFloat(value) || 0;
      const rej = parseFloat(target.rejectedQuantity) || 0;
      target.acceptedQuantity = (rec - rej > 0 ? rec - rej : 0).toFixed(4);
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
    if (!selectedPoId) {
      setError('Please select a Purchase Order.');
      return;
    }
    if (lines.length === 0) {
      setError('At least one item line is required.');
      return;
    }

    const selectedPo = purchaseOrders.find((p) => p.id === selectedPoId);

    try {
      setSubmitting(true);
      await onSubmit({
        purchaseOrderId: selectedPoId,
        supplierId: selectedPo?.supplierId,
        receiptDate,
        warehouseId,
        receivingLocationId,
        supplierDeliveryNoteNumber,
        supplierDeliveryNoteDate,
        transporter,
        vehicleNumber,
        lrNumber,
        receivedBy: receivedBy || 'Store Receiver',
        notes,
        lines: lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          productId: l.productId,
          descriptionSnapshot: l.descriptionSnapshot,
          productCodeSnapshot: l.productCodeSnapshot,
          uom: l.uom,
          receivedQuantity: l.receivedQuantity,
          acceptedQuantity: l.acceptedQuantity,
          rejectedQuantity: l.rejectedQuantity,
          inspectionRequired: l.inspectionRequired,
          rejectionReason: l.rejectionReason,
        })),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit Goods Receipt.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
          <h3 className="text-base font-bold text-white tracking-tight">Record Goods Receipt Note (GRN)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {error && <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-xl text-xs">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Select Purchase Order *</label>
              <select
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Select Issued/Acknowledged PO --</option>
                {purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.poNumber} ({po.supplierName || 'Supplier'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Receipt Date *</label>
              <input
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Warehouse / Location</label>
              <input
                type="text"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                placeholder="e.g. MAIN-WH"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Supplier Delivery Note #</label>
              <input
                type="text"
                value={supplierDeliveryNoteNumber}
                onChange={(e) => setSupplierDeliveryNoteNumber(e.target.value)}
                placeholder="e.g. DN-90123"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Vehicle / Transporter</label>
              <input
                type="text"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="e.g. KA-01-AB-1234"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Received By</label>
              <input
                type="text"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder="Receiver name"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-2">Receivable Line Items</h4>
            {loadingLines ? (
              <div className="py-6 text-center text-xs text-slate-400">Loading PO receivable lines...</div>
            ) : lines.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                Select a Purchase Order to populate receivable lines.
              </div>
            ) : (
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase font-semibold">
                    <tr>
                      <th className="p-2.5 text-left">Description</th>
                      <th className="p-2.5 text-right">Ordered</th>
                      <th className="p-2.5 text-right">Prev. Rec</th>
                      <th className="p-2.5 text-right">Remaining</th>
                      <th className="p-2.5 text-right w-24">Received *</th>
                      <th className="p-2.5 text-right w-24">Accepted</th>
                      <th className="p-2.5 text-right w-24">Rejected</th>
                      <th className="p-2.5 text-center">Inspect?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {lines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/30">
                        <td className="p-2.5 font-medium text-white">
                          {line.productCodeSnapshot ? `[${line.productCodeSnapshot}] ` : ''}
                          {line.descriptionSnapshot}
                        </td>
                        <td className="p-2.5 text-right font-mono">{parseFloat(line.orderedQuantity).toFixed(2)}</td>
                        <td className="p-2.5 text-right font-mono text-slate-400">{parseFloat(line.previouslyReceivedQuantity).toFixed(2)}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-amber-400">{parseFloat(line.remainingReceivableQuantity).toFixed(2)}</td>
                        <td className="p-2.5 text-right">
                          <input
                            type="number"
                            step="0.0001"
                            value={line.receivedQuantity}
                            onChange={(e) => handleLineChange(idx, 'receivedQuantity', e.target.value)}
                            className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right font-mono text-white"
                          />
                        </td>
                        <td className="p-2.5 text-right">
                          <input
                            type="number"
                            step="0.0001"
                            value={line.acceptedQuantity}
                            onChange={(e) => handleLineChange(idx, 'acceptedQuantity', e.target.value)}
                            className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right font-mono text-emerald-400"
                          />
                        </td>
                        <td className="p-2.5 text-right">
                          <input
                            type="number"
                            step="0.0001"
                            value={line.rejectedQuantity}
                            onChange={(e) => handleLineChange(idx, 'rejectedQuantity', e.target.value)}
                            className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right font-mono text-rose-400"
                          />
                        </td>
                        <td className="p-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={line.inspectionRequired}
                            onChange={(e) => handleLineChange(idx, 'inspectionRequired', e.target.checked)}
                            className="rounded border-slate-700 text-indigo-600"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              {submitting ? 'Creating GRN...' : 'Save & Submit GRN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
