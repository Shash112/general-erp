import React, { useState } from 'react';
import { PurchaseOrderListTable, PurchaseOrderListItem } from './PurchaseOrderListTable';
import { PurchaseOrderFormModal, PurchaseOrderFormValues } from './PurchaseOrderFormModal';
import { PurchaseOrderDetailsView } from './PurchaseOrderDetailsView';

interface PurchaseOrderHubProps {
  companyId: string;
}

export const PurchaseOrderHub: React.FC<PurchaseOrderHubProps> = ({ companyId }) => {
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const [mockOrders, setMockOrders] = useState<any[]>([
    {
      id: 'po_01',
      poNumber: 'PO-2026-0001',
      supplierId: 'sup_vendor_01',
      supplierName: 'Acme Steel Corp',
      poDate: '2026-09-12',
      expectedDeliveryDate: '2026-09-22',
      status: 'APPROVED',
      currency: 'INR',
      subtotal: '5000.00',
      tax: '900.00',
      grandTotal: '5900.00',
      purchaseRequestNumber: 'PR-2026-0001',
      rfqNumber: 'RFQ-2026-0001',
      supplierQuoteNumber: 'SQ-ACME-881',
      paymentTerms: 'Net 30',
      deliveryTerms: 'FOB Destination',
      lines: [
        {
          lineNumber: 1,
          description: 'High-Grade Steel Alloy Rods 10mm',
          orderedQuantity: '10.0000',
          uom: 'PCS',
          unitPrice: '500.00',
          taxRate: '18.00',
          lineTotal: '5900.00'
        }
      ]
    }
  ]);

  const filteredOrders = mockOrders.filter(o => {
    if (activeTab === 'ALL') return true;
    return o.status === activeTab;
  });

  const selectedOrder = mockOrders.find(o => o.id === selectedOrderId);

  const handleCreateSubmit = async (values: PurchaseOrderFormValues) => {
    const subtotalNum = values.lines.reduce((sum, l) => sum + (parseFloat(l.orderedQuantity) || 0) * (parseFloat(l.unitPrice) || 0), 0);
    const taxNum = subtotalNum * 0.18;
    const grandNum = subtotalNum + taxNum;

    const newPo = {
      id: `po_${Date.now()}`,
      poNumber: `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      supplierId: values.supplierId,
      supplierName: `Supplier ${values.supplierId}`,
      poDate: new Date().toISOString().split('T')[0],
      expectedDeliveryDate: values.expectedDeliveryDate,
      status: 'DRAFT',
      currency: 'INR',
      subtotal: subtotalNum.toFixed(2),
      tax: taxNum.toFixed(2),
      grandTotal: grandNum.toFixed(2),
      purchaseRequestNumber: values.purchaseRequestId || null,
      paymentTerms: values.paymentTerms,
      deliveryTerms: values.deliveryTerms,
      lines: values.lines.map((l, idx) => ({
        lineNumber: idx + 1,
        description: l.description,
        orderedQuantity: l.orderedQuantity,
        uom: l.uom,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate || '18.00',
        lineTotal: ((parseFloat(l.orderedQuantity) || 0) * (parseFloat(l.unitPrice) || 0) * 1.18).toFixed(2)
      }))
    };

    setMockOrders([newPo, ...mockOrders]);
  };

  const handleSubmit = async (id: string) => {
    setMockOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'SUBMITTED' } : o));
  };

  const handleApprove = async (id: string) => {
    setMockOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'APPROVED' } : o));
  };

  const handleIssue = async (id: string) => {
    setMockOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'ISSUED' } : o));
  };

  const handleAcknowledge = async (id: string) => {
    setMockOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'ACKNOWLEDGED' } : o));
  };

  const handleCancel = async (id: string, reason: string) => {
    setMockOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'CANCELLED', cancellationReason: reason } : o));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
            Purchase Orders Workbench
            <span className="text-xs bg-indigo-950 text-indigo-400 border border-indigo-800 px-2 py-0.5 rounded font-mono font-medium">Phase 3.7</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">Manage commercial supplier orders and purchasing commitments</p>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          {['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'ACKNOWLEDGED', 'CANCELLED'].map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedOrderId(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {selectedOrder ? (
        <PurchaseOrderDetailsView
          order={selectedOrder}
          onBack={() => setSelectedOrderId(null)}
          onSubmit={handleSubmit}
          onApprove={handleApprove}
          onIssue={handleIssue}
          onAcknowledge={handleAcknowledge}
          onCancel={handleCancel}
        />
      ) : (
        <PurchaseOrderListTable
          orders={filteredOrders}
          onSelectOrder={(id) => setSelectedOrderId(id)}
          onNewOrder={() => setIsModalOpen(true)}
        />
      )}

      <PurchaseOrderFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateSubmit}
        companyId={companyId}
      />
    </div>
  );
};
