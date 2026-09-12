import React, { useState } from 'react';
import { RFQListTable, RFQListItem } from './RFQListTable';
import { RFQFormModal, RFQFormValues } from './RFQFormModal';
import { SupplierQuotationFormModal, SupplierQuotationFormValues } from './SupplierQuotationFormModal';
import { QuotationComparisonView } from './QuotationComparisonView';

interface RFQHubProps {
  companyId: string;
}

export const RFQHub: React.FC<RFQHubProps> = ({ companyId }) => {
  const [rfqs, setRfqs] = useState<RFQListItem[]>([
    {
      id: 'rfq_01',
      rfqNumber: 'RFQ-2026-0001',
      rfqDate: '2026-09-12',
      responseDueDate: '2026-09-20',
      title: 'Q4 Steel & Fastener Sourcing Request',
      status: 'RESPONSE_OPEN',
      currency: 'INR',
      quotationCount: 2
    }
  ]);
  const [isNewRfqModalOpen, setIsNewRfqModalOpen] = useState(false);
  const [isLogQuoteModalOpen, setIsLogQuoteModalOpen] = useState(false);
  const [activeRfqForQuote, setActiveRfqForQuote] = useState<string | null>(null);
  const [activeRfqForCompare, setActiveRfqForCompare] = useState<string | null>(null);

  const handleCreateRfq = async (values: RFQFormValues) => {
    const newRfq: RFQListItem = {
      id: `rfq_${Date.now()}`,
      rfqNumber: `RFQ-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      rfqDate: new Date().toISOString().split('T')[0],
      responseDueDate: values.responseDueDate,
      title: values.title,
      status: 'PUBLISHED',
      currency: 'INR',
      quotationCount: 0
    };
    setRfqs([newRfq, ...rfqs]);
  };

  const handleLogQuoteSubmit = async (values: SupplierQuotationFormValues) => {
    if (activeRfqForQuote) {
      setRfqs(prev => prev.map(r => r.id === activeRfqForQuote ? { ...r, quotationCount: (r.quotationCount || 0) + 1 } : r));
    }
  };

  const selectedRfqForCompare = rfqs.find(r => r.id === activeRfqForCompare);

  return (
    <div className="space-y-6">
      {activeRfqForCompare && selectedRfqForCompare ? (
        <QuotationComparisonView
          rfqNumber={selectedRfqForCompare.rfqNumber}
          rfqTitle={selectedRfqForCompare.title}
          comparisonItems={[
            {
              rfqLineId: 'rfql_01',
              description: 'Steel Alloy Rod 10mm',
              requestedQuantity: '100.0000',
              uom: 'PCS',
              quotes: [
                {
                  supplierId: 'sup_alpha',
                  supplierName: 'Alpha Metals Ltd',
                  quotationNumber: 'SQ-AM-101',
                  unitPrice: '480.00',
                  quotedQuantity: '100.0000',
                  lineTotal: '48000.00',
                  leadTimeDays: 5,
                  paymentTerms: 'Net 30'
                },
                {
                  supplierId: 'sup_beta',
                  supplierName: 'Beta Industrial Supply',
                  quotationNumber: 'SQ-BI-994',
                  unitPrice: '465.00',
                  quotedQuantity: '100.0000',
                  lineTotal: '46500.00',
                  leadTimeDays: 7,
                  paymentTerms: 'Net 45'
                }
              ]
            }
          ]}
          onBack={() => setActiveRfqForCompare(null)}
          onAward={async (awardedSupId) => {
            setRfqs(prev => prev.map(r => r.id === activeRfqForCompare ? { ...r, status: 'AWARDED' } : r));
            setActiveRfqForCompare(null);
          }}
        />
      ) : (
        <RFQListTable
          rfqs={rfqs}
          onSelectRfq={(id) => setActiveRfqForCompare(id)}
          onNewRfq={() => setIsNewRfqModalOpen(true)}
          onNewQuotation={(rfqId) => {
            setActiveRfqForQuote(rfqId);
            setIsLogQuoteModalOpen(true);
          }}
          onCompare={(rfqId) => setActiveRfqForCompare(rfqId)}
        />
      )}

      <RFQFormModal
        isOpen={isNewRfqModalOpen}
        onClose={() => setIsNewRfqModalOpen(false)}
        onSubmit={handleCreateRfq}
        companyId={companyId}
      />

      <SupplierQuotationFormModal
        isOpen={isLogQuoteModalOpen}
        rfqId={activeRfqForQuote}
        onClose={() => setIsLogQuoteModalOpen(false)}
        onSubmit={handleLogQuoteSubmit}
      />
    </div>
  );
};
