import React from 'react';

export interface SalesOrderLineData {
  id: string;
  lineNumber: number;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description?: string | null;
  uom: string;
  orderedQuantity: string;
  deliveredQuantity: string;
  invoicedQuantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  allocatedHeaderDiscountAmount: string;
  grossAmount: string;
  taxableAmount: string;
  hsnSac: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
}

interface OrderLineTableProps {
  lines: SalesOrderLineData[];
}

export const OrderLineTable: React.FC<OrderLineTableProps> = ({ lines }) => {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
        <thead>
          <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
            <th style={{ padding: '8px 12px' }}>#</th>
            <th style={{ padding: '8px 12px' }}>Item / Code</th>
            <th style={{ padding: '8px 12px' }}>UOM</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Qty</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Unit Price</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Gross Amt</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Discount</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Taxable Amt</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>GST</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(line => (
            <tr key={line.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '8px 12px' }}>{line.lineNumber}</td>
              <td style={{ padding: '8px 12px' }}>
                <strong>{line.productCodeSnapshot}</strong>
                <div style={{ fontSize: '12px', color: '#475569' }}>{line.productNameSnapshot}</div>
              </td>
              <td style={{ padding: '8px 12px' }}>{line.uom}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>{line.orderedQuantity}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{parseFloat(line.unitPrice).toFixed(2)}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{parseFloat(line.grossAmount).toFixed(2)}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                ₹{(parseFloat(line.discountAmount) + parseFloat(line.allocatedHeaderDiscountAmount || '0')).toFixed(2)}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{parseFloat(line.taxableAmount).toFixed(2)}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{parseFloat(line.taxAmount).toFixed(2)}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                ₹{parseFloat(line.lineTotal).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
