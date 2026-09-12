import React from 'react';

interface OrderFulfillmentProgressProps {
  status: string;
  orderedQuantity: string;
  deliveredQuantity: string;
  invoicedQuantity: string;
}

export const OrderFulfillmentProgress: React.FC<OrderFulfillmentProgressProps> = ({
  status,
  orderedQuantity,
  deliveredQuantity,
  invoicedQuantity
}) => {
  const ordered = parseFloat(orderedQuantity || '0');
  const delivered = parseFloat(deliveredQuantity || '0');
  const invoiced = parseFloat(invoicedQuantity || '0');

  const deliveryPercent = ordered > 0 ? Math.min(100, Math.round((delivered / ordered) * 100)) : 0;
  const invoicePercent = ordered > 0 ? Math.min(100, Math.round((invoiced / ordered) * 100)) : 0;

  return (
    <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
        <span>Downstream Fulfillment Status ({status})</span>
        <span style={{ color: '#64748b' }}>Delivered: {delivered} / Invoiced: {invoiced} (Ordered: {ordered})</span>
      </div>
      <div style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '2px', color: '#475569' }}>
          <span>Delivery Progress (Phase 3.3 Handoff)</span>
          <span>{deliveryPercent}%</span>
        </div>
        <div style={{ height: '6px', backgroundColor: '#cbd5e1', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ width: `${deliveryPercent}%`, height: '100%', backgroundColor: '#2563eb', transition: 'width 0.3s' }} />
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '2px', color: '#475569' }}>
          <span>Invoicing Progress (Phase 3.4 Handoff)</span>
          <span>{invoicePercent}%</span>
        </div>
        <div style={{ height: '6px', backgroundColor: '#cbd5e1', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ width: `${invoicePercent}%`, height: '100%', backgroundColor: '#059669', transition: 'width 0.3s' }} />
        </div>
      </div>
    </div>
  );
};
