import React, { useState } from 'react';
import { QuotationLineEditor, EditableLineItem } from './QuotationLineEditor';
import { QuotationTaxPreview } from './QuotationTaxPreview';
import { QuotationActionToolbar } from './QuotationActionToolbar';
import { QuotationHistoryTimeline } from './QuotationHistoryTimeline';

export interface QuotationBuilderFormProps {
  initialData?: any;
  onSaveDraft?: (data: any) => void;
  onActionTrigger?: (action: string, id: string, payload?: any) => void;
}

export function QuotationBuilderForm({ initialData, onSaveDraft, onActionTrigger }: QuotationBuilderFormProps) {
  const [customerId, setCustomerId] = useState(initialData?.customerId || 'cust_acme_corp');
  const [quotationDate, setQuotationDate] = useState(initialData?.quotationDate || new Date().toISOString().split('T')[0]);
  const [validityDate, setValidityDate] = useState(initialData?.validityDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
  const [currency, setCurrency] = useState(initialData?.currency || 'INR');
  const [exchangeRate, setExchangeRate] = useState(initialData?.exchangeRate || '1.000000');
  const [headerDiscountAmount, setHeaderDiscountAmount] = useState(initialData?.headerDiscountAmount || '0.00');
  const [billingAddressId, setBillingAddressId] = useState(initialData?.billingAddressId || 'addr_hq_billing');
  const [shippingAddressId, setShippingAddressId] = useState(initialData?.shippingAddressId || 'addr_wh_shipping');
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [terms, setTerms] = useState(initialData?.termsAndConditions || '1. Valid for 30 days.\n2. Payment terms 30 days net.');
  
  const [lines, setLines] = useState<EditableLineItem[]>(initialData?.lines || [
    {
      productId: 'prod_bearing_1',
      productCode: 'PROD-BEAR-01',
      productName: 'Industrial Roller Bearing 50mm',
      uom: 'PCS',
      quantity: 10,
      unitPrice: 1500.0,
      discountPercent: 5.0,
      pricingSource: 'PRICE_LIST'
    },
    {
      productId: 'prod_seal_2',
      productCode: 'PROD-SEAL-02',
      productName: 'High Pressure Oil Seal',
      uom: 'PCS',
      quantity: 50,
      unitPrice: 250.0,
      discountPercent: 0.0,
      pricingSource: 'PRODUCT_DEFAULT'
    }
  ]);

  const currentStatus = initialData?.status || 'DRAFT';
  const isReadOnly = currentStatus !== 'DRAFT';

  // Live total preview calculations
  let subtotal = 0;
  let lineDiscount = 0;

  for (const line of lines) {
    const qty = Number(line.quantity || 0);
    const price = Number(line.unitPrice || 0);
    const disc = Number(line.discountPercent || 0);
    const gross = Math.round((qty * price) * 100) / 100;
    const lDisc = Math.round((gross * disc / 100) * 100) / 100;
    subtotal += gross;
    lineDiscount += lDisc;
  }

  const headerDisc = Number(headerDiscountAmount || 0);
  const totalDisc = lineDiscount + headerDisc;
  const taxable = Math.max(0, subtotal - totalDisc);
  const estimatedGst = Math.round((taxable * 0.18) * 100) / 100; // 18% GST estimate
  const finalTotal = Math.round((taxable + estimatedGst) * 100) / 100;
  const exRateNum = Number(exchangeRate || 1.0);
  const baseTotal = Math.round((finalTotal * exRateNum) * 100) / 100;

  return (
    <div style={{ backgroundColor: '#ffffff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>
            {initialData ? `Sales Quotation ${initialData.quotationNumber} (Rev ${initialData.revisionNumber})` : 'New Sales Proposal'}
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Status: <strong style={{ color: '#2563eb' }}>{currentStatus}</strong></span>
        </div>

        {initialData?.conversionContractId && (
          <div style={{ backgroundColor: '#f3e8ff', color: '#6b21a8', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
            ✓ Conversion Contract Issued: {initialData.conversionContractId}
          </div>
        )}
      </div>

      {initialData && (
        <QuotationActionToolbar
          status={currentStatus}
          onSubmitForApproval={() => onActionTrigger && onActionTrigger('submit', initialData.id)}
          onApprove={() => onActionTrigger && onActionTrigger('approve', initialData.id)}
          onReject={() => onActionTrigger && onActionTrigger('reject', initialData.id, { rejectionReason: 'Price threshold exceeded' })}
          onSend={() => onActionTrigger && onActionTrigger('send', initialData.id)}
          onAccept={() => onActionTrigger && onActionTrigger('accept', initialData.id)}
          onCreateRevision={() => onActionTrigger && onActionTrigger('revision', initialData.id)}
          onCancel={() => onActionTrigger && onActionTrigger('cancel', initialData.id)}
          onIssueContract={() => onActionTrigger && onActionTrigger('convert-contract', initialData.id)}
        />
      )}

      {/* Header Fields Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.2rem' }}>Customer</label>
          <select
            disabled={isReadOnly}
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
          >
            <option value="cust_acme_corp">Acme Corporation India Pvt Ltd</option>
            <option value="cust_tech_ind">TechIndustries Pvt Ltd</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.2rem' }}>Quotation Date</label>
          <input
            type="date"
            disabled={isReadOnly}
            value={quotationDate}
            onChange={e => setQuotationDate(e.target.value)}
            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.2rem' }}>Validity Expiration Date</label>
          <input
            type="date"
            disabled={isReadOnly}
            value={validityDate}
            onChange={e => setValidityDate(e.target.value)}
            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.2rem' }}>Currency & FX Rate</label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <select
              disabled={isReadOnly}
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              style={{ width: '80px', padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            >
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
            <input
              type="text"
              disabled={isReadOnly || currency === 'INR'}
              value={exchangeRate}
              onChange={e => setExchangeRate(e.target.value)}
              style={{ flex: 1, padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.2rem' }}>Billing Address</label>
          <select
            disabled={isReadOnly}
            value={billingAddressId}
            onChange={e => setBillingAddressId(e.target.value)}
            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
          >
            <option value="addr_hq_billing">HQ Billing Address (Mumbai, MH - 27)</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.2rem' }}>Shipping Address (Tax POS)</label>
          <select
            disabled={isReadOnly}
            value={shippingAddressId}
            onChange={e => setShippingAddressId(e.target.value)}
            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
          >
            <option value="addr_wh_shipping">Warehouse Shipping Address (Pune, MH - 27)</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.2rem' }}>Header Discount Amount (₹)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            disabled={isReadOnly}
            value={headerDiscountAmount}
            onChange={e => setHeaderDiscountAmount(e.target.value)}
            style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 600, color: '#b91c1c' }}
          />
        </div>
      </div>

      {/* Line Item Grid */}
      <QuotationLineEditor lines={lines} onChange={setLines} isReadOnly={isReadOnly} />

      {/* Lower Summary & Tax Preview Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '1.5rem', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
            Customer Notes & Technical Specs
            <textarea
              rows={3}
              disabled={isReadOnly}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            />
          </label>

          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
            Commercial Terms & Legal Conditions
            <textarea
              rows={3}
              disabled={isReadOnly}
              value={terms}
              onChange={e => setTerms(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', marginTop: '0.2rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            />
          </label>
        </div>

        <QuotationTaxPreview
          subtotalAmount={subtotal.toFixed(2)}
          lineDiscountAmount={lineDiscount.toFixed(2)}
          headerDiscountAmount={Number(headerDiscountAmount || 0).toFixed(2)}
          discountAmount={totalDisc.toFixed(2)}
          taxableAmount={taxable.toFixed(2)}
          cgstTotal={(estimatedGst / 2).toFixed(2)}
          sgstTotal={(estimatedGst / 2).toFixed(2)}
          igstTotal="0.00"
          taxAmount={estimatedGst.toFixed(2)}
          totalAmount={finalTotal.toFixed(2)}
          totalAmountBase={baseTotal.toFixed(2)}
          currency={currency}
          exchangeRate={exchangeRate}
        />
      </div>

      {!isReadOnly && (
        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => onSaveDraft && onSaveDraft({
              customerId,
              quotationDate,
              validityDate,
              currency,
              exchangeRate,
              billingAddressId,
              shippingAddressId,
              headerDiscountAmount,
              notes,
              termsAndConditions: terms,
              lines
            })}
            style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
          >
            Save Quotation Draft
          </button>
        </div>
      )}

      {initialData && (
        <QuotationHistoryTimeline quotationNumber={initialData.quotationNumber} revisionNumber={initialData.revisionNumber} />
      )}
    </div>
  );
}

export default QuotationBuilderForm;
