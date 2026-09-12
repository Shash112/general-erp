import React, { useState } from 'react';
import { QuotationListTable, QuotationListItem } from './QuotationListTable';
import { QuotationBuilderForm } from './QuotationBuilderForm';

export function SalesQuotationHub() {
  const [activeView, setActiveView] = useState<'list' | 'builder'>('list');
  const [selectedQuotation, setSelectedQuotation] = useState<any | null>(null);

  // Demo quotations list
  const [quotations, setQuotations] = useState<QuotationListItem[]>([
    {
      id: 'quote_demo_1',
      quotationNumber: 'QT-2026-00001',
      revisionNumber: 1,
      customerName: 'Acme Corporation India Pvt Ltd',
      quotationDate: '2026-09-12',
      validityDate: '2026-10-12',
      currency: 'INR',
      totalAmount: '18,880.00',
      status: 'SENT'
    },
    {
      id: 'quote_demo_2',
      quotationNumber: 'QT-2026-00002',
      revisionNumber: 1,
      customerName: 'TechIndustries Pvt Ltd',
      quotationDate: '2026-09-10',
      validityDate: '2026-10-10',
      currency: 'INR',
      totalAmount: '450,000.00',
      status: 'ACCEPTED'
    }
  ]);

  const handleSelectQuotation = (id: string) => {
    const found = quotations.find(q => q.id === id);
    if (found) {
      setSelectedQuotation({
        ...found,
        billingAddressId: 'addr_hq_billing',
        shippingAddressId: 'addr_wh_shipping',
        headerDiscountAmount: '500.00',
        subtotalAmount: '27,500.00',
        discountAmount: '1,250.00',
        taxableAmount: '26,250.00',
        taxAmount: '4,725.00',
        totalAmount: found.totalAmount,
        totalAmountBase: found.totalAmount,
        lines: [
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
        ]
      });
      setActiveView('builder');
    }
  };

  const handleNewQuotation = () => {
    setSelectedQuotation(null);
    setActiveView('builder');
  };

  const handleActionTrigger = (action: string, id: string, payload?: any) => {
    if (!selectedQuotation) return;
    let newStatus = selectedQuotation.status;

    if (action === 'submit') newStatus = 'APPROVED';
    if (action === 'approve') newStatus = 'APPROVED';
    if (action === 'reject') newStatus = 'REJECTED';
    if (action === 'send') newStatus = 'SENT';
    if (action === 'accept') newStatus = 'ACCEPTED';
    if (action === 'cancel') newStatus = 'CANCELLED';
    if (action === 'convert-contract') {
      alert('✓ QuotationConversionContract issued successfully! Contract ID: qcc_' + Math.random().toString(36).substring(2, 9));
      setSelectedQuotation({
        ...selectedQuotation,
        conversionContractId: 'qcc_' + Math.random().toString(36).substring(2, 9)
      });
      return;
    }
    if (action === 'revision') {
      const rev2 = {
        ...selectedQuotation,
        id: 'quote_demo_' + Date.now(),
        revisionNumber: selectedQuotation.revisionNumber + 1,
        status: 'DRAFT'
      };
      setSelectedQuotation(rev2);
      setQuotations([...quotations.map(q => q.id === id ? { ...q, status: 'REVISED' } : q), {
        id: rev2.id,
        quotationNumber: rev2.quotationNumber,
        revisionNumber: rev2.revisionNumber,
        customerName: rev2.customerName,
        quotationDate: rev2.quotationDate,
        validityDate: rev2.validityDate,
        currency: rev2.currency,
        totalAmount: rev2.totalAmount,
        status: 'DRAFT'
      }]);
      return;
    }

    const updated = { ...selectedQuotation, status: newStatus };
    setSelectedQuotation(updated);
    setQuotations(quotations.map(q => q.id === id ? { ...q, status: newStatus } : q));
  };

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '1rem' }}>
      <header style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, color: '#1e293b', fontSize: '1.75rem' }}>Sales Foundation & Quotations Workbench</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.9rem' }}>
            Phase 3.1 Commercial Proposals, Approval Workflow, Pricing Cascade & Conversion Contract Issuance
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setActiveView('list')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              backgroundColor: activeView === 'list' ? '#2563eb' : '#ffffff',
              color: activeView === 'list' ? '#ffffff' : '#475569',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Quotations Directory
          </button>
          <button
            type="button"
            onClick={handleNewQuotation}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              backgroundColor: activeView === 'builder' ? '#2563eb' : '#ffffff',
              color: activeView === 'builder' ? '#ffffff' : '#475569',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Quotation Builder
          </button>
        </div>
      </header>

      {activeView === 'list' && (
        <QuotationListTable
          quotations={quotations}
          onSelectQuotation={handleSelectQuotation}
          onNewQuotation={handleNewQuotation}
        />
      )}

      {activeView === 'builder' && (
        <QuotationBuilderForm
          initialData={selectedQuotation}
          onSaveDraft={(data) => {
            alert('Quotation Draft Saved Successfully!');
            setActiveView('list');
          }}
          onActionTrigger={handleActionTrigger}
        />
      )}
    </div>
  );
}

export default SalesQuotationHub;
