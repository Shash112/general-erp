import React from 'react';

interface CreditExposureCardProps {
  customerId: string;
  totalAmountBase: string;
  creditLimit?: string;
  arOutstanding?: string;
  unappliedReceipts?: string;
  openConfirmedOrders?: string;
  creditOverrideBy?: string | null;
  creditOverrideReason?: string | null;
}

export const CreditExposureCard: React.FC<CreditExposureCardProps> = ({
  customerId,
  totalAmountBase,
  creditLimit = '100000.00',
  arOutstanding = '0.00',
  unappliedReceipts = '0.00',
  openConfirmedOrders = '0.00',
  creditOverrideBy,
  creditOverrideReason
}) => {
  const currentOrder = parseFloat(totalAmountBase || '0');
  const ar = parseFloat(arOutstanding || '0');
  const unapplied = parseFloat(unappliedReceipts || '0');
  const openConfirmed = parseFloat(openConfirmedOrders || '0');
  const limit = parseFloat(creditLimit || '0');

  const totalExposure = ar - unapplied + openConfirmed + currentOrder;
  const isExceeded = limit > 0 && totalExposure > limit;

  return (
    <div
      style={{
        padding: '16px',
        border: `1px solid ${isExceeded ? '#fca5a5' : '#cbd5e1'}`,
        borderRadius: '8px',
        backgroundColor: isExceeded ? '#fef2f2' : '#ffffff',
        marginBottom: '16px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '14px', color: '#1e293b' }}>Customer Real-Time Credit Exposure</h4>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 600,
            backgroundColor: isExceeded ? '#fee2e2' : '#dcfce7',
            color: isExceeded ? '#991b1b' : '#166534'
          }}
        >
          {isExceeded ? 'Credit Limit Exceeded' : 'Within Credit Limit'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', fontSize: '13px' }}>
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>AR Outstanding</span>
          <strong>₹{ar.toFixed(2)}</strong>
        </div>
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Unapplied Cash (-</span>
          <strong style={{ color: '#059669' }}>-₹{unapplied.toFixed(2)}</strong>
        </div>
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Confirmed Open Orders</span>
          <strong>₹{openConfirmed.toFixed(2)}</strong>
        </div>
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Current Order Base</span>
          <strong>₹{currentOrder.toFixed(2)}</strong>
        </div>
      </div>

      <div
        style={{
          marginTop: '12px',
          paddingTop: '12px',
          borderTop: '1px dashed #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div>
          <span style={{ fontSize: '13px', color: '#475569' }}>Total Credit Exposure: </span>
          <strong style={{ fontSize: '15px', color: isExceeded ? '#dc2626' : '#0f172a' }}>
            ₹{totalExposure.toFixed(2)}
          </strong>
          <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>
            (Limit: {limit > 0 ? `₹${limit.toFixed(2)}` : 'Disabled / Unlimited'})
          </span>
        </div>
      </div>

      {creditOverrideReason && (
        <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fef3c7', borderRadius: '4px', fontSize: '12px', color: '#92400e' }}>
          <strong>Credit Override Approved:</strong> {creditOverrideReason} {creditOverrideBy && `(by ${creditOverrideBy})`}
        </div>
      )}
    </div>
  );
};
