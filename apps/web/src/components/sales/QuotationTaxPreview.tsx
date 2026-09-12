import React from 'react';

export interface QuotationTaxPreviewProps {
  subtotalAmount: string;
  lineDiscountAmount: string;
  headerDiscountAmount: string;
  discountAmount: string;
  taxableAmount: string;
  cgstTotal?: string;
  sgstTotal?: string;
  igstTotal?: string;
  taxAmount: string;
  totalAmount: string;
  totalAmountBase: string;
  currency?: string;
  exchangeRate?: string;
}

export function QuotationTaxPreview({
  subtotalAmount,
  lineDiscountAmount,
  headerDiscountAmount,
  discountAmount,
  taxableAmount,
  cgstTotal = '0.00',
  sgstTotal = '0.00',
  igstTotal = '0.00',
  taxAmount,
  totalAmount,
  totalAmountBase,
  currency = 'INR',
  exchangeRate = '1.000000'
}: QuotationTaxPreviewProps) {
  const isForeign = currency !== 'INR';

  return (
    <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem', width: '360px', marginLeft: 'auto' }}>
      <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: '0.4rem' }}>
        Estimated Commercial Breakdown
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.875rem', color: '#334155' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Gross Line Subtotal:</span>
          <span style={{ fontWeight: 600 }}>{currency} {subtotalAmount}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
          <span>Line Discounts:</span>
          <span>- {currency} {lineDiscountAmount}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b91c1c' }}>
          <span>Header Discount:</span>
          <span style={{ fontWeight: 600 }}>- {currency} {headerDiscountAmount}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: '0.4rem', color: '#0f172a', fontWeight: 600 }}>
          <span>Net Taxable Base:</span>
          <span>{currency} {taxableAmount}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontSize: '0.8rem', paddingLeft: '0.5rem' }}>
          <span>CGST Total:</span>
          <span>+ {currency} {cgstTotal}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontSize: '0.8rem', paddingLeft: '0.5rem' }}>
          <span>SGST Total:</span>
          <span>+ {currency} {sgstTotal}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontSize: '0.8rem', paddingLeft: '0.5rem' }}>
          <span>IGST Total:</span>
          <span>+ {currency} {igstTotal}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2563eb', fontWeight: 600 }}>
          <span>Total Estimated GST:</span>
          <span>+ {currency} {taxAmount}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #1e293b', paddingTop: '0.5rem', marginTop: '0.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
          <span>Final Net Total:</span>
          <span style={{ color: '#047857' }}>{currency} {totalAmount}</span>
        </div>

        {isForeign && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem', backgroundColor: '#eff6ff', padding: '0.4rem', borderRadius: '4px' }}>
            <span>Base Equivalent (INR @ {exchangeRate}):</span>
            <span style={{ fontWeight: 600 }}>₹ {totalAmountBase}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default QuotationTaxPreview;
