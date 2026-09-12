import React from 'react';

export interface SalesDeliveryLineItem {
  id: string;
  lineNumber: number;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description?: string | null;
  uom: string;
  orderedQuantitySnapshot: string;
  previouslyDeliveredQuantitySnapshot: string;
  deliveryQuantity: string;
  rejectedQuantity: string;
  remainingQuantitySnapshot: string;
  notes?: string | null;
}

interface DeliveryLineTableProps {
  lines: SalesDeliveryLineItem[];
}

export const DeliveryLineTable: React.FC<DeliveryLineTableProps> = ({ lines }) => {
  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
            <th style={{ padding: '10px 14px', width: '50px' }}>#</th>
            <th style={{ padding: '10px 14px' }}>Product</th>
            <th style={{ padding: '10px 14px', textAlign: 'center' }}>UOM</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Ordered</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Prev Delivered</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>This Delivery</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Rejected</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{line.lineNumber}</td>
              <td style={{ padding: '10px 14px' }}>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{line.productNameSnapshot}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Code: {line.productCodeSnapshot}</div>
                {line.description && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{line.description}</div>}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'center', color: '#475569' }}>{line.uom}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>
                {parseFloat(line.orderedQuantitySnapshot).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#64748b' }}>
                {parseFloat(line.previouslyDeliveredQuantitySnapshot).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#2563eb' }}>
                {parseFloat(line.deliveryQuantity).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#dc2626' }}>
                {parseFloat(line.rejectedQuantity).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#475569' }}>
                {parseFloat(line.remainingQuantitySnapshot).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
