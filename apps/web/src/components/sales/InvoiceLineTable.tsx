import React from 'react';

export interface SalesInvoiceLineItem {
  id: string;
  lineNumber: number;
  salesOrderLineId?: string | null;
  salesDeliveryLineId?: string | null;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  description?: string | null;
  uom: string;
  invoicedQuantity: string;
  unitPrice: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
}

interface InvoiceLineTableProps {
  lines: SalesInvoiceLineItem[];
}

export const InvoiceLineTable: React.FC<InvoiceLineTableProps> = ({ lines }) => {
  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
            <th style={{ padding: '10px 14px', width: '50px' }}>#</th>
            <th style={{ padding: '10px 14px' }}>Product</th>
            <th style={{ padding: '10px 14px', textAlign: 'center' }}>UOM</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Qty</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Unit Price</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Taxable</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Tax (CGST/SGST/IGST)</th>
            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{line.lineNumber}</td>
              <td style={{ padding: '10px 14px' }}>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{line.productNameSnapshot}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  Code: {line.productCodeSnapshot}
                  {line.salesDeliveryLineId && <span style={{ marginLeft: '8px', color: '#0284c7' }}>(Delivery Line Ref)</span>}
                </div>
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'center', color: '#475569' }}>{line.uom}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                {parseFloat(line.invoicedQuantity).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>
                ₹{parseFloat(line.unitPrice).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>
                ₹{parseFloat(line.taxableAmount).toFixed(2)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#0284c7' }}>
                <div>₹{parseFloat(line.taxAmount).toFixed(2)}</div>
                {(parseFloat(line.cgstAmount) > 0 || parseFloat(line.sgstAmount) > 0 || parseFloat(line.igstAmount) > 0) && (
                  <div style={{ fontSize: '10px', color: '#64748b' }}>
                    {parseFloat(line.cgstAmount) > 0 && `C: ₹${parseFloat(line.cgstAmount).toFixed(2)} `}
                    {parseFloat(line.sgstAmount) > 0 && `S: ₹${parseFloat(line.sgstAmount).toFixed(2)} `}
                    {parseFloat(line.igstAmount) > 0 && `I: ₹${parseFloat(line.igstAmount).toFixed(2)}`}
                  </div>
                )}
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
