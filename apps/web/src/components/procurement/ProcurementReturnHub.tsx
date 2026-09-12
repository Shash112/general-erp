import React, { useState } from 'react';
import { ProcurementReturnListTable, ProcurementReturnItem } from './ProcurementReturnListTable';
import { ProcurementReturnFormModal } from './ProcurementReturnFormModal';
import { ProcurementReturnDetailsView } from './ProcurementReturnDetailsView';

interface ProcurementReturnHubProps {
  companyId: string;
}

export const ProcurementReturnHub: React.FC<ProcurementReturnHubProps> = ({ companyId }) => {
  const [returns, setReturns] = useState<ProcurementReturnItem[]>([
    {
      id: 'prtn_sample_1',
      returnNumber: 'PRTN-2026-0001',
      supplierId: 'sup_001',
      returnDate: new Date().toISOString().split('T')[0],
      reason: 'Quality failure on raw material',
      status: 'APPROVED',
      subtotalAmount: '5000.00',
      taxAmount: '900.00',
      totalAmount: '5900.00',
      createdAt: new Date().toISOString(),
    },
  ]);

  const [selectedReturn, setSelectedReturn] = useState<ProcurementReturnItem | null>(null);
  const [returnLines, setReturnLines] = useState<any[]>([
    {
      id: 'prl_1',
      lineNumber: 1,
      description: 'Industrial Steel Plates',
      uom: 'KG',
      returnedQuantity: '10.0000',
      unitPrice: '500.00',
      taxableAmount: '5000.00',
      taxAmount: '900.00',
      lineTotal: '5900.00',
    },
  ]);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const handleCreateSubmit = async (formData: any) => {
    const newReturn: ProcurementReturnItem = {
      id: `prtn_${Date.now()}`,
      returnNumber: `PRTN-2026-000${returns.length + 1}`,
      supplierId: formData.supplierId,
      purchaseOrderId: formData.purchaseOrderId,
      goodsReceiptId: formData.goodsReceiptId,
      returnDate: formData.returnDate,
      reason: formData.reason,
      status: 'DRAFT',
      subtotalAmount: formData.lines[0].taxableAmount,
      taxAmount: formData.lines[0].taxAmount,
      totalAmount: formData.lines[0].lineTotal,
      createdAt: new Date().toISOString(),
    };

    setReturns([newReturn, ...returns]);
  };

  const handleSubmit = async () => {
    if (selectedReturn) {
      setSelectedReturn({ ...selectedReturn, status: 'SUBMITTED' });
      setReturns(returns.map(r => r.id === selectedReturn.id ? { ...r, status: 'SUBMITTED' } : r));
    }
  };

  const handleApprove = async () => {
    if (selectedReturn) {
      setSelectedReturn({ ...selectedReturn, status: 'APPROVED' });
      setReturns(returns.map(r => r.id === selectedReturn.id ? { ...r, status: 'APPROVED' } : r));
    }
  };

  const handleComplete = async () => {
    if (selectedReturn) {
      setSelectedReturn({ ...selectedReturn, status: 'COMPLETED' });
      setReturns(returns.map(r => r.id === selectedReturn.id ? { ...r, status: 'COMPLETED' } : r));
    }
  };

  const handleCancel = async () => {
    if (selectedReturn) {
      setSelectedReturn({ ...selectedReturn, status: 'CANCELLED' });
      setReturns(returns.map(r => r.id === selectedReturn.id ? { ...r, status: 'CANCELLED' } : r));
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
      {selectedReturn ? (
        <ProcurementReturnDetailsView
          returnRecord={selectedReturn}
          lines={returnLines}
          onBack={() => setSelectedReturn(null)}
          onSubmit={handleSubmit}
          onApprove={handleApprove}
          onComplete={handleComplete}
          onCancel={handleCancel}
          onCreateDebitNote={() => alert('Debit note creation initialized')}
        />
      ) : (
        <ProcurementReturnListTable
          returns={returns}
          onSelectReturn={(ret) => setSelectedReturn(ret)}
          onCreateNew={() => setIsFormOpen(true)}
        />
      )}

      <ProcurementReturnFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleCreateSubmit}
        companyId={companyId}
      />
    </div>
  );
};
