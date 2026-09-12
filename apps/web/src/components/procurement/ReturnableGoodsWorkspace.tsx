import React, { useState } from 'react';

interface ReturnableGoodsWorkspaceProps {
  goodsReceiptLineId: string;
  acceptedQuantity: string;
  previouslyReturnedQuantity: string;
  maximumReturnableQuantity: string;
  onConfirmReturn: (qty: string, reason: string) => void;
}

export const ReturnableGoodsWorkspace: React.FC<ReturnableGoodsWorkspaceProps> = ({
  goodsReceiptLineId,
  acceptedQuantity,
  previouslyReturnedQuantity,
  maximumReturnableQuantity,
  onConfirmReturn,
}) => {
  const [returnQty, setReturnQty] = useState(maximumReturnableQuantity);
  const [reason, setReason] = useState('Damaged goods / Quality failure');
  const [error, setError] = useState<string | null>(null);

  const handleApply = () => {
    const requested = parseFloat(returnQty) || 0;
    const maxAllowed = parseFloat(maximumReturnableQuantity) || 0;

    if (requested <= 0) {
      setError('Returned quantity must be greater than zero.');
      return;
    }

    if (requested > maxAllowed) {
      setError(`Requested return quantity (${requested}) exceeds maximum returnable quantity (${maxAllowed}).`);
      return;
    }

    setError(null);
    onConfirmReturn(returnQty, reason);
  };

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginTop: '12px' }}>
      <h4 style={{ margin: '0 0 8px 0', fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>GRN Line Returnable Calculation</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px', fontSize: '0.8125rem' }}>
        <div>
          <span style={{ color: '#64748b' }}>Accepted Qty: </span>
          <strong style={{ color: '#0f172a' }}>{acceptedQuantity}</strong>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Previously Returned: </span>
          <strong style={{ color: '#d97706' }}>{previouslyReturnedQuantity}</strong>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Max Returnable Qty: </span>
          <strong style={{ color: '#16a34a' }}>{maximumReturnableQuantity}</strong>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8125rem', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 100px', gap: '12px', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#475569', marginBottom: '4px' }}>Return Qty</label>
          <input
            type="text"
            value={returnQty}
            onChange={(e) => setReturnQty(e.target.value)}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.8125rem' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#475569', marginBottom: '4px' }}>Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.8125rem' }}
          />
        </div>
        <button
          onClick={handleApply}
          style={{ background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '7px 12px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Confirm
        </button>
      </div>
    </div>
  );
};
