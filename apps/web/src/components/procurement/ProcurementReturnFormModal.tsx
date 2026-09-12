import React, { useState } from 'react';

interface ProcurementReturnFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: any) => Promise<void>;
  companyId: string;
}

export const ProcurementReturnFormModal: React.FC<ProcurementReturnFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  companyId,
}) => {
  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [goodsReceiptId, setGoodsReceiptId] = useState('');
  const [goodsReceiptLineId, setGoodsReceiptLineId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('Damaged / Rejected Goods');
  const [notes, setNotes] = useState('');
  const [description, setDescription] = useState('Raw Material Return');
  const [uom, setUom] = useState('PCS');
  const [returnedQuantity, setReturnedQuantity] = useState('10.0000');
  const [unitPrice, setUnitPrice] = useState('500.00');
  const [taxRatePercent, setTaxRatePercent] = useState('18.00');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const qtyNum = parseFloat(returnedQuantity) || 0;
      const priceNum = parseFloat(unitPrice) || 0;
      const taxRateNum = parseFloat(taxRatePercent) || 0;

      const taxable = (qtyNum * priceNum).toFixed(2);
      const tax = ((parseFloat(taxable) * taxRateNum) / 100).toFixed(2);
      const cgst = (parseFloat(tax) / 2).toFixed(2);
      const sgst = (parseFloat(tax) / 2).toFixed(2);
      const lineTotal = (parseFloat(taxable) + parseFloat(tax)).toFixed(2);

      const payload = {
        companyId,
        supplierId: supplierId || 'sup_default_01',
        purchaseOrderId: purchaseOrderId || undefined,
        goodsReceiptId: goodsReceiptId || undefined,
        returnDate,
        reason,
        notes,
        lines: [
          {
            goodsReceiptLineId: goodsReceiptLineId || undefined,
            description,
            uom,
            returnedQuantity,
            unitPrice,
            taxableAmount: taxable,
            taxRatePercent,
            cgstAmount: cgst,
            sgstAmount: sgst,
            taxAmount: tax,
            lineTotal,
          },
        ],
      };

      await onSubmit(payload);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create procurement return.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17, 24, 39, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: '#ffffff', borderRadius: '16px', maxWidth: '640px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>New Procurement Return</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8125rem', color: '#94a3b8' }}>Record commercial return against accepted receipt</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          {error && (
            <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '0.875rem', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Return Date *</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Supplier ID *</label>
              <input
                type="text"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="sup_001"
                required
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Purchase Order ID</label>
              <input
                type="text"
                value={purchaseOrderId}
                onChange={(e) => setPurchaseOrderId(e.target.value)}
                placeholder="po_001 (Optional)"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Goods Receipt ID</label>
              <input
                type="text"
                value={goodsReceiptId}
                onChange={(e) => setGoodsReceiptId(e.target.value)}
                placeholder="grn_001 (Optional)"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Return Reason *</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem' }}
            />
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '16px', marginTop: '16px' }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>Returned Line Item Details</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '4px' }}>Item Description</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} required style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8125rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '4px' }}>Return Qty</label>
                <input type="text" value={returnedQuantity} onChange={(e) => setReturnedQuantity(e.target.value)} required style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8125rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '4px' }}>Unit Price (₹)</label>
                <input type="text" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.8125rem' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#ffffff', color: '#374151', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={isSubmitting} style={{ padding: '8px 18px', border: 'none', borderRadius: '6px', background: '#2563eb', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}>
              {isSubmitting ? 'Saving...' : 'Save Procurement Return'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
