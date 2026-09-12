import React from 'react';

export interface SalesReturnLineItem {
  id: string;
  lineNumber: number;
  originalInvoiceLineId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  uom: string;
  originalInvoicedQuantity: string;
  previouslyReturnedQuantity: string;
  returnQuantity: string;
  unitPrice: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
  reason?: string | null;
}

interface ReturnLineTableProps {
  lines: SalesReturnLineItem[];
}

export const ReturnLineTable: React.FC<ReturnLineTableProps> = ({ lines }) => {
  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
            <th style={{ padding: '10px 14px', width: '40px' }}>#</th>
            <th style={{ padding: '10px 14px' }}>Product</th>
            <th style={{ padding: '10px 14px', textAlign: 'center' }}>UOM</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Invoiced</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Prev Returned</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Return Qty</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Unit Price</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Taxable</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Tax Reversal</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Total Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{line.lineNumber}</td>
              <td style={{ padding: '10px 14px' }}>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{line.productNameSnapshot}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Code: {line.productCodeSnapshot}</div>
                {line.reason && <div style={{ fontSize: '11px', color: '#ea580c', marginTop: '2px' }}>Reason: {line.reason}</div>}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'center', color: '#475569' }}>{line.uom}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#64748b' }}>
                {parseFloat(line.originalInvoicedQuantity).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#64748b' }}>
                {parseFloat(line.previouslyReturnedQuantity).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                {parseFloat(line.returnQuantity).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>
                ₹{parseFloat(line.unitPrice).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>
                ₹{parseFloat(line.taxableAmount).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#0284c7' }}>
                ₹{parseFloat(line.taxAmount).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                ₹{parseFloat(line.lineTotal).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
